import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Queryable } from "../api/handler.js";
import { inlineParams, type BatchWriter, type Statement } from "./sql.js";

/**
 * Manual-run transport: shells out to `wrangler d1 execute --remote`, which uses the
 * developer's own `wrangler login` — no API token to create or store. Slower than the
 * REST client (each call is a process spawn), so it is for one-off local runs; the
 * scheduled GitHub Actions job uses D1Http with a scoped token.
 */
export class WranglerD1 implements Queryable, BatchWriter {
  constructor(private readonly database = "geopulse", private readonly cwd = process.cwd()) {}

  private wrangler(args: string[]): string {
    // wrangler's own network calls fail transiently; a manual run should ride through that.
    let last = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = spawnSync("npx", ["wrangler", "d1", "execute", this.database, "--remote", ...args], { cwd: this.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (r.status === 0) return r.stdout;
      last = r.stderr || r.stdout;
      if (!/fetch failed|connectivity|ECONN|ETIMEDOUT|ENOTFOUND|5\d\d/.test(last)) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000 * (attempt + 1));
    }
    throw new Error(`wrangler failed: ${last}`);
  }

  async all<T>(sql: string, ...bindings: unknown[]): Promise<T[]> {
    const out = this.wrangler(["--json", "--command", inlineParams(sql, bindings)]);
    const parsed = JSON.parse(out.slice(out.indexOf("["))) as Array<{ results?: T[] }>;
    return parsed[0]?.results ?? [];
  }

  async first<T>(sql: string, ...bindings: unknown[]): Promise<T | null> {
    return (await this.all<T>(sql, ...bindings))[0] ?? null;
  }

  async run(sql: string, ...bindings: unknown[]): Promise<void> {
    this.wrangler(["--command", inlineParams(sql, bindings)]);
  }

  async batch(statements: readonly Statement[]): Promise<void> {
    if (statements.length === 0) return;
    const dir = mkdtempSync(join(tmpdir(), "geopulse-batch-"));
    try {
      const file = join(dir, "batch.sql");
      writeFileSync(file, statements.map((s) => `${inlineParams(s.sql, s.params)};`).join("\n"));
      this.wrangler(["--file", file]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
