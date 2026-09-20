/**
 * Maps GDELT's CAMEO root event codes (2-digit, 01-20 — the top level of the CAMEO
 * verb taxonomy: https://parusanalytics.com/eventdata/data.dir/cameo.html, codified in
 * the GDELT Event Codebook v2.0) to GeoPulseKit's EventCategory, plus a severity
 * coefficient in [0,1] used by the severity model (docs/planning/2026-09-20-initial-plan.md
 * §6: `Sev = clamp(base(goldstein) × categoryCoeff × quadClassCoeff × geoSignificance)`).
 *
 * Hand-curated once, version-controlled, reviewable — exactly as the plan specifies.
 * Coefficients are ordered by consequence class: routine diplomacy (0.2) up to
 * mass-casualty violence (1.0). This is necessarily a coarse mapping — CAMEO's root
 * codes describe the TYPE of interaction (make a statement, protest, fight, ...), not
 * its domain, so a root code alone cannot distinguish e.g. a trade dispute from a
 * territorial one. Finer categorization (sanctions vs. territorial dispute) needs the
 * full 3-digit CAMEO code or GKG theme tags — a refinement for a later phase, not
 * invented here to paper over the gap.
 *
 * IMPORTANT: CAMEO's political/diplomatic/military taxonomy has no root code for the
 * economic/financial (I-M) or physical-world (N-S) categories from the product brief —
 * those categories are populated from entirely different sources (central bank feeds,
 * USGS, GDACS, NOAA) that this map deliberately does not attempt to cover.
 */
import type { EventCategory } from "../shared/types.js";

export interface CameoRootMapping {
  /** The CAMEO root's short name, from the codebook — for readability/audit only. */
  cameoName: string;
  category: EventCategory;
  /** Severity coefficient in [0,1], by consequence class. */
  severityCoefficient: number;
}

export const CAMEO_ROOT_TO_CATEGORY: Readonly<Record<string, CameoRootMapping>> = {
  "01": { cameoName: "Make public statement", category: "diplomaticNegotiation", severityCoefficient: 0.2 },
  "02": { cameoName: "Appeal", category: "diplomaticNegotiation", severityCoefficient: 0.2 },
  "03": { cameoName: "Express intent to cooperate", category: "diplomaticNegotiation", severityCoefficient: 0.2 },
  "04": { cameoName: "Consult", category: "diplomaticNegotiation", severityCoefficient: 0.25 },
  "05": { cameoName: "Engage in diplomatic cooperation", category: "diplomaticNegotiation", severityCoefficient: 0.25 },
  "06": { cameoName: "Engage in material cooperation", category: "diplomaticNegotiation", severityCoefficient: 0.3 },
  "07": { cameoName: "Provide aid", category: "diplomaticNegotiation", severityCoefficient: 0.3 },
  "08": { cameoName: "Yield", category: "diplomaticNegotiation", severityCoefficient: 0.3 },
  "09": { cameoName: "Investigate", category: "internationalDispute", severityCoefficient: 0.35 },
  "10": { cameoName: "Demand", category: "diplomaticNegotiation", severityCoefficient: 0.4 },
  "11": { cameoName: "Disapprove", category: "internationalDispute", severityCoefficient: 0.4 },
  "12": { cameoName: "Reject", category: "internationalDispute", severityCoefficient: 0.45 },
  "13": { cameoName: "Threaten", category: "internationalDispute", severityCoefficient: 0.55 },
  "14": { cameoName: "Protest", category: "protestCivilUnrest", severityCoefficient: 0.5 },
  "15": { cameoName: "Exhibit military posture", category: "militaryMovement", severityCoefficient: 0.65 },
  "16": { cameoName: "Reduce relations", category: "sanctionsTradeRestriction", severityCoefficient: 0.55 },
  "17": { cameoName: "Coerce", category: "sanctionsTradeRestriction", severityCoefficient: 0.65 },
  "18": { cameoName: "Assault", category: "terrorismSecurityIncident", severityCoefficient: 0.85 },
  "19": { cameoName: "Fight", category: "warArmedConflict", severityCoefficient: 1.0 },
  "20": { cameoName: "Use unconventional mass violence", category: "terrorismSecurityIncident", severityCoefficient: 1.0 },
};

/** Looks up a category+coefficient for a raw EventRootCode field (may have leading zeros
 * stripped by some tools, e.g. "1" vs "01") — normalizes before lookup. Returns `null`
 * (never a guessed default) when the code is genuinely unrecognized, so callers can
 * decide how to handle it rather than silently mis-categorizing. */
export function lookupCameoRoot(rawRootCode: string): CameoRootMapping | null {
  const normalized = rawRootCode.trim().padStart(2, "0");
  return CAMEO_ROOT_TO_CATEGORY[normalized] ?? null;
}
