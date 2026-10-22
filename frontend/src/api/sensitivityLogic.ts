/**
 * sensitivityLogic.ts
 * Pure functions for Sensitivity Analysis Lab — no React, no fetch, no side effects.
 * All functions are unit-testable without any DOM or network dependencies.
 */

import type { WhatIfInputs, NumericField, SchemaLimit, FeatureRange } from './whatIfLogic';
import type { WhatIfResponse, RuleIndicator } from './client';
import { FEATURE_META } from './whatIfLogic';

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_SWEEP_EVALUATIONS = 25;
export const MIN_SWEEP_EVALUATIONS = 2;
export const DEFAULT_SWEEP_EVALUATIONS = 10;
export const SWEEP_CONCURRENCY_LIMIT = 3;

// ── Types ────────────────────────────────────────────────────────────────────

export type EvaluationStatus = 'success' | 'failed' | 'not_run';
export type FailureKind = 'validation_422' | 'network' | 'unavailable' | 'aborted' | 'unknown';
export type RangeClassification = 'within_training' | 'outside_training' | 'outside_schema';

export interface SweepPointResult {
  index: number;
  value: number;
  status: EvaluationStatus;
  failureKind?: FailureKind;
  errorMessage?: string;
  response?: WhatIfResponse;
}

export interface SensitivitySummary {
  totalCount: number;
  successfulCount: number;
  failedCount: number;
  notRunCount: number;
  minProbability: number | null;
  maxProbability: number | null;
  /**
   * Number of model-label changes between strictly consecutive successful points
   * (points with no failed evaluation in between).
   */
  consecutiveLabelChanges: number;
  /**
   * Number of maintenance tier changes between strictly consecutive successful points.
   */
  consecutiveTierChanges: number;
  /**
   * Whether there are gaps (failed or unrun points) between successful evaluations.
   */
  hasGaps: boolean;
  /**
   * Number of gaps between successful evaluations.
   */
  gapCount: number;
}

export interface IndicatorTransition {
  rule_id: string;
  name: string;
  prevStatus: 'normal' | 'approaching' | 'triggered' | 'unknown';
  nextStatus: 'normal' | 'approaching' | 'triggered' | 'unknown';
  changed: boolean;
  description: string;
}

export interface ThresholdConsistencyResult {
  consistent: boolean;
  threshold: number | null;
  distinctThresholds: number[];
  message?: string;
}

// ── Pure Logic Functions ─────────────────────────────────────────────────────

/**
 * Build evenly spaced sweep values inclusive of both `start` and `end`.
 * 
 * Rules:
 * - count must be between MIN_SWEEP_EVALUATIONS (2) and MAX_SWEEP_EVALUATIONS (25).
 * - start and end must be finite numbers.
 * - start == end is rejected with an Error.
 * - start > end is rejected with an Error (no silent reordering).
 * - Floating point rounding is applied to 4 decimal places to ensure values
 *   sent to the API match what is displayed and have no IEEE-754 precision artifacts.
 */
export function buildSweepValues(start: number, end: number, count: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(count)) {
    throw new Error('Start, end, and evaluation count must be valid finite numbers.');
  }

  const roundedCount = Math.round(count);
  if (roundedCount < MIN_SWEEP_EVALUATIONS || roundedCount > MAX_SWEEP_EVALUATIONS) {
    throw new Error(
      `Evaluation count must be between ${MIN_SWEEP_EVALUATIONS} and ${MAX_SWEEP_EVALUATIONS} (received ${count}).`
    );
  }

  if (start === end) {
    throw new Error(`Start value (${start}) and end value (${end}) cannot be identical for a sweep.`);
  }

  if (start > end) {
    throw new Error(
      `Start value (${start}) cannot be greater than end value (${end}). Please adjust your sweep range.`
    );
  }

  const step = (end - start) / (roundedCount - 1);
  const values: number[] = [];

  for (let i = 0; i < roundedCount; i++) {
    if (i === 0) {
      values.push(Number(start.toFixed(4)));
    } else if (i === roundedCount - 1) {
      values.push(Number(end.toFixed(4)));
    } else {
      const raw = start + i * step;
      values.push(Number(raw.toFixed(4)));
    }
  }

  return values;
}

/**
 * Returns a new copy of startingInputs with ONLY the specified featureKey changed.
 * Guarantees that startingInputs is never mutated.
 */
export function buildSweepRequest(
  startingInputs: WhatIfInputs,
  featureKey: NumericField,
  value: number
): WhatIfInputs {
  return {
    ...startingInputs,
    [featureKey]: value,
  };
}

/**
 * Classify a value against backend schema limits and observed training range.
 * - outside_schema: value is outside the hard limits accepted by FastAPI Pydantic schema
 * - outside_training: value is accepted by schema, but outside observed AI4I training range (extrapolation)
 * - within_training: value is inside observed AI4I training distribution
 */
export function classifyRange(
  value: number,
  schemaLimits: SchemaLimit,
  trainingRange: FeatureRange
): RangeClassification {
  if (value < schemaLimits.min || value > schemaLimits.max) {
    return 'outside_schema';
  }
  if (value < trainingRange.min || value > trainingRange.max) {
    return 'outside_training';
  }
  return 'within_training';
}

