import { CONFLICT, ruleMatches, type LinkInput, type RuleBase } from "./ruleMatch.js";

/**
 * Situation -> non-equity asset links (the licensed, price-bearing assets in
 * data/assets.seed.json). Used to decide which watchers to notify about an event —
 * no price is read or implied. Named rules, curated rationale, deterministic.
 */
export const WATCHABLE_ASSETS: Readonly<Record<string, string>> = {
  BTCUSDT: "Bitcoin",
  ETHUSDT: "Ethereum",
  PAXGUSDT: "Gold (PAXG)",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  WTI: "WTI crude oil",
  BRENT: "Brent crude oil",
};

interface AssetRule extends RuleBase {
  assets: readonly string[];
  rationale: string;
}

const CHOKEPOINTS = ["hormuz", "persian gulf", "red sea", "suez", "bab el-mandeb", "bab al-mandab", "gulf of aden"];

export const ASSET_RULES: readonly AssetRule[] = [
  { id: "oil_supply", categories: ["oilEnergyDisruption"], assets: ["BRENT", "WTI"], rationale: "Crude prices follow energy-supply disruption." },
  {
    id: "oil_chokepoint",
    categories: [...CONFLICT, "shippingMaritimeDisruption", "terrorismSecurityIncident"],
    keywords: CHOKEPOINTS,
    requireBoth: true,
    assets: ["BRENT", "WTI"],
    rationale: "A major oil shipping route is affected.",
  },
  { id: "safe_haven_conflict", categories: ["warArmedConflict", "militaryMovement"], assets: ["PAXGUSDT", "USDJPY"], rationale: "Gold and the yen are common safe-haven assets during armed conflict." },
  { id: "rates_and_macro", categories: ["centralBankDecision", "macroDataRelease", "fiscalPolicy"], assets: ["EURUSD", "GBPUSD", "USDJPY", "PAXGUSDT"], rationale: "Policy and data releases move major currencies and gold." },
  { id: "financial_stress", categories: ["bankingFinancialSystem"], assets: ["PAXGUSDT", "USDJPY", "BTCUSDT"], rationale: "Banking stress can shift demand toward gold, the yen and crypto." },
];

export interface AssetLink { symbol: string; name: string; ruleId: string; rationale: string }

export function linkAssets(input: LinkInput): AssetLink[] {
  const seen = new Set<string>();
  const links: AssetLink[] = [];
  for (const rule of ASSET_RULES) {
    if (!ruleMatches(rule, input)) continue;
    for (const symbol of rule.assets) {
      if (seen.has(symbol)) continue;
      seen.add(symbol);
      links.push({ symbol, name: WATCHABLE_ASSETS[symbol] ?? symbol, ruleId: rule.id, rationale: rule.rationale });
    }
  }
  return links;
}
