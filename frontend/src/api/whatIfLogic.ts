/**
 * whatIfLogic.ts
 * Pure functions for What-if Lab — no React, no fetch, no side effects.
 * All functions are unit-testable without any DOM or network.
 */

export interface FeatureRange {
  min: number;
  max: number;
  q25?: number;
  median?: number;
  q75?: number;
  std?: number;
  non_fail_median?: number;
}

export interface InputSpec {
  /** Training range info keyed by canonical field name (snake_case) */
  ranges: Record<string, FeatureRange>;
  /** Healthy baseline values keyed by canonical field name (snake_case) */
  baseline: Record<string, number | string>;
  /** Allowed product type values e.g. ["L","M","H"] */
  typeOptions: string[];
  /** Mode/default product type */
  typeDefault: string;
}

// ── Feature display metadata (display only — not data) ──────────────────────
export interface FeatureMeta {
  label: string;
  unit: string;
  /** Step size for sliders */
  step: number;
}

/** Maps canonical field names → display labels and units */
export const FEATURE_META: Record<string, FeatureMeta> = {
  air_temperature:    { label: 'Air Temperature',    unit: 'K',   step: 0.1 },
  process_temperature:{ label: 'Process Temperature',unit: 'K',   step: 0.1 },
  rotational_speed:   { label: 'Rotational Speed',   unit: 'rpm', step: 1   },
  torque:             { label: 'Cutting Torque',      unit: 'Nm',  step: 0.1 },
  tool_wear:          { label: 'Tool Wear',           unit: 'min', step: 1   },
};

/** Hard limits enforced by backend MachineFeatures Pydantic schema and openapi specification */
export interface SchemaLimit {
  min: number;
  max: number;
}

export const SCHEMA_LIMITS: Record<NumericField, SchemaLimit> = {
  air_temperature:     { min: 200.0, max: 400.0 },
  process_temperature: { min: 200.0, max: 450.0 },
  rotational_speed:    { min: 0.0,   max: 5000.0 },
  torque:              { min: 0.0,   max: 200.0 },
  tool_wear:           { min: 0.0,   max: 500.0 },
};

/** Canonical field names for the 5 numeric inputs (order matches AI4I) */
export const NUMERIC_FIELDS = [
  'air_temperature',
  'process_temperature',
  'rotational_speed',
  'torque',
  'tool_wear',
] as const;
export type NumericField = typeof NUMERIC_FIELDS[number];

// ── Input values type used throughout ───────────────────────────────────────
export interface WhatIfInputs {
  type: string;
  air_temperature: number;
  process_temperature: number;
  rotational_speed: number;
  torque: number;
  tool_wear: number;
}

// ── Clamp / Range helpers ────────────────────────────────────────────────────

/**
 * Clamp `value` to [min, max]. Returns the clamped value.
 * If min > max the arguments are corrected silently.
 */
