import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/api/handler.js";
import { TestDb } from "./dbTestHelper.js";
import { SqliteDb } from "./sqliteDb.js";

/** The Markets tab endpoints (derived change, history, event impact) against real SQLite with the real migrations. */
let raw: TestDb;
let db: SqliteDb;
const NOW = "2026-09-26T12:00:00Z";
const get = (path: string) => handleRequest(new Request(`https://api.test${path}`), { db, now: () => NOW });

beforeEach(() => {
  raw = TestDb.createWithMigrations();
  db = new SqliteDb(raw);
  raw.exec(`
    INSERT INTO assets (id, symbol, name, class, currency, data_source, license_class) VALUES ('btc', 'BTCUSDT', 'Bitcoin', 'crypto', 'USD', 'binance', 'green');
    INSERT INTO assets (id, symbol, name, class, currency, data_source, license_class, is_delayed) VALUES ('eur', 'EURUSD', 'Euro / US Dollar', 'fx', 'USD', 'ecb_frankfurter', 'green', 1);
    INSERT INTO assets (id, symbol, name, class, currency, data_source, license_class) VALUES ('ixic', 'IXIC', 'NASDAQ', 'index', 'USD', 'none', 'red');
    INSERT INTO asset_prices (asset_id, ts, price, change_pct, as_of, session_state) VALUES ('btc', '2026-09-26T11:00:00Z', 100, 2.5, '2026-09-26T11:00:00Z', 'continuous');
    INSERT INTO asset_prices (asset_id, ts, price, change_pct, as_of, session_state) VALUES ('eur', '2026-09-24T00:00:00Z', 1.10, NULL, '2026-09-24T00:00:00Z', 'closed');
    INSERT INTO asset_prices (asset_id, ts, price, change_pct, as_of, session_state) VALUES ('eur', '2026-09-25T00:00:00Z', 1.21, NULL, '2026-09-25T00:00:00Z', 'closed');
    INSERT INTO asset_prices (asset_id, ts, price, as_of, session_state) VALUES ('ixic', '2026-09-26T11:00:00Z', 1, '2026-09-26T11:00:00Z', 'closed');
  `);
});
afterEach(() => raw.cleanup());

interface Markets { assets: Array<{ symbol: string; quote: { price: number; changePercent: number | null } | null }> }

describe("/v1/markets change", () => {
  it("passes through a source-published change and derives one from the previous day for daily sources", async () => {
    const { assets } = await (await get("/v1/markets")).json() as Markets;
    expect(assets.find((a) => a.symbol === "BTCUSDT")?.quote?.changePercent).toBe(2.5);
    expect(assets.find((a) => a.symbol === "EURUSD")?.quote?.changePercent).toBeCloseTo(10, 5); // (1.21-1.10)/1.10
    expect(assets.some((a) => a.symbol === "IXIC")).toBe(false); // red-licensed assets never leave the server
  });

  it("does not invent a change when there is no previous observation", async () => {
    raw.exec("DELETE FROM asset_prices WHERE asset_id = 'eur' AND ts = '2026-09-24T00:00:00Z'");
    const { assets } = await (await get("/v1/markets")).json() as Markets;
    expect(assets.find((a) => a.symbol === "EURUSD")?.quote?.changePercent).toBeNull();
  });
});

