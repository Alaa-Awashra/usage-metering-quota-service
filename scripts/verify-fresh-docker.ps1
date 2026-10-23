# Phase 4: isolated, destructive-to-ITS-OWN-TEMPORARY-STACK fresh Docker verification.
# Never invokes 'docker compose down -v' without a unique test-only -p project name.
# Designed for the Usage Metering & Quota Service compose configuration. Docker execution must be verified on Windows.

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$project = 'umqsphase4' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$variableNames = @('ADMIN_TOKEN', 'API_HOST_PORT', 'DB_HOST_PORT')
$previous = @{}
foreach ($name in $variableNames) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function New-LocalPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return [int]$listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Require([bool]$ok, [string]$message) {
    if (-not $ok) { throw $message }
}

function Run-Compose([string[]]$arguments) {
    & docker compose -p $project @arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('docker compose ' + ($arguments -join ' ') + ' failed')
    }
}

function Read-DatabaseSnapshot {
    $sql = @'
SELECT json_build_object(
  'migrations', (SELECT COUNT(*) FROM drizzle.__drizzle_migrations),
  'global_plans', (SELECT COUNT(*) FROM plans WHERE owner_account_id IS NULL),
  'accounts', (SELECT COUNT(*) FROM accounts),
  'requests', (SELECT COUNT(*) FROM consume_requests),
  'account_units', (SELECT COALESCE(SUM(used),0) FROM account_monthly_usage),
  'user_units', (SELECT COALESCE(SUM(used),0) FROM user_monthly_usage)
)::text;
'@
    $output = & docker compose -p $project exec -T db psql -X -q -t -A -U meter -d metering -c $sql
    if ($LASTEXITCODE -ne 0) { throw 'Failed to read disposable PostgreSQL database' }
    $json = ($output -join "`n").Trim()
    Require ($json.StartsWith('{')) ('Unexpected PostgreSQL response: ' + $json)
    return ($json | ConvertFrom-Json)
}

