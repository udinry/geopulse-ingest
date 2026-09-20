import { describe, expect, it } from "vitest";
import { entityOverlapScore, extractCapitalizedEntities, jaccardSimilarity } from "../src/dedupe/entityOverlap.js";

describe("extractCapitalizedEntities", () => {
  it("extracts a multi-word proper noun as a single entity", () => {
    const entities = extractCapitalizedEntities("Military activity reported near Taiwan Strait");
    expect(entities.has("taiwan strait")).toBe(true);
  });

  it("does not extract a sentence-initial ordinary word as an entity", () => {
    const entities = extractCapitalizedEntities("Military activity reported near Taiwan");
    expect(entities.has("military")).toBe(false);
  });

  it("excludes common capitalized stopwords like 'The'", () => {
    const entities = extractCapitalizedEntities("The Reuters report on Taiwan");
    expect(entities.has("the")).toBe(false);
  });
});

describe("jaccardSimilarity", () => {
  it("is 1.0 for identical sets", () => {
    const a = new Set(["taiwan", "china"]);
    expect(jaccardSimilarity(a, new Set(a))).toBe(1);
  });

  it("is 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["taiwan"]), new Set(["brazil"]))).toBe(0);
  });

  it("is 0 for two empty sets (not NaN)", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });
});

describe("entityOverlapScore", () => {
  it("scores high for titles sharing the same named place", () => {
    const score = entityOverlapScore(
      "Military activity reported near Taiwan Strait",
      "Taiwan Strait sees increased military activity"
    );
    expect(score).toBeGreaterThan(0);
  });

  it("scores zero for titles with no shared proper nouns", () => {
    const score = entityOverlapScore(
      "Central bank holds interest rates steady",
      "Earthquake strikes off the coast of Japan"
    );
    expect(score).toBe(0);
  });
});
