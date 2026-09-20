import { describe, expect, it } from "vitest";
import { deliveryKey, evaluateAlert } from "../src/alerts/evaluate.js";
import type { AlertRow } from "../src/shared/types.js";

const baseAlert: AlertRow = {
  id: "alert-1", device_id: "device-1", kind: "percent", subject_type: "asset", subject_id: "asset-1",
  operator: "gte", threshold: 5, window_minutes: null, combinator_group_id: null,
  live_activity: 0, is_active: 1, last_fired_at: null, cooldown_minutes: 30,
};

describe("alert evaluator", () => {
  it("fires when a threshold is met", () => {
    expect(evaluateAlert({ alert: baseAlert, currentValue: 5 })).toEqual({ shouldFire: true, reason: "triggered" });
  });

  it("honours cooldown and inactive rules", () => {
    expect(evaluateAlert({ alert: { ...baseAlert, last_fired_at: "2026-09-20T10:00:00.000Z" }, currentValue: 8, now: "2026-09-20T10:15:00.000Z" }).reason).toBe("cooldown");
    expect(evaluateAlert({ alert: { ...baseAlert, is_active: 0 }, currentValue: 8 }).reason).toBe("inactive");
  });

  it("fires only on a crossing when configured", () => {
    const alert = { ...baseAlert, operator: "crosses" as const, threshold: 10 };
    expect(evaluateAlert({ alert, previousValue: 9, currentValue: 10 }).shouldFire).toBe(true);
    expect(evaluateAlert({ alert, previousValue: 10, currentValue: 11 }).shouldFire).toBe(false);
  });

  it("produces a stable delivery key", () => {
    expect(deliveryKey(baseAlert, "2026-09-20T10:00:00.000Z", 5)).toBe(deliveryKey(baseAlert, "2026-09-20T10:00:00.000Z", 5));
  });
});
