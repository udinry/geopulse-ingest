import { describe, expect, it } from "vitest";
import { dispatchAlerts } from "../src/alerts/dispatch.js";
import { APNsError } from "../src/alerts/apns.js";
import type { AlertRow } from "../src/shared/types.js";
import type { Queryable } from "../src/api/handler.js";

const alert: AlertRow = { id: "a1", device_id: "d1", kind: "price", subject_type: "asset", subject_id: "btc", operator: "gte", threshold: 100, window_minutes: null, combinator_group_id: null, live_activity: 1, is_active: 1, last_fired_at: null, cooldown_minutes: 15 };

class DispatchDB implements Queryable {
  writes: string[] = [];
  async all<T>(sql: string): Promise<T[]> {
    if (sql.includes("JOIN devices")) return [{ ...alert, apns_token: "token" }] as T[];
    if (sql.includes("asset_prices")) return [{ price: 101 }, { price: 99 }] as T[];
    return [];
  }
  async first<T>(): Promise<T | null> { return null; }
  async run(sql: string): Promise<void> { this.writes.push(sql); }
}

describe("alert dispatch", () => {
  it("sends a threshold event and records its delivery", async () => {
    const db = new DispatchDB();
    const payloads: Record<string, unknown>[] = [];
    const delivered = await dispatchAlerts(db, { async send(_token, payload) { payloads.push(payload); } }, "2026-09-20T01:00:00.000Z");
    expect(delivered).toBe(1);
    expect(payloads[0]).toHaveProperty("aps.content-state.status", "Triggered");
    expect(db.writes).toHaveLength(2);
  });

  it("removes an invalid APNs device without recording a false delivery", async () => {
    const db = new DispatchDB();
    await dispatchAlerts(db, { async send() { throw new APNsError(400, "BadDeviceToken"); } }, "2026-09-20T01:00:00.000Z");
    expect(db.writes).toEqual(["DELETE FROM devices WHERE apns_token = ?"]);
  });

  it("retries a transient APNs failure and then records delivery", async () => {
    const db = new DispatchDB();
    let attempts = 0;
    const delivered = await dispatchAlerts(db, { async send() { attempts += 1; if (attempts === 1) throw new APNsError(500, null); } }, "2026-09-20T01:00:00.000Z");
    expect(delivered).toBe(1);
    expect(attempts).toBe(2);
    expect(db.writes).toHaveLength(2);
  });

  it("does not retry a permanent client error, and does not abort delivery to other devices", async () => {
    const db = new DispatchDB();
    let attempts = 0;
    const delivered = await dispatchAlerts(db, { async send() { attempts += 1; throw new APNsError(400, "BadPayload"); } }, "2026-09-20T01:00:00.000Z");
    expect(delivered).toBe(0);
    expect(attempts).toBe(1);
    expect(db.writes).toHaveLength(0);
  });

  it("skips an already-recorded delivery", async () => {
    class DuplicateDB extends DispatchDB {
      override async first<T>(): Promise<T | null> { return { alert_id: "a1" } as T; }
    }
    const db = new DuplicateDB();
    let attempts = 0;
    const delivered = await dispatchAlerts(db, { async send() { attempts += 1; } }, "2026-09-20T01:00:00.000Z");
    expect(delivered).toBe(0);
    expect(attempts).toBe(0);
  });

  it("fires a crosses alert on an outlook market using its stored previous probability", async () => {
    const outlookAlert: AlertRow = { id: "a2", device_id: "d1", kind: "outlook", subject_type: "market", subject_id: "m1", operator: "crosses", threshold: 0.3, window_minutes: null, combinator_group_id: null, live_activity: 0, is_active: 1, last_fired_at: null, cooldown_minutes: 15 };
    class OutlookDB implements Queryable {
      writes: string[] = [];
      async all<T>(sql: string): Promise<T[]> {
        return sql.includes("JOIN devices") ? [{ ...outlookAlert, apns_token: "token" }] as T[] : [];
      }
      async first<T>(sql: string): Promise<T | null> {
        return sql.includes("outlook_markets") ? { probability: 0.35, prev_probability: 0.25 } as T : null;
      }
      async run(sql: string): Promise<void> { this.writes.push(sql); }
    }
    const db = new OutlookDB();
    const delivered = await dispatchAlerts(db, { async send() {} }, "2026-09-20T01:00:00.000Z");
    expect(delivered).toBe(1);
  });

  it("does not fire a crosses alert on an outlook market with no recorded previous probability", async () => {
    const outlookAlert: AlertRow = { id: "a2", device_id: "d1", kind: "outlook", subject_type: "market", subject_id: "m1", operator: "crosses", threshold: 0.3, window_minutes: null, combinator_group_id: null, live_activity: 0, is_active: 1, last_fired_at: null, cooldown_minutes: 15 };
    class OutlookDB implements Queryable {
      async all<T>(sql: string): Promise<T[]> {
        return sql.includes("JOIN devices") ? [{ ...outlookAlert, apns_token: "token" }] as T[] : [];
      }
      async first<T>(sql: string): Promise<T | null> {
        return sql.includes("outlook_markets") ? { probability: 0.35, prev_probability: null } as T : null;
      }
      async run(): Promise<void> {}
    }
    const delivered = await dispatchAlerts(new OutlookDB(), { async send() {} }, "2026-09-20T01:00:00.000Z");
    expect(delivered).toBe(0);
  });

  it("keeps delivering to other devices after one alert's delivery fails permanently", async () => {
    const alertB: AlertRow = { ...alert, id: "a2" };
    class MultiDB implements Queryable {
      writes: string[] = [];
      async all<T>(sql: string): Promise<T[]> {
        if (sql.includes("JOIN devices")) return [{ ...alert, apns_token: "bad" }, { ...alertB, apns_token: "good" }] as T[];
        if (sql.includes("asset_prices")) return [{ price: 101 }, { price: 99 }] as T[];
        return [];
      }
      async first<T>(): Promise<T | null> { return null; }
      async run(sql: string): Promise<void> { this.writes.push(sql); }
    }
    const db = new MultiDB();
    const delivered = await dispatchAlerts(db, {
      async send(token) { if (token === "bad") throw new APNsError(400, "BadPayload"); },
    }, "2026-09-20T01:00:00.000Z");
    expect(delivered).toBe(1);
  });
});
