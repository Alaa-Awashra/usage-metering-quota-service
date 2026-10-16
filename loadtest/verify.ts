export interface DecisionRecord {
  requestId: string;
  units: number;
  accepted: boolean;
  userId?: string;
}

export interface ObservedDecision extends DecisionRecord {
  accountIndex: number;
  userIndex: number;
  replayed: boolean;
}

export interface AccountObservation {
  accountIndex: number;
  used: number;
  users: Array<{ index: number; used: number }>;
  history: DecisionRecord[];
}

export interface Verification {
  ok: boolean;
  failures: string[];
  accountCount: number;
  historyRows: number;
  acceptedHistoryUnits: number;
}

/** Cross-check the HTTP decisions, persisted history, and both counter levels. */
export function verifyResults(
  decisions: ObservedDecision[],
  accounts: AccountObservation[],
): Verification {
  const failures: string[] = [];
  let historyRows = 0;
  let acceptedHistoryUnits = 0;
  const observedByAccount = new Map<number, Map<string, ObservedDecision>>();
  for (const decision of decisions) {
    let account = observedByAccount.get(decision.accountIndex);
    if (!account) {
      account = new Map();
      observedByAccount.set(decision.accountIndex, account);
    }
    const previous = account.get(decision.requestId);
    if (previous && (previous.accepted !== decision.accepted || previous.units !== decision.units || previous.userIndex !== decision.userIndex)) {
      failures.push(`Account ${decision.accountIndex}: replay changed decision ${decision.requestId}`);
    }
    account.set(decision.requestId, decision);
  }

  for (const account of accounts) {
    const historyIds = new Set<string>();
    const observed = observedByAccount.get(account.accountIndex) ?? new Map();
    let acceptedUnits = 0;
    for (const row of account.history) {
      historyRows++;
      if (historyIds.has(row.requestId)) {
        failures.push(`Account ${account.accountIndex}: duplicate history request ${row.requestId}`);
      }
      historyIds.add(row.requestId);
      const decision = observed.get(row.requestId);
      if (!decision) {
        failures.push(`Account ${account.accountIndex}: unknown history request ${row.requestId}`);
      } else if (decision.accepted !== row.accepted || decision.units !== row.units) {
        failures.push(`Account ${account.accountIndex}: history differs from response for ${row.requestId}`);
      }
      if (row.accepted) acceptedUnits += row.units;
    }
    acceptedHistoryUnits += acceptedUnits;
    if (historyIds.size !== observed.size) {
      failures.push(`Account ${account.accountIndex}: ${historyIds.size} history rows for ${observed.size} unique HTTP decisions`);
    }
    if (account.used !== acceptedUnits) {
      failures.push(`Account ${account.accountIndex}: counter ${account.used} differs from accepted history ${acceptedUnits}`);
    }
    const expectedByUser = new Map<number, number>();
    for (const decision of observed.values()) {
      if (decision.accepted) {
        expectedByUser.set(decision.userIndex, (expectedByUser.get(decision.userIndex) ?? 0) + decision.units);
      }
    }
    let userTotal = 0;
    for (const user of account.users) {
      const expected = expectedByUser.get(user.index) ?? 0;
      if (user.used !== expected) {
        failures.push(`Account ${account.accountIndex}, user ${user.index}: counter ${user.used} differs from accepted decisions ${expected}`);
      }
      userTotal += user.used;
    }
    if (userTotal !== account.used) {
      failures.push(`Account ${account.accountIndex}: user counter sum ${userTotal} differs from account counter ${account.used}`);
    }
  }
  return { ok: failures.length === 0, failures, accountCount: accounts.length, historyRows, acceptedHistoryUnits };
}
