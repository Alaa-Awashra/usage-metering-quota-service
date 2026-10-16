import { randomUUID } from 'node:crypto';

export type ScenarioName = 'distributed' | 'hot' | 'retries' | 'plan-changes' | 'rejection';

export interface WorkItem {
  account: number;
  user: number;
  units: number;
  requestId: string;
}

export interface ScenarioOptions {
  scenario: ScenarioName;
  requests: number;
  accounts?: number;
  usersPerAccount?: number;
}

export interface ScenarioDefinition {
  name: ScenarioName;
  accountCount: number;
  usersPerAccount: number;
  items: WorkItem[];
  mutationAt?: number;
}

/** The generated identifiers make every run independent of persistent database data. */
export function makeScenario(options: ScenarioOptions): ScenarioDefinition {
  const { scenario, requests } = options;
  if (!Number.isSafeInteger(requests) || requests < 1) {
    throw new Error('--requests must be a positive safe integer');
  }
  const accountCount = options.accounts ?? (scenario === 'distributed' ? 50 : 1);
  const usersPerAccount = options.usersPerAccount ??
    (scenario === 'distributed' ? 10 : scenario === 'hot' ? 200 : 20);
  if (!Number.isSafeInteger(accountCount) || accountCount < 1 || accountCount > 1000) {
    throw new Error('--accounts must be between 1 and 1000');
  }
  if (!Number.isSafeInteger(usersPerAccount) || usersPerAccount < 1 || usersPerAccount > 1000) {
    throw new Error('--users must be between 1 and 1000');
  }

  const runId = randomUUID();
  const items: WorkItem[] = [];
  const uniqueCount = scenario === 'retries' ? Math.max(1, Math.ceil(requests * 0.8)) : requests;
  for (let i = 0; i < uniqueCount; i++) {
    items.push({
      account: i % accountCount,
      user: Math.floor(i / accountCount) % usersPerAccount,
      units: scenario === 'rejection' ? 101 : 1,
      requestId: `${runId}-${i}`,
    });
  }
  if (scenario === 'retries') {
    const duplicates = requests - uniqueCount;
    // Half race with the first submission; the other half run after it completes.
    const racing = Math.ceil(duplicates / 2);
    for (let i = 0; i < racing; i++) {
      items.splice(Math.min(items.length, i * 3 + 1), 0, { ...items[i * 3 % uniqueCount]! });
    }
    for (let i = racing; i < duplicates; i++) {
      items.push({ ...items[i % uniqueCount]! });
    }
  }
  return {
    name: scenario,
    accountCount,
    usersPerAccount,
    items,
    mutationAt: scenario === 'plan-changes' ? Math.max(1, Math.floor(items.length / 3)) : undefined,
  };
}
