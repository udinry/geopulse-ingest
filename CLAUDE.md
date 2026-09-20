# geopulse-ingest — agent entry point

This is the backend half of GeoPulse. **The authoritative status tracker is [`../GeoPulse/PLAN.md`](../GeoPulse/PLAN.md)** in the sibling app repo, not a copy here — phases 2–5 (ingestion, clustering, scoring, read API) live in this repo, but tracking status in two places invites drift, so don't create a duplicate PLAN.md here. Update the sibling repo's PLAN.md phase table when a phase in *this* repo lands.

Read [`../GeoPulse/docs/ARCHITECTURE.md`](../GeoPulse/docs/ARCHITECTURE.md) for the why before making structural changes here — especially the de-branding contract (§outlook) if you're touching anything in `src/link/` or `src/emit/` that serializes outlook data, and the market-data licensing table if you're touching `src/fetch/` for a new asset.

## Non-negotiables (see the sibling repo's CLAUDE.md for full detail)

1. **No AI.** Dedup, clustering, scoring, matching are all deterministic rules — see each module's doc comments for the exact algorithm and its citation in the planning doc.
2. **The de-branding boundary is enforced here, at emit time.** `src/emit/` must never serialize a venue name, slug, URL, or ticker for an outlook entry into anything that reaches the read API / client. This is the actual enforcement point for the contract described in the app repo's `docs/ARCHITECTURE.md` — the client-side `OutlookIndicator` type having no such field is the second line of defense, not the first.
3. **Market data source additions require a licence check first.** Before wiring up a new asset in `src/fetch/`, confirm its `licenseClass` against the table in the app repo's `docs/ARCHITECTURE.md`. NASDAQ and NIFTY are `red` — do not add them without an explicit licensing decision.
4. **Never hand-edit `data/weights.json`** once it exists (Phase 4) — it's fit by the backtest harness against 6 months of GDELT history. Changing scoring behavior means re-running the backtest, not hand-tuning a number.

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
