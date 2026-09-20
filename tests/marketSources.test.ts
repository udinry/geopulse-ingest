import { afterEach, describe, expect, it, vi } from "vitest";
import { BinanceMarketSource, EIADailyMarketSource, FrankfurterMarketSource, marketSourceFor } from "../src/markets/source.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(json: unknown, ok = true, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status, json: async () => json })));
}

describe("market sources", () => {
  it("parses a Binance quote and rejects malformed payloads", async () => {
    stubFetch({ symbol: "BTCUSDT", lastPrice: "100.5", priceChangePercent: "1.2", closeTime: 1_758_000_000_000 });
    const quote = await new BinanceMarketSource().quote("btcusdt");
    expect(quote).toEqual(expect.objectContaining({ symbol: "BTCUSDT", price: 100.5, changePercent: 1.2, sessionState: "continuous" }));
    stubFetch({ symbol: "BTCUSDT", lastPrice: "nope" });
    expect(await new BinanceMarketSource().quote("BTCUSDT")).toBeNull();
  });

  it("throws on Binance HTTP errors", async () => {
    stubFetch({}, false, 429);
    await expect(new BinanceMarketSource().quote("BTCUSDT")).rejects.toThrow("binance returned 429");
  });

  it("parses a Frankfurter daily rate and rejects bad symbols", async () => {
    stubFetch({ date: "2026-09-19", rates: { USD: 1.08 } });
    const quote = await new FrankfurterMarketSource().quote("EURUSD");
    expect(quote).toEqual(expect.objectContaining({ symbol: "EURUSD", price: 1.08, sessionState: "closed" }));
    expect(await new FrankfurterMarketSource().quote("TOOLONG")).toBeNull();
  });

  it("parses an EIA daily value and requires a series mapping", async () => {
    stubFetch({ response: { data: [{ period: "2026-09-19", value: "71.23" }] } });
    const quote = await new EIADailyMarketSource("key").quote("WTI");
    expect(quote).toEqual(expect.objectContaining({ symbol: "WTI", price: 71.23, sessionState: "closed" }));
    expect(await new EIADailyMarketSource("key").quote("UNKNOWN")).toBeNull();
  });

  it("selects sources only for licensed identifiers", () => {
    expect(marketSourceFor("binance")?.id).toBe("binance");
    expect(marketSourceFor("ecb_frankfurter")?.id).toBe("ecb_frankfurter");
    expect(marketSourceFor("eia")).toBeNull();
    expect(marketSourceFor("eia", "key")?.id).toBe("eia");
    expect(marketSourceFor("nasdaq")).toBeNull();
  });
});
