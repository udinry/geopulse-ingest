import type { Queryable } from "../api/handler.js";
import type { AssetRow } from "../shared/types.js";
import { marketSourceFor, type MarketSource } from "./source.js";

export interface MarketIngestOptions {
  now?: () => string;
  eiaAPIKey?: string;
  sources?: Map<string, MarketSource>;
}

/** Fetches only green assets and stores source-stamped quotes; no fallback values are invented. */
export async function ingestLicensedQuotes(db: Queryable, options: MarketIngestOptions = {}): Promise<number> {
  const assets = await db.all<AssetRow>("SELECT id, symbol, name, class, exchange, currency, country_iso, data_source, license_class, is_delayed, delay_minutes FROM assets WHERE license_class = 'green'");
  const sources = options.sources ?? new Map<string, MarketSource>();
  let inserted = 0;
  for (const asset of assets) {
    const source = sources.get(asset.data_source) ?? marketSourceFor(asset.data_source, options.eiaAPIKey);
    if (source === null) continue;
    const quote = await source.quote(asset.symbol);
    if (quote === null) continue;
    await db.run("INSERT INTO asset_prices (asset_id, ts, price, change_pct, as_of, session_state) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(asset_id, ts) DO UPDATE SET price = excluded.price, change_pct = excluded.change_pct, as_of = excluded.as_of, session_state = excluded.session_state", asset.id, quote.asOf, quote.price, quote.changePercent, quote.asOf, quote.sessionState);
    inserted += 1;
  }
  return inserted;
}
