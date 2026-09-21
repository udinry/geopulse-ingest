import { describe, expect, it } from "vitest";
import { dispatchWatchImpacts } from "../src/alerts/watchImpact.js";
import { APNsError } from "../src/alerts/apns.js";
import { linkAssets } from "../src/link/assetLinks.js";
import type { Queryable } from "../src/api/handler.js";

const hormuz = { id: "s1", title: "Naval buildup near the Strait of Hormuz", category: "militaryMovement", geo_name: null, first_seen_at: "2026-09-21T10:00:00Z" };

class DB implements Queryable {
  writes: Array<{ sql: string; bindings: unknown[] }> = [];
  delivered = new Set<string>();
  constructor(private watches: Array<Record<string, unknown>>, private situations: Array<Record<string, unknown>> = [hormuz]) {}
  async all<T>(sql: string): Promise<T[]> {
    if (sql.includes("FROM device_watches")) return this.watches as T[];
    if (sql.includes("FROM situations")) return this.situations as T[];
    return [];
  }
  async first<T>(sql: string, ...b: unknown[]): Promise<T | null> {
    return sql.includes("FROM watch_deliveries") && this.delivered.has(`${b[0]}|${b[1]}|${b[2]}|${b[4]}`) ? ({ situation_id: "x" } as T) : null;
  }
  async run(sql: string, ...bindings: unknown[]): Promise<void> { this.writes.push({ sql, bindings }); }
}
const watch = (over: Record<string, unknown> = {}) => ({ device_id: "d1", kind: "company", symbol: "XOM", exchange: "NYSE", created_at: "2026-09-21T00:00:00Z", apns_token: "tok", ...over });

describe("asset links", () => {
  it("links a Hormuz conflict to oil and safe-haven assets, and nothing for an unrelated event", () => {
    const symbols = linkAssets(hormuz as never).map((l) => l.symbol);
    expect(symbols).toEqual(expect.arrayContaining(["BRENT", "WTI", "PAXGUSDT", "USDJPY"]));
    expect(linkAssets({ category: "earthquakeTsunami", title: "Quake", geo_name: null })).toEqual([]);
  });
});

describe("watch impact push", () => {
  it("notifies a watcher of an affected company once, recording the delivery", async () => {
    const db = new DB([watch()]);
    const sent: Array<Record<string, unknown>> = [];
    expect(await dispatchWatchImpacts(db, { async send(_t, p) { sent.push(p); } }, "2026-09-21T11:00:00Z")).toBe(1);
    expect(JSON.stringify(sent[0])).toContain("Exxon Mobil may be affected");
    expect(db.writes.some((w) => w.sql.startsWith("INSERT INTO watch_deliveries"))).toBe(true);
  });

  it("notifies a watcher of an affected asset", async () => {
    const db = new DB([watch({ kind: "asset", symbol: "BRENT", exchange: "" })]);
    expect(await dispatchWatchImpacts(db, { async send() {} }, "2026-09-21T11:00:00Z")).toBe(1);
  });

  it("does not notify for a situation that began before the user started watching", async () => {
    const db = new DB([watch({ created_at: "2026-09-21T10:30:00Z" })]);
    expect(await dispatchWatchImpacts(db, { async send() { throw new Error("must not send"); } }, "2026-09-21T11:00:00Z")).toBe(0);
  });

  it("does not notify for an unaffected watch or a duplicate delivery", async () => {
    const other = new DB([watch({ symbol: "JPM" })]);
    expect(await dispatchWatchImpacts(other, { async send() { throw new Error("must not send"); } }, "2026-09-21T11:00:00Z")).toBe(0);
    const dup = new DB([watch()]);
    dup.delivered.add("d1|company|XOM|s1");
    expect(await dispatchWatchImpacts(dup, { async send() { throw new Error("must not send"); } }, "2026-09-21T11:00:00Z")).toBe(0);
  });

  it("caps pushes per device per run and leaves the rest unrecorded for a later tick", async () => {
    const watches = ["XOM", "CVX", "COP", "SHEL", "BP"].map((symbol) => watch({ symbol }));
    const db = new DB(watches);
    expect(await dispatchWatchImpacts(db, { async send() {} }, "2026-09-21T11:00:00Z")).toBe(3);
  });

  it("removes a dead device and keeps going after another failure", async () => {
    const db = new DB([watch({ device_id: "dead", apns_token: "bad" }), watch({ device_id: "flaky", apns_token: "err" }), watch({ device_id: "ok", apns_token: "good" })]);
    const n = await dispatchWatchImpacts(db, { async send(t) { if (t === "bad") throw new APNsError(400, "BadDeviceToken"); if (t === "err") throw new APNsError(400, "BadPayload"); } }, "2026-09-21T11:00:00Z");
    expect(n).toBe(1);
    expect(db.writes.some((w) => w.sql === "DELETE FROM devices WHERE id = ?" && w.bindings[0] === "dead")).toBe(true);
  });
});