describe("/v1/markets/history", () => {
  it("returns green assets' points oldest-first within the window and thins long series", async () => {
    for (let i = 0; i < 300; i++) {
      const ts = new Date(Date.parse("2026-09-25T00:00:00Z") + i * 300_000).toISOString();
      raw.exec(`INSERT INTO asset_prices (asset_id, ts, price, as_of, session_state) VALUES ('btc', '${ts}', ${i}, '${ts}', 'continuous');`);
    }
    const body = await (await get("/v1/markets/history?days=3")).json() as { series: Array<{ symbol: string; points: Array<{ ts: string; price: number }> }> };
    expect(body.series.map((s) => s.symbol)).toEqual(["BTCUSDT", "EURUSD"]);
    const btc = body.series[0]!.points;
    expect(btc.length).toBeLessThanOrEqual(96);
    expect(btc[0]!.ts < btc[btc.length - 1]!.ts).toBe(true);
    expect(btc[btc.length - 1]!.price).toBe(100); // the newest observation is always kept
  });

  it("clamps the window", async () => {
    raw.exec("INSERT INTO asset_prices (asset_id, ts, price, as_of, session_state) VALUES ('btc', '2026-08-01T00:00:00Z', 5, '2026-08-01T00:00:00Z', 'continuous');");
    const body = await (await get("/v1/markets/history?days=9999")).json() as { days: number; series: Array<{ points: unknown[] }> };
    expect(body.days).toBe(30);
    expect(body.series[0]!.points).toHaveLength(1); // the August point is outside even the clamped 30 days
  });
});

describe("/v1/markets/impact", () => {
  beforeEach(() => raw.exec(`
    INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at, map_rank, source_count)
    VALUES ('s1', 'a', 'Missile strike in the Red Sea shipping lane', 'warArmedConflict', 15, 42, 'active', '2026-09-26T08:00:00Z', '2026-09-26T11:00:00Z', 1, 6);
    INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at, map_rank, source_count)
    VALUES ('s2', 'b', 'Local council votes on parking', 'protestCivilUnrest', 0, 0, 'active', '2026-09-26T08:00:00Z', '2026-09-26T11:00:00Z', 2, 4);
    INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at, map_rank, source_count)
    VALUES ('s3', 'c', 'Hidden armed conflict', 'warArmedConflict', 0, 0, 'active', '2026-09-26T08:00:00Z', '2026-09-26T11:00:00Z', NULL, 4);
  `));

  it("lists only map-visible situations that a named rule links to something, with rationale", async () => {
    const body = await (await get("/v1/markets/impact")).json() as { items: Array<{ situationID: string; assets: Array<{ symbol: string; rationale: string }>; companies: unknown[] }> };
    expect(body.items.map((i) => i.situationID)).toEqual(["s1"]); // s2 links to nothing, s3 is not on the map
    const symbols = body.items[0]!.assets.map((a) => a.symbol);
    expect(symbols).toEqual(expect.arrayContaining(["BRENT", "WTI", "PAXGUSDT"]));
    expect(body.items[0]!.assets.every((a) => a.rationale.length > 0)).toBe(true);
    expect(body.items[0]!.companies.length).toBeGreaterThan(0);
  });
});

describe("situation detail impacted assets", () => {
  it("carries the linked assets with their live quote and the rule's rationale, only for licensed assets", async () => {
    raw.exec(`
      INSERT INTO assets (id, symbol, name, class, currency, data_source, license_class) VALUES ('paxg', 'PAXGUSDT', 'Gold (PAXG)', 'commodity', 'USD', 'binance', 'green');
      INSERT INTO asset_prices (asset_id, ts, price, change_pct, as_of, session_state) VALUES ('paxg', '2026-09-26T11:30:00Z', 4200, 0.4, '2026-09-26T11:30:00Z', 'continuous');
      INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at, map_rank, source_count)
      VALUES ('war', 'war', 'Border clashes escalate', 'warArmedConflict', 1, 1, 'active', '2026-09-26T08:00:00Z', '2026-09-26T11:00:00Z', 1, 5);
    `);
    const detail = await (await get("/v1/situation/war")).json() as { impactedAssets: Array<{ symbol: string; rationale: string; quote: { price: number; changePercent: number } | null }> };
    // PAXG is licensed and seeded here; USDJPY is linked by the same rule but not in this database, so it is omitted rather than invented.
    expect(detail.impactedAssets.map((a) => a.symbol)).toEqual(["PAXGUSDT"]);
    expect(detail.impactedAssets[0]!.quote?.price).toBe(4200);
    expect(detail.impactedAssets[0]!.rationale).toContain("safe-haven");
  });
});
