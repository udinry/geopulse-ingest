import type { Queryable } from "../api/handler.js";
import { linkAssets } from "../link/assetLinks.js";
import { linkCompanies } from "../link/companyLinks.js";
import type { EventCategory } from "../shared/types.js";
import { APNsError } from "./apns.js";
import type { APNsSender } from "./dispatch.js";

interface WatchRow { device_id: string; kind: "company" | "asset"; symbol: string; exchange: string; created_at: string; apns_token: string }
interface SituationRow { id: string; title: string; category: EventCategory; geo_name: string | null; first_seen_at: string }

const MAX_PUSHES_PER_DEVICE_PER_RUN = 3;

/**
 * Pushes when a map-visible situation that emerged AFTER a device started watching
 * a company/asset is linked to it by a named rule (src/link). Event-driven, so it
 * needs no price. Each (watch, situation) pair notifies once; the per-run cap
 * spreads a burst over later ticks because unsent pairs are simply not recorded.
 */
export async function dispatchWatchImpacts(db: Queryable, sender: APNsSender, now: string): Promise<number> {
  const watches = await db.all<WatchRow>("SELECT w.device_id, w.kind, w.symbol, w.exchange, w.created_at, d.apns_token FROM device_watches w JOIN devices d ON d.id = w.device_id");
  if (watches.length === 0) return 0;
  const situations = await db.all<SituationRow>("SELECT id, title, category, geo_name, first_seen_at FROM situations WHERE status = 'active' AND map_rank IS NOT NULL");

  const impacted = new Map<string, { title: string; names: Map<string, string> }>();
  for (const situation of situations) {
    const names = new Map<string, string>();
    for (const company of linkCompanies(situation, 50)) names.set(`company|${company.symbol}|${company.exchange}`, company.name);
    for (const asset of linkAssets(situation)) names.set(`asset|${asset.symbol}|`, asset.name);
    if (names.size > 0) impacted.set(situation.id, { title: situation.title, names });
  }

  let delivered = 0;
  const sentPerDevice = new Map<string, number>();
  const deadDevices = new Set<string>();
  for (const situation of situations) {
    const hit = impacted.get(situation.id);
    if (hit === undefined) continue;
    for (const watch of watches) {
      if (deadDevices.has(watch.device_id)) continue;
      if (situation.first_seen_at < watch.created_at) continue;
      const name = hit.names.get(`${watch.kind}|${watch.symbol}|${watch.exchange}`);
      if (name === undefined) continue;
      if ((sentPerDevice.get(watch.device_id) ?? 0) >= MAX_PUSHES_PER_DEVICE_PER_RUN) continue;
      const already = await db.first("SELECT situation_id FROM watch_deliveries WHERE device_id = ? AND kind = ? AND symbol = ? AND exchange = ? AND situation_id = ?", watch.device_id, watch.kind, watch.symbol, watch.exchange, situation.id);
      if (already !== null) continue;
      const payload = {
        aps: { alert: { title: `${name} may be affected`, body: hit.title }, sound: "default" },
        geoPulse: { situationID: situation.id, kind: watch.kind, symbol: watch.symbol },
      };
      try {
        await sender.send(watch.apns_token, payload);
      } catch (error) {
        if (error instanceof APNsError && (error.reason === "BadDeviceToken" || error.reason === "Unregistered")) {
          await db.run("DELETE FROM devices WHERE id = ?", watch.device_id);
          deadDevices.add(watch.device_id);
        } else {
          console.error(`watch push for ${watch.device_id} failed`, error);
        }
        continue;
      }
      await db.run("INSERT INTO watch_deliveries (device_id, kind, symbol, exchange, situation_id, delivered_at) VALUES (?, ?, ?, ?, ?, ?)", watch.device_id, watch.kind, watch.symbol, watch.exchange, situation.id, now);
      sentPerDevice.set(watch.device_id, (sentPerDevice.get(watch.device_id) ?? 0) + 1);
      delivered += 1;
    }
  }
  return delivered;
}
