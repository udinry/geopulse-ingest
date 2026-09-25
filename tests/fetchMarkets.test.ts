import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchOutlookCandidates, parseGammaMarket, storeAndLinkOutlook } from "../src/outlook/fetchMarkets.js";
import { handleRequest } from "../src/api/handler.js";
import { TestDb } from "./dbTestHelper.js";
import { SqliteDb } from "./sqliteDb.js";

const good = { id: 501, question: "Will the naval buildup near the Strait of Hormuz escalate before December?", slug: "iran-hormuz-close", endDate: "2026-12-31T00:00:00Z", volume: "120000.5", liquidity: 8000, outcomes: '["Yes","No"]', outcomePrices: '["0.23","0.77"]', oneDayPriceChange: 0.05, closed: false, active: true };

describe("outlook source parsing", () => {
  it("parses a binary open market and reads Yes as the probability regardless of order", () => {
    expect(parseGammaMarket(good)).toMatchObject({ id: "om-501", probability: 0.23, change24h: 0.05, volume: 120000.5 });
    expect(parseGammaMarket({ ...good, outcomes: '["No","Yes"]', outcomePrices: '["0.77","0.23"]' })?.probability).toBe(0.23);
  });

  it("skips anything it cannot read honestly: closed, non-binary, unpriced, out of range, banned vocabulary", () => {
    expect(parseGammaMarket({ ...good, closed: true })).toBeNull();
    expect(parseGammaMarket({ ...good, outcomes: '["A","B","C"]', outcomePrices: '["0.2","0.3","0.5"]' })).toBeNull();
    expect(parseGammaMarket({ ...good, outcomePrices: "not json" })).toBeNull();
    expect(parseGammaMarket({ ...good, outcomePrices: '["1.4","-0.4"]' })).toBeNull();
    expect(parseGammaMarket({ ...good, question: "What are the odds Iran attacks the Strait of Hormuz?" })).toBeNull();
    expect(parseGammaMarket({ id: 1 })).toBeNull();
  });

  it("fetches through an injected fetch, rejecting a non-array or failing response", async () => {
    const ok = async () => new Response(JSON.stringify([good, { id: 2 }]), { status: 200 });
    expect(await fetchOutlookCandidates(10, ok as never)).toHaveLength(1);
    await expect(fetchOutlookCandidates(10, (async () => new Response("{}", { status: 200 })) as never)).rejects.toThrow("unexpected shape");
    await expect(fetchOutlookCandidates(10, (async () => new Response("", { status: 451 })) as never)).rejects.toThrow("451");
  });
});

describe("storing, linking and serving outlook on real SQL", () => {
  let raw: TestDb;
  let db: SqliteDb;
  beforeEach(() => {
    raw = TestDb.createWithMigrations();
    db = new SqliteDb(raw);
    raw.exec(`INSERT INTO situations (id, slug, title, category, lat, lon, status, first_seen_at, last_event_at, map_rank, source_count)
      VALUES ('s1', 'hormuz', 'Naval buildup near the Strait of Hormuz', 'militaryMovement', 26.5, 56.3, 'active', '2026-09-25T10:00:00Z', '2026-09-25T10:00:00Z', 1, 5);`);
  });
  afterEach(() => raw.cleanup());

  it("stores a market, tracks the previous probability, links only a strong match, and serves it de-branded", async () => {
    const candidate = parseGammaMarket(good)!;
    const first = await storeAndLinkOutlook(db, [candidate], "2026-09-25T11:00:00Z");
    expect(first.stored).toBe(1);
    expect(first.linked).toBe(1);
    await storeAndLinkOutlook(db, [{ ...candidate, probability: 0.31 }], "2026-09-25T11:15:00Z");
    expect(raw.query<{ probability: number; prev_probability: number }>("SELECT probability, prev_probability FROM outlook_markets")[0]).toEqual({ probability: 0.31, prev_probability: 0.23 });

    const unrelated = { ...candidate, id: "om-9", slug: "other", question: "Will a new cryptocurrency exchange list a token this quarter?" };
    await storeAndLinkOutlook(db, [unrelated], "2026-09-25T11:30:00Z");
    expect(raw.query("SELECT * FROM situation_outlook WHERE market_id = 'om-9'")).toHaveLength(0);

    // A market absent from one fetch stays visible; one unseen for over 6 hours is retired.
    expect(raw.query<{ is_resolved: number }>("SELECT is_resolved FROM outlook_markets WHERE id = 'om-501'")[0]?.is_resolved).toBe(0);
    await storeAndLinkOutlook(db, [unrelated], "2026-09-25T20:00:00Z");
    expect(raw.query<{ is_resolved: number }>("SELECT is_resolved FROM outlook_markets WHERE id = 'om-501'")[0]?.is_resolved).toBe(1);
    await storeAndLinkOutlook(db, [candidate], "2026-09-25T20:15:00Z"); // seen again: back on
    expect(raw.query<{ is_resolved: number }>("SELECT is_resolved FROM outlook_markets WHERE id = 'om-501'")[0]?.is_resolved).toBe(0);

    const detail = await (await handleRequest(new Request("https://api.test/v1/situation/s1"), { db })).json() as { outlook: Array<Record<string, unknown>> };
    expect(detail.outlook).toHaveLength(1);
    expect(detail.outlook[0]).toMatchObject({ probability: 0.23, method: "market_implied_v1" });
    const wire = JSON.stringify(detail).toLowerCase();
    for (const forbidden of ["gamma", "polymarket", "iran-hormuz-close", "venue", "slug"]) expect(wire).not.toContain(forbidden);
  });
});