/**
 * Summarize sweep results from successful points only.
 * 
 * Gap handling definition:
 * When analyzing transitions (model label and maintenance tier changes), we only compare
 * strictly consecutive successful points (i.e. points whose indices differ by exactly 1).
 * If a point failed or was aborted between two successful evaluations (e.g. point 3 succeeded,
 * point 4 failed, point 5 succeeded), we do NOT treat point 3 and 5 as consecutive without
 * noting the gap. Instead, hasGaps is set to true and gapCount records the number of missing
 * intervals.
 */
export function summarizeResults(results: SweepPointResult[]): SensitivitySummary {
  let successfulCount = 0;
  let failedCount = 0;
  let notRunCount = 0;
  let minProbability: number | null = null;
  let maxProbability: number | null = null;

  const successfulPoints: SweepPointResult[] = [];

  for (const r of results) {
    if (r.status === 'success' && r.response) {
      successfulCount++;
      successfulPoints.push(r);
      const prob = r.response.failure_probability;
      if (typeof prob === 'number' && Number.isFinite(prob)) {
        if (minProbability === null || prob < minProbability) {
          minProbability = prob;
        }
        if (maxProbability === null || prob > maxProbability) {
          maxProbability = prob;
        }
      }
    } else if (r.status === 'failed') {
      failedCount++;
    } else {
      notRunCount++;
    }
  }

  // Count transitions between strictly consecutive successful points
  let consecutiveLabelChanges = 0;
  let consecutiveTierChanges = 0;
  let gapCount = 0;

  for (let i = 0; i < successfulPoints.length - 1; i++) {
    const curr = successfulPoints[i];
    const next = successfulPoints[i + 1];

    if (next.index === curr.index + 1) {
      // Strictly consecutive
      if (curr.response && next.response) {
        if (curr.response.predicted_label !== next.response.predicted_label) {
          consecutiveLabelChanges++;
        }
        const currTier = curr.response.recommendations?.risk_tier;
        const nextTier = next.response.recommendations?.risk_tier;
        if (currTier && nextTier && currTier !== nextTier) {
          consecutiveTierChanges++;
        }
      }
    } else {
      // Index gap: there was at least one failed or not-run evaluation between curr and next
      gapCount++;
    }
  }

  return {
    totalCount: results.length,
    successfulCount,
    failedCount,
    notRunCount,
    minProbability,
    maxProbability,
    consecutiveLabelChanges,
    consecutiveTierChanges,
    hasGaps: gapCount > 0,
    gapCount,
  };
}

/**
 * Diff rule indicators between two successful API responses.
 * Uses ONLY actual response fields from `recommendations.indicators`.
 */
export function diffIndicatorsBetween(
  prev: WhatIfResponse,
  next: WhatIfResponse
): IndicatorTransition[] {
  const prevIndicators = prev.recommendations?.indicators ?? [];
  const nextIndicators = next.recommendations?.indicators ?? [];

  const prevMap = new Map<string, RuleIndicator>();
  for (const ind of prevIndicators) {
    prevMap.set(ind.rule_id, ind);
  }

  const transitions: IndicatorTransition[] = [];

  for (const nextInd of nextIndicators) {
    const prevInd = prevMap.get(nextInd.rule_id);
    const prevStatus = prevInd ? prevInd.status : 'unknown';
    const nextStatus = nextInd.status;
    const changed = prevStatus !== nextStatus;

    let description = `${prevStatus} → ${nextStatus}`;
    if (!prevInd) {
      description = `new (${nextStatus})`;
    } else if (!changed) {
      description = `remained ${nextStatus}`;
    }

    transitions.push({
      rule_id: nextInd.rule_id,
      name: nextInd.name,
      prevStatus,
      nextStatus,
      changed,
      description,
    });
  }

  return transitions;
}

/**
 * Check if the model decision threshold is consistent across all successful responses.
 * Never hardcodes or assumes 0.66. Returns the threshold only if every successful response agrees.
 */
export function thresholdConsistency(results: SweepPointResult[]): ThresholdConsistencyResult {
  const successfulResults = results.filter((r) => r.status === 'success' && r.response);

  if (successfulResults.length === 0) {
    return {
      consistent: true,
      threshold: null,
      distinctThresholds: [],
    };
  }

  const thresholds = successfulResults.map((r) => r.response!.decision_threshold);
  const uniqueThresholds = Array.from(new Set(thresholds));

  if (uniqueThresholds.length === 1) {
    return {
      consistent: true,
      threshold: uniqueThresholds[0],
      distinctThresholds: uniqueThresholds,
    };
  }

  return {
    consistent: false,
    threshold: null,
    distinctThresholds: uniqueThresholds,
    message: `Decision thresholds differed across evaluated points (${uniqueThresholds.join(', ')}). Threshold cannot be displayed as a single reference line.`,
  };
}

// ── Formatters ───────────────────────────────────────────────────────────────

/** Format a feature value based on display metadata (consistent precision) */
export function formatSweepValue(field: NumericField, value: number): string {
  const meta = FEATURE_META[field];
  if (!meta) return value.toFixed(1);
  if (meta.step >= 1) return Math.round(value).toString();
  return value.toFixed(1);
}

/** Format probability as percentage string, e.g. "42.1%" */
export function formatProbability(prob: number): string {
  if (!Number.isFinite(prob)) return '—';
  return `${(prob * 100).toFixed(1)}%`;
}

/** Format percentage string, e.g. "108.3%" */
export function formatPercentage(val: number): string {
  if (!Number.isFinite(val)) return '—';
  return `${val.toFixed(1)}%`;
}
