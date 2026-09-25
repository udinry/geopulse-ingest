import { describe, expect, it } from "vitest";
import { isGeopoliticallyRelevant } from "../src/normalize/actorRelevance.js";

const row = (a1: string, a2: string, c1 = "", c2 = "") => ({ actor1Code: a1, actor2Code: a2, actor1CountryCode: c1, actor2CountryCode: c2 });

describe("geopolitical relevance", () => {
  it("drops domestic police/opposition/civilian events, e.g. a local crime story", () => {
    expect(isGeopoliticallyRelevant(row("COP", "OPP"))).toBe(false);
    expect(isGeopoliticallyRelevant(row("FRA", "COP", "FRA", ""))).toBe(false);
    expect(isGeopoliticallyRelevant(row("", "", "", ""))).toBe(false);
    expect(isGeopoliticallyRelevant(row("USACOP", "USACVL", "USA", "USA"))).toBe(false);
  });

  it("keeps events with a state, armed or intergovernmental actor", () => {
    expect(isGeopoliticallyRelevant(row("ETHGOV", "", "ETH", ""))).toBe(true);
    expect(isGeopoliticallyRelevant(row("", "SDNREB", "", "SDN"))).toBe(true);
    expect(isGeopoliticallyRelevant(row("USAMIL", "IRNGOVMIL", "USA", "IRN"))).toBe(true);
    expect(isGeopoliticallyRelevant(row("IGO", "", "", ""))).toBe(true);
  });

  it("keeps cross-border events even with civilian actors", () => {
    expect(isGeopoliticallyRelevant(row("CHN", "USA", "CHN", "USA"))).toBe(true);
    expect(isGeopoliticallyRelevant(row("CHN", "CHN", "CHN", "CHN"))).toBe(false);
  });
});
