import { describe, expect, it, vi } from "vitest";
import { isIngestTick, triggerIngest } from "../src/api/triggerIngest.js";

describe("triggerIngest", () => {
  it("posts a workflow_dispatch for main with the token and reports success on 204", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect(await triggerIngest("tok", "owner/repo", fetcher)).toBe(true);
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/owner/repo/actions/workflows/ingest.yml/dispatches");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ ref: "main" });
  });

  it("reports failure without throwing when GitHub refuses", async () => {
    const fetcher = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await triggerIngest("bad", "owner/repo", fetcher)).toBe(false);
  });

  it("asks once per 15 minutes on the 5-minute cron", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute));
    expect([0, 5, 10, 15, 20, 25, 30].map((m) => isIngestTick(at(m)))).toEqual([true, false, false, true, false, false, true]);
  });
});