export function clampToRange(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Returns true if `value` is outside the observed training range [min, max].
 * False positives are impossible: a value AT the boundary is not "outside".
 */
export function isOutsideRange(value: number, min: number, max: number): boolean {
  return value < min || value > max;
}

/**
 * Returns a human-readable description of how far outside the range the value is,
 * or null if it is in-range.
 */
export function rangeWarningText(
  field: string,
  value: number,
  range: FeatureRange
): string | null {
  if (value < range.min) {
    return `${field} (${formatValue(field, value)}) is below the minimum observed training value (${formatValue(field, range.min)}).`;
  }
  if (value > range.max) {
    return `${field} (${formatValue(field, value)}) is above the maximum observed training value (${formatValue(field, range.max)}).`;
  }
  return null;
}

// ── Delta computation ────────────────────────────────────────────────────────

export interface WhatIfDelta {
  /** Probability delta in percentage points (hypothetical - original) */
  probDeltaPP: number;
  /** Whether the model label changed */
  labelChanged: boolean;
  originalLabel: string;
  hypotheticalLabel: string;
  /** Whether the risk tier changed */
  tierChanged: boolean;
  originalTier: string;
  hypotheticalTier: string;
  /** Whether the agreement state changed */
  agreementChanged: boolean;
  originalAgreement: string;
  hypotheticalAgreement: string;
}

/**
 * Compute all deltas between original and hypothetical results.
 * All inputs must come from API responses — never computed locally.
 */
export function computeDelta(
  originalProb: number,
  hypotheticalProb: number,
  originalLabel: string,
  hypotheticalLabel: string,
  originalTier: string,
  hypotheticalTier: string,
  originalAgreement: string,
  hypotheticalAgreement: string,
): WhatIfDelta {
  return {
    probDeltaPP: (hypotheticalProb - originalProb) * 100,
    labelChanged: originalLabel !== hypotheticalLabel,
    originalLabel,
    hypotheticalLabel,
    tierChanged: originalTier !== hypotheticalTier,
    originalTier,
    hypotheticalTier,
    agreementChanged: originalAgreement !== hypotheticalAgreement,
    originalAgreement,
    hypotheticalAgreement,
  };
}

// ── Indicator diff ───────────────────────────────────────────────────────────

export type IndicatorStatus = 'normal' | 'approaching' | 'triggered';

export interface IndicatorSummary {
  rule_id: string;
  name: string;
  originalStatus: IndicatorStatus | null;
  hypotheticalStatus: IndicatorStatus;
  /** 'new' = appeared, 'resolved' = gone, 'worsened' = approaching→triggered, 'improved' = triggered→approaching, 'unchanged' = same */
  change: 'new' | 'resolved' | 'worsened' | 'improved' | 'unchanged';
}

const STATUS_SEVERITY: Record<IndicatorStatus, number> = {
  normal: 0,
  approaching: 1,
  triggered: 2,
};

/**
 * Diff two sets of rule indicators.
 * `originalIndicators` may be null (when starting from baseline with no original).
 */
export function diffIndicators(
  originalIndicators: Array<{ rule_id: string; name: string; status: string }> | null,
  hypotheticalIndicators: Array<{ rule_id: string; name: string; status: string }>,
): IndicatorSummary[] {
  const origMap = new Map<string, { name: string; status: IndicatorStatus }>(
    (originalIndicators ?? []).map((i) => [
      i.rule_id,
      { name: i.name, status: i.status as IndicatorStatus },
    ])
  );

  return hypotheticalIndicators.map((hyp) => {
    const hypStatus = hyp.status as IndicatorStatus;
    const orig = origMap.get(hyp.rule_id);

    if (!orig) {
      return {
        rule_id: hyp.rule_id,
        name: hyp.name,
        originalStatus: null,
        hypotheticalStatus: hypStatus,
        change: 'new' as const,
      };
    }

    const origSev = STATUS_SEVERITY[orig.status];
    const hypSev = STATUS_SEVERITY[hypStatus];
    let change: IndicatorSummary['change'];
    if (origSev === hypSev) change = 'unchanged';
    else if (hypSev > origSev) change = orig.status === 'normal' && hypStatus === 'triggered' ? 'worsened' : (hypSev > origSev ? 'worsened' : 'improved');
    else change = 'improved';

    // Simplify: triggered from normal -> worsened, approaching from triggered -> improved, etc
    if (origSev < hypSev) change = 'worsened';
    else if (origSev > hypSev) change = hypStatus === 'normal' ? 'resolved' : 'improved';

    return {
      rule_id: hyp.rule_id,
      name: hyp.name,
      originalStatus: orig.status,
      hypotheticalStatus: hypStatus,
      change,
    };
  });
}

// ── Formatters ───────────────────────────────────────────────────────────────

/** Format a numeric value with appropriate decimal places for display */
export function formatValue(field: string, value: number): string {
  const meta = FEATURE_META[field];
  if (!meta) return value.toFixed(1);
  if (meta.step >= 1) return Math.round(value).toString();
  return value.toFixed(1);
}

/** Format probability as "XX.X%" */
export function formatProb(prob: number): string {
  return `${(prob * 100).toFixed(1)}%`;
}

/** Format delta in percentage points with sign */
export function formatDeltaPP(deltaPP: number): string {
  const sign = deltaPP > 0 ? '+' : '';
  return `${sign}${deltaPP.toFixed(1)} pp`;
}

/** Map tier string to a CSS colour variable name */
export function tierColor(tier: string): string {
  switch (tier) {
    case 'NORMAL':   return 'var(--color-normal)';
    case 'WATCH':    return 'var(--color-warning)';
    case 'HIGH':     return 'rgba(251,146,60,1)'; // orange-400
    case 'CRITICAL': return 'var(--color-critical)';
    default:         return 'var(--color-unknown)';
  }
}

export function tierBg(tier: string): string {
  switch (tier) {
    case 'NORMAL':   return 'rgba(34,197,94,0.15)';
    case 'WATCH':    return 'rgba(245,158,11,0.15)';
    case 'HIGH':     return 'rgba(251,146,60,0.15)';
    case 'CRITICAL': return 'rgba(239,68,68,0.15)';
    default:         return 'rgba(107,114,128,0.15)';
  }
}

/** Map indicator status to CSS colour */
export function indicatorStatusColor(status: IndicatorStatus): string {
  switch (status) {
    case 'normal':     return 'var(--color-normal)';
    case 'approaching':return 'var(--color-warning)';
    case 'triggered':  return 'var(--color-critical)';
  }
}

/** Human text for change type */
export function changeLabel(change: IndicatorSummary['change']): string {
  switch (change) {
    case 'new':      return '🆕 New';
    case 'resolved': return '✅ Resolved';
    case 'worsened': return '⬆ Worsened';
    case 'improved': return '⬇ Improved';
    case 'unchanged':return '— Same';
  }
}
