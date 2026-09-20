import { describe, expect, it } from "vitest";
import { geoProximity, haversineDistanceKm } from "../src/cluster/geoProximity.js";

describe("haversineDistanceKm", () => {
  it("is zero for identical coordinates", () => {
    expect(haversineDistanceKm(23.5, 121.0, 23.5, 121.0)).toBeCloseTo(0, 6);
  });

  it("computes a realistic distance (Taipei to Beijing, ~1700km)", () => {
    const distance = haversineDistanceKm(25.033, 121.5654, 39.9042, 116.4074);
    expect(distance).toBeGreaterThan(1500);
    expect(distance).toBeLessThan(1900);
  });

  it("is symmetric", () => {
    const a = haversineDistanceKm(23.5, 121.0, 39.9, 116.4);
    const b = haversineDistanceKm(39.9, 116.4, 23.5, 121.0);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("geoProximity", () => {
  it("is 1.0 at zero distance", () => {
    expect(geoProximity(23.5, 121.0, 23.5, 121.0)).toBeCloseTo(1, 6);
  });

  it("decays toward 0 for antipodal points", () => {
    expect(geoProximity(0, 0, 0, 180)).toBeLessThan(0.01);
  });

  it("scores meaningfully higher for nearby points than distant ones", () => {
    const nearby = geoProximity(23.5, 121.0, 23.6, 121.1); // ~15km
    const distant = geoProximity(23.5, 121.0, 51.5, -0.1); // Taiwan to London
    expect(nearby).toBeGreaterThan(distant);
    expect(nearby).toBeGreaterThan(0.9);
  });
});
