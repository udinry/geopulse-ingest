import { spawnSync } from "node:child_process";
import type { Queryable } from "../src/api/handler.js";
import { inlineParams, type BatchWriter, type Statement } from "../src/run/sql.js";
import type { TestDb } from "./dbTestHelper.js";

/** A real SQLite database (same dialect as D1) behind the Queryable the pipeline and API use. */
export class SqliteDb implements Queryable, BatchWriter {
  constructor(private readonly db: TestDb) {}
  async all<T>(sql: string, ...b: unknown[]): Promise<T[]> {
    return this.db.query<T>(inlineParams(sql, b));
  }
  async first<T>(sql: string, ...b: unknown[]): Promise<T | null> { return (await this.all<T>(sql, ...b))[0] ?? null; }
  async run(sql: string, ...b: unknown[]): Promise<void> { this.exec([{ sql, params: b }]); }
  async batch(statements: readonly Statement[]): Promise<void> { this.exec(statements); }
  private exec(statements: readonly Statement[]): void {
    const script = ["PRAGMA foreign_keys=ON;", "BEGIN;", ...statements.map((s) => `${inlineParams(s.sql, s.params)};`), "COMMIT;"].join("\n");
    const r = spawnSync("sqlite3", [this.db.path], { input: script, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`sqlite failed: ${r.stderr}\n${script.slice(0, 400)}`);
  }
}
