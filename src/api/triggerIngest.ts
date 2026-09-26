/**
 * GitHub's own `schedule:` trigger is best-effort and, on this repo, fires only every 3–5 hours instead of
 * every 15 minutes. The Worker's cron is reliable, so it asks GitHub to run the ingest workflow instead.
 * The ingest itself must stay on GitHub Actions: a free Worker has 10 ms of CPU and Binance refuses
 * Cloudflare's egress addresses (403). The workflow's `concurrency` group collapses overlapping requests.
 *
 * Needs a fine-grained token limited to this one repository with "Actions: read and write".
 * Without the secret this is a no-op.
 */
export async function triggerIngest(token: string, repo: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(`https://api.github.com/repos/${repo}/actions/workflows/ingest.yml/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "geopulse-worker",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (response.status !== 204) console.error(`ingest dispatch returned ${response.status}`);
  return response.status === 204;
}

/** Ask for a run every 15 minutes (the Worker cron ticks every 5). */
export function isIngestTick(now: Date): boolean {
  return now.getUTCMinutes() % 15 < 5;
}
