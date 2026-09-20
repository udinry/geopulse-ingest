export interface MarketQuote {
  symbol: string;
  price: number;
  changePercent: number | null;
  asOf: string;
  sessionState: "continuous" | "closed";
}

export interface MarketSource {
  readonly id: string;
  quote(symbol: string, signal?: AbortSignal): Promise<MarketQuote | null>;
}

export class BinanceMarketSource implements MarketSource {
  readonly id = "binance";
  private readonly endpoint: URL;

  constructor(endpoint = "https://api.binance.com/api/v3/ticker/24hr") {
    this.endpoint = new URL(endpoint);
  }

  async quote(symbol: string, signal?: AbortSignal): Promise<MarketQuote | null> {
    const url = new URL(this.endpoint);
    url.searchParams.set("symbol", symbol.toUpperCase());
    const response = await fetch(url, signal === undefined ? undefined : { signal });
    if (!response.ok) throw new Error(`binance returned ${response.status}`);
    const value = await response.json() as { symbol?: string; lastPrice?: string; priceChangePercent?: string; closeTime?: number };
    const price = Number(value.lastPrice);
    if (!value.symbol || !Number.isFinite(price) || value.closeTime === undefined) return null;
    const change = Number(value.priceChangePercent);
    return { symbol: value.symbol, price, changePercent: Number.isFinite(change) ? change : null, asOf: new Date(value.closeTime).toISOString(), sessionState: "continuous" };
  }
}

export class FrankfurterMarketSource implements MarketSource {
  readonly id = "ecb_frankfurter";
  private readonly endpoint: URL;

  constructor(endpoint = "https://api.frankfurter.app/latest") {
    this.endpoint = new URL(endpoint);
  }

  async quote(symbol: string, signal?: AbortSignal): Promise<MarketQuote | null> {
    const pair = symbol.toUpperCase();
    if (pair.length !== 6) return null;
    const url = new URL(this.endpoint);
    url.searchParams.set("from", pair.slice(0, 3));
    url.searchParams.set("to", pair.slice(3));
    const response = await fetch(url, signal === undefined ? undefined : { signal });
    if (!response.ok) throw new Error(`frankfurter returned ${response.status}`);
    const value = await response.json() as { date?: string; rates?: Record<string, number> };
    const price = value.rates?.[pair.slice(3)];
    if (value.date === undefined || price === undefined || !Number.isFinite(price)) return null;
    return { symbol: pair, price, changePercent: null, asOf: `${value.date}T00:00:00.000Z`, sessionState: "closed" };
  }
}

export class EIADailyMarketSource implements MarketSource {
  readonly id = "eia";
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly series: Record<string, string> = { WTI: "PET.RWTC.D", BRENT: "PET.RBRTE.D" };

  constructor(apiKey: string, endpoint = "https://api.eia.gov/v2/petroleum/pri/spt/data/") {
    this.apiKey = apiKey;
    this.endpoint = new URL(endpoint);
  }

  async quote(symbol: string, signal?: AbortSignal): Promise<MarketQuote | null> {
    const seriesID = this.series[symbol.toUpperCase()];
    if (seriesID === undefined) return null;
    const url = new URL(this.endpoint);
    url.searchParams.set("api_key", this.apiKey);
    url.searchParams.set("frequency", "daily");
    url.searchParams.set("data[0]", "value");
    url.searchParams.set("facets[seriesId][]", seriesID);
    url.searchParams.set("sort[0][column]", "period");
    url.searchParams.set("sort[0][direction]", "desc");
    url.searchParams.set("length", "1");
    const response = await fetch(url, signal === undefined ? undefined : { signal });
    if (!response.ok) throw new Error(`eia returned ${response.status}`);
    const value = await response.json() as { response?: { data?: Array<{ period?: string; value?: string }> } };
    const row = value.response?.data?.[0];
    const price = Number(row?.value);
    if (row?.period === undefined || !Number.isFinite(price)) return null;
    return { symbol: symbol.toUpperCase(), price, changePercent: null, asOf: `${row.period}T00:00:00.000Z`, sessionState: "closed" };
  }
}

export function marketSourceFor(id: string, eiaAPIKey?: string): MarketSource | null {
  if (id === "binance") return new BinanceMarketSource();
  if (id === "ecb_frankfurter") return new FrankfurterMarketSource();
  if (id === "eia" && eiaAPIKey !== undefined) return new EIADailyMarketSource(eiaAPIKey);
  return null;
}
