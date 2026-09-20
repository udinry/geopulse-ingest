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
  public writes: string[] = [];
  public devices = new Set<string>();
  async all<T>(sql: string): Promise<T[]> {
    this.queries.push(sql);
    if (sql.includes("ROW_NUMBER")) return [quote as T];
    if (sql.includes("FROM assets")) return [asset as T];
    if (sql.includes("FROM situations")) return [row as T];
    return [];
  }
  async first<T>(sql: string, ...bindings: unknown[]): Promise<T | null> {
    this.queries.push(sql);
    if (sql.includes("FROM devices")) {
      const id = bindings[0] as string;
      return this.devices.has(id) ? ({ id } as T) : null;
    }
    if (sql.includes("FROM outlook_controls")) return null;
    return sql.includes("FROM situations") ? row as T : null;
  }
  async run(sql: string, ...bindings: unknown[]): Promise<void> {
    this.writes.push(sql);
    if (sql.startsWith("INSERT INTO devices")) this.devices.add(bindings[0] as string);
    if (sql.startsWith("DELETE FROM devices")) this.devices.delete(bindings[1] as string);
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
    expect(await response.json()).toEqual({ query: "x", sections: { situations: [], assets: [] } });
    expect(db.queries).toHaveLength(0);
  });

  it("serializes markets through the public asset contract", async () => {
    const response = await handleRequest(request("/v1/markets"), { db: new FakeDB(), now: () => "2026-09-20T01:00:00Z" });
    expect(await response.json()).toEqual({
      generatedAt: "2026-09-20T01:00:00Z",
      assets: [{
        id: "btc",
        symbol: "BTC",
        name: "Bitcoin",
        assetClass: "crypto",
        currency: "USD",
        licenseClass: "green",
        isDelayed: false,
        delayMinutes: 0,
        quote: {
          price: 100,
          changePercent: 1,
          asOf: "2026-09-20T01:00:00Z",
          sessionState: "continuous",
        },
      }],
    });
  });

  it("serializes search results through the public camelCase contract", async () => {
    const response = await handleRequest(request("/v1/search?q=Sit"), { db: new FakeDB() });
    expect(await response.json()).toEqual({
      query: "Sit",
      sections: {
        situations: [{ id: "s1", title: "Situation", category: "militaryMovement", trendingScore: 1 }],
        assets: [{ id: "btc", symbol: "BTC", name: "Bitcoin", assetClass: "crypto", score: 1 }],
      },
    });
  });

  it("requires the operations key for outlook controls", async () => {
    const response = await handleRequest(new Request("https://api.example/v1/internal/outlook/kill-switch", { method: "POST", body: JSON.stringify({ regionISO: "IN", enabled: false }) }), { db: new FakeDB(), opsKey: "secret" });
    expect(response.status).toBe(401);
  });

  it("accepts authenticated kill-switch and manual-link operations", async () => {
    const db = new FakeDB();
    const headers = { authorization: "Bearer secret" };
    const killSwitch = await handleRequest(new Request("https://api.example/v1/internal/outlook/kill-switch", { method: "POST", headers, body: JSON.stringify({ regionISO: "in", enabled: false, reason: "ops" }) }), { db, opsKey: "secret" });
    const manual = await handleRequest(new Request("https://api.example/v1/internal/outlook/manual-link", { method: "POST", headers, body: JSON.stringify({ situationID: "s1", marketID: "m1", verified: true }) }), { db, opsKey: "secret" });
    expect(killSwitch.status).toBe(200);
    expect(manual.status).toBe(200);
    expect(db.writes).toHaveLength(2);
  });

  it("persists device registration and alert creation through device-scoped routes", async () => {
    const db = new FakeDB();
    const device = await handleRequest(new Request("https://api.example/v1/devices", { method: "POST", body: JSON.stringify({ id: "device-1", apnsToken: "token" }) }), { db });
    expect(device.status).toBe(201);
    const alert = await handleRequest(new Request("https://api.example/v1/alerts", { method: "POST", headers: { "x-device-id": "device-1" }, body: JSON.stringify({ kind: "price", subjectType: "asset", subjectID: "btc", operator: "gte", threshold: 100 }) }), { db });
    expect(alert.status).toBe(201);
    const listed = await handleRequest(new Request("https://api.example/v1/alerts", { headers: { "x-device-id": "device-1" } }), { db });
    const updated = await handleRequest(new Request("https://api.example/v1/alerts/a1", { method: "PATCH", headers: { "x-device-id": "device-1" }, body: JSON.stringify({ isActive: false }) }), { db });
    const deleted = await handleRequest(new Request("https://api.example/v1/alerts/a1", { method: "DELETE", headers: { "x-device-id": "device-1" } }), { db });
    expect(listed.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(deleted.status).toBe(204);
    expect(db.writes).toHaveLength(5);
  });

  it("rejects alert creation for an unknown device", async () => {
    const db = new FakeDB();
    const response = await handleRequest(new Request("https://api.example/v1/alerts", { method: "POST", headers: { "x-device-id": "ghost" }, body: JSON.stringify({ kind: "price", subjectType: "asset", subjectID: "btc", operator: "gte", threshold: 100 }) }), { db });
    expect(response.status).toBe(404);
  });

  it("returns an empty outlook section when the region kill-switch is disabled", async () => {
    const db = new FakeDB();
    db.first = async <T>(sql: string, ...bindings: unknown[]): Promise<T | null> => {
      if (sql.includes("FROM outlook_controls")) return { is_enabled: 0 } as T;
      if (sql.includes("FROM situations")) return row as T;
      void bindings;
      return null;
    };
    db.all = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes("outlook_markets") || sql.includes("situation_outlook")) throw new Error("outlook must not be queried when disabled");
      if (sql.includes("ROW_NUMBER")) return [quote as T];
      if (sql.includes("FROM assets")) return [asset as T];
      if (sql.includes("FROM situations")) return [row as T];
      return [];
    };
    const response = await handleRequest(request("/v1/situation/s1", { "x-region-iso": "IN" }), { db });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ outlook: [] }));
  });
});
