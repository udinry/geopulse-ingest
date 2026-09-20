import { describe, expect, it } from "vitest";
import { canonicalizeUrl, canonicalUrlHash } from "../src/normalize/canonicalUrl.js";

describe("canonicalizeUrl", () => {
  it("strips utm_ and other tracking params", () => {
    const a = canonicalizeUrl("https://example.com/story?utm_source=twitter&utm_medium=social&id=42");
    expect(a).toBe("https://example.com/story?id=42");
  });

  it("strips fbclid and gclid", () => {
    const a = canonicalizeUrl("https://example.com/story?fbclid=abc123&gclid=xyz");
    expect(a).toBe("https://example.com/story");
  });

  it("lowercases the hostname and drops a www prefix", () => {
    const a = canonicalizeUrl("https://WWW.Example.COM/Story");
    expect(a).toBe("https://example.com/Story");
  });

  it("drops the fragment", () => {
    const a = canonicalizeUrl("https://example.com/story#section-2");
    expect(a).toBe("https://example.com/story");
  });

  it("strips a single trailing slash but keeps root", () => {
    expect(canonicalizeUrl("https://example.com/story/")).toBe("https://example.com/story");
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("sorts remaining query params so key order never causes a false distinct", () => {
    const a = canonicalizeUrl("https://example.com/story?b=2&a=1");
    const b = canonicalizeUrl("https://example.com/story?a=1&b=2");
    expect(a).toBe(b);
  });

  it("two URLs differing only by tracking params canonicalize identically", () => {
    const a = canonicalizeUrl("https://example.com/story?id=42&utm_source=newsletter");
    const b = canonicalizeUrl("https://www.example.com/story?id=42");
    expect(a).toBe(b);
  });

  it("falls back to the trimmed original string on an unparseable URL", () => {
    expect(canonicalizeUrl("  not a url  ")).toBe("not a url");
  });

  it("canonicalUrlHash is stable and equal for equivalent URLs", () => {
    const h1 = canonicalUrlHash("https://example.com/story?utm_source=x&id=1");
    const h2 = canonicalUrlHash("https://www.example.com/story/?id=1");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
  });

  it("distinct articles hash differently", () => {
    const h1 = canonicalUrlHash("https://example.com/story-one");
    const h2 = canonicalUrlHash("https://example.com/story-two");
    expect(h1).not.toBe(h2);
  });
});
