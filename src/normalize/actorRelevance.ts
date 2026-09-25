import type { RawGdeltEventRow } from "./gdeltEventParser.js";

/**
 * CAMEO actor-type codes for state, armed, and intergovernmental actors. None collides
 * with an ISO country code, so a composite actor code ("IRNGOV", "USAMIL") can be
 * scanned in 3-letter chunks.
 */
const GEOPOLITICAL_TYPES: ReadonlySet<string> = new Set(["GOV", "MIL", "REB", "INS", "SEP", "UAF", "SPY", "IGO", "IMG"]);

function hasGeopoliticalType(actorCode: string): boolean {
  for (let i = 0; i + 3 <= actorCode.length; i += 3) {
    if (GEOPOLITICAL_TYPES.has(actorCode.slice(i, i + 3))) return true;
  }
  return false;
}

/**
 * GDELT extracts CAMEO events from any article, and CAMEO codes a police "assault" or
 * "coerce" the same as an army's — so a local crime story reads as conflict. An event
 * is kept only if it plausibly is geopolitical: a state, armed, or intergovernmental
 * actor is involved, or it crosses a border (the two actors' countries differ).
 * Purely domestic police/opposition/civilian events are dropped.
 *
 * A deterministic heuristic with a known ceiling — it cannot tell a government actor in
 * a domestic political story from one in a crisis. Corroboration from independent source
 * types (wires, USGS/GDACS) is the real fix; see PLAN.md.
 */
export function isGeopoliticallyRelevant(raw: Pick<RawGdeltEventRow, "actor1Code" | "actor2Code" | "actor1CountryCode" | "actor2CountryCode">): boolean {
  if (hasGeopoliticalType(raw.actor1Code) || hasGeopoliticalType(raw.actor2Code)) return true;
  return raw.actor1CountryCode !== "" && raw.actor2CountryCode !== "" && raw.actor1CountryCode !== raw.actor2CountryCode;
}
