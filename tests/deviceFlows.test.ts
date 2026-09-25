import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/api/handler.js";
import { dispatchAlerts } from "../src/alerts/dispatch.js";
import { dispatchWatchImpacts } from "../src/alerts/watchImpact.js";
import { TestDb } from "./dbTestHelper.js";
import { SqliteDb } from "./sqliteDb.js";

/** The device, alert, watch, and deletion flows against a real SQLite database with the real migrations (FKs on). */
let raw: TestDb;
let db: SqliteDb;
const sent: Array<{ token: string; payload: Record<string, unknown> }> = [];
const sender = { async send(token: string, payload: Record<string, unknown>) { sent.push({ token, payload }); } };
const call = (path: string, init: RequestInit & { device?: string } = {}) =>
  handleRequest(new Request(`https://api.test${path}`, { ...init, headers: { ...(init.device ? { "x-device-id": init.device } : {}), ...(init.headers as Record<string, string> | undefined) } }), { db, now: () => "2026-09-25T10:00:00Z" });
const json = (body: unknown) => ({ body: JSON.stringify(body) });

beforeEach(() => {
  raw = TestDb.createWithMigrations();
  db = new SqliteDb(raw);
  sent.length = 0;
  raw.exec(`
    INSERT INTO assets (id, symbol, name, class, currency, data_source, license_class) VALUES ('btc-usdt', 'BTCUSDT', 'Bitcoin', 'crypto', 'USD', 'binance', 'green');
    INSERT INTO assets (id, symbol, name, class, currency, data_source, license_class) VALUES ('ixic', 'IXIC', 'NASDAQ', 'index', 'USD', 'none', 'red');
    INSERT INTO asset_prices (asset_id, ts, price, as_of, session_state) VALUES ('btc-usdt', '2026-09-25T09:50:00Z', 90, '2026-09-25T09:50:00Z', 'continuous');
  `);
});
afterEach(() => raw.cleanup());

describe("device, alert and watch flows on real SQL", () => {
  it("registers a device, validates alerts, fires a price alert once within its cooldown", async () => {
    expect((await call("/v1/devices", { method: "POST", ...json({ id: "dev1", apnsToken: "tok1" }) })).status).toBe(201);
    const bad = (body: object) => call("/v1/alerts", { method: "POST", device: "dev1", ...json(body) });
    expect((await bad({ kind: "price", subjectType: "asset", subjectID: "btc-usdt", operator: "sideways", threshold: 100 })).status).toBe(400);
    expect((await bad({ kind: "price", subjectType: "asset", subjectID: "ixic", operator: "gt", threshold: 100 })).status).toBe(400); // red-licensed asset
    expect((await bad({ kind: "price", subjectType: "asset", subjectID: "nope", operator: "gt", threshold: 100 })).status).toBe(400);
    const created = await bad({ kind: "price", subjectType: "asset", subjectID: "btc-usdt", operator: "gt", threshold: 100, cooldownMinutes: 240 });
    expect(created.status).toBe(201);

    expect(await dispatchAlerts(db, sender, "2026-09-25T10:00:00Z")).toBe(0); // price 90, threshold 100
    raw.exec("INSERT INTO asset_prices (asset_id, ts, price, as_of, session_state) VALUES ('btc-usdt', '2026-09-25T10:05:00Z', 150, '2026-09-25T10:05:00Z', 'continuous');");
    expect(await dispatchAlerts(db, sender, "2026-09-25T10:06:00Z")).toBe(1);
    expect(sent[0]?.token).toBe("tok1");
    expect(await dispatchAlerts(db, sender, "2026-09-25T10:20:00Z")).toBe(0); // inside the 240-minute cooldown
    expect(await dispatchAlerts(db, sender, "2026-09-25T14:30:00Z")).toBe(1); // cooldown over, still above
    const list = await (await call("/v1/alerts", { device: "dev1" })).json() as { alerts: Array<{ id: string; isActive: number }> };
    expect(list.alerts).toHaveLength(1);
    expect((await call(`/v1/alerts/${list.alerts[0]!.id}`, { method: "PATCH", device: "dev1", ...json({ isActive: false }) })).status).toBe(200);
    expect(await dispatchAlerts(db, sender, "2026-09-25T20:00:00Z")).toBe(0); // paused
  });

  it("pushes about an emerged situation linked to a followed company, once", async () => {
    await call("/v1/devices", { method: "POST", ...json({ id: "dev2", apnsToken: "tok2" }) });
    expect((await call("/v1/watches", { method: "PUT", device: "dev2", ...json({ watches: [{ kind: "company", symbol: "XOM", exchange: "NYSE" }, { kind: "asset", symbol: "BRENT" }] }) })).status).toBe(200);
    raw.exec(`
      INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at, map_rank, source_count)
      VALUES ('sit1', 'hormuz', 'Naval buildup near the Strait of Hormuz', 'militaryMovement', 26.5, 56.3, 'active', '2026-09-25T10:30:00Z', '2026-09-25T10:30:00Z', 1, 5);
      INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at, map_rank, source_count)
      VALUES ('old', 'old-hormuz', 'Older Hormuz story', 'militaryMovement', 26.5, 56.3, 'active', '2026-09-24T10:30:00Z', '2026-09-24T10:30:00Z', 2, 5);
    `);
    // 'old' began before the device started watching, so only sit1 counts.
    expect(await dispatchWatchImpacts(db, sender, "2026-09-25T11:00:00Z")).toBe(2); // XOM company + BRENT asset for sit1
    expect(await dispatchWatchImpacts(db, sender, "2026-09-25T11:15:00Z")).toBe(0);
    expect(JSON.stringify(sent.map((s) => s.payload))).toContain("may be affected");
  });

  it("lets a device delete itself and everything the server holds for it, and nobody else's", async () => {
    await call("/v1/devices", { method: "POST", ...json({ id: "dev3", apnsToken: "tok3" }) });
    await call("/v1/devices", { method: "POST", ...json({ id: "other", apnsToken: "tok4" }) });
    await call("/v1/alerts", { method: "POST", device: "dev3", ...json({ kind: "price", subjectType: "asset", subjectID: "btc-usdt", operator: "gt", threshold: 100 }) });
    await call("/v1/watches", { method: "PUT", device: "dev3", ...json({ watches: [{ kind: "asset", symbol: "WTI" }] }) });
    raw.exec("INSERT INTO asset_prices (asset_id, ts, price, as_of, session_state) VALUES ('btc-usdt', '2026-09-25T10:05:00Z', 150, '2026-09-25T10:05:00Z', 'continuous');");
    await dispatchAlerts(db, sender, "2026-09-25T10:06:00Z"); // creates an alert_delivery row referencing the alert

    expect((await call("/v1/devices/dev3", { method: "DELETE", device: "other" })).status).toBe(403);
    expect((await call("/v1/devices/dev3", { method: "DELETE" })).status).toBe(403);
    expect((await call("/v1/devices/dev3", { method: "DELETE", device: "dev3" })).status).toBe(204);
    const count = (sql: string) => raw.query<{ n: number }>(sql)[0]!.n;
    expect(count("SELECT COUNT(*) n FROM devices WHERE id = 'dev3'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM alerts WHERE device_id = 'dev3'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM alert_deliveries")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM device_watches WHERE device_id = 'dev3'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM devices WHERE id = 'other'")).toBe(1);
  });
});
