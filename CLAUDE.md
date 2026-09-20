# geopulse-ingest — agent entry point

This is the backend half of GeoPulse. **The authoritative status tracker is [`../GeoPulse/PLAN.md`](../GeoPulse/PLAN.md)** in the sibling app repo, not a copy here — phases 2–5 (ingestion, clustering, scoring, read API) live in this repo, but tracking status in two places invites drift, so don't create a duplicate PLAN.md here. Update the sibling repo's PLAN.md phase table when a phase in *this* repo lands.

Read [`../GeoPulse/docs/ARCHITECTURE.md`](../GeoPulse/docs/ARCHITECTURE.md) for the why before making structural changes here — especially the de-branding contract (§outlook) if you're touching anything in `src/link/` or `src/emit/` that serializes outlook data, and the market-data licensing table if you're touching `src/fetch/` for a new asset.

## Non-negotiables (see the sibling repo's CLAUDE.md for full detail)

1. **No AI.** Dedup, clustering, scoring, matching are all deterministic rules — see each module's doc comments for the exact algorithm and its citation in the planning doc.
2. **The de-branding boundary is enforced here, at emit time.** `src/emit/` must never serialize a venue name, slug, URL, or ticker for an outlook entry into anything that reaches the read API / client. This is the actual enforcement point for the contract described in the app repo's `docs/ARCHITECTURE.md` — the client-side `OutlookIndicator` type having no such field is the second line of defense, not the first.
3. **Market data source additions require a licence check first.** Before wiring up a new asset in `src/fetch/`, confirm its `licenseClass` against the table in the app repo's `docs/ARCHITECTURE.md`. NASDAQ and NIFTY are `red` — do not add them without an explicit licensing decision.
4. **Never hand-edit `data/weights.json`** once it exists (Phase 4) — it's fit by the backtest harness against 6 months of GDELT history. Changing scoring behavior means re-running the backtest, not hand-tuning a number.

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
