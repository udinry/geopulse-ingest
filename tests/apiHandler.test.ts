import { describe, expect, it } from "vitest";
import { handleRequest, type Queryable } from "../src/api/handler.js";
import type { AssetPriceRow, AssetRow, SituationRow } from "../src/shared/types.js";

const row: SituationRow = {
  id: "s1", slug: "internal", title: "Situation", headline_article_id: null, category: "militaryMovement",
  lat: 1, lon: 2, geo_name: null, country_iso: "US", bbox_json: null, status: "active",
  first_seen_at: "2026-09-20T00:00:00Z", last_event_at: "2026-09-20T01:00:00Z", trending_score: 1,
  score_updated_at: null, peak_score: 1, event_count: 1, source_count: 3, map_rank: 1,
};
const asset: AssetRow = { id: "btc", symbol: "BTC", name: "Bitcoin", class: "crypto", exchange: "Binance", currency: "USD", country_iso: null, data_source: "binance", license_class: "green", is_delayed: 0, delay_minutes: 0 };
const quote: AssetPriceRow & { rn: number } = { asset_id: "btc", ts: "2026-09-20T01:00:00Z", price: 100, change_pct: 1, as_of: "2026-09-20T01:00:00Z", session_state: "continuous", rn: 1 };

class FakeDB implements Queryable {
  public queries: string[] = [];
  async all<T>(sql: string): Promise<T[]> {
    this.queries.push(sql);
    if (sql.includes("ROW_NUMBER")) return [quote as T];
    if (sql.includes("FROM assets")) return [asset as T];
    if (sql.includes("FROM situations")) return [row as T];
    return [];
  }
  async first<T>(sql: string): Promise<T | null> {
    this.queries.push(sql);
    return sql.includes("FROM situations") ? row as T : null;
  }
}

function request(path: string, headers?: Record<string, string>): Request {
  return headers === undefined
    ? new Request(`https://api.example${path}`)
    : new Request(`https://api.example${path}`, { headers });
}

describe("read API handler", () => {
  it("serves a stable now snapshot with an ETag and only green assets", async () => {
    const db = new FakeDB();
    const env = { db, now: () => "2026-09-20T01:00:00Z" };
    const response = await handleRequest(request("/v1/now"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    expect(await response.json()).toEqual(expect.objectContaining({ schemaVersion: 1, generatedAt: "2026-09-20T01:00:00Z" }));
    const second = await handleRequest(request("/v1/now", { "if-none-match": response.headers.get("etag") as string }), env);
    expect(second.status).toBe(304);
  });

  it("returns 404 for an unknown route and rejects non-GET requests", async () => {
    const env = { db: new FakeDB() };
    expect((await handleRequest(request("/missing"), env)).status).toBe(404);
    expect((await handleRequest(new Request("https://api.example/v1/now", { method: "POST" }), env)).status).toBe(405);
  });

  it("keeps search empty until a meaningful query is supplied", async () => {
    const db = new FakeDB();
    const response = await handleRequest(request("/v1/search?q=x"), { db });
    expect(await response.json()).toEqual({ query: "x", results: [] });
    expect(db.queries).toHaveLength(0);
  });
});
