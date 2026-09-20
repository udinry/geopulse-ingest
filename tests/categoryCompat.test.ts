import { describe, expect, it } from "vitest";
import { categoryCompat, pillarOf } from "../src/cluster/categoryCompat.js";

describe("categoryCompat", () => {
  it("is 1.0 for identical categories", () => {
    expect(categoryCompat("militaryMovement", "militaryMovement")).toBe(1.0);
  });

  it("is higher for same-pillar categories than cross-pillar ones", () => {
    const samePillar = categoryCompat("militaryMovement", "warArmedConflict"); // both geopolitical
    const crossPillar = categoryCompat("militaryMovement", "macroDataRelease"); // geopolitical vs economic
    expect(samePillar).toBeGreaterThan(crossPillar);
  });

  it("is symmetric", () => {
    expect(categoryCompat("militaryMovement", "earthquakeTsunami")).toBe(
      categoryCompat("earthquakeTsunami", "militaryMovement")
    );
  });

  it("is never zero — a cross-pillar join is discouraged, not made impossible", () => {
    expect(categoryCompat("militaryMovement", "oilEnergyDisruption")).toBeGreaterThan(0);
  });

  it("correctly assigns pillars matching the product brief's own grouping", () => {
    expect(pillarOf("warArmedConflict")).toBe("geopolitical");
    expect(pillarOf("centralBankDecision")).toBe("economic");
    expect(pillarOf("earthquakeTsunami")).toBe("physical");
  });
});
