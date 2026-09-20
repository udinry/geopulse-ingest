# geopulse-ingest — agent entry point

This is the backend half of GeoPulse. **The authoritative status tracker is [`../GeoPulse/PLAN.md`](../GeoPulse/PLAN.md)** in the sibling app repo, not a copy here — phases 2–5 (ingestion, clustering, scoring, read API) live in this repo, but tracking status in two places invites drift, so don't create a duplicate PLAN.md here. Update the sibling repo's PLAN.md phase table when a phase in *this* repo lands.

Read [`../GeoPulse/docs/ARCHITECTURE.md`](../GeoPulse/docs/ARCHITECTURE.md) for the why before making structural changes here — especially the de-branding contract (§outlook) if you're touching anything in `src/link/` or `src/emit/` that serializes outlook data, and the market-data licensing table if you're touching `src/fetch/` for a new asset.

## Non-negotiables (see the sibling repo's CLAUDE.md for full detail)

1. **No AI.** Dedup, clustering, scoring, matching are all deterministic rules — see each module's doc comments for the exact algorithm and its citation in the planning doc.
2. **The de-branding boundary is enforced here, at emit time.** `src/emit/` must never serialize a venue name, slug, URL, or ticker for an outlook entry into anything that reaches the read API / client. This is the actual enforcement point for the contract described in the app repo's `docs/ARCHITECTURE.md` — the client-side `OutlookIndicator` type having no such field is the second line of defense, not the first.
3. **Market data source additions require a licence check first.** Before wiring up a new asset in `src/fetch/`, confirm its `licenseClass` against the table in the app repo's `docs/ARCHITECTURE.md`. NASDAQ and NIFTY are `red` — do not add them without an explicit licensing decision.
4. **Never hand-edit `data/weights.json`** once calibration exists — it's fit by the backtest harness against the six-month historical dataset. The committed Phase 4 file is explicitly an uncalibrated bootstrap prior; changing scoring behavior means running the harness, not hand-tuning a number.

## Handover discipline

- The sibling `GeoPulse/PLAN.md` is a live handover document. Update its phase table and handover block at the start of work, during meaningful progress, and at phase completion with exact commits, verification, CI links, blockers, and next steps.
- Never leave an in-progress phase documented only in the conversation; another agent must be able to resume from the repositories cold.

## GDELT ingestion gotchas (found the hard way in Phase 2)

- **The bulk Events/Mentions files have no article title field at all.** Don't go looking for one — the DOC 2.0 API (`src/fetch/gdeltDoc.ts`) is the only GDELT source for headline text; the bulk Events export (`src/fetch/gdeltEvents.ts`) is structured actor/CAMEO/geo data only, with `SOURCEURL` being the article that triggered ONE specific event's creation, not an aggregate of coverage.
- **Don't hit `api.gdeltproject.org` (the DOC API) repeatedly during development.** It throttles hard and the block outlasted several minutes of spaced-out retries during Phase 2 — plausibly IP-level, not strictly per-request. `gdeltDoc.ts`'s built-in `MIN_REQUEST_INTERVAL_MS` throttle is a real production safeguard, not just courtesy for dev.
- **`lastupdate.txt` (`data.gdeltproject.org`) is the correct bulk-polling path** and was NOT throttled the same way — use it for Events/Mentions/GKG, reserve the DOC API for title search specifically.
- **SimHash alone is too noisy for headline-length dedup — confirmed by measurement, not assumed.** See `src/dedupe/cascade.ts`'s top comment for the actual numbers (a single-word swap in a real headline pair measured Hamming distance 11-24/64 bits, overlapping with unrelated-headline distances of 22-31). Stage 2 of the cascade is now normalized-token Jaccard similarity; `titleSimHash`/`hammingDistance` are kept for cheap candidate-bucketing at scale, not as the precision signal. If you're tempted to "simplify" the cascade back to a raw SimHash threshold, re-read that comment first.
- **`sourcecountry` in the DOC API response is a country NAME ("United States"), not an ISO code** — don't map it into `country_iso` without a real gazetteer; `mapGdeltArticle.ts` deliberately leaves it null rather than guess.

## Clustering gotchas (Phase 3)

- **`entitySignature.ts` deliberately does NOT do NER/gazetteer resolution.** It uses GDELT's own structured `actor1_code`/`actor2_code`/`country_iso` fields directly (already reliable and deterministic — no free-text parsing needed for this purpose). This is a real, considered scope decision, not a shortcut taken quietly — see the README's Phase 3 scope note before "improving" this into a full gazetteer; the actual gazetteer (for display/cross-referencing, not clustering) is separate future work.
- **`similarity.ts`'s weights (0.40/0.25/0.20/0.15) and `cluster.ts`'s thresholds (join 0.55, merge 0.75) are the plan's specified values, not yet empirically calibrated** — unlike the trending score, which has a dedicated Phase 4 backtest step, the plan doesn't call for a separate clustering-calibration phase. If real ingestion data later shows these thresholds cluster too loosely/tightly, that's a legitimate empirical finding to act on (the same spirit as the Phase 2 SimHash correction) — don't hesitate to fix it with real measurement, just don't hand-tune without evidence.
- **`categoryCompat.ts` uses a 3-pillar model (geopolitical/economic/physical), not a hand-curated 19x19 category-pair matrix** — deliberately, to avoid fabricated-looking precision across 361 mostly-arbitrary numbers. See its doc comment.
- **`updateSituationWithEvent`'s `sourceCount` is a running max across joined events, not a sum** — summing would double-count outlets that report on multiple developments within the same situation. This is a conservative proxy pending Phase 5's real distinct-source count from joined article data.
- **Split (an over-merged situation separating back into two) is NOT implemented.** Only merge is. See the README's Phase 3 scope note for why this is a reasoned deferral, not an oversight.

