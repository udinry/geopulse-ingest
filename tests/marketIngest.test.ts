import { describe, expect, it } from "vitest";
import { ingestLicensedQuotes } from "../src/markets/ingest.js";
import type { Queryable } from "../src/api/handler.js";

class MarketDB implements Queryable {
  writes: unknown[][] = [];
  async all<T>(): Promise<T[]> { return [{ id: "eur-usd", symbol: "EURUSD", name: "Euro / US Dollar", class: "fx", exchange: null, currency: "USD", country_iso: null, data_source: "ecb_frankfurter", license_class: "green", is_delayed: 1, delay_minutes: 1440 }] as T[]; }
  async first<T>(): Promise<T | null> { return null; }
  async run(_sql: string, ...bindings: unknown[]): Promise<void> { this.writes.push(bindings); }
}

describe("licensed market ingestion", () => {
  it("stores source-stamped quotes only for green assets", async () => {
    const db = new MarketDB();
    const inserted = await ingestLicensedQuotes(db, { sources: new Map([["ecb_frankfurter", { id: "ecb_frankfurter", async quote() { return { symbol: "EURUSD", price: 1.08, changePercent: null, asOf: "2026-09-20T00:00:00.000Z", sessionState: "closed" as const }; } }]]) });
    expect(inserted).toBe(1);
    expect(db.writes[0]).toContain(1.08);
  });
});
