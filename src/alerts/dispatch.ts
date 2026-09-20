import type { AlertRow } from "../shared/types.js";
import { deliveryKey, evaluateAlert } from "./evaluate.js";
import type { Queryable } from "../api/handler.js";
import { APNsError } from "./apns.js";

interface AlertWithDevice extends AlertRow { apns_token: string; }

export interface APNsSender {
  send(token: string, payload: Record<string, unknown>): Promise<void>;
}

async function sendWithRetry(sender: APNsSender, token: string, payload: Record<string, unknown>): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await sender.send(token, payload);
      return;
    } catch (error) {
      if (error instanceof APNsError && (error.reason === "BadDeviceToken" || error.reason === "Unregistered")) throw error;
      if (attempt >= 2 || (error instanceof APNsError && error.status < 500 && error.status !== 429)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

async function currentValue(db: Queryable, alert: AlertRow): Promise<{ current: number; previous?: number } | null> {
  if (alert.subject_type === "asset") {
    const rows = await db.all<{ price: number }>("SELECT price FROM asset_prices WHERE asset_id = ? ORDER BY ts DESC LIMIT 2", alert.subject_id);
    if (rows[0] === undefined) return null;
    return rows[1] === undefined ? { current: rows[0].price } : { current: rows[0].price, previous: rows[1].price };
  }
  if (alert.subject_type === "situation") {
    const row = await db.first<{ trending_score: number }>("SELECT trending_score FROM situations WHERE id = ?", alert.subject_id);
    return row === null ? null : { current: row.trending_score };
  }
  const row = await db.first<{ probability: number; prev_probability: number | null }>("SELECT probability, prev_probability FROM outlook_markets WHERE id = ? AND is_resolved = 0", alert.subject_id);
  if (row === null) return null;
  return row.prev_probability === null ? { current: row.probability } : { current: row.probability, previous: row.prev_probability };
}

/** Evaluates active rules and records a delivery only after APNs accepts it. */
export async function dispatchAlerts(db: Queryable, sender: APNsSender, now: string): Promise<number> {
  const alerts = await db.all<AlertWithDevice>("SELECT a.*, d.apns_token FROM alerts a JOIN devices d ON d.id = a.device_id WHERE a.is_active = 1");
  let delivered = 0;
  for (const alert of alerts) {
    const value = await currentValue(db, alert);
    if (value === null) continue;
    const evaluation = value.previous === undefined
      ? evaluateAlert({ alert, currentValue: value.current, now })
      : evaluateAlert({ alert, currentValue: value.current, previousValue: value.previous, now });
    if (!evaluation.shouldFire) continue;
    const payloadHash = deliveryKey(alert, now, value.current);
    const duplicate = await db.first("SELECT alert_id FROM alert_deliveries WHERE alert_id = ? AND payload_hash = ?", alert.id, payloadHash);
    if (duplicate !== null) continue;
    const payload = { aps: { alert: { title: "GeoPulse alert", body: "A watched value crossed your threshold." }, sound: "default", ...(alert.live_activity === 1 ? { "content-state": { status: "Triggered", updatedAt: now } } : {}) }, geoPulse: { alertID: alert.id, subjectType: alert.subject_type, subjectID: alert.subject_id, value: value.current } };
    try {
      await sendWithRetry(sender, alert.apns_token, payload);
    } catch (error) {
      if (error instanceof APNsError && (error.reason === "BadDeviceToken" || error.reason === "Unregistered")) {
        await db.run("DELETE FROM devices WHERE apns_token = ?", alert.apns_token);
      } else {
        // A single alert's delivery failing (bad payload, transient outage after
        // retries, etc.) must not abort delivery to every other device this tick.
        console.error(`alert ${alert.id} delivery failed`, error);
      }
      continue;
    }
    await db.run("INSERT INTO alert_deliveries (alert_id, fired_at, payload_hash) VALUES (?, ?, ?)", alert.id, now, payloadHash);
    await db.run("UPDATE alerts SET last_fired_at = ? WHERE id = ?", now, alert.id);
    delivered += 1;
  }
  return delivered;
}