## Scoring gotchas (Phase 4)

- `src/score/labelSet.ts` uses the planning document's strict movement thresholds (`>2σ` and `>15` percentage points) and inclusive coverage thresholds (`≥72h` and `≥30` sources). A major label requires at least two of the three criteria.
- `src/score/gridSearch.ts` enumerates the complete five-weight simplex. Its default resolution is `0.05`; it intentionally retains the first candidate on an NDCG tie so calibration is deterministic.
- `data/weights.json` is not a calibration result. It contains the documented bootstrap prior with `calibrated: false` because no six-month production-compatible corpus was fabricated or downloaded irresponsibly. Do not present these weights as empirically fitted.

## API gotchas (Phase 5)

- `src/emit/publicSerializer.ts` is the de-branding boundary. Never spread an `OutlookMarketRow` into a response; `serializeOutlook` is intentionally field-by-field and strips venue, slug, URL, ticker, and source-volume details.
- `src/api/handler.ts` is runtime-neutral and tested with a small query interface. `src/api/worker.ts` is the only Cloudflare/D1 adapter. Keep SQL and Worker globals out of serializers so contract tests stay fast and deterministic.
- Actual Cloudflare deployment still needs a real D1 database/account binding. Do not commit a fabricated database ID or create an external account autonomously; record that as a blocker in `GeoPulse/PLAN.md` until the owner supplies it.
- Alert persistence is device-scoped through `X-Device-ID`; it is not an account or identity system. APNs delivery runs from the Worker scheduled hook and requires `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_TOPIC` secrets.
- Outlook matching is deterministic token/category overlap only. `src/emit/publicSerializer.ts` remains the enforcement boundary: internal venue, slug, and URL fields must never enter a public response.
- Market adapters must be selected from a licensed asset row's `data_source`; `BinanceMarketSource` is currently the only implemented live adapter and only returns source-stamped crypto quotes.
- `src/markets/ingest.ts` is the runtime-neutral quote ingestion stage. It deliberately does not create a database connection or cron runner; the deployment-owned runner supplies the `Queryable` and EIA secret.

## Schema changes

`migrations/*.sql` is the single source of truth for the D1 schema — numbered, applied in order, never edited after being committed (add a new migration instead, same as any real migration system). Three independent places currently mirror parts of it and must be kept in sync by hand whenever it changes (no shared source of truth across the language boundary):
- `src/shared/types.ts` (this repo) — row-shape contracts
- `../GeoPulse/Packages/GeoPulseKit/Sources/GeoPulseKit/Models/*.swift` — client-side domain types
- `EventCategory`'s value list specifically appears a third time as a SQL `CHECK` constraint in `migrations/0002_events.sql` and `0003_situations.sql`

`tests/schema.test.ts` is the actual verification: it applies every migration via the real `sqlite3` CLI (not a mock — D1 is the same SQL dialect) and round-trips seeded data through real joins, including a query-level check that the outlook de-branding contract holds (a query selecting only public-safe columns must never expose `venue`/`slug`/`url`).

## The licensing register (`data/*.seed.json`)

Every row in `sources.seed.json` and `assets.seed.json` carries a real, dated `terms_reviewed_at` and a `terms_url` a human can re-check — `tests/schema.test.ts` enforces this isn't just a convention (a source missing either fails the test). Before adding a row:
1. Actually check that source/asset's current terms — don't assume a prior general research pass still holds.
2. Confirm `license_class` against `../GeoPulse/docs/ARCHITECTURE.md`'s table.
3. For market assets: it must not be `equity` or `index` class while `green` — those are structurally NASDAQ/NIFTY-shaped and there is no free commercial licence for them (see docs/ARCHITECTURE.md §10.1). The test suite checks this invariant.

## Why this repo is separate and public

GitHub Actions gives unlimited minutes on public repos vs. 2,000 min/month on private — at 5–15 minute ingestion cadence, a private repo rides that quota edge. See the app repo's `docs/ARCHITECTURE.md` for the full reasoning, including why Cloudflare Workers' free tier (10ms CPU/invocation) can't run this pipeline.

## Workflow

Same as the app repo: commit doc updates in the same commit as the code, push straight to `main`, no branches/PRs/force-push. GitHub owner `udinry`; this repo is **deliberately public**.

## Test

```bash
npm install
npm run typecheck
npm test
```

Node ≥18 works locally (this machine has 18.17.1). CI pins Node 20. See README.md's note on the vitest 2.x dev-dependency vulnerabilities before bumping to vitest 5 / Node 22.
