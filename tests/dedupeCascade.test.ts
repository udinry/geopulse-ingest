import { describe, expect, it } from "vitest";
import { dedupeCandidates, type DedupCandidate } from "../src/dedupe/cascade.js";

function candidate(id: string, url: string, title: string, publishedAtIso: string): DedupCandidate {
  return { id, urlCanonical: url, title, publishedAtIso };
}

describe("dedupeCandidates: the full 4-stage cascade", () => {
  it("groups the same story from two publishers within the time window", () => {
    const candidates = [
      candidate("a", "https://reuters.com/story-1", "Military activity reported near Taiwan Strait | Reuters", "2026-09-20T10:00:00Z"),
      candidate("b", "https://apnews.com/story-1", "Military activity reported near the Taiwan Strait — AP", "2026-09-20T10:15:00Z"),
    ];
    const { groupIdByCandidateId, groupCount } = dedupeCandidates(candidates);
    expect(groupCount).toBe(1);
    expect(groupIdByCandidateId.get("a")).toBe(groupIdByCandidateId.get("b"));
  });

  it("does not group unrelated stories even when published close together", () => {
    const candidates = [
      candidate("a", "https://example.com/taiwan", "Military activity reported near Taiwan Strait", "2026-09-20T10:00:00Z"),
      candidate("b", "https://example.com/fed", "Central bank holds interest rates steady amid inflation concerns", "2026-09-20T10:05:00Z"),
    ];
    const { groupIdByCandidateId, groupCount } = dedupeCandidates(candidates);
    expect(groupCount).toBe(2);
    expect(groupIdByCandidateId.get("a")).not.toBe(groupIdByCandidateId.get("b"));
  });

  it("groups two URLs that differ only by tracking params via stage 1, even with unrelated-looking titles", () => {
    const candidates = [
      candidate("a", "https://example.com/story?id=42&utm_source=newsletter", "Breaking: major development", "2026-09-20T10:00:00Z"),
      candidate("b", "https://www.example.com/story?id=42", "Something completely different sounding", "2026-09-20T10:00:00Z"),
    ];
    const { groupIdByCandidateId, groupCount } = dedupeCandidates(candidates);
    expect(groupCount).toBe(1);
    expect(groupIdByCandidateId.get("a")).toBe(groupIdByCandidateId.get("b"));
  });

  it("does NOT group a similarly-titled anniversary piece published outside the time window", () => {
    const candidates = [
      candidate("a", "https://example.com/live", "Military activity reported near Taiwan Strait", "2026-09-20T10:00:00Z"),
      candidate("b", "https://example.com/anniversary", "One year on: military activity reported near Taiwan Strait", "2026-09-27T10:00:00Z"),
    ];
    const { groupIdByCandidateId, groupCount } = dedupeCandidates(candidates);
    expect(groupCount).toBe(2);
    expect(groupIdByCandidateId.get("a")).not.toBe(groupIdByCandidateId.get("b"));
  });

  it("transitively groups A-B-C even when A and C alone wouldn't cross the threshold", () => {
    // A and C share no wording/entities directly (measured: jaccard 0.125, entity 0 —
    // below both thresholds) but each connects to B independently (measured: A-B
    // jaccard 0.417/entity 0.5, B-C jaccard 0.267/entity 0.5 — both clear the rescue
    // path). The union-find must merge all three via B as the connecting hub.
    const candidates = [
      candidate("a", "https://example.com/a", "Military activity reported near Taiwan Strait as tensions escalate", "2026-09-20T10:00:00Z"),
      candidate("b", "https://example.com/b", "Reports from Beijing describe military activity increasing near Taiwan Strait", "2026-09-20T10:05:00Z"),
      candidate("c", "https://example.com/c", "Sources close to Beijing describe activity increasing amid rising regional tensions", "2026-09-20T10:10:00Z"),
    ];
    const { groupIdByCandidateId, groupCount } = dedupeCandidates(candidates);
    expect(groupCount).toBe(1);
    const groups = new Set(candidates.map((c) => groupIdByCandidateId.get(c.id)));
    expect(groups.size).toBe(1);
  });

  it("picks the earliest-published member as the canonical id for the group", () => {
    const candidates = [
      candidate("later", "https://apnews.com/story-1", "Military activity reported near Taiwan Strait — AP", "2026-09-20T10:15:00Z"),
      candidate("earlier", "https://reuters.com/story-1", "Military activity reported near Taiwan Strait | Reuters", "2026-09-20T10:00:00Z"),
    ];
    const { groupIdByCandidateId } = dedupeCandidates(candidates);
    expect(groupIdByCandidateId.get("later")).toBe("earlier");
    expect(groupIdByCandidateId.get("earlier")).toBe("earlier");
  });

  it("a single candidate with no duplicates is its own group", () => {
    const candidates = [candidate("solo", "https://example.com/solo", "A completely unique headline", "2026-09-20T10:00:00Z")];
    const { groupIdByCandidateId, groupCount } = dedupeCandidates(candidates);
    expect(groupCount).toBe(1);
    expect(groupIdByCandidateId.get("solo")).toBe("solo");
  });

  it("handles an empty candidate list", () => {
    const { groupIdByCandidateId, groupCount } = dedupeCandidates([]);
    expect(groupCount).toBe(0);
    expect(groupIdByCandidateId.size).toBe(0);
  });
});
