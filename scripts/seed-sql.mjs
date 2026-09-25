// Generates idempotent seed SQL (the licensing register) from data/*.seed.json.
//   node scripts/seed-sql.mjs > /tmp/seed.sql && wrangler d1 execute geopulse --remote --file /tmp/seed.sql
import { readFileSync } from "node:fs";

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "boolean" ? (v ? "1" : "0") : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));

const out = [];
for (const s of read("sources.seed.json").sources) {
  out.push(`INSERT INTO sources (id, name, domain, feed_url, kind, credibility_tier, license_class, excerpt_allowed, attribution_text, attribution_url, terms_url, terms_reviewed_at, is_active) VALUES (${[s.id, s.name, s.domain, s.feed_url, s.kind, s.credibility_tier, s.license_class, Boolean(s.excerpt_allowed), s.attribution_text, s.attribution_url, s.terms_url, s.terms_reviewed_at, Boolean(s.is_active)].map(q).join(", ")}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, domain=excluded.domain, feed_url=excluded.feed_url, kind=excluded.kind, credibility_tier=excluded.credibility_tier, license_class=excluded.license_class, excerpt_allowed=excluded.excerpt_allowed, attribution_text=excluded.attribution_text, attribution_url=excluded.attribution_url, terms_url=excluded.terms_url, terms_reviewed_at=excluded.terms_reviewed_at, is_active=excluded.is_active;`);
}
for (const a of read("assets.seed.json").assets) {
  out.push(`INSERT INTO assets (id, symbol, name, class, exchange, currency, country_iso, data_source, license_class, is_delayed, delay_minutes) VALUES (${[a.id, a.symbol, a.name, a.class, a.exchange, a.currency, a.country_iso, a.data_source, a.license_class, Boolean(a.is_delayed), a.delay_minutes].map(q).join(", ")}) ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol, name=excluded.name, class=excluded.class, exchange=excluded.exchange, currency=excluded.currency, country_iso=excluded.country_iso, data_source=excluded.data_source, license_class=excluded.license_class, is_delayed=excluded.is_delayed, delay_minutes=excluded.delay_minutes;`);
}
console.log(out.join("\n"));
