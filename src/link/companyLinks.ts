import { CONFLICT, ruleMatches, type LinkInput, type RuleBase } from "./ruleMatch.js";

/**
 * Situation -> company links. Reference data only: this module never carries or
 * fetches a price. The client opens `quoteURL` in an in-app browser sheet, so the
 * user's own browser retrieves the quote from the third-party site and GeoPulse
 * redistributes no exchange data (docs/ARCHITECTURE.md, market data section).
 *
 * Every link traces to a named rule below (`ruleId`) with a curated, static
 * rationale — no generated prose, no scoring, no learned association. Adding a
 * company or rule is a reviewed code change, like the CAMEO category table.
 */

export interface Company {
  symbol: string;
  name: string;
  /** Google Finance exchange code, used only to build the outbound quote link. */
  exchange: string;
  country: "US" | "IN" | "DK" | "GB" | "TW";
}

export const COMPANIES: Readonly<Record<string, Company>> = {
  XOM: { symbol: "XOM", name: "Exxon Mobil", exchange: "NYSE", country: "US" },
  CVX: { symbol: "CVX", name: "Chevron", exchange: "NYSE", country: "US" },
  COP: { symbol: "COP", name: "ConocoPhillips", exchange: "NYSE", country: "US" },
  SHEL: { symbol: "SHEL", name: "Shell", exchange: "NYSE", country: "GB" },
  BP: { symbol: "BP", name: "BP", exchange: "NYSE", country: "GB" },
  RELIANCE: { symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE", country: "IN" },
  ONGC: { symbol: "ONGC", name: "Oil and Natural Gas Corporation", exchange: "NSE", country: "IN" },
  IOC: { symbol: "IOC", name: "Indian Oil Corporation", exchange: "NSE", country: "IN" },
  BPCL: { symbol: "BPCL", name: "Bharat Petroleum", exchange: "NSE", country: "IN" },
  LMT: { symbol: "LMT", name: "Lockheed Martin", exchange: "NYSE", country: "US" },
  RTX: { symbol: "RTX", name: "RTX", exchange: "NYSE", country: "US" },
  NOC: { symbol: "NOC", name: "Northrop Grumman", exchange: "NYSE", country: "US" },
  GD: { symbol: "GD", name: "General Dynamics", exchange: "NYSE", country: "US" },
  HAL: { symbol: "HAL", name: "Hindustan Aeronautics", exchange: "NSE", country: "IN" },
  BEL: { symbol: "BEL", name: "Bharat Electronics", exchange: "NSE", country: "IN" },
  ZIM: { symbol: "ZIM", name: "ZIM Integrated Shipping", exchange: "NYSE", country: "US" },
  "MAERSK-B": { symbol: "MAERSK-B", name: "A.P. Moller - Maersk", exchange: "CPH", country: "DK" },
  ADANIPORTS: { symbol: "ADANIPORTS", name: "Adani Ports and SEZ", exchange: "NSE", country: "IN" },
  SCI: { symbol: "SCI", name: "Shipping Corporation of India", exchange: "NSE", country: "IN" },
  DAL: { symbol: "DAL", name: "Delta Air Lines", exchange: "NYSE", country: "US" },
  UAL: { symbol: "UAL", name: "United Airlines", exchange: "NASDAQ", country: "US" },
  BA: { symbol: "BA", name: "Boeing", exchange: "NYSE", country: "US" },
  INDIGO: { symbol: "INDIGO", name: "InterGlobe Aviation (IndiGo)", exchange: "NSE", country: "IN" },
  JPM: { symbol: "JPM", name: "JPMorgan Chase", exchange: "NYSE", country: "US" },
  GS: { symbol: "GS", name: "Goldman Sachs", exchange: "NYSE", country: "US" },
  HDFCBANK: { symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE", country: "IN" },
  SBIN: { symbol: "SBIN", name: "State Bank of India", exchange: "NSE", country: "IN" },
  TSM: { symbol: "TSM", name: "Taiwan Semiconductor (ADR)", exchange: "NYSE", country: "TW" },
  NVDA: { symbol: "NVDA", name: "NVIDIA", exchange: "NASDAQ", country: "US" },
  INTC: { symbol: "INTC", name: "Intel", exchange: "NASDAQ", country: "US" },
};

interface Rule extends RuleBase {
  companies: readonly string[];
  rationale: string;
}

export const RULES: readonly Rule[] = [
  {
    id: "energy_supply",
    categories: ["oilEnergyDisruption"],
    companies: ["XOM", "CVX", "COP", "SHEL", "BP", "RELIANCE", "ONGC", "IOC", "BPCL"],
    rationale: "Oil and gas producers and refiners whose earnings follow energy supply.",
  },
  {
    id: "energy_chokepoint",
    categories: [...CONFLICT, "shippingMaritimeDisruption", "terrorismSecurityIncident"],
    keywords: ["hormuz", "persian gulf", "red sea", "suez", "bab el-mandeb", "bab al-mandab", "gulf of aden"],
    requireBoth: true,
    companies: ["XOM", "CVX", "SHEL", "BP", "RELIANCE", "ONGC", "IOC", "BPCL"],
    rationale: "Energy companies exposed to disruption of a major oil shipping route.",
  },
  {
    id: "shipping_disruption",
    categories: ["shippingMaritimeDisruption"],
    companies: ["ZIM", "MAERSK-B", "ADANIPORTS", "SCI"],
    rationale: "Container lines and port operators directly affected by shipping disruption.",
  },
  {
    id: "chokepoint_shipping",
    categories: [...CONFLICT, "terrorismSecurityIncident"],
    keywords: ["hormuz", "red sea", "suez", "bab el-mandeb", "bab al-mandab", "gulf of aden", "malacca", "taiwan strait"],
    requireBoth: true,
    companies: ["ZIM", "MAERSK-B", "ADANIPORTS", "SCI"],
    rationale: "Shipping and port companies on routes affected by the dispute.",
  },
  {
    id: "defense_conflict",
    categories: ["warArmedConflict", "militaryMovement"],
    companies: ["LMT", "RTX", "NOC", "GD", "HAL", "BEL"],
    rationale: "Defence contractors whose orders track armed-conflict activity.",
  },
  {
    id: "aviation_disruption",
    categories: ["aviationDisruption"],
    companies: ["DAL", "UAL", "BA", "INDIGO"],
    rationale: "Airlines and aircraft makers affected by aviation disruption.",
  },
  {
    id: "financial_system",
    categories: ["bankingFinancialSystem", "centralBankDecision"],
    companies: ["JPM", "GS", "HDFCBANK", "SBIN"],
    rationale: "Large banks directly affected by financial-system or interest-rate developments.",
  },
  {
    id: "taiwan_semiconductors",
    categories: [...CONFLICT],
    keywords: ["taiwan"],
    requireBoth: true,
    companies: ["TSM", "NVDA", "INTC"],
    rationale: "Chip makers dependent on Taiwan-based semiconductor manufacturing.",
  },
];

export type CompanyLinkInput = LinkInput;

export interface CompanyLink {
  symbol: string;
  name: string;
  exchange: string;
  country: Company["country"];
  ruleId: string;
  rationale: string;
  quoteURL: string;
}

/** Outbound third-party quote page. A link only — GeoPulse never fetches or stores the price. */
export function quoteURL(company: Company): string {
  return `https://www.google.com/finance/quote/${encodeURIComponent(company.symbol)}:${company.exchange}`;
}

/** Deterministic: same input, same output. First matching rule wins per company. Max 12. */
export function linkCompanies(input: CompanyLinkInput, limit = 12): CompanyLink[] {
  const seen = new Set<string>();
  const links: CompanyLink[] = [];
  for (const rule of RULES) {
    if (!ruleMatches(rule, input)) continue;
    for (const symbol of rule.companies) {
      const company = COMPANIES[symbol];
      if (company === undefined || seen.has(symbol)) continue;
      seen.add(symbol);
      links.push({ ...company, ruleId: rule.id, rationale: rule.rationale, quoteURL: quoteURL(company) });
      if (links.length >= limit) return links;
    }
  }
  return links;
}
