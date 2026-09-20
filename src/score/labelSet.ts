/**
 * Objective ground-truth labels for score calibration, as defined in planning
 * doc section 5.4. A situation is major when at least two independent signals
 * clear their published thresholds.
 */

export interface MajorSituationEvidence {
  /** Duration of sustained coverage, in hours. */
  coverageHours: number;
  /** Number of distinct reporting sources during that coverage window. */
  distinctSources: number;
  /** Largest absolute linked-asset movement, measured in trailing-volatility σ. */
  maxAssetMoveSigma: number;
  /** Largest absolute matched-outlook movement, in percentage points. */
  maxOutlookMovePoints: number;
}

export const MAJOR_LABEL_THRESHOLDS = {
  coverageHours: 72,
  distinctSources: 30,
  assetMoveSigma: 2,
  outlookMovePoints: 15,
} as const;

export function hasSustainedCoverage(evidence: MajorSituationEvidence): boolean {
  return (
    evidence.coverageHours >= MAJOR_LABEL_THRESHOLDS.coverageHours &&
    evidence.distinctSources >= MAJOR_LABEL_THRESHOLDS.distinctSources
  );
}

export function hasSignificantAssetMove(evidence: MajorSituationEvidence): boolean {
  return evidence.maxAssetMoveSigma > MAJOR_LABEL_THRESHOLDS.assetMoveSigma;
}

export function hasSignificantOutlookMove(evidence: MajorSituationEvidence): boolean {
  return evidence.maxOutlookMovePoints > MAJOR_LABEL_THRESHOLDS.outlookMovePoints;
}

/** Returns true when at least two of the three objective criteria are met. */
export function isObjectivelyMajor(evidence: MajorSituationEvidence): boolean {
  const criteriaMet = [
    hasSustainedCoverage(evidence),
    hasSignificantAssetMove(evidence),
    hasSignificantOutlookMove(evidence),
  ].filter(Boolean).length;
  return criteriaMet >= 2;
}
