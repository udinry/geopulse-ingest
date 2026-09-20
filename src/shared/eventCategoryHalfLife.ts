/**
 * Mirrors GeoPulseKit's EventCategory.scoreHalfLifeHours byte-for-byte — see
 * GeoPulse/Packages/GeoPulseKit/Sources/GeoPulseKit/Models/EventCategory.swift.
 * This is the third independent copy of this table (Swift enum property, here, and the
 * conceptual half-life values cited in the planning doc) — no shared source of truth
 * across the language boundary, so keep all copies in sync if these ever change (see
 * CLAUDE.md's note on this).
 *
 * Used here for the clustering similarity function's time-proximity term
 * (planning doc §8: `timeProximity = exp(-Δt / halflife(category))`) — the same decay
 * shape that drives the trending score, reused because a category's natural "story
 * arc" length is the same whether you're asking "does this new event still belong to
 * that situation" or "how much should this event's impulse still count."
 */
import type { EventCategory } from "./types.js";

export const EVENT_CATEGORY_HALF_LIFE_HOURS: Readonly<Record<EventCategory, number>> = {
  earthquakeTsunami: 6,
  hurricaneExtremeWeather: 6,
  majorFireIndustrialAccident: 6,
  majorCorporateEvent: 12,
  oilEnergyDisruption: 12,
  shippingMaritimeDisruption: 12,
  aviationDisruption: 12,
  centralBankDecision: 24,
  macroDataRelease: 24,
  fiscalPolicy: 24,
  bankingFinancialSystem: 24,
  protestCivilUnrest: 48,
  electionPoliticalTransition: 48,
  militaryMovement: 120,
  terrorismSecurityIncident: 120,
  sanctionsTradeRestriction: 120,
  diplomaticNegotiation: 120,
  warArmedConflict: 240,
  internationalDispute: 240,
};
