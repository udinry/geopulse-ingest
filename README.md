# geopulse-ingest

The backend for [GeoPulse](https://github.com/udinry/GeoPulse) — GDELT/RSS ingestion, dedup, situation clustering, trending-score computation, and outlook matching. Runs entirely on **GitHub Actions cron** (this is a public repo specifically so those runs get unlimited minutes — see the GeoPulse repo's `docs/ARCHITECTURE.md`).

This repo is intentionally public. Nothing here is a secret — it's algorithmic (dedup, clustering, scoring rules); credentials live in encrypted Actions secrets regardless of repo visibility.

## Start here

- **Status, phases, non-negotiables**: [`GeoPulse/PLAN.md`](https://github.com/udinry/GeoPulse/blob/main/PLAN.md) — this repo doesn't duplicate that tracker; see [CLAUDE.md](CLAUDE.md) here for why.
- **Why it's shaped this way**: [`GeoPulse/docs/ARCHITECTURE.md`](https://github.com/udinry/GeoPulse/blob/main/docs/ARCHITECTURE.md).
- **Full research/formulas**: [`GeoPulse/docs/planning/2026-09-20-initial-plan.md`](https://github.com/udinry/GeoPulse/blob/main/docs/planning/2026-09-20-initial-plan.md).

## Build

```bash
npm install
npm run typecheck
npm test
```

## Layout

```
migrations/    numbered SQLite/D1 schema migrations — the single source of truth for
               every table. Apply in order (0001, 0002, ...); see tests/schema.test.ts
               for how, and docs/ARCHITECTURE.md for the outlook table's de-branding
               contract, which this schema enforces structurally (venue/slug/url only
               ever live in outlook_markets, never in a serialized shape).
data/          the licensing register: sources.seed.json + assets.seed.json. Every row
               has a dated terms_reviewed_at citation — "zero unreviewed sources" is
               enforced by tests/schema.test.ts, not just a convention. Also where
               gazetteer/CAMEO/geo-significance tables and the calibrated weights.json
               land once Phase 2+ builds them.
src/
  shared/      TS row-shape contracts (types.ts), 1:1 with migrations/*.sql
  fetch/       gdeltEvents.ts (bulk Events 2.0 real-time polling), gdeltDoc.ts (DOC 2.0
               API — the actual source of article TITLES; the bulk files have none).
               RSS allowlist + market data adapters land here too, once a source passes
               licensing review.
  normalize/   canonicalUrl.ts (dedup stage 1), cameoCategoryMap.ts (the hand-curated
               CAMEO-root -> EventCategory + severity table), mapGdeltEvent.ts /
               mapGdeltArticle.ts (raw GDELT rows -> our schema)
  dedupe/      titleSimHash.ts, entityOverlap.ts, timeWindow.ts, cascade.ts (the
               orchestrated 4-stage pipeline — see cascade.ts's top comment for an
               important correction made during Phase 2: stage 2 is token-Jaccard
               similarity, not a raw SimHash Hamming threshold; SimHash is noisy at
               headline length, confirmed by measurement, not assumed)
  cluster/     incremental situation clustering (Phase 3)
  score/       trending-score computation + calibration harness (Phase 4)
  link/        situation↔asset and situation↔outlook matching (Phase 10, 13)
  emit/        D1 writes + R2 snapshot generation (Phase 5) — this is where the
               de-branding contract's actual enforcement code lives once built
tests/         schema.test.ts applies migrations/*.sql via the system sqlite3 CLI to a
               throwaway file (no native driver dep — same SQL dialect as D1, so this
               is a real portability check, not a mock). tests/fixtures/ holds a real,
               live-downloaded 40-row GDELT sample used by gdeltEvents.test.ts.
```

## Phase 2 scope note

"GDELT ingestion + dedup" delivered the pure fetch -> parse -> categorize -> dedupe
pipeline, fully tested. Deliberately deferred to Phase 5 (when D1/Workers actually
exist): wiring this to write live rows and the scheduled cron trigger — there's nowhere
to write to yet, so standing up the actual `ingest-fast.yml` workflow now would have
nothing to verify against. `event_articles` linking (event <-> article association) is
Phase 3's job, not Phase 2's — it's the same entity/time-window matching machinery
situation clustering needs anyway, so building it here would mean building Phase 3 to
finish Phase 2.

## Known and accepted: dev-dependency vulnerabilities

`npm audit` currently reports 5 vulnerabilities in vitest 2.x's dev-server dependency chain (esbuild/vite). These are exploitable only if the Vite dev server is run and exposed to network — never the case here (`vitest run` in CI, no dev server). The fix is vitest 5.x, which requires Node ≥22; this repo pins Node 20 in CI and stays on vitest 2.x until the toolchain moves. Re-evaluate when bumping the Node baseline.
