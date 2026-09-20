import { describe, expect, it } from "vitest";
import { matchOutlook } from "../src/outlook/match.js";

describe("outlook matching", () => {
  it("matches deterministic shared tokens without carrying venue fields", () => {
    const match = matchOutlook(
      { id: "s1", title: "Central bank rate decision", category: "centralBankDecision" },
      { id: "m1", question_normalised: "Central bank rate decision this month", category: "centralBankDecision" },
    );
    expect(match).toEqual(expect.objectContaining({ situationId: "s1", marketId: "m1", matchedBy: "category", method: "outlook_match_v1" }));
    expect(match?.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("does not match unrelated questions", () => {
    expect(matchOutlook(
      { id: "s1", title: "Coastal flooding", category: "hurricaneExtremeWeather" },
      { id: "m1", question_normalised: "Central bank rate decision", category: "centralBankDecision" },
    )).toBeNull();
  });
});