$started = $false
Push-Location $projectRoot
try {
    Require (Test-Path 'docker-compose.yml') 'Run this script from the project directory (docker-compose.yml missing)'
    Require (Test-Path 'client/Dockerfile') 'Client Dockerfile is missing'
    Require (Test-Path 'service/Dockerfile') 'Service Dockerfile is missing'

    # Random secrets are in this process only; no .env file or repository data is changed.
    $secretBytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($secretBytes) } finally { $generator.Dispose() }
    $adminToken = ([BitConverter]::ToString($secretBytes) -replace '-', '').ToLowerInvariant()
    $apiPort = New-LocalPort
    $dbPort = New-LocalPort
    while ($dbPort -eq $apiPort) { $dbPort = New-LocalPort }

    [Environment]::SetEnvironmentVariable('ADMIN_TOKEN', $adminToken, 'Process')
    [Environment]::SetEnvironmentVariable('API_HOST_PORT', [string]$apiPort, 'Process')
    [Environment]::SetEnvironmentVariable('DB_HOST_PORT', [string]$dbPort, 'Process')

    Write-Host "[1/7] Isolated Compose project: $project"
    Write-Host "      Fresh host ports: API=$apiPort DB=$dbPort (existing stack untouched)"
    & docker compose -p $project config --services | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Docker Compose configuration failed'

    Write-Host '[2/7] Starting fresh db, api, and demo client from an empty isolated Docker volume...'
    $started = $true
    Run-Compose -arguments @('up', '--build', '-d')

    Write-Host '[3/7] Waiting for the one-shot client demo to exit successfully...'
    # Use Compose's structured status output. On Windows PowerShell, piping
    # `docker inspect -f '{{...}}'` through Select-Object can be unreliable.
    # This avoids native Go-template quoting and works with Compose v5.
    $finished = $false
    for ($i = 0; $i -lt 90; $i++) {
        $psOutput = (& docker compose -p $project ps --all --format json client) -join "`n"
        Require ($LASTEXITCODE -eq 0) 'Could not query the client status using Docker Compose'
        if (-not [string]::IsNullOrWhiteSpace($psOutput)) {
            try {
                $entries = @($psOutput | ConvertFrom-Json)
            }
            catch {
                throw ('Could not parse Docker Compose client status: ' + $psOutput)
            }
            $clientStatus = $entries | Where-Object { $_.Service -eq 'client' } | Select-Object -First 1
            if ($null -ne $clientStatus -and [string]$clientStatus.State -eq 'exited') {
                if ([int]$clientStatus.ExitCode -ne 0) {
                    & docker compose -p $project logs --no-color client
                    throw ("Client demo failed with exit code {0}" -f $clientStatus.ExitCode)
                }
                $finished = $true
                break
            }
        }
        Start-Sleep -Seconds 2
    }
    Require $finished 'Client did not exit successfully within 180 seconds'
    $demoLogs = (& docker compose -p $project logs --no-color client) -join "`n"
    Require ($LASTEXITCODE -eq 0) 'Cannot fetch client logs'
    Require ($demoLogs -match 'Demo completed successfully\.') 'Client exited 0 but expected demo success marker is missing'
    Write-Host '      PASS: plain docker compose up ran the complete client demo.'

    Write-Host '[4/7] Checking API readiness, fresh migrations, Plan seeding, and committed consumption...'
    $ready = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/readyz" -f $apiPort) -TimeoutSec 15
    Require ($ready.status -eq 'ready') 'API is not ready after fresh startup'
    $before = Read-DatabaseSnapshot
    Require ([int64]$before.migrations -ge 1) 'Drizzle migration record missing after fresh boot'
    Require ([int64]$before.global_plans -eq 4) 'Expected exactly four seeded global Plans'
    Require ([int64]$before.accounts -eq 1) 'Demo should create one Account in empty database'
    Require ([int64]$before.requests -eq 5) 'Demo should persist five distinct decisions (replay creates none)'
    Require ([int64]$before.account_units -eq 16) 'Demo account usage should equal 16'
    Require ([int64]$before.user_units -eq 16) 'Demo combined user usage should equal 16'
    Write-Host ("      PASS: migrations={0}, global_plans={1}, accounts={2}, decisions={3}, used={4}" -f $before.migrations, $before.global_plans, $before.accounts, $before.requests, $before.account_units)

    Write-Host '[5/7] Removing only temporary containers, preserving the temporary database volume...'
    Run-Compose -arguments @('down', '--remove-orphans') # IMPORTANT: no -v here.

    Write-Host '[6/7] Recreating db and API with the SAME volume, verifying migrations and seeding are idempotent...'
    Run-Compose -arguments @('up', '-d', '--wait', '--wait-timeout', '180', 'db', 'api')
    $readyAfter = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/readyz" -f $apiPort) -TimeoutSec 15
    Require ($readyAfter.status -eq 'ready') 'API failed readiness after full container recreation'
    $after = Read-DatabaseSnapshot
    foreach ($key in @('migrations', 'global_plans', 'accounts', 'requests', 'account_units', 'user_units')) {
        Require ([string]$before.$key -eq [string]$after.$key) ("Persistence mismatch in ${key}: before=$($before.$key), after=$($after.$key)")
    }
    Write-Host '      PASS: all rows, counters, seeded Plans, and migrations persisted without duplicates.'

    Write-Host '[7/7] PHASE 4 PASS: fresh Docker start, full demo, migrations, persisted data and clean recreation.'
}
finally {
    # This generated project name is unique for THIS check. Never touch the user's default stack.
    if ($started) {
        Write-Host 'Cleaning up ONLY the temporary phase-4 project and its disposable volume...'
        try {
            & docker compose -p $project down --volumes --remove-orphans | Out-Null
            if ($LASTEXITCODE -ne 0) { Write-Warning "Temporary cleanup failed. Review project: $project" }
        }
        catch { Write-Warning "Temporary cleanup failed for $project : $_" }
    }
    foreach ($name in $variableNames) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
    Pop-Location
}
