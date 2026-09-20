import { describe, expect, it } from "vitest";
import { withinTimeWindow } from "../src/dedupe/timeWindow.js";

describe("withinTimeWindow", () => {
  it("is true for timestamps within the default 6h window", () => {
    expect(withinTimeWindow("2026-09-20T10:00:00Z", "2026-09-20T14:00:00Z")).toBe(true);
  });

  it("is false for timestamps 7h apart with the default window", () => {
    expect(withinTimeWindow("2026-09-20T10:00:00Z", "2026-09-20T17:00:00Z")).toBe(false);
  });

  it("is exactly inclusive at the boundary", () => {
    expect(withinTimeWindow("2026-09-20T10:00:00Z", "2026-09-20T16:00:00Z")).toBe(true);
  });

  it("respects a custom window", () => {
    expect(withinTimeWindow("2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z", 0.5)).toBe(false);
  });

  it("is order-independent", () => {
    const a = "2026-09-20T10:00:00Z";
    const b = "2026-09-20T14:00:00Z";
    expect(withinTimeWindow(a, b)).toBe(withinTimeWindow(b, a));
  });

  it("is false for an unparseable date rather than throwing", () => {
    expect(withinTimeWindow("not a date", "2026-09-20T10:00:00Z")).toBe(false);
  });
});
