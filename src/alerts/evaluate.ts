import { createHash } from "node:crypto";
import type { AlertRow } from "../shared/types.js";

export interface AlertEvaluationInput {
  alert: AlertRow;
  currentValue: number;
  previousValue?: number;
  now?: string;
}

export interface AlertEvaluation {
  shouldFire: boolean;
  reason: "inactive" | "below_threshold" | "cooldown" | "triggered";
}

export function evaluateAlert({ alert, currentValue, previousValue, now = new Date().toISOString() }: AlertEvaluationInput): AlertEvaluation {
  if (alert.is_active === 0) return { shouldFire: false, reason: "inactive" };

  const triggered = (() => {
    switch (alert.operator) {
      case "gt": return currentValue > alert.threshold;
      case "gte": return currentValue >= alert.threshold;
      case "lt": return currentValue < alert.threshold;
      case "lte": return currentValue <= alert.threshold;
      case "crosses":
        if (previousValue === undefined) return false;
        return (previousValue < alert.threshold && currentValue >= alert.threshold)
          || (previousValue > alert.threshold && currentValue <= alert.threshold);
    }
  })();

  if (!triggered) return { shouldFire: false, reason: "below_threshold" };
  if (alert.last_fired_at !== null) {
    const elapsed = Date.parse(now) - Date.parse(alert.last_fired_at);
    if (elapsed < alert.cooldown_minutes * 60_000) return { shouldFire: false, reason: "cooldown" };
  }
  return { shouldFire: true, reason: "triggered" };
}

export function deliveryKey(alert: AlertRow, firedAt: string, value: number): string {
  return createHash("sha256")
    .update([alert.id, firedAt, value.toPrecision(15)].join("|"))
    .digest("hex");
}
