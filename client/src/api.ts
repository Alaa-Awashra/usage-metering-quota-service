export type JsonObject = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
  ) {
    super(`HTTP ${status}: ${describeError(detail)}`);
    this.name = "ApiError";
  }
}

function describeError(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (isObject(detail)) {
    if (typeof detail.message === "string") return detail.message;
    if (isObject(detail.error) && typeof detail.error.message === "string") {
      return detail.error.message;
    }
    if (typeof detail.error === "string") return detail.error;
  }
  return "request failed";
}

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function object(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`Unexpected ${label} response`);
  return value;
}

export function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Missing ${label} in API response`);
  return value;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly adminToken?: string,
  ) {}

  async request(method: string, path: string, body?: JsonObject, admin = false): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (admin) {
      if (!this.adminToken) throw new Error("Set ADMIN_TOKEN to create an account");
      headers["X-Admin-Token"] = this.adminToken;
    } else if (this.apiKey) {
      headers.Authorization = `ApiKey ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const data: unknown = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) throw new ApiError(response.status, data);
    return data;
  }

  get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  post(path: string, body: JsonObject): Promise<unknown> {
    return this.request("POST", path, body);
  }

  put(path: string, body: JsonObject): Promise<unknown> {
    return this.request("PUT", path, body);
  }

  patch(path: string, body: JsonObject): Promise<unknown> {
    return this.request("PATCH", path, body);
  }

  createAccount(name: string, planName: string): Promise<unknown> {
    return this.request("POST", "/admin/accounts", { name, planName }, true);
  }
}
