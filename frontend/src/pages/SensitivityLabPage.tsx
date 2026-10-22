/**
 * SensitivityLabPage.tsx
 * Phase 5: Sensitivity Analysis Lab
 *
 * IMPORTANT — read before changing:
 * - POST /api/explain performs ZERO database writes. No prediction rows, no alerts.
 * - No hardcoded thresholds, probabilities, or training ranges — all from backend responses.
 * - Results live in component state only; no localStorage/sessionStorage/IndexedDB.
 * - No interpolation, smoothing, or invented data points.
 * - Never claims RUL, remaining operating time, or physical causation.
 * - AI4I 2020 is a synthetic dataset.
 */
import React, { useState, useEffect, useCallback, useId } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  ScanSearch, ArrowLeft, RefreshCw, AlertTriangle,
  Info, XCircle, Play, StopCircle,
} from 'lucide-react';

import { api } from '../api/client';
import type { WhatIfResponse, Prediction, BaselineInfo } from '../api/client';
import { useSensitivitySweep } from '../api/useSensitivitySweep';
import {
  buildSweepValues, summarizeResults, diffIndicatorsBetween,
  thresholdConsistency, classifyRange, formatSweepValue, formatProbability,
  MAX_SWEEP_EVALUATIONS, MIN_SWEEP_EVALUATIONS, DEFAULT_SWEEP_EVALUATIONS,
  type SweepPointResult, type RangeClassification,
} from '../api/sensitivityLogic';
import {
  FEATURE_META, SCHEMA_LIMITS, NUMERIC_FIELDS,
  type WhatIfInputs, type NumericField,
} from '../api/whatIfLogic';
import { OriginBadge, LoadingState, EmptyState } from '../components/Common';

// ── Constants ─────────────────────────────────────────────────────────────────
const FIELD_ORDER: NumericField[] = [
  'air_temperature', 'process_temperature', 'rotational_speed', 'torque', 'tool_wear',
];

// ── Tier colours matching Phase 4 ────────────────────────────────────────────
function tierColor(tier: string): string {
  switch (tier) {
    case 'NORMAL':   return '#22c55e';
    case 'WATCH':    return '#f59e0b';
    case 'HIGH':     return '#fb923c';
    case 'CRITICAL': return '#ef4444';
    default:         return '#6b7280';
  }
}

// ── Small helper components ───────────────────────────────────────────────────

const InlineBadge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', padding: '1px 6px',
    borderRadius: '3px', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em',
    textTransform: 'uppercase', backgroundColor: `${color}22`, color, border: `1px solid ${color}44`,
  }}>
    {label}
  </span>
);

const RangeTag: React.FC<{ classification: RangeClassification }> = ({ classification }) => {
  if (classification === 'within_training') return null;
  if (classification === 'outside_training') {
    return <span style={{ color: '#f59e0b', fontSize: '0.75rem' }}>⚠ extrapolation</span>;
  }
  return <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>✕ outside schema</span>;
};

// ── Sweep range validation ────────────────────────────────────────────────────
interface SweepValidation {
  ok: boolean;
  error?: string;
  sweepValues: number[];
  minClassification: RangeClassification;
  maxClassification: RangeClassification;
  hasExtrapolation: boolean;
}

function validateSweepConfig(
  startVal: number,
  endVal: number,
  count: number,
  field: NumericField,
  trainingRange: { min: number; max: number } | null,
): SweepValidation {
  const schema = SCHEMA_LIMITS[field];
  if (!schema) {
    return { ok: false, error: 'Unknown field', sweepValues: [], minClassification: 'outside_schema', maxClassification: 'outside_schema', hasExtrapolation: false };
  }

  try {
    const sweepValues = buildSweepValues(startVal, endVal, count);
    const training = trainingRange ?? { min: schema.min, max: schema.max };

    const minClass = classifyRange(startVal, schema, training);
    const maxClass = classifyRange(endVal, schema, training);

    if (minClass === 'outside_schema' || maxClass === 'outside_schema') {
      const violator = minClass === 'outside_schema'
        ? `Start (${formatSweepValue(field, startVal)}) is outside the backend schema limits [${schema.min}, ${schema.max}].`
        : `End (${formatSweepValue(field, endVal)}) is outside the backend schema limits [${schema.min}, ${schema.max}].`;
      return { ok: false, error: violator, sweepValues: [], minClassification: minClass, maxClassification: maxClass, hasExtrapolation: false };
    }

    const hasExtrapolation = minClass === 'outside_training' || maxClass === 'outside_training';
    return { ok: true, sweepValues, minClassification: minClass, maxClassification: maxClass, hasExtrapolation };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid sweep range.';
    return { ok: false, error: msg, sweepValues: [], minClassification: 'within_training', maxClassification: 'within_training', hasExtrapolation: false };
  }
}

interface SweepTooltipProps {
  active?: boolean;
  payload?: any;
  selectedFeature: NumericField;
  threshold: number | null;
  thresholdConsistent: boolean;
}

