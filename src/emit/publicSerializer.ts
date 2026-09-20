import type {
  ArticleRow,
  AssetPriceRow,
  AssetRow,
  EventRow,
  OutlookMarketRow,
  OutlookPublic,
  SituationOutlookRow,
  SituationRow,
} from "../shared/types.js";

export interface PublicSituation {
  id: string;
  title: string;
  category: SituationRow["category"];
  coordinate: { latitude: number; longitude: number };
  countryISO: string | null;
  status: SituationRow["status"];
  firstSeenAt: string;
  lastEventAt: string;
  trendingScore: number;
  eventCount: number;
  sourceCount: number;
  mapRank: number | null;
}

export interface PublicEvent {
  id: string;
  category: EventRow["category"];
  quadClass: EventRow["quad_class"];
  goldstein: number | null;
  actor1Name: string | null;
  actor2Name: string | null;
  geoName: string | null;
  occurredAt: string;
  numMentions: number;
  numSources: number;
}

export interface PublicNews {
  id: string;
  sourceName: string;
  headline: string;
  excerpt: string | null;
  publishedAt: string;
  url: string;
}

export interface PublicAsset {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetRow["class"];
  currency: string;
  licenseClass: AssetRow["license_class"];
  isDelayed: boolean;
  delayMinutes: number;
  quote: {
    price: number;
    changePercent: number | null;
    asOf: string;
    sessionState: AssetPriceRow["session_state"];
  } | null;
}

export interface SituationDetail extends PublicSituation {
  events: PublicEvent[];
  news: PublicNews[];
  outlook: OutlookPublic[];
  assets: PublicAsset[];
}

export function serializeSituation(row: SituationRow): PublicSituation {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    coordinate: { latitude: row.lat, longitude: row.lon },
    countryISO: row.country_iso,
    status: row.status,
    firstSeenAt: row.first_seen_at,
    lastEventAt: row.last_event_at,
    trendingScore: row.trending_score,
    eventCount: row.event_count,
    sourceCount: row.source_count,
    mapRank: row.map_rank,
  };
}

/** Serializes only the public outlook projection. Never spread `market`. */
export function serializeOutlook(market: OutlookMarketRow, link: SituationOutlookRow): OutlookPublic | null {
  if (link.confidence < 0.70 && link.is_manually_verified !== 1) return null;
  return {
    id: market.id,
    question: market.question_normalised,
    probability: market.probability,
    change24h: market.prob_change_24h,
    matchConfidence: link.confidence,
    method: link.method,
    asOf: market.updated_at,
  };
}

export function serializeEvent(row: EventRow): PublicEvent {
  return {
    id: row.id,
    category: row.category,
    quadClass: row.quad_class,
    goldstein: row.goldstein,
    actor1Name: row.actor1_name,
    actor2Name: row.actor2_name,
    geoName: row.geo_name,
    occurredAt: row.occurred_at,
    numMentions: row.num_mentions,
    numSources: row.num_sources,
  };
}

export function serializeNews(row: ArticleRow & { source_name: string }): PublicNews {
  if (row.published_at === null) throw new Error(`article ${row.id} has no published_at timestamp`);
  return {
    id: row.id,
    sourceName: row.source_name,
    headline: row.title,
    excerpt: row.excerpt,
    publishedAt: row.published_at,
    url: row.url_canonical,
  };
}

export function serializeAsset(asset: AssetRow, quote: AssetPriceRow | null): PublicAsset {
  return {
    id: asset.id,
    symbol: asset.symbol,
    name: asset.name,
    assetClass: asset.class,
    currency: asset.currency,
    licenseClass: asset.license_class,
    isDelayed: asset.is_delayed === 1,
    delayMinutes: asset.delay_minutes,
    quote: quote === null ? null : {
      price: quote.price,
      changePercent: quote.change_pct,
      asOf: quote.as_of,
      sessionState: quote.session_state,
    },
  };
}
