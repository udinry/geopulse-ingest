/**
 * Test-only helper: applies migrations/*.sql to a throwaway SQLite file via the
 * system `sqlite3` CLI (no native driver dependency — D1 uses the same SQL dialect,
 * so this is the real portability check for Phase 1's "schema round-trips" DoD).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export class TestDb {
  readonly path: string;
  private readonly dir: string;

  private constructor(dir: string, path: string) {
    this.dir = dir;
    this.path = path;
  }

  static createWithMigrations(): TestDb {
    const dir = mkdtempSync(join(tmpdir(), "geopulse-schema-"));
    const path = join(dir, "test.sqlite");
    const db = new TestDb(dir, path);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const result = spawnSync("sqlite3", [path], {
        input: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
        encoding: "utf8",
      });
      if (result.status !== 0) {
        throw new Error(`Migration ${file} failed:\n${result.stderr}`);
      }
    }
    return db;
  }

  /** Runs a statement with no expected output (INSERT/UPDATE/DDL). */
  exec(sql: string): void {
    const result = spawnSync("sqlite3", [this.path], { input: sql, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`exec failed:\n${sql}\n${result.stderr}`);
    }
  }

  /** Runs a SELECT and returns parsed JSON rows via sqlite3's -json output mode. */
  query<T = Record<string, unknown>>(sql: string): T[] {
    const result = spawnSync("sqlite3", ["-json", this.path], { input: sql, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`query failed:\n${sql}\n${result.stderr}`);
    }
    const trimmed = result.stdout.trim();
    return trimmed.length === 0 ? [] : (JSON.parse(trimmed) as T[]);
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Escapes a value for inline SQL literal use — fine for fixed, developer-controlled
 * seed/test data; never use this pattern for untrusted input in real ingestion code. */
export function sqlLiteral(value: string | number | boolean | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${value.replace(/'/g, "''")}'`;
}
