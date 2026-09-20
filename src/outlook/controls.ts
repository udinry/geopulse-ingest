import type { Queryable } from "../api/handler.js";

export async function isOutlookEnabled(db: Queryable, regionISO: string | null): Promise<boolean> {
  if (regionISO === null) return true;
  const control = await db.first<{ is_enabled: number }>("SELECT is_enabled FROM outlook_controls WHERE region_iso = ?", regionISO.toUpperCase());
  return control?.is_enabled !== 0;
}

export async function setOutlookKillSwitch(db: Queryable, regionISO: string, enabled: boolean, reason: string | null, updatedAt: string): Promise<void> {
  await db.run("INSERT INTO outlook_controls (region_iso, is_enabled, reason, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(region_iso) DO UPDATE SET is_enabled = excluded.is_enabled, reason = excluded.reason, updated_at = excluded.updated_at", regionISO.toUpperCase(), enabled ? 1 : 0, reason, updatedAt);
}

/** Pins a situation to a market regardless of whether the deterministic matcher ever linked them. */
export async function setManualOutlookLink(db: Queryable, situationID: string, marketID: string, verified: boolean): Promise<void> {
  await db.run(
    "INSERT INTO situation_outlook (situation_id, market_id, confidence, matched_by, is_manually_verified, method) VALUES (?, ?, 1, 'manual', ?, 'manual_override_v1') "
    + "ON CONFLICT(situation_id, market_id) DO UPDATE SET confidence = 1, matched_by = 'manual', is_manually_verified = excluded.is_manually_verified, method = 'manual_override_v1'",
    situationID, marketID, verified ? 1 : 0,
  );
}
