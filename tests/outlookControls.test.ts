import { describe, expect, it } from "vitest";
import { isOutlookEnabled, setManualOutlookLink, setOutlookKillSwitch } from "../src/outlook/controls.js";
import type { Queryable } from "../src/api/handler.js";

class ControlsDB implements Queryable {
  writes: Array<{ sql: string; bindings: unknown[] }> = [];
  constructor(private control: { is_enabled: number } | null = null) {}
  async all<T>(): Promise<T[]> { return []; }
  async first<T>(sql: string): Promise<T | null> {
    return sql.includes("outlook_controls") ? (this.control as T) : null;
  }
  async run(sql: string, ...bindings: unknown[]): Promise<void> {
    this.writes.push({ sql, bindings });
  }
}

describe("outlook controls", () => {
  it("enables outlook by default and respects the kill-switch row", async () => {
    expect(await isOutlookEnabled(new ControlsDB(), null)).toBe(true);
    expect(await isOutlookEnabled(new ControlsDB(null), "IN")).toBe(true);
    expect(await isOutlookEnabled(new ControlsDB({ is_enabled: 0 }), "in")).toBe(false);
    expect(await isOutlookEnabled(new ControlsDB({ is_enabled: 1 }), "IN")).toBe(true);
  });

  it("upper-cases the region when persisting the kill-switch", async () => {
    const db = new ControlsDB();
    await setOutlookKillSwitch(db, "in", false, "ops", "2026-09-20T00:00:00Z");
    expect(db.writes[0]?.bindings[0]).toBe("IN");
    expect(db.writes[0]?.bindings[1]).toBe(0);
  });

  it("writes manual overrides with the auditable method name", async () => {
    const db = new ControlsDB();
    await setManualOutlookLink(db, "s1", "m1", true);
    expect(db.writes[0]?.sql).toContain("manual_override_v1");
    expect(db.writes[0]?.bindings).toEqual(["s1", "m1", 1]);
  });

  it("creates a manual override even when the pair was never auto-matched", async () => {
    const db = new ControlsDB();
    await setManualOutlookLink(db, "new-situation", "new-market", false);
    expect(db.writes[0]?.sql).toContain("INSERT INTO situation_outlook");
    expect(db.writes[0]?.sql).toContain("ON CONFLICT(situation_id, market_id)");
    expect(db.writes[0]?.bindings).toEqual(["new-situation", "new-market", 0]);
  });
});