const SweepTooltip: React.FC<SweepTooltipProps> = ({ active, payload, selectedFeature, threshold, thresholdConsistent }) => {
  if (!active || !payload?.length) return null;
  const pr = payload[0]?.payload?.pointResult as SweepPointResult | undefined;
  if (!pr || pr.status !== 'success' || !pr.response) return null;
  const res = pr.response;
  const indicators = res.recommendations?.indicators ?? [];
  const triggered = indicators.filter(i => i.status === 'triggered');
  const approaching = indicators.filter(i => i.status === 'approaching');

  return (
    <div role="tooltip" style={{
      background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
      padding: '12px 16px', fontSize: '0.8rem', color: '#e2e8f0', maxWidth: '280px',
    }}>
      <div style={{ fontWeight: 700, marginBottom: '8px', color: '#38bdf8' }}>
        {FEATURE_META[selectedFeature]?.label}: {formatSweepValue(selectedFeature, pr.value)} {FEATURE_META[selectedFeature]?.unit}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div><span style={{ color: '#94a3b8' }}>Failure Probability: </span>
          <strong style={{ color: res.failure_probability >= (threshold ?? 0.66) ? '#ef4444' : '#22c55e' }}>
            {formatProbability(res.failure_probability)}
          </strong>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: '#94a3b8' }}>Model Label: </span>
          <InlineBadge
            label={res.predicted_label}
            color={res.predicted_label === 'Failure' ? '#ef4444' : '#22c55e'}
          />
        </div>
        {res.recommendations && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: '#94a3b8' }}>Maintenance Tier: </span>
            <InlineBadge label={res.recommendations.risk_tier} color={tierColor(res.recommendations.risk_tier)} />
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>(application policy)</span>
          </div>
        )}
        {thresholdConsistent && threshold !== null && (
          <div><span style={{ color: '#94a3b8' }}>Decision Threshold: </span>{formatProbability(threshold)}</div>
        )}
        {triggered.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            <span style={{ color: '#ef4444' }}>⚠ Triggered rules: </span>
            {triggered.map(t => t.name).join(', ')}
          </div>
        )}
        {approaching.length > 0 && (
          <div>
            <span style={{ color: '#f59e0b' }}>→ Approaching: </span>
            {approaching.map(a => a.name).join(', ')}
          </div>
        )}
        {res.outside_range_warnings?.length > 0 && (
          <div style={{ marginTop: '4px', color: '#f59e0b', fontSize: '0.75rem' }}>
            ⚠ Extrapolation warning
          </div>
        )}
      </div>
    </div>
  );
};

// ── Snapshot → WhatIfInputs parser ───────────────────────────────────────────
function snapshotToInputs(snapshot: Record<string, unknown>): WhatIfInputs | null {
  // Snapshot uses AI4I column names (e.g. 'Air temperature [K]')
  // or may use snake_case depending on how stored — handle both
  const get = (aiKey: string, snakeKey: string): number | string | null => {
    const v = snapshot[aiKey] ?? snapshot[snakeKey];
    return v !== undefined ? (v as number | string) : null;
  };

  const type = (snapshot['Type'] ?? snapshot['type'] ?? snapshot['product_type']) as string | null;
  const air = get('Air temperature [K]', 'air_temperature');
  const proc = get('Process temperature [K]', 'process_temperature');
  const rpm = get('Rotational speed [rpm]', 'rotational_speed');
  const torq = get('Torque [Nm]', 'torque');
  const wear = get('Tool wear [min]', 'tool_wear');

  if (!type || air === null || proc === null || rpm === null || torq === null || wear === null) {
    return null;
  }

  return {
    type: String(type),
    air_temperature: Number(air),
    process_temperature: Number(proc),
    rotational_speed: Number(rpm),
    torque: Number(torq),
    tool_wear: Number(wear),
  };
}

function baselineToInputs(info: BaselineInfo): WhatIfInputs | null {
  const bv = info.baseline_values;
  const type = (bv['Type'] ?? bv['type'] ?? 'L') as string;
  const air = bv['Air temperature [K]'];
  const proc = bv['Process temperature [K]'];
  const rpm = bv['Rotational speed [rpm]'];
  const torq = bv['Torque [Nm]'];
  const wear = bv['Tool wear [min]'];

  if (air === undefined || proc === undefined || rpm === undefined || torq === undefined || wear === undefined) {
    return null;
  }

  return {
    type: String(type),
    air_temperature: Number(air),
    process_temperature: Number(proc),
    rotational_speed: Number(rpm),
    torque: Number(torq),
    tool_wear: Number(wear),
  };
}

// ── Training ranges from baseline ────────────────────────────────────────────
// Maps AI4I column names to snake_case field names
const COLUMN_TO_FIELD: Record<string, NumericField> = {
  'Air temperature [K]': 'air_temperature',
  'Process temperature [K]': 'process_temperature',
  'Rotational speed [rpm]': 'rotational_speed',
  'Torque [Nm]': 'torque',
  'Tool wear [min]': 'tool_wear',
};

