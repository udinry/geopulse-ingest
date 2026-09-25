import type { Queryable } from "../api/handler.js";
import type { BatchWriter, Statement } from "./sql.js";

export interface D1HttpConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
}

interface D1Result<T> { results?: T[]; success?: boolean }
interface D1Envelope<T> { success: boolean; errors?: Array<{ message: string }>; result?: Array<D1Result<T>> }

/**
 * Cloudflare D1 over its REST API, so a GitHub Actions runner (which is where
 * ingestion runs — a free Worker's 10ms CPU can't) can read and write the same
 * database the Worker serves. Uses native parameter binding.
 */
export class D1Http implements Queryable, BatchWriter {
  private readonly url: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: D1HttpConfig) {
    this.url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
    this.apiToken = config.apiToken;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async post<T>(body: unknown): Promise<Array<D1Result<T>>> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      const json = await response.json() as D1Envelope<T>;
      if (!response.ok || !json.success) {
        throw new Error(`D1 request failed (${response.status}): ${json.errors?.map((e) => e.message).join("; ") ?? "unknown error"}`);
      }
      return json.result ?? [];
    }
  }

  async all<T>(sql: string, ...bindings: unknown[]): Promise<T[]> {
    const result = await this.post<T>({ sql, params: bindings });
    return result[0]?.results ?? [];
  }

  async first<T>(sql: string, ...bindings: unknown[]): Promise<T | null> {
    return (await this.all<T>(sql, ...bindings))[0] ?? null;
  }

  async run(sql: string, ...bindings: unknown[]): Promise<void> {
    await this.post({ sql, params: bindings });
  }

  /** One request, applied in order, for up to `chunk` statements at a time. */
  async batch(statements: readonly Statement[], chunk = 50): Promise<void> {
    for (let i = 0; i < statements.length; i += chunk) {
      await this.post({ batch: statements.slice(i, i + chunk).map((s) => ({ sql: s.sql, params: s.params })) });
    }
  }
}
