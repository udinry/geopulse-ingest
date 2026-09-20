import { describe, expect, it } from "vitest";
import { dcgAtK, ndcgAtK } from "../src/score/ndcg.js";

describe("NDCG", () => {
  it("matches the standard binary-relevance calculation", () => {
    expect(dcgAtK([1, 0, 1], 3)).toBeCloseTo(1 + 1 / Math.log2(4), 12);
    expect(ndcgAtK([1, 0, 1], 3)).toBeCloseTo((1 + 1 / Math.log2(4)) / (1 + 1 / Math.log2(3)), 12);
  });

  it("returns one for ideal order and zero when nothing is relevant", () => {
    expect(ndcgAtK([1, 1, 0], 2)).toBe(1);
    expect(ndcgAtK([0, 0], 10)).toBe(0);
  });

  it("limits both predicted and ideal rankings to k", () => {
    expect(ndcgAtK([0, 1, 1], 1)).toBe(0);
    expect(ndcgAtK([1, 0, 0], 0)).toBe(0);
  });
});
