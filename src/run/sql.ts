export type SqlValue = string | number | boolean | null;

/** Inlines bound parameters as SQL literals. Only for tests and script generation —
 * production queries use the driver's own binding. */
export function inlineParams(sql: string, params: readonly unknown[]): string {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

export interface Statement {
  sql: string;
  params: readonly unknown[];
}

/** A Queryable that can also run many writes in one round trip. */
export interface BatchWriter {
  batch(statements: readonly Statement[]): Promise<void>;
}