function extractTrainingRanges(info: BaselineInfo): Record<NumericField, { min: number; max: number }> {
  const result: Partial<Record<NumericField, { min: number; max: number }>> = {};
  for (const [colName, fieldName] of Object.entries(COLUMN_TO_FIELD)) {
    const r = info.training_ranges[colName];
    if (r) {
      result[fieldName] = { min: r.min, max: r.max };
    }
  }
  return result as Record<NumericField, { min: number; max: number }>;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export const SensitivityLabPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const fromId = searchParams.get('from') ?? undefined;
  const idPrefix = useId();

  // ── Starting point state ───────────────────────────────────────────────────
  const [baselineInfo, setBaselineInfo] = useState<BaselineInfo | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(true);
  const [trainingRanges, setTrainingRanges] = useState<Record<NumericField, { min: number; max: number }> | null>(null);

  const [originPrediction, setOriginPrediction] = useState<Prediction | null>(null);
  const [originError, setOriginError] = useState<string | null>(null);
  const [originLoading, setOriginLoading] = useState(false);

  const [startingPoint, setStartingPoint] = useState<'prediction' | 'baseline'>('baseline');
  const [startingInputs, setStartingInputs] = useState<WhatIfInputs | null>(null);
  const [inputsError, setInputsError] = useState<string | null>(null);

  // ── Sweep configuration state ──────────────────────────────────────────────
  const [selectedFeature, setSelectedFeature] = useState<NumericField>('tool_wear');
  const [sweepStart, setSweepStart] = useState<string>('');
  const [sweepEnd, setSweepEnd] = useState<string>('');
  const [sweepCount, setSweepCount] = useState<string>(String(DEFAULT_SWEEP_EVALUATIONS));

  // ── Sweep runner ───────────────────────────────────────────────────────────
  const {
    runState, results, progress, isPartial, isStale,
    statusMessage, runSweep, cancelSweep, markStale, resetSweep,
  } = useSensitivitySweep();

  // ── Load baseline ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setBaselineLoading(true);
    api.getBaselineInfo()
      .then((info) => {
        if (cancelled) return;
        setBaselineInfo(info);
        setBaselineError(null);
        const ranges = extractTrainingRanges(info as BaselineInfo);
        setTrainingRanges(ranges);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setBaselineError(e instanceof Error ? e.message : 'Failed to load baseline info.');
      })
      .finally(() => {
        if (!cancelled) setBaselineLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // ── Load prediction by ID ──────────────────────────────────────────────────
  useEffect(() => {
    if (!fromId) {
      setOriginPrediction(null);
      setOriginError(null);
      setOriginLoading(false);
      return;
    }

    let cancelled = false;
    setOriginLoading(true);
    setOriginError(null);

    api.getPrediction(fromId)
      .then((pred) => {
        if (cancelled) return;
        setOriginPrediction(pred);
        setOriginError(null);
        setStartingPoint('prediction');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setOriginError(
          e instanceof Error
            ? `Could not load prediction ${fromId}: ${e.message}. Using healthy baseline instead.`
            : `Could not load prediction ${fromId}. Using healthy baseline instead.`
        );
        setStartingPoint('baseline');
      })
      .finally(() => {
        if (!cancelled) setOriginLoading(false);
      });
    return () => { cancelled = true; };
  }, [fromId]);

  // ── Load latest prediction if no ?from= ────────────────────────────────────
  useEffect(() => {
    if (fromId) return;
    let cancelled = false;
    api.listPredictions(1, 0)
      .then(({ items }) => {
        if (cancelled || !items.length) return;
        return api.getPrediction(items[0].prediction_id);
      })
      .then((pred) => {
        if (cancelled || !pred) return;
        setOriginPrediction(pred as Prediction);
        setStartingPoint('prediction');
      })
      .catch(() => {
        // No stored predictions — silently fall back to baseline
      });
    return () => { cancelled = true; };
  }, [fromId]);

  // ── Resolve starting inputs ────────────────────────────────────────────────
  useEffect(() => {
    if (startingPoint === 'prediction' && originPrediction) {
      const inputs = snapshotToInputs(originPrediction.input_snapshot);
      if (inputs) {
        setStartingInputs(inputs);
        setInputsError(null);
      } else {
        setInputsError('Could not parse input snapshot from stored prediction. Check field names.');
        setStartingInputs(null);
      }
    } else if (startingPoint === 'baseline' && baselineInfo) {
      const inputs = baselineToInputs(baselineInfo as BaselineInfo);
      if (inputs) {
        setStartingInputs(inputs);
        setInputsError(null);
      } else {
        setInputsError('Could not parse healthy baseline values from API response.');
        setStartingInputs(null);
      }
    }
  }, [startingPoint, originPrediction, baselineInfo]);

  // ── Default sweep start/end from training range ────────────────────────────
  useEffect(() => {
    if (!trainingRanges) return;
    const range = trainingRanges[selectedFeature];
    if (!range) return;
    setSweepStart(String(range.min));
    setSweepEnd(String(range.max));
  }, [selectedFeature, trainingRanges]);

  // Mark stale when configuration changes after a completed run
  const onConfigChange = useCallback(() => {
    if (runState === 'completed' || runState === 'partial') {
      markStale();
    }
  }, [runState, markStale]);

  const handleFeatureChange = useCallback((f: NumericField) => {
    setSelectedFeature(f);
    onConfigChange();
  }, [onConfigChange]);

  const handleSweepStartChange = useCallback((v: string) => {
    setSweepStart(v);
    onConfigChange();
  }, [onConfigChange]);

  const handleSweepEndChange = useCallback((v: string) => {
    setSweepEnd(v);
    onConfigChange();
  }, [onConfigChange]);

  const handleSweepCountChange = useCallback((v: string) => {
    setSweepCount(v);
    onConfigChange();
  }, [onConfigChange]);

  const handleStartingPointSwitch = useCallback((sp: 'prediction' | 'baseline') => {
    setStartingPoint(sp);
    onConfigChange();
  }, [onConfigChange]);

  // ── Compute sweep validation ───────────────────────────────────────────────
  const startNum = parseFloat(sweepStart);
  const endNum = parseFloat(sweepEnd);
  const countNum = parseInt(sweepCount, 10);
  const countClamped = Math.max(MIN_SWEEP_EVALUATIONS, Math.min(MAX_SWEEP_EVALUATIONS, isNaN(countNum) ? DEFAULT_SWEEP_EVALUATIONS : countNum));
  const trainingRange = trainingRanges?.[selectedFeature] ?? null;

  const sweepValidation = (!isNaN(startNum) && !isNaN(endNum) && !isNaN(countNum))
    ? validateSweepConfig(startNum, endNum, countNum, selectedFeature, trainingRange)
    : { ok: false, error: 'Enter valid numeric start, end and count values.', sweepValues: [], minClassification: 'within_training' as RangeClassification, maxClassification: 'within_training' as RangeClassification, hasExtrapolation: false };

  const canRun = sweepValidation.ok && startingInputs !== null && runState !== 'running';

  // ── Handle Run Analysis ────────────────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (!canRun || !startingInputs) return;
    runSweep(startingInputs, selectedFeature, sweepValidation.sweepValues);
  }, [canRun, startingInputs, selectedFeature, sweepValidation.sweepValues, runSweep]);

  // ── Results analysis ───────────────────────────────────────────────────────
  const summary = results.length > 0 ? summarizeResults(results) : null;
  const thresholdResult = results.length > 0 ? thresholdConsistency(results) : null;
  const activeThreshold = thresholdResult?.consistent ? thresholdResult.threshold : null;

  // ── Build chart data (only successful points) ──────────────────────────────
  const chartData = results
    .filter((r) => r.status === 'success' && r.response)
    .map((r) => ({
      x: r.value,
      y: r.response!.failure_probability,
      pointResult: r,
    }));

  // ── Detect label / tier transitions between consecutive successful points ──
  const successfulPoints = results.filter((r) => r.status === 'success' && r.response);
  const transitions: Array<{
    fromIndex: number;
    toIndex: number;
    fromValue: number;
    toValue: number;
    labelChanged: boolean;
    tierChanged: boolean;
    indicators: ReturnType<typeof diffIndicatorsBetween>;
  }> = [];

  for (let i = 0; i < successfulPoints.length - 1; i++) {
    const curr = successfulPoints[i];
    const next = successfulPoints[i + 1];
    if (next.index === curr.index + 1) {
      const labelChanged = curr.response!.predicted_label !== next.response!.predicted_label;
      const tierChanged = curr.response!.recommendations?.risk_tier !== next.response!.recommendations?.risk_tier;
      const indicators = diffIndicatorsBetween(curr.response!, next.response!);
      if (labelChanged || tierChanged || indicators.some(t => t.changed)) {
        transitions.push({
          fromIndex: curr.index,
          toIndex: next.index,
          fromValue: curr.value,
          toValue: next.value,
          labelChanged,
          tierChanged,
          indicators,
        });
      }
    }
  }

  // ── Accessibility summary text ─────────────────────────────────────────────
  const accessibilitySummary = summary && summary.successfulCount > 0 && thresholdResult
    ? `Sensitivity analysis chart: ${FEATURE_META[selectedFeature]?.label} swept from ${formatSweepValue(selectedFeature, sweepValidation.sweepValues[0] ?? 0)} to ${formatSweepValue(selectedFeature, sweepValidation.sweepValues[sweepValidation.sweepValues.length - 1] ?? 0)} ${FEATURE_META[selectedFeature]?.unit}. ` +
      `${summary.successfulCount} of ${summary.totalCount} evaluations succeeded. ` +
      (summary.minProbability !== null && summary.maxProbability !== null
        ? `Failure probability ranged from ${formatProbability(summary.minProbability)} to ${formatProbability(summary.maxProbability)}. `
        : '') +
      `${summary.consecutiveLabelChanges} label change(s) observed between consecutive successful points.`
    : '';

  // ── Render ─────────────────────────────────────────────────────────────────
  if (baselineLoading || originLoading) {
    return (
      <div className="page">
        <LoadingState label="Loading Sensitivity Analysis Lab…" />
      </div>
    );
  }

  if (baselineError && !baselineInfo) {
    return (
      <div className="page">
        <div style={{ padding: '2rem' }}>
          <div className="alert-banner error" role="alert">
            <AlertTriangle size={16} />
            <span>Could not load backend baseline info: {baselineError}. Check that the FastAPI backend is running on port 8001.</span>
          </div>
        </div>
      </div>
    );
  }

  const meta = FEATURE_META[selectedFeature];
  const schema = SCHEMA_LIMITS[selectedFeature];

  return (
    <div className="page" aria-busy={runState === 'running'}>
      {/* ── aria-live region for run completion ────────────────────────── */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {(runState === 'completed' || runState === 'partial' || runState === 'failed') ? statusMessage : ''}
      </div>

      {/* ── Accessibility summary (visually hidden) ─────────────────────── */}
      {accessibilitySummary && (
        <div style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
          aria-label={accessibilitySummary} />
      )}

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => window.history.back()}
            aria-label="Go back"
          >
            <ArrowLeft size={17} />
          </button>
          <ScanSearch size={28} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
            Sensitivity Analysis Lab
          </h1>
          <OriginBadge type="HYPOTHETICAL" label="HYPOTHETICAL — not saved, no alerts" />
          <OriginBadge type="MODEL_OUTPUT" />
          <Link to="/what-if" className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
            <ArrowLeft size={14} /> What-if Lab
          </Link>
        </div>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.02rem', lineHeight: 1.6, margin: 0 }}>
          Sweep one feature across an operating range and observe how the model's failure probability responds — with all other inputs held fixed.
        </p>
      </div>

      {/* ── Required disclaimer ─────────────────────────────────────────── */}
      <div style={{
        marginBottom: 'var(--space-6)',
        padding: 'var(--space-4) var(--space-5)',
        borderRadius: 'var(--radius)',
        background: 'rgba(14,165,233,0.08)',
        border: '1px solid rgba(14,165,233,0.22)',
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
      }}>
        <Info size={18} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--color-text-primary)' }}>Sensitivity analysis</strong> shows how the model responds to evaluated inputs.
          It does <strong>not</strong> establish physical causation or predict actual future machine behaviour.
          Results are <strong>not saved</strong> and create no alerts or prediction history.
          AI4I 2020 is a <strong>synthetic dataset</strong>; model behaviour outside the training
          distribution is extrapolation and may be unreliable.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 380px) 1fr', gap: 'var(--space-6)', minWidth: 0 }}>
        {/* ── LEFT PANEL: Configuration ──────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

          {/* ── Starting point ─────────────────────────────────────────── */}
          <section className="card card-shine" style={{ padding: 'var(--space-5)' }} aria-labelledby={`${idPrefix}-sp-heading`}>
            <h2 id={`${idPrefix}-sp-heading`} style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-text-primary)' }}>
              Starting Point
            </h2>

            {originError && (
              <div className="alert-banner warning" role="alert" style={{ marginBottom: 'var(--space-3)', fontSize: '0.85rem' }}>
                <AlertTriangle size={15} />
                <span>{originError}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              {originPrediction && (
                <button
                  className={`btn btn-sm ${startingPoint === 'prediction' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleStartingPointSwitch('prediction')}
                  style={{ flex: 1 }}
                  aria-pressed={startingPoint === 'prediction'}
                >
                  Stored Prediction
                </button>
              )}
              <button
                className={`btn btn-sm ${startingPoint === 'baseline' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleStartingPointSwitch('baseline')}
                style={{ flex: 1 }}
                aria-pressed={startingPoint === 'baseline'}
              >
                Healthy Baseline
              </button>
            </div>

            {/* Starting inputs display (read-only) */}
            {inputsError && (
              <div className="alert-banner error" role="alert" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                <XCircle size={13} /> {inputsError}
              </div>
            )}

            {startingInputs && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {startingPoint === 'prediction'
                      ? `Prediction #${originPrediction?.id?.slice(-8) ?? '—'}`
                      : 'Healthy non-failure median baseline'
                    }
                  </span>
                  {startingPoint === 'prediction'
                    ? <OriginBadge type="SIMULATED" label="SIMULATED" />
                    : <OriginBadge type="MODEL_OUTPUT" label="BASELINE" />
                  }
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '2px' }}>
                    Type: <strong style={{ color: '#e2e8f0' }}>{startingInputs.type}</strong>
                    <span style={{ marginLeft: '8px', color: '#475569', fontSize: '0.7rem' }}>(categorical — held fixed, not sweepable)</span>
                  </div>
                  {FIELD_ORDER.map((field) => (
                    <div key={field} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '3px 6px', borderRadius: '4px',
                      background: field === selectedFeature ? 'rgba(56,189,248,0.08)' : 'transparent',
                      border: field === selectedFeature ? '1px solid rgba(56,189,248,0.2)' : '1px solid transparent',
                    }}>
                      <span style={{ fontSize: '0.75rem', color: field === selectedFeature ? '#38bdf8' : '#94a3b8' }}>
                        {FEATURE_META[field]?.label}
                        {field === selectedFeature && <span style={{ marginLeft: '4px', fontSize: '0.65rem' }}>← sweeping</span>}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
                        {formatSweepValue(field, startingInputs[field] as number)} {FEATURE_META[field]?.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!startingInputs && !inputsError && (
              <EmptyState icon="📊" title="No starting inputs available" subtitle="Load a prediction or use the healthy baseline." />
            )}
          </section>

          {/* ── Feature selector ──────────────────────────────────────── */}
          <section className="card card-shine" style={{ padding: 'var(--space-5)' }} aria-labelledby={`${idPrefix}-feat-heading`}>
            <h2 id={`${idPrefix}-feat-heading`} style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 'var(--space-2)', color: 'var(--color-text-primary)' }}>
              Feature to Sweep
            </h2>
            <label htmlFor={`${idPrefix}-feature-select`} style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: 'var(--space-3)' }}>
              Select one numerical feature (categorical Type is fixed)
            </label>
            <select
              id={`${idPrefix}-feature-select`}
              value={selectedFeature}
              onChange={(e) => handleFeatureChange(e.target.value as NumericField)}
              className="form-select"
              style={{ width: '100%', fontSize: '0.95rem', padding: '10px 14px' }}
            >
              {FIELD_ORDER.map((f) => (
                <option key={f} value={f}>
                  {FEATURE_META[f]?.label} ({FEATURE_META[f]?.unit})
                </option>
              ))}
            </select>
            <div style={{ marginTop: 'var(--space-3)', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {NUMERIC_FIELDS.length} numerical features available · categorical Type is not sweepable
            </div>
          </section>

          {/* ── Sweep range config ────────────────────────────────────── */}
          <section className="card card-shine" style={{ padding: 'var(--space-5)' }} aria-labelledby={`${idPrefix}-range-heading`}>
            <h2 id={`${idPrefix}-range-heading`} style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-text-primary)' }}>
              Sweep Range
            </h2>

            {/* Training range info */}
            {trainingRange && (
              <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: '0.82rem' }}>
                <div style={{ color: 'var(--color-text-muted)', marginBottom: '2px' }}>Observed training range (AI4I 2020):</div>
                <div style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {trainingRange.min} – {trainingRange.max} {meta?.unit}
                </div>
                <div style={{ color: 'var(--color-text-muted)', marginTop: '6px' }}>Backend schema limits:</div>
                <div style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {schema?.min} – {schema?.max} {meta?.unit}
                </div>
                <div style={{ color: 'var(--color-text-muted)', marginTop: '6px', fontSize: '0.75rem', lineHeight: 1.4 }}>
                  Values outside the training range but within schema limits will be accepted with an extrapolation warning.
                  Values outside schema limits will be rejected.
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <div>
                <label htmlFor={`${idPrefix}-start`} style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                  Start ({meta?.unit})
                </label>
                <input
                  id={`${idPrefix}-start`}
                  type="number"
                  value={sweepStart}
                  onChange={(e) => handleSweepStartChange(e.target.value)}
                  step={meta?.step}
                  className="form-input"
                  style={{ width: '100%', fontSize: '0.95rem', padding: '8px 12px' }}
                  aria-label={`Sweep start value in ${meta?.unit}`}
                />
                {!isNaN(startNum) && trainingRange && (
                  <div style={{ marginTop: '4px' }}>
                    <RangeTag classification={classifyRange(startNum, schema, trainingRange)} />
                  </div>
                )}
              </div>
              <div>
                <label htmlFor={`${idPrefix}-end`} style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                  End ({meta?.unit})
                </label>
                <input
                  id={`${idPrefix}-end`}
                  type="number"
                  value={sweepEnd}
                  onChange={(e) => handleSweepEndChange(e.target.value)}
                  step={meta?.step}
                  className="form-input"
                  style={{ width: '100%', fontSize: '0.95rem', padding: '8px 12px' }}
                  aria-label={`Sweep end value in ${meta?.unit}`}
                />
                {!isNaN(endNum) && trainingRange && (
                  <div style={{ marginTop: '4px' }}>
                    <RangeTag classification={classifyRange(endNum, schema, trainingRange)} />
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor={`${idPrefix}-count`} style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', display: 'block', marginBottom: '4px' }}>
                Evaluation Count (max {MAX_SWEEP_EVALUATIONS})
              </label>
              <input
                id={`${idPrefix}-count`}
                type="number"
                value={sweepCount}
                onChange={(e) => handleSweepCountChange(e.target.value)}
                min={MIN_SWEEP_EVALUATIONS}
                max={MAX_SWEEP_EVALUATIONS}
                step={1}
                className="form-input"
                style={{ width: '100%', fontSize: '0.95rem', padding: '8px 12px' }}
                aria-label={`Number of evaluation points between ${MIN_SWEEP_EVALUATIONS} and ${MAX_SWEEP_EVALUATIONS}`}
              />
              {!isNaN(countNum) && (countNum < MIN_SWEEP_EVALUATIONS || countNum > MAX_SWEEP_EVALUATIONS) && (
                <div style={{ color: 'var(--color-warning)', fontSize: '0.78rem', marginTop: '4px' }}>
                  Will be clamped to {countClamped} (range: {MIN_SWEEP_EVALUATIONS}–{MAX_SWEEP_EVALUATIONS})
                </div>
              )}
            </div>

            {/* Sweep extrapolation warning (non-blocking) */}
            {sweepValidation.ok && sweepValidation.hasExtrapolation && (
              <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', fontSize: '0.82rem', color: 'var(--color-warning)', marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  The sweep range extends beyond the training distribution. Points outside the training range
                  will be sent to the model, which may produce extrapolated results. The backend will include
                  <strong> outside_range_warnings</strong> in those responses.
                </span>
              </div>
            )}

            {/* Schema violation error (blocking) */}
            {!sweepValidation.ok && sweepValidation.error && (
              <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', fontSize: '0.82rem', color: 'var(--color-critical)', marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }} role="alert">
                <XCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{sweepValidation.error}</span>
              </div>
            )}

            {/* Run / Cancel buttons */}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                onClick={handleRun}
                disabled={!canRun}
                aria-disabled={!canRun}
                className="btn btn-primary"
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 'var(--space-2)',
                  fontSize: '0.95rem',
                  padding: '12px 18px',
                }}
              >
                {runState === 'running'
                  ? <><RefreshCw size={16} className="spinner" /> Running…</>
                  : <><Play size={16} /> Run Analysis</>
                }
              </button>

              {runState === 'running' && (
                <button
                  onClick={cancelSweep}
                  className="btn btn-secondary"
                  style={{
                    padding: '12px 16px',
                    color: 'var(--color-critical)',
                    borderColor: 'rgba(239,68,68,0.3)',
                  }}
                  aria-label="Cancel sweep"
                >
                  <StopCircle size={16} />
                </button>
              )}

              {(runState === 'completed' || runState === 'partial' || runState === 'failed') && (
                <button
                  onClick={resetSweep}
                  className="btn btn-ghost"
                  style={{ padding: '12px 16px' }}
                  aria-label="Clear results"
                >
                  <RefreshCw size={16} />
                </button>
              )}
            </div>
          </section>
        </div>

        {/* ── RIGHT PANEL: Results ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minWidth: 0 }}>

          {/* ── Progress indicator ──────────────────────────────────────── */}
          {(runState === 'running' || runState === 'completed' || runState === 'partial' || runState === 'failed') && (
            <div style={{ padding: '0.75rem 1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid #1e293b', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>{statusMessage}</span>
                  <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{progress.completed} / {progress.total}</span>
                </div>
                <div style={{ height: '8px', borderRadius: '4px', background: 'var(--color-surface-2)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: progress.total > 0 ? `${(progress.completed / progress.total) * 100}%` : '0%',
                    background: runState === 'failed' ? 'var(--color-critical)' : runState === 'partial' ? 'var(--color-warning)' : 'var(--color-accent)',
                    borderRadius: '4px',
                    transition: 'width 0.2s ease-out',
                  }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                {runState === 'completed' && !isPartial && (
                  <InlineBadge label="COMPLETED" color="#22c55e" />
                )}
                {isStale && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <AlertTriangle size={14} /> Results are stale — configuration changed
                  </span>
                )}
                {isPartial && runState !== 'running' && (
                  <InlineBadge label={runState === 'partial' ? 'CANCELLED' : 'PARTIAL'} color="#f59e0b" />
                )}
                {runState === 'failed' && !isPartial && (
                  <InlineBadge label="FAILED" color="#ef4444" />
                )}
              </div>
            </div>
          )}

          {/* ── Threshold note ──────────────────────────────────────────── */}
          {thresholdResult && !thresholdResult.consistent && (
            <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.82rem', color: 'var(--color-warning)' }}>
              ⚠ {thresholdResult.message} The threshold reference line cannot be shown.
            </div>
          )}

          {/* ── Main chart ──────────────────────────────────────────────── */}
          {(runState === 'completed' || runState === 'partial' || runState === 'failed' || results.length > 0) && (
            <section className="card card-shine" style={{ padding: 'var(--space-5)' }} aria-labelledby={`${idPrefix}-chart-heading`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <h2 id={`${idPrefix}-chart-heading`} style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: 'var(--color-text-primary)' }}>
                  Failure Probability vs {meta?.label}
                </h2>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <OriginBadge type="MODEL_OUTPUT" />
                  {isStale && <InlineBadge label="STALE" color="#f59e0b" />}
                </div>
              </div>

              {chartData.length === 0 && (
                <div style={{ height: '320px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>
                  {runState === 'failed' ? 'All evaluations failed — no chart data available.' : 'No successful evaluations to plot.'}
                </div>
              )}

              {chartData.length > 0 && (
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={chartData} margin={{ top: 12, right: 24, left: 10, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      label={{ value: `${meta?.label} (${meta?.unit})`, position: 'insideBottom', offset: -14, fill: '#94a3b8', fontSize: 13 }}
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      tickFormatter={(v: number) => formatSweepValue(selectedFeature, v)}
                    />
                    <YAxis
                      dataKey="y"
                      domain={[0, 1]}
                      tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      label={{ value: 'Failure Probability', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 13 }}
                    />
                    <RechartTooltip
                      content={(props) => (
                        <SweepTooltip
                          {...props}
                          selectedFeature={selectedFeature}
                          threshold={activeThreshold}
                          thresholdConsistent={thresholdResult?.consistent ?? false}
                        />
                      )}
                    />
                    {/* Threshold reference line — only if consistent and available */}
                    {activeThreshold !== null && thresholdResult?.consistent && (
                      <ReferenceLine
                        y={activeThreshold}
                        stroke="var(--color-critical)"
                        strokeDasharray="5 5"
                        strokeWidth={1.5}
                        label={{ value: `Threshold ${formatProbability(activeThreshold)}`, fill: 'var(--color-critical)', fontSize: 11, position: 'insideTopRight' }}
                      />
                    )}
                    <Line
                      type="linear"
                      dataKey="y"
                      stroke="var(--color-accent)"
                      strokeWidth={2.5}
                      dot={(dotProps) => {
                        const { cx, cy, payload } = dotProps as { cx: number; cy: number; payload: { pointResult: SweepPointResult; y: number } };
                        const pr = payload.pointResult;
                        const prob = payload.y;
                        const isAboveThreshold = activeThreshold !== null && prob >= activeThreshold;
                        const dotColor = isAboveThreshold ? 'var(--color-critical)' : 'var(--color-accent)';
                        return (
                          <circle
                            key={`dot-${pr.index}`}
                            cx={cx}
                            cy={cy}
                            r={5.5}
                            fill={dotColor}
                            stroke="#070a16"
                            strokeWidth={2}
                          />
                        );
                      }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}

              {/* Failed points strip */}
              {results.some(r => r.status === 'failed') && (
                <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.82rem' }}>
                  <strong style={{ color: 'var(--color-critical)' }}>Failed evaluations (not plotted):</strong>
                  <div style={{ marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {results.filter(r => r.status === 'failed').map(r => (
                      <span key={r.index} title={r.errorMessage} style={{
                        padding: '2px 8px', borderRadius: '4px', background: 'rgba(239,68,68,0.15)', color: '#fca5a5', fontSize: '0.78rem',
                      }}>
                        {formatSweepValue(selectedFeature, r.value)} ({r.failureKind ?? 'unknown'})
                      </span>
                    ))}
                  </div>
                  {summary?.hasGaps && (
                    <div style={{ marginTop: '6px', color: 'var(--color-critical)' }}>
                      ⚠ {summary.gapCount} gap(s) in consecutive successful points — transitions across gaps are not counted.
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Summary stats ───────────────────────────────────────────── */}
          {summary && summary.successfulCount > 0 && (
            <section className="card card-shine" style={{ padding: 'var(--space-5)' }} aria-labelledby={`${idPrefix}-summary-heading`}>
              <h2 id={`${idPrefix}-summary-heading`} style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 'var(--space-4)', color: 'var(--color-text-primary)' }}>
                Summary <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>(among evaluated points only)</span>
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
                {[
                  { label: 'Succeeded', value: `${summary.successfulCount} / ${summary.totalCount}`, color: '#22c55e' },
                  { label: 'Failed', value: String(summary.failedCount), color: summary.failedCount > 0 ? '#ef4444' : 'var(--color-text-muted)' },
                  { label: 'Min Probability', value: summary.minProbability !== null ? formatProbability(summary.minProbability) : '—', color: 'var(--color-accent)' },
                  { label: 'Max Probability', value: summary.maxProbability !== null ? formatProbability(summary.maxProbability) : '—', color: 'var(--color-accent)' },
                  { label: 'Label Changes', value: String(summary.consecutiveLabelChanges), color: summary.consecutiveLabelChanges > 0 ? '#f59e0b' : 'var(--color-text-muted)', note: 'consecutive' },
                  { label: 'Tier Changes', value: String(summary.consecutiveTierChanges), color: summary.consecutiveTierChanges > 0 ? '#f59e0b' : 'var(--color-text-muted)', note: 'consecutive' },
                ].map(({ label, value, color, note }) => (
                  <div key={label} style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px', fontWeight: 600 }}>
                      {label} {note && <span>({note})</span>}
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Transitions ─────────────────────────────────────────────── */}
          {transitions.length > 0 && (
            <section className="card card-shine" style={{ padding: 'var(--space-5)' }} aria-labelledby={`${idPrefix}-trans-heading`}>
              <h2 id={`${idPrefix}-trans-heading`} style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 'var(--space-4)', color: 'var(--color-text-primary)' }}>
                Observed Transitions <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>(consecutive successful points only)</span>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {transitions.map((t) => (
                  <div key={`${t.fromIndex}-${t.toIndex}`} style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)', fontSize: '0.85rem' }}>
                    <div style={{ color: 'var(--color-warning)', fontWeight: 700, marginBottom: '6px', fontSize: '0.9rem' }}>
                      {formatSweepValue(selectedFeature, t.fromValue)} → {formatSweepValue(selectedFeature, t.toValue)} {meta?.unit}
                    </div>
                    {t.labelChanged && (
                      <div style={{ marginBottom: '4px' }}>
                        <strong style={{ color: 'var(--color-text-primary)' }}>Model label: </strong>
                        <InlineBadge
                          label={results[t.fromIndex]?.response?.predicted_label ?? '?'}
                          color={results[t.fromIndex]?.response?.predicted_label === 'Failure' ? '#ef4444' : '#22c55e'}
                        />
                        {' → '}
                        <InlineBadge
                          label={results[t.toIndex]?.response?.predicted_label ?? '?'}
                          color={results[t.toIndex]?.response?.predicted_label === 'Failure' ? '#ef4444' : '#22c55e'}
                        />
                        <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>(model output)</span>
                      </div>
                    )}
                    {t.tierChanged && (
                      <div style={{ marginBottom: '4px' }}>
                        <strong style={{ color: 'var(--color-text-primary)' }}>Maintenance tier: </strong>
                        <InlineBadge
                          label={results[t.fromIndex]?.response?.recommendations?.risk_tier ?? '?'}
                          color={tierColor(results[t.fromIndex]?.response?.recommendations?.risk_tier ?? '')}
                        />
                        {' → '}
                        <InlineBadge
                          label={results[t.toIndex]?.response?.recommendations?.risk_tier ?? '?'}
                          color={tierColor(results[t.toIndex]?.response?.recommendations?.risk_tier ?? '')}
                        />
                        <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>(application policy — does not change the model label)</span>
                      </div>
                    )}
                    {t.indicators.filter(i => i.changed).map(ind => (
                      <div key={ind.rule_id} style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', marginTop: '2px' }}>
                        Rule <strong>{ind.name}</strong>: {ind.description}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Results table ───────────────────────────────────────────── */}
          {results.length > 0 && (
            <section className="card card-shine" style={{ padding: 'var(--space-5)' }} aria-labelledby={`${idPrefix}-table-heading`}>
              <h2 id={`${idPrefix}-table-heading`} style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 'var(--space-4)', color: 'var(--color-text-primary)' }}>
                Detailed Results
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }} role="table" aria-label="Sweep evaluation results">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {['#', meta?.label + ` (${meta?.unit})`, 'Probability', 'Model Label', 'Tier', 'Triggered Rules', 'Status'].map((h) => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const res: WhatIfResponse | undefined = r.response;
                      const triggered = res?.recommendations?.indicators?.filter(i => i.status === 'triggered') ?? [];
                      const approaching = res?.recommendations?.indicators?.filter(i => i.status === 'approaching') ?? [];

                      return (
                        <tr key={r.index} style={{
                          borderBottom: '1px solid var(--color-border)',
                          background: r.status === 'success' ? 'transparent' : 'rgba(239,68,68,0.04)',
                        }}>
                          <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                            {r.index + 1}
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                            {formatSweepValue(selectedFeature, r.value)}
                          </td>
                          <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums' }}>
                            {res ? (
                              <span style={{ color: res.failure_probability >= (activeThreshold ?? 0.66) ? 'var(--color-critical)' : 'var(--color-normal)', fontWeight: 700 }}>
                                {formatProbability(res.failure_probability)}
                              </span>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {res ? (
                              <InlineBadge
                                label={res.predicted_label}
                                color={res.predicted_label === 'Failure' ? '#ef4444' : '#22c55e'}
                              />
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {res?.recommendations ? (
                              <InlineBadge
                                label={res.recommendations.risk_tier}
                                color={tierColor(res.recommendations.risk_tier)}
                              />
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>
                            {res ? (
                              <span>
                                {triggered.length > 0 && <span style={{ color: 'var(--color-critical)', fontWeight: 600 }}>⚠{triggered.length} </span>}
                                {approaching.length > 0 && <span style={{ color: 'var(--color-warning)' }}>→{approaching.length} </span>}
                                {triggered.length === 0 && approaching.length === 0 && <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                              </span>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {r.status === 'success' && <InlineBadge label="OK" color="#22c55e" />}
                            {r.status === 'failed' && (
                              <span title={r.errorMessage} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <InlineBadge label={r.failureKind ?? 'failed'} color="#ef4444" />
                              </span>
                            )}
                            {r.status === 'not_run' && <InlineBadge label="not run" color="#64748b" />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 'var(--space-3)', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                Table values match chart data exactly — both sourced directly from raw API responses.
              </div>
            </section>
          )}

          {/* ── Empty state when idle ───────────────────────────────────── */}
          {runState === 'idle' && results.length === 0 && (
            <div className="card card-shine" style={{ padding: 'var(--space-12)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-3)', color: 'var(--color-text-muted)', textAlign: 'center' }}>
              <ScanSearch size={52} style={{ opacity: 0.4, color: 'var(--color-accent)' }} />
              <div>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>No analysis run yet</div>
                <div style={{ fontSize: '0.9rem', marginTop: '6px', color: 'var(--color-text-secondary)' }}>
                  Configure a sweep range on the left and click <strong>Run Analysis</strong>.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
