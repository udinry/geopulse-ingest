import { fetchOutlookCandidates } from "../outlook/fetchMarkets.js";

// Fetch-only check (no database): confirms the real response shape from a network that can reach the source.
fetchOutlookCandidates()
  .then((c) => {
    console.log(`parsed ${c.length} binary open markets`);
    for (const m of c.slice(0, 8)) console.log(`${(m.probability * 100).toFixed(0).padStart(3)}%  ${m.question.slice(0, 90)}`);
  })
  .catch((e) => { console.error("outlook check failed", e); process.exit(1); });
