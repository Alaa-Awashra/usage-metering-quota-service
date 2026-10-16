import { randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiClient, isObject, object, string, type JsonObject } from "./api.js";
import { runDemo } from "./demo.js";

type Config = { apiKey: string; accountId: string; baseUrl: string };
type Plan = JsonObject & { id: string; name: string; scope: "account" | "user" };

function configPath(): string {
  return process.env.CLIENT_CONFIG_FILE ?? join(homedir(), ".usage-metering-client.json");
}

async function readConfig(): Promise<Config | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(configPath(), "utf8"));
    const record = object(data, "client configuration");
    return {
      apiKey: string(record.apiKey, "apiKey"),
      accountId: string(record.accountId, "accountId"),
      baseUrl: string(record.baseUrl, "baseUrl"),
    };
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeConfig(config: Config): Promise<void> {
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(configPath(), 0o600);
}

function required(arg: string | undefined, label: string): string {
  if (!arg) throw new Error(`Missing ${label}; run 'client help' for usage`);
  return arg;
}

function positiveUnits(raw: string | undefined): number {
  const value = Number(required(raw, "units"));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Units must be a positive safe integer");
  }
  return value;
}

function asPlans(value: unknown): Plan[] {
  const raw = Array.isArray(value) ? value : object(value, "plans").plans;
  if (!Array.isArray(raw)) throw new Error("Unexpected plans response");
  return raw.map((item) => {
    const plan = object(item, "plan");
    const scope = string(plan.scope, "plan scope");
    if (scope !== "account" && scope !== "user") throw new Error("Unexpected plan scope");
    return { ...plan, id: string(plan.id, "plan id"), name: string(plan.name, "plan name"), scope };
  });
}

export async function findPlan(api: ApiClient, name: string, scope: "account" | "user"): Promise<Plan> {
  const plans = asPlans(await api.get("/v1/plans"));
  const match = plans.find((plan) => plan.scope === scope && plan.name.toLowerCase() === name.toLowerCase());
  if (!match) throw new Error(`No visible ${scope} plan named '${name}'`);
  return match;
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const help = `Usage Metering CLI

Environment:
  API_BASE_URL        API address (default http://localhost:3000)
  ADMIN_TOKEN         Required for create-account and demo
  API_KEY             Optional account key override
  CLIENT_CONFIG_FILE  Optional local key/config file path

Commands:
  create-account <name> <account-plan-name>
  add-user <external-id> <user-plan-name>
  process-doc <external-id> <units> [request-id]
  usage [external-id] [YYYY-MM]
  switch-plan <external-id> <user-plan-name>
  history [external-id]
  demo
  help

The create-account command stores the returned API key in a private local config file.
The demo keeps its API key in memory and uses a new account on every run.
`;

export async function runCommand(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help);
    return;
  }

  const config = await readConfig();
  const baseUrl = process.env.API_BASE_URL ?? config?.baseUrl ?? "http://localhost:3000";
  if (command === "demo") {
    await runDemo(baseUrl, process.env.ADMIN_TOKEN);
    return;
  }

  if (command === "create-account") {
    const name = required(args[1], "account name");
    const requestedPlan = required(args[2], "account plan name");
    const planName = ({ starter: "Starter", pro: "Pro" } as Record<string, string>)[requestedPlan.toLowerCase()] ?? requestedPlan;
    const api = new ApiClient(baseUrl, undefined, process.env.ADMIN_TOKEN);
    const result = object(await api.createAccount(name, planName), "account creation");
    const accountId = string(result.id, "account id");
    const apiKey = string(result.apiKey, "API key");
    await writeConfig({ accountId, apiKey, baseUrl });
    printJson({ id: accountId, name: result.name, plan: result.plan, configFile: configPath() });
    process.stdout.write("API key saved locally; this CLI will use it for later commands.\n");
    return;
  }

  const apiKey = process.env.API_KEY ?? config?.apiKey;
  if (!apiKey) throw new Error("Create an account first, or set API_KEY");
  const api = new ApiClient(baseUrl, apiKey);
  switch (command) {
    case "add-user": {
      const externalId = required(args[1], "external user ID");
      const plan = await findPlan(api, required(args[2], "user plan name"), "user");
      printJson(await api.post("/v1/users", { externalId, planId: plan.id }));
      return;
    }
    case "process-doc": {
      const userId = required(args[1], "external user ID");
      const units = positiveUnits(args[2]);
      const requestId = args[3] ?? `cli-${randomUUID()}`;
      printJson(await api.post("/v1/consume", { userId, units, requestId }));
      return;
    }
    case "usage": {
      const userId = args[1];
      const month = args[2];
      const path = userId ? `/v1/users/${encodeURIComponent(userId)}/usage` : "/v1/usage";
      printJson(await api.get(month ? `${path}?month=${encodeURIComponent(month)}` : path));
      return;
    }
    case "switch-plan": {
      const userId = required(args[1], "external user ID");
      const plan = await findPlan(api, required(args[2], "user plan name"), "user");
      printJson(await api.put(`/v1/users/${encodeURIComponent(userId)}/plan`, { planId: plan.id }));
      return;
    }
    case "history": {
      const userId = args[1];
      printJson(await api.get(userId ? `/v1/requests?userId=${encodeURIComponent(userId)}` : "/v1/requests"));
      return;
    }
    default:
      throw new Error(`Unknown command '${command}'; run 'client help'`);
  }
}
