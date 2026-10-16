import { randomUUID } from "node:crypto";
import { ApiClient, object, string, type JsonObject } from "./api.js";

function logStep(label: string, value: unknown): void {
  process.stdout.write(`\n${label}\n${JSON.stringify(value, null, 2)}\n`);
}

function plans(value: unknown): JsonObject[] {
  const list = Array.isArray(value) ? value : object(value, "plans").plans;
  if (!Array.isArray(list)) throw new Error("Unexpected plans response");
  return list.map((item) => object(item, "plan"));
}

function planId(list: JsonObject[], name: string, scope: string): string {
  const match = list.find((plan) => plan.scope === scope && plan.name === name);
  if (!match) throw new Error(`Missing seeded ${scope} plan '${name}'`);
  return string(match.id, "plan ID");
}

function checkDecision(value: unknown, accepted: boolean, level?: string, rule?: string): void {
  const decision = object(value, "consume decision");
  if (decision.accepted !== accepted) {
    throw new Error(`Demo expected accepted=${accepted}, received ${String(decision.accepted)}`);
  }
  if (level || rule) {
    const rejection = object(decision.rejection, "rejection");
    if (rejection.level !== level || rejection.rule !== rule) {
      throw new Error(`Demo expected rejection ${level}/${rule}`);
    }
  }
}

function checkReplay(value: unknown): void {
  if (object(value, "replay").replayed !== true) throw new Error("Demo expected an idempotent replay");
}

export async function runDemo(baseUrl: string, adminToken: string | undefined): Promise<void> {
  if (!adminToken) throw new Error("Set ADMIN_TOKEN to run the demo");
  const suffix = randomUUID().slice(0, 8);
  const admin = new ApiClient(baseUrl, undefined, adminToken);
  const created = object(await admin.createAccount(`demo-${suffix}`, "Starter"), "account creation");
  const apiKey = string(created.apiKey, "API key");
  const api = new ApiClient(baseUrl, apiKey);
  logStep("1. Account created (key withheld from display)", {
    id: created.id,
    name: created.name,
    plan: created.plan,
  });

  const availablePlans = plans(await api.get("/v1/plans"));
  const basicId = planId(availablePlans, "Basic", "user");
  const premiumId = planId(availablePlans, "Premium", "user");
  logStep("2. User ahmad on Basic", await api.post("/v1/users", { externalId: "ahmad", planId: basicId }));
  logStep("3. User sara on Premium", await api.post("/v1/users", { externalId: "sara", planId: premiumId }));

  const custom = object(await api.post("/v1/plans", {
    name: "Demo shared 15",
    scope: "account",
    monthlyLimit: 15,
    maxPerRequest: 100,
  }), "custom plan");
  const customId = string(custom.id, "custom plan ID");
  logStep("4. Configured shared Account allowance of 15", await api.put("/v1/account/plan", { planId: customId }));

  const id1 = `demo-${suffix}-accepted-ahmad`;
  const accepted1 = await api.post("/v1/consume", { userId: "ahmad", units: 10, requestId: id1 });
  checkDecision(accepted1, true);
  logStep("5. Accepted for ahmad", accepted1);

  const userRejected = await api.post("/v1/consume", {
    userId: "ahmad", units: 21, requestId: `demo-${suffix}-user-rule`,
  });
  checkDecision(userRejected, false, "user", "max_per_request");
  logStep("6. Rejected by User max per request", userRejected);

  const accepted2 = await api.post("/v1/consume", {
    userId: "sara", units: 5, requestId: `demo-${suffix}-accepted-sara`,
  });
  checkDecision(accepted2, true);
  logStep("7. Accepted for sara; shared Account allowance is exhausted", accepted2);

  const accountRejected = await api.post("/v1/consume", {
    userId: "ahmad", units: 1, requestId: `demo-${suffix}-account-rule`,
  });
  checkDecision(accountRejected, false, "account", "monthly_allowance");
  logStep("8. Rejected by shared Account monthly allowance", accountRejected);

  logStep("9. Custom Account plan raised to 30", await api.patch(`/v1/plans/${customId}`, { monthlyLimit: 30 }));
  const acceptedAfterChange = await api.post("/v1/consume", {
    userId: "ahmad", units: 1, requestId: `demo-${suffix}-after-change`,
  });
  checkDecision(acceptedAfterChange, true);
  logStep("10. New request accepted after plan change", acceptedAfterChange);

  const replay = await api.post("/v1/consume", { userId: "ahmad", units: 10, requestId: id1 });
  checkReplay(replay);
  logStep("11. Original request replayed without extra consumption", replay);

  logStep("12. Current Account usage", await api.get("/v1/usage"));
  logStep("13. Current User usage", await api.get("/v1/users/ahmad/usage"));
  logStep("14. Request history", await api.get("/v1/requests?limit=20"));
  process.stdout.write("\nDemo completed successfully.\n");
}
