import { describe, expect, it } from "vitest";
import { COMPANIES, RULES, linkCompanies, quoteURL } from "../src/link/companyLinks.js";

describe("company links", () => {
  it("links a Hormuz conflict to energy and shipping names via named rules, without any price", () => {
    const links = linkCompanies({ category: "militaryMovement", title: "Naval buildup near the Strait of Hormuz", geo_name: null });
    const symbols = links.map((link) => link.symbol);
    expect(symbols).toContain("XOM");
    expect(symbols).toContain("RELIANCE");
    expect(symbols).toContain("ZIM");
    for (const link of links) {
      expect(link.ruleId).toBeTruthy();
      expect(link.quoteURL).toMatch(/^https:\/\/www\.google\.com\/finance\/quote\//);
      expect(Object.keys(link)).not.toContain("price");
    }
  });

  it("does not link a keyword in an unrelated category when the rule needs both", () => {
    const links = linkCompanies({ category: "protestCivilUnrest", title: "Taiwan protest over red sea prices", geo_name: null });
    expect(links).toEqual([]);
  });

  it("is deterministic and de-duplicates a company matched by several rules", () => {
    const input = { category: "shippingMaritimeDisruption" as const, title: "Red Sea shipping attacks", geo_name: "Red Sea" };
    const a = linkCompanies(input);
    expect(a).toEqual(linkCompanies(input));
    expect(new Set(a.map((l) => l.symbol)).size).toBe(a.length);
  });

  it("returns nothing when no rule applies, rather than guessing", () => {
    expect(linkCompanies({ category: "earthquakeTsunami", title: "Earthquake in Chile", geo_name: null })).toEqual([]);
  });

  it("only references registered companies and builds exchange-qualified links", () => {
    for (const rule of RULES) for (const symbol of rule.companies) expect(COMPANIES[symbol]).toBeDefined();
    expect(quoteURL(COMPANIES["RELIANCE"]!)).toBe("https://www.google.com/finance/quote/RELIANCE:NSE");
    expect(quoteURL(COMPANIES["MAERSK-B"]!)).toBe("https://www.google.com/finance/quote/MAERSK-B:CPH");
  });
});
