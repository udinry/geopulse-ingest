import { describe, expect, it } from "vitest";
import { CAMEO_ROOT_TO_CATEGORY, lookupCameoRoot } from "../src/normalize/cameoCategoryMap.js";

const VALID_CATEGORIES = new Set([
  "warArmedConflict", "militaryMovement", "terrorismSecurityIncident",
  "electionPoliticalTransition", "protestCivilUnrest", "diplomaticNegotiation",
  "sanctionsTradeRestriction", "internationalDispute", "centralBankDecision",
  "macroDataRelease", "fiscalPolicy", "bankingFinancialSystem", "majorCorporateEvent",
  "oilEnergyDisruption", "shippingMaritimeDisruption", "aviationDisruption",
  "earthquakeTsunami", "hurricaneExtremeWeather", "majorFireIndustrialAccident",
]);

describe("CAMEO_ROOT_TO_CATEGORY", () => {
  it("covers all 20 CAMEO root codes (01-20)", () => {
    const codes = Object.keys(CAMEO_ROOT_TO_CATEGORY).sort();
    const expected = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"));
    expect(codes).toEqual(expected);
  });

  it("every mapping points to a real EventCategory", () => {
    for (const mapping of Object.values(CAMEO_ROOT_TO_CATEGORY)) {
      expect(VALID_CATEGORIES.has(mapping.category)).toBe(true);
    }
  });

  it("every severity coefficient is within [0,1]", () => {
    for (const mapping of Object.values(CAMEO_ROOT_TO_CATEGORY)) {
      expect(mapping.severityCoefficient).toBeGreaterThanOrEqual(0);
      expect(mapping.severityCoefficient).toBeLessThanOrEqual(1);
    }
  });

  it("severity coefficients are ordered by consequence class: Fight (19) and mass violence (20) are highest", () => {
    const fight = CAMEO_ROOT_TO_CATEGORY["19"]!.severityCoefficient;
    const massViolence = CAMEO_ROOT_TO_CATEGORY["20"]!.severityCoefficient;
    const statement = CAMEO_ROOT_TO_CATEGORY["01"]!.severityCoefficient;
    expect(fight).toBeGreaterThan(statement);
    expect(massViolence).toBeGreaterThan(statement);
  });
});

describe("lookupCameoRoot", () => {
  it("normalizes a single-digit code with a leading zero", () => {
    expect(lookupCameoRoot("1")).toEqual(lookupCameoRoot("01"));
  });

  it("returns null for a genuinely unrecognized code, never a default guess", () => {
    expect(lookupCameoRoot("99")).toBeNull();
    expect(lookupCameoRoot("")).toBeNull();
  });
});
