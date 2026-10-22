/**
 * WhatIfLabPage.tsx
 * Phase 4: What-if Lab — interactive model exploration.
 *
 * IMPORTANT — read before changing:
 * - All displayed numbers come from backend API responses. No hardcoded probabilities,
 *   contributions, thresholds, or example scenarios.
 * - POST /api/explain performs ZERO database writes. No prediction rows, no alerts created.
 * - Never presents results as predictions of real machine behaviour or physical causes.
 * - Threshold is read from the API payload response; never hardcoded.
 * - Wear is labelled strictly: "wear-budget proxy - not Remaining Useful Life (RUL)".
 * - No RUL, no remaining hours, no remaining cycles claimed anywhere.
 */
import React, { useId, useState, useRef, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartTooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import {
  AlertTriangle, FlaskConical, RotateCcw, ArrowLeft,
  ChevronDown, ChevronUp, Info, RefreshCw,
} from 'lucide-react';

import { useWhatIf } from '../api/useWhatIf';
import {
  FEATURE_META,
  SCHEMA_LIMITS,
  computeDelta, diffIndicators,
  formatProb, formatDeltaPP, tierColor, tierBg,
  indicatorStatusColor, changeLabel,
  isOutsideRange, clampToRange,
  type WhatIfInputs,
  type IndicatorSummary,
} from '../api/whatIfLogic';
import type { NumericField } from '../api/whatIfLogic';
import { OriginBadge, LoadingState, EmptyState } from '../components/Common';

// ── Feature display order and labels ─────────────────────────────────────────
const FIELD_ORDER: NumericField[] = [
  'air_temperature', 'process_temperature', 'rotational_speed', 'torque', 'tool_wear',
];

interface FeatureContributionTooltipProps {
  active?: boolean;
  payload?: readonly any[];
}

const FeatureContributionTooltip: React.FC<FeatureContributionTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const c = payload[0]?.payload;
  if (!c) return null;

  const title = c.displayLabel || c.feature || 'Feature';
  const val = typeof c.contribution === 'number' ? c.contribution : 0;
  const isPos = val > 0.00005;
  const isNeg = val < -0.00005;

  const deltaStr = isPos
    ? `+${(val * 100).toFixed(2)} pp`
    : `${(val * 100).toFixed(2)} pp`;

  const deltaColor = isPos ? '#ef4444' : isNeg ? '#22c55e' : '#94a3b8';
  const dirColor = isPos ? '#ef4444' : isNeg ? '#22c55e' : '#94a3b8';

  const rawDir = c.direction || (isPos ? 'increases_risk' : isNeg ? 'decreases_risk' : 'neutral');
  const dirDisplay = rawDir.replace(/_/g, ' ');

  return (
    <div
      role="tooltip"
      style={{
        background: '#0B1020',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        borderRadius: '8px',
        padding: '12px 16px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 0 15px rgba(56, 189, 248, 0.15)',
        minWidth: '240px',
        maxWidth: '340px',
        pointerEvents: 'none',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          fontSize: '0.95rem',
          fontWeight: 700,
          color: '#F4F7FB',
          marginBottom: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: '6px',
          wordBreak: 'break-word',
          lineHeight: 1.3,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ color: '#A8B6CC', fontWeight: 500 }}>Δ Probability:</span>
          <span style={{ color: deltaColor, fontWeight: 700, fontFamily: 'monospace' }}>
            {deltaStr}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ color: '#A8B6CC', fontWeight: 500 }}>Observed:</span>
          <span style={{ color: '#F4F7FB', fontFamily: 'monospace' }}>
            {String(c.original_value ?? '—')}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ color: '#A8B6CC', fontWeight: 500 }}>Baseline:</span>
          <span style={{ color: '#F4F7FB', fontFamily: 'monospace' }}>
            {String(c.baseline_value ?? '—')}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <span style={{ color: '#A8B6CC', fontWeight: 500 }}>Direction:</span>
          <span style={{ color: dirColor, fontWeight: 600, textTransform: 'capitalize' }}>
            {dirDisplay}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────
export const WhatIfLabPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const fromId = searchParams.get('from') ?? undefined;

  const {
    inputSpec, specStatus, specError,
    originPrediction, originStatus, originError,
    startingPoint,
    inputs, originalInputs,
    result, resultStatus, resultError,
    consistencyWarning,
    setField,
    resetToOriginal,
    switchToBaseline,
    reloadSpec,
    retryResult,
  } = useWhatIf(fromId);

  const [showAllContributions, setShowAllContributions] = useState(false);
  const [showChangeSummary, setShowChangeSummary] = useState(true);

  // aria-live: throttled so slider drags don't spam announcements
  const [liveText, setLiveText] = useState('');
  const liveThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (resultStatus !== 'success' || !result) return;
    if (liveThrottleRef.current) clearTimeout(liveThrottleRef.current);
    liveThrottleRef.current = setTimeout(() => {
      setLiveText(
        `What-if result: ${result.predicted_label}, ${formatProb(result.failure_probability)} failure probability. ` +
        `Risk tier: ${result.recommendations?.risk_tier ?? result.risk_level}.`
      );
    }, 800);
    return () => { if (liveThrottleRef.current) clearTimeout(liveThrottleRef.current); };
  }, [result, resultStatus]);

  // ── Spec / initial load states ─────────────────────────────────────────────
  if (specStatus === 'idle' || specStatus === 'loading') {
    return (
      <div className="page">
        <WhatIfHeader />
        <LoadingState label="Loading input specification from backend…" />
      </div>
    );
  }

  if (specStatus === 'error' || !inputSpec) {
    return (
      <div className="page">
        <WhatIfHeader />
        <div className="card" style={{ borderLeft: '4px solid var(--color-critical)', padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', color: 'var(--color-critical)' }}>
            <AlertTriangle size={24} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <h3>Cannot load input specification</h3>
              <p className="text-muted" style={{ marginTop: 4 }}>
                {specError?.kind === 'unavailable'
                  ? 'The baseline artifact is not available. Ensure the backend is running and artifacts are built.'
                  : specError?.kind === 'network'
                    ? 'Backend unreachable. Check that the FastAPI server is running on port 8001.'
                    : specError?.message ?? 'Unknown error loading input specification.'}
              </p>
              <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} onClick={() => reloadSpec()}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Origin load error banner (non-fatal: falls back to baseline) ──────────
  const originErrorBanner = originError && (
    <div className="card" style={{ borderLeft: `4px solid var(--color-warning)`, padding: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', color: 'var(--color-warning)' }}>
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong style={{ fontSize: '0.875rem' }}>
            {originError.kind === 'not_found'
              ? `Prediction "${fromId}" not found (HTTP 404).`
              : originError.kind === 'validation'
                ? `Invalid prediction ID: "${fromId}".`
                : `Could not load prediction "${fromId}".`}
          </strong>
          <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: 2 }}>
            Loaded the healthy baseline instead.{' '}
            <button
              className="btn btn-ghost btn-sm"
              style={{ display: 'inline', padding: '0 4px', fontSize: '0.8rem' }}
              onClick={switchToBaseline}
            >
              Start fresh from baseline
            </button>
          </p>
        </div>
      </div>
    </div>
  );

  // ── Origin loading ─────────────────────────────────────────────────────────
  const originLoadingBanner = fromId && originStatus === 'loading' && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: 'var(--space-4)' }}>
      <div className="spinner" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--color-accent)' }} />
      Loading stored prediction…
    </div>
  );

  // ── Compute deltas for comparison ──────────────────────────────────────────
  const originalResult = startingPoint === 'prediction' && originPrediction ? {
    failure_probability: originPrediction.failure_probability,
    predicted_label: originPrediction.predicted_label ?? 'Healthy',
    decision_threshold: originPrediction.decision_threshold,
    risk_tier: null as string | null,
    agreement: null as string | null,
    indicators: null as Array<{ rule_id: string; name: string; status: string }> | null,
  } : null;

  const hyp = result;
  const delta = hyp && originalResult
    ? computeDelta(
        originalResult.failure_probability,
        hyp.failure_probability,
        originalResult.predicted_label,
        hyp.predicted_label,
        '', // tier unknown for stored pred (it's in recommendations)
        hyp.recommendations?.risk_tier ?? '',
        '',
        hyp.recommendations?.agreement?.status ?? '',
      )
    : null;

  const indicatorDiff: IndicatorSummary[] = hyp?.recommendations?.indicators
    ? diffIndicators(null, hyp.recommendations.indicators)
    : [];

  // contributions sorted by absolute value, take top 6 or all
  const allContributions = hyp?.contributions ?? [];
  const sortedContributions = [...allContributions].sort(
    (a, b) => b.absolute_contribution - a.absolute_contribution
  );
  const displayedContributions = showAllContributions ? sortedContributions : sortedContributions.slice(0, 6);
  const chartContributions = displayedContributions.map((c) => ({
    ...c,
    displayLabel: c.feature,
    unit: FEATURE_META[
      Object.keys(FEATURE_META).find(k =>
        c.feature.toLowerCase().includes(FEATURE_META[k]?.label.toLowerCase().split(' ')[0].toLowerCase() ?? '') ||
        c.feature.includes(k)
      ) ?? ''
    ]?.unit ?? '',
  }));

  // ── Consistency warning on threshold mismatch across payloads ─────────────
  const thresholdMismatch = hyp && originPrediction &&
    Math.abs(hyp.decision_threshold - originPrediction.decision_threshold) > 0.001
    ? `Threshold mismatch: stored record has ${(originPrediction.decision_threshold * 100).toFixed(1)}% but What-if API returned ${(hyp.decision_threshold * 100).toFixed(1)}%.`
    : null;

  // ── Changed-from-original markers ─────────────────────────────────────────
  const isChanged = (field: keyof WhatIfInputs): boolean => {
    if (field === 'type') return inputs.type !== originalInputs.type;
    const f = field as NumericField;
    return Math.abs(inputs[f] - originalInputs[f]) > 0.001;
  };

  return (
    <div className="page">
      <WhatIfHeader />

      {/* ── HYPOTHETICAL persistent banner ── */}
      <div style={{
        background: 'rgba(168,85,247,0.1)',
        border: '1px solid rgba(168,85,247,0.25)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-4) var(--space-5)',
        marginBottom: 'var(--space-5)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
      }}>
        <OriginBadge type="HYPOTHETICAL" />
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-primary)', margin: 0, fontWeight: 600 }}>
            These results are hypothetical. They are not saved and do not create alerts or history records.
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            How the model responds to these inputs — not a simulation of a physical machine.
          </p>
        </div>
      </div>

      {originErrorBanner}
      {originLoadingBanner}

      {/* ── Starting point selector ── */}
      <div className="card" style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-4) var(--space-5)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' }}>
          <span className="text-xs text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Starting from:
          </span>
          {startingPoint === 'prediction' && originPrediction ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <OriginBadge type="SIMULATED" label={originPrediction.is_simulated ? 'SIMULATED READING' : 'MODEL OUTPUT'} />
              <span className="monospace text-sm">
                {originPrediction.machine_id ?? '—'} · {new Date(originPrediction.predicted_at).toLocaleString()}
              </span>
              <span className="badge" style={{ background: 'rgba(239,68,68,0.12)', color: originPrediction.status === 'critical' ? 'var(--color-critical)' : originPrediction.status === 'warning' ? 'var(--color-warning)' : 'var(--color-normal)' }}>
                {originPrediction.status}
              </span>
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <OriginBadge type="ESTIMATE_PROXY" label="HEALTHY BASELINE" />
              <span className="text-xs text-muted">non-failure median values from AI4I 2020 training data</span>
            </span>
          )}
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={switchToBaseline}
            title="Start fresh from healthy baseline medians"
          >
            Use Baseline
          </button>
          {startingPoint === 'prediction' && originPrediction && (
            <Link
              to={`/history/${originPrediction.prediction_id}`}
              className="btn btn-secondary btn-sm"
              style={{ textDecoration: 'none' }}
            >
              View Detail →
            </Link>
          )}
        </div>
      </div>

      {/* ── Main two-column layout ── */}
      <div className="whatif-grid">

        {/* ── LEFT: Controls ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="card">
            <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
              <h3 className="card-title">Sensor Inputs</h3>
              <button
                className="btn btn-secondary btn-sm"
                onClick={resetToOriginal}
                title="Reset all inputs to original starting values"
              >
                <RotateCcw size={13} /> Reset
              </button>
            </div>

            {/* Product Type */}
            <TypeSelector
              value={inputs.type}
              options={inputSpec.typeOptions}
              changed={isChanged('type')}
              originalValue={originalInputs.type}
              onChange={(v) => setField('type', v)}
            />

            {/* Numeric sliders */}
            {FIELD_ORDER.map((field) => {
              const range = inputSpec.ranges[field];
              if (!range) return null;
              return (
                <FeatureControl
                  key={field}
                  field={field}
                  value={inputs[field]}
                  originalValue={originalInputs[field]}
                  range={range}
                  changed={isChanged(field)}
                  onChange={(v) => setField(field, v)}
                />
              );
            })}

            {/* Physics note */}
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
              Note: Process temperature must exceed air temperature (backend validation). Values outside training ranges are accepted but flagged.
            </p>
          </div>
        </div>

        {/* ── RIGHT: Results ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          {/* Consistency warnings */}
          {consistencyWarning && (
            <div className="card" style={{ borderLeft: '4px solid var(--color-warning)', padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', color: 'var(--color-warning)', alignItems: 'flex-start' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: '0.83rem' }}>{consistencyWarning}</span>
              </div>
            </div>
          )}
          {thresholdMismatch && (
            <div className="card" style={{ borderLeft: '4px solid var(--color-warning)', padding: 'var(--space-4)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', color: 'var(--color-warning)', alignItems: 'flex-start' }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: '0.83rem' }}>{thresholdMismatch}</span>
              </div>
            </div>
          )}

          {/* Result error */}
          {resultStatus === 'error' && resultError && (
            <div className="card" style={{ borderLeft: '4px solid var(--color-critical)', padding: 'var(--space-5)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-3)', color: 'var(--color-critical)', alignItems: 'flex-start' }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ fontSize: '0.875rem' }}>
                    {resultError.kind === 'validation' ? 'Input validation error (422)' :
                     resultError.kind === 'network' ? 'Backend unreachable' :
                     resultError.kind === 'unavailable' ? 'Model unavailable' : 'Error'}
                  </strong>
                  <p style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                    {resultError.message}
                  </p>
                  {resultError.kind === 'network' && (
                    <button className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--space-3)' }} onClick={retryResult}>
                      <RefreshCw size={12} /> Retry
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* aria-live region */}
          <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', left: -9999 }}>
            {liveText}
          </div>

          {/* A. Comparison header */}
          {(resultStatus === 'loading' || resultStatus === 'success' || result) && (
            <div
              className="card"
              style={{ opacity: resultStatus === 'loading' ? 0.6 : 1, transition: 'opacity 0.2s' }}
              aria-busy={resultStatus === 'loading'}
            >
              {resultStatus === 'loading' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                  <div className="spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--color-accent)' }} />
                  Updating…
                </div>
              )}

              <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
                <h3 className="card-title">
                  <FlaskConical size={16} style={{ marginRight: 6, opacity: 0.7 }} />
                  What-if Result
                </h3>
                {result && (
                  <span className="text-xs text-muted monospace">{result.method}</span>
                )}
              </div>

              {result && (
                <>
                  {/* Side-by-side comparison */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
                    {/* Original column */}
                    <div style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', padding: 'var(--space-4)', border: '1px solid var(--color-border)' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
                        Original
                      </div>
                      {startingPoint === 'prediction' && originPrediction ? (
                        <>
                          <OriginBadge type={originPrediction.is_simulated ? 'SIMULATED' : 'MODEL_OUTPUT'} />
                          <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 'var(--space-3)', color: 'var(--color-text-primary)', lineHeight: 1 }}>
                            {formatProb(originPrediction.failure_probability)}
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                            {originPrediction.predicted_label ?? 'Unknown'}
                          </div>
                          <div style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            Stored probability · MODEL OUTPUT
                          </div>
                        </>
                      ) : (
                        <>
                          <OriginBadge type="ESTIMATE_PROXY" label="BASELINE" />
                          <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 'var(--space-3)', color: 'var(--color-text-primary)', lineHeight: 1 }}>
                            —
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                            Healthy baseline (hypothetical)
                          </div>
                        </>
                      )}
                    </div>

                    {/* Hypothetical column */}
                    <div style={{
                      background: 'var(--color-surface-2)',
                      borderRadius: 'var(--radius)',
                      padding: 'var(--space-4)',
                      border: `1px solid ${result.failure_predicted ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.2)'}`,
                    }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
                        Hypothetical
                      </div>
                      <OriginBadge type="HYPOTHETICAL" />
                      <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: 'var(--space-3)', lineHeight: 1, color: result.failure_predicted ? 'var(--color-critical)' : 'var(--color-normal)' }}>
                        {formatProb(result.failure_probability)}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                        {result.predicted_label}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                        Threshold: {(result.decision_threshold * 100).toFixed(1)}% · MODEL OUTPUT
                      </div>
                    </div>
                  </div>

                  {/* Delta row */}
                  {delta && startingPoint === 'prediction' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-surface-3)', borderRadius: 'var(--radius-sm)' }}>
                      <DeltaBadge
                        label="Probability Δ"
                        value={formatDeltaPP(delta.probDeltaPP)}
                        positive={delta.probDeltaPP > 0}
                        neutral={Math.abs(delta.probDeltaPP) < 0.5}
                      />
                      {delta.labelChanged && (
                        <DeltaBadge
                          label="Model Label"
                          value={`${delta.originalLabel} → ${delta.hypotheticalLabel}`}
                          positive={delta.hypotheticalLabel === 'Failure'}
                          neutral={false}
                        />
                      )}
                    </div>
                  )}

                  {/* Tier block — separated with explicit note that tier ≠ model label */}
                  {result.recommendations && (
                    <div style={{
                      padding: 'var(--space-4)',
                      borderRadius: 'var(--radius)',
                      background: tierBg(result.recommendations.risk_tier),
                      border: `1px solid ${tierColor(result.recommendations.risk_tier)}22`,
                      marginBottom: 'var(--space-4)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                        <OriginBadge type="RULE_BASED" />
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: tierColor(result.recommendations.risk_tier), textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {result.recommendations.risk_tier} tier
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginLeft: 4 }}>
                          (application policy — separate from model label)
                        </span>
                      </div>
                      <p style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', margin: 0 }}>
                        {result.recommendations.agreement.explanation}
                      </p>
                    </div>
                  )}

                  {/* Out-of-range warnings from API */}
                  {result.outside_range_warnings.map((w, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                      padding: 'var(--space-3)', background: 'rgba(245,158,11,0.1)',
                      borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)',
                      fontSize: '0.8rem', color: 'var(--color-warning)',
                    }}>
                      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {w}
                    </div>
                  ))}
                </>
              )}

              {!result && resultStatus !== 'loading' && (
                <EmptyState icon="⚗️" title="No result yet" subtitle="Adjust inputs to see model response." />
              )}
            </div>
          )}

          {/* B. Probability bar */}
          {result && (
            <div className="card">
              <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
                <h3 className="card-title">Failure Probability Meter</h3>
                <OriginBadge type="MODEL_OUTPUT" />
              </div>
              <ProbabilityBar
                probability={result.failure_probability}
                threshold={result.decision_threshold}
                originalProbability={startingPoint === 'prediction' && originPrediction
                  ? originPrediction.failure_probability : null}
                failed={result.failure_predicted}
              />
            </div>
          )}

          {/* C. Contribution chart */}
          {result && sortedContributions.length > 0 && (
            <div className="card">
              <div className="card-header" style={{ marginBottom: 'var(--space-3)' }}>
                <h3 className="card-title">Feature Contributions</h3>
                <OriginBadge type="MODEL_OUTPUT" />
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
                Signed probability delta when each feature is occluded with its healthy baseline value.
                Positive = increases failure probability; negative = decreases it.
              </p>
              <ResponsiveContainer width="100%" height={Math.max(160, displayedContributions.length * 36)}>
                <BarChart
                  data={chartContributions}
                  layout="vertical"
                  margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => v.toFixed(3)} />
                  <YAxis
                    type="category"
                    dataKey="displayLabel"
                    tick={{ fill: '#f1f5f9', fontSize: 12 }}
                    width={160}
                  />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />
                  <RechartTooltip
                    content={(props) => <FeatureContributionTooltip {...props} />}
                    contentStyle={{
                      background: '#0B1020',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7)',
                      color: '#F4F7FB',
                      padding: '12px 16px',
                    }}
                    itemStyle={{ color: '#F4F7FB' }}
                    labelStyle={{ color: '#F4F7FB', fontWeight: 700, marginBottom: '6px' }}
                    wrapperStyle={{ zIndex: 1000 }}
                  />
                  <Bar dataKey="contribution" radius={[0, 4, 4, 0]}>
                    {chartContributions.map((c, i) => (
                      <Cell
                        key={i}
                        fill={c.contribution > 0 ? 'rgba(239,68,68,0.7)' : c.contribution < 0 ? 'rgba(34,197,94,0.7)' : 'rgba(107,114,128,0.4)'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {sortedContributions.length > 6 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 'var(--space-3)' }}
                  onClick={() => setShowAllContributions(!showAllContributions)}
                >
                  {showAllContributions ? <><ChevronUp size={14} /> Show top 6</> : <><ChevronDown size={14} /> Show all {sortedContributions.length}</>}
                </button>
              )}
            </div>
          )}

          {/* D. Rule indicators */}
          {result?.recommendations && (
            <div className="card">
              <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
                <h3 className="card-title">Physical Failure-Mode Indicators</h3>
                <OriginBadge type="RULE_BASED" />
              </div>

              {/* Change summary toggle */}
              {indicatorDiff.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginBottom: 'var(--space-3)' }}
                  onClick={() => setShowChangeSummary(!showChangeSummary)}
                >
                  {showChangeSummary ? <><ChevronUp size={13} /> Hide change summary</> : <><ChevronDown size={13} /> Show change summary</>}
                </button>
              )}
              {showChangeSummary && indicatorDiff.length > 0 && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)',
                  padding: 'var(--space-3)', background: 'var(--color-surface-3)',
                  borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)',
                }}>
                  {indicatorDiff.map((d) => (
                    <span key={d.rule_id} style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600,
                      background: d.change === 'worsened' || d.change === 'new' ? 'rgba(239,68,68,0.15)'
                        : d.change === 'resolved' || d.change === 'improved' ? 'rgba(34,197,94,0.15)'
                        : 'rgba(107,114,128,0.1)',
                      color: d.change === 'worsened' || d.change === 'new' ? 'var(--color-critical)'
                        : d.change === 'resolved' || d.change === 'improved' ? 'var(--color-normal)'
                        : 'var(--color-text-muted)',
                    }}>
                      {changeLabel(d.change)} {d.rule_id}
                    </span>
                  ))}
                </div>
              )}

              {result.recommendations.indicators.map((ind) => (
                <IndicatorCard key={ind.rule_id} indicator={ind} />
              ))}

              {/* Recommended actions */}
              {result.recommendations.recommended_actions.length > 0 && (
                <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
                  <div className="text-xs text-muted" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--space-3)' }}>
                    Recommended Actions
                  </div>
                  {result.recommendations.recommended_actions.map((a, i) => (
                    <div key={i} style={{
                      padding: 'var(--space-3)', background: 'var(--color-surface-3)',
                      borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-2)',
                      borderLeft: '3px solid var(--color-accent)', fontSize: '0.82rem',
                      color: 'var(--color-text-secondary)',
                    }}>
                      💡 {a}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {result.recommendations.notes.length > 0 && (
                <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'rgba(59,130,246,0.06)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-accent)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                    <Info size={13} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 2 }} />
                    <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      {result.recommendations.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* E. Wear-budget proxy */}
          {result?.recommendations?.wear_budget_proxy && (
            <div className="card">
              <div className="card-header" style={{ marginBottom: 'var(--space-4)' }}>
                <h3 className="card-title">Tool Wear Budget</h3>
                <OriginBadge type="ESTIMATE_PROXY" />
              </div>
              <WearBudgetPanel proxy={result.recommendations.wear_budget_proxy} />
            </div>
          )}

          {/* Disclaimer */}
          {result && (
            <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'rgba(59,130,246,0.06)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
              <Info size={12} style={{ display: 'inline', marginRight: 6, color: 'var(--color-accent)' }} />
              {result.disclaimer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const WhatIfHeader: React.FC = () => (
  <div style={{ marginBottom: 'var(--space-8)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => window.history.back()}
        aria-label="Go back"
      >
        <ArrowLeft size={17} />
      </button>
      <FlaskConical size={26} style={{ color: 'var(--color-accent)' }} />
      <h1 style={{ margin: 0, fontSize: 'clamp(32px, 3.5vw, 44px)', fontWeight: 800 }}>What-if Simulation Lab</h1>
    </div>
    <p style={{ color: 'var(--color-text-secondary)', marginLeft: 'calc(var(--space-3) + 26px + var(--space-3))', fontSize: '1.05rem', lineHeight: 1.6 }}>
      Explore how the model responds to hypothetical sensor readings. Zero database writes, no alerts generated.
    </p>
  </div>
);

// ── Type selector ─────────────────────────────────────────────────────────────
interface TypeSelectorProps {
  value: string;
  options: string[];
  changed: boolean;
  originalValue: string;
  onChange: (v: string) => void;
}
const TypeSelector: React.FC<TypeSelectorProps> = ({ value, options, changed, originalValue, onChange }) => {
  const id = useId();
  return (
    <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
      <label className="form-label" htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.92rem' }}>
        Product Type Variant
        {changed && (
          <span style={{ fontSize: '0.8rem', background: 'rgba(14,165,233,0.2)', color: 'var(--color-accent)', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>
            changed from {originalValue}
          </span>
        )}
      </label>
      <select
        id={id}
        className="form-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-desc`}
        style={{ fontSize: '0.95rem', padding: '10px 14px' }}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt} — {opt === 'L' ? 'Low quality (50%)' : opt === 'M' ? 'Medium quality (30%)' : 'High quality (20%)'}</option>
        ))}
      </select>
      <span id={`${id}-desc`} style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
        Product quality variant from AI4I 2020. L=Low, M=Medium, H=High.
      </span>
    </div>
  );
};

// ── Feature control (slider + numeric input) ──────────────────────────────────
interface FeatureControlProps {
  field: NumericField;
  value: number;
  originalValue: number;
  range: { min: number; max: number; non_fail_median?: number };
  changed: boolean;
  onChange: (v: number) => void;
}
const FeatureControl: React.FC<FeatureControlProps> = ({ field, value, originalValue, range, changed, onChange }) => {
  const id = useId();
  const meta = FEATURE_META[field];
  const schema = SCHEMA_LIMITS[field];
  const outside = isOutsideRange(value, range.min, range.max);

  const handleBlur = (rawStr: string) => {
    const parsed = parseFloat(rawStr);
    if (isNaN(parsed)) {
      onChange(value);
      return;
    }
    if (parsed !== value) onChange(parsed);
  };

  return (
    <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
      <label className="form-label" htmlFor={`num-${id}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: '0.95rem' }}>
        {meta.label}
        <span className="text-muted" style={{ fontSize: '0.85rem' }}>({meta.unit})</span>
        {changed && (
          <span style={{ fontSize: '0.8rem', background: 'rgba(14,165,233,0.2)', color: 'var(--color-accent)', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>
            Δ {value > originalValue ? '+' : ''}{(meta.step >= 1 ? Math.round(value - originalValue) : (value - originalValue).toFixed(1))}{meta.unit}
          </span>
        )}
      </label>

      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
        <input
          type="range"
          id={`slider-${id}`}
          min={range.min}
          max={range.max}
          step={meta.step}
          value={clampToRange(value, range.min, range.max)}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: outside ? 'var(--color-warning)' : 'var(--color-accent)', cursor: 'pointer' }}
          aria-label={`${meta.label} slider (${range.min} to ${range.max} ${meta.unit} training distribution)`}
          aria-valuemin={range.min}
          aria-valuemax={range.max}
          aria-valuenow={clampToRange(value, range.min, range.max)}
          aria-valuetext={`${value} ${meta.unit}${outside ? ' (extrapolated outside training range)' : ''}`}
        />
        <input
          type="number"
          id={`num-${id}`}
          value={meta.step >= 1 ? Math.round(value) : value.toFixed(1)}
          step={meta.step}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            onChange(isNaN(parsed) ? 0 : parsed);
          }}
          onBlur={(e) => handleBlur(e.target.value)}
          style={{
            width: 95,
            background: 'var(--color-surface-inset)',
            border: `1px solid ${outside ? 'var(--color-warning)' : 'var(--color-border-glass)'}`,
            borderRadius: 'var(--radius-sm)',
            padding: '7px 10px',
            color: 'var(--color-text-primary)',
            fontSize: '0.95rem',
            textAlign: 'right',
          }}
          aria-label={`${meta.label} value (${schema.min} to ${schema.max} ${meta.unit} schema limits)`}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', minWidth: 32 }}>{meta.unit}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 4, flexWrap: 'wrap', gap: 4 }}>
        <span>Training distribution: {range.min} – {range.max} {meta.unit}</span>
        {range.non_fail_median !== undefined && (
          <span>Healthy median: {range.non_fail_median} {meta.unit}</span>
        )}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', opacity: 0.8, marginTop: 2 }}>
        Numeric input schema limits: {schema.min} – {schema.max} {meta.unit}
      </div>

      {outside && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 6, fontSize: '0.85rem', color: 'var(--color-warning)' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          Value is outside observed training range. Model results are extrapolation — treat with caution.
        </div>
      )}
    </div>
  );
};

// ── Probability bar ───────────────────────────────────────────────────────────
interface ProbabilityBarProps {
  probability: number;
  threshold: number;
  originalProbability: number | null;
  failed: boolean;
}
const ProbabilityBar: React.FC<ProbabilityBarProps> = ({ probability, threshold, originalProbability, failed }) => {
  const pct = (probability * 100).toFixed(1);
  const threshPct = (threshold * 100).toFixed(1);
  const color = failed ? 'var(--color-critical)' : 'var(--color-normal)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)', alignItems: 'flex-end' }}>
        <div>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color }}>{pct}%</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginLeft: 8 }}>
            {failed ? 'Failure predicted' : 'Healthy predicted'}
          </span>
        </div>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Threshold: {threshPct}%</span>
      </div>
      <div
        role="meter"
        aria-label="Failure probability meter"
        aria-valuenow={probability * 100}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}% failure probability`}
        style={{ position: 'relative', height: 20, background: 'var(--color-surface-3)', borderRadius: 10, overflow: 'hidden' }}
      >
        {/* Original ghost bar */}
        {originalProbability !== null && (
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: `${originalProbability * 100}%`,
            height: '100%',
            background: 'rgba(255,255,255,0.12)',
            borderRadius: 10,
          }} aria-hidden="true" />
        )}
        {/* Probability bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: `${probability * 100}%`,
          height: '100%',
          background: color,
          borderRadius: 10,
          transition: 'width 0.3s ease',
        }} aria-hidden="true" />
        {/* Threshold marker */}
        <div
          style={{
            position: 'absolute', top: 0,
            left: `${threshold * 100}%`,
            width: 2,
            height: '100%',
            background: 'rgba(255,255,255,0.8)',
          }}
          title={`Decision threshold: ${threshPct}%`}
          aria-hidden="true"
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
        <span>0% (Healthy)</span>
        {originalProbability !== null && (
          <span>● Original: {(originalProbability * 100).toFixed(1)}%</span>
        )}
        <span>100% (Failure)</span>
      </div>
    </div>
  );
};

// ── Rule indicator card ───────────────────────────────────────────────────────
interface IndicatorCardProps {
  indicator: {
    rule_id: string;
    name: string;
    status: string;
    actual_value: number;
    threshold: string | number;
    unit: string;
    comparison: string;
    recommendation: string | null;
    source_text: string;
    threshold_status: string;
  };
}
const IndicatorCard: React.FC<IndicatorCardProps> = ({ indicator: ind }) => {
  const st = ind.status as 'normal' | 'approaching' | 'triggered';
  const color = indicatorStatusColor(st);
  return (
    <div style={{
      marginBottom: 'var(--space-3)',
      padding: 'var(--space-4)',
      borderRadius: 'var(--radius)',
      background: 'var(--color-surface-2)',
      border: `1px solid ${color}33`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
        <strong style={{ fontSize: '0.875rem' }}>{ind.name}</strong>
        <span style={{ fontSize: '0.72rem', padding: '1px 6px', borderRadius: 4, background: `${color}22`, color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {ind.status}
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
          {ind.threshold_status === 'VERIFIED' ? '✓ AI4I verified rule' : '⚠ heuristic estimate'}
        </span>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
        Observed: <strong className="monospace">{typeof ind.actual_value === 'number' ? ind.actual_value.toFixed(2) : ind.actual_value} {ind.unit}</strong>
        {' · '}
        Threshold: <span className="monospace">{String(ind.threshold)} {ind.unit}</span>
      </div>
      {ind.recommendation && (
        <div style={{ marginTop: 'var(--space-2)', fontSize: '0.8rem', color: 'var(--color-text-secondary)', borderLeft: `3px solid ${color}`, paddingLeft: 'var(--space-3)' }}>
          {ind.recommendation}
        </div>
      )}
      <div style={{ marginTop: 'var(--space-2)', fontSize: '0.72rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        {ind.source_text}
      </div>
    </div>
  );
};

// ── Wear-budget proxy panel ───────────────────────────────────────────────────
interface WearProxy {
  tool_wear_min: number;
  assumed_limit_min: number;
  percentage_consumed: number;
  is_over_limit: boolean;
  label: string;
  limit_source: string;
  interpretation: string;
}
const WearBudgetPanel: React.FC<{ proxy: WearProxy }> = ({ proxy }) => {
  // Visual progress bar fill width is clamped to 0–100%
  const barWidthPct = Math.min(100, Math.max(0, proxy.percentage_consumed));
  const color = proxy.percentage_consumed >= 100 ? 'var(--color-critical)' : proxy.percentage_consumed >= 80 ? 'var(--color-warning)' : 'var(--color-normal)';
  return (
    <div>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-warning)', fontWeight: 700, marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        ⚠ wear-budget proxy — not Remaining Useful Life (RUL)
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
        <span style={{ fontSize: '1.2rem', fontWeight: 800, color }}>
          {proxy.percentage_consumed.toFixed(1)}% consumed
        </span>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          {proxy.tool_wear_min} / {proxy.assumed_limit_min} min
        </span>
      </div>
      <div style={{ height: 14, background: 'var(--color-surface-3)', borderRadius: 7, overflow: 'hidden', marginBottom: 'var(--space-3)' }}>
        <div style={{ width: `${barWidthPct}%`, height: '100%', background: color, borderRadius: 7, transition: 'width 0.3s ease' }} />
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-2)' }}>
        {proxy.interpretation}
      </p>
      <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', margin: 0, fontStyle: 'italic' }}>
        {proxy.limit_source}
      </p>
    </div>
  );
};

// ── Delta badge ───────────────────────────────────────────────────────────────
interface DeltaBadgeProps {
  label: string;
  value: string;
  positive: boolean; // positive = worse (higher failure probability)
  neutral: boolean;
}
const DeltaBadge: React.FC<DeltaBadgeProps> = ({ label, value, positive, neutral }) => {
  const color = neutral ? 'var(--color-text-muted)' : positive ? 'var(--color-critical)' : 'var(--color-normal)';
  const bg = neutral ? 'rgba(107,114,128,0.1)' : positive ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)';
  return (
    <div style={{ padding: 'var(--space-2) var(--space-3)', background: bg, borderRadius: 'var(--radius-sm)', border: `1px solid ${color}33` }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: '0.95rem', fontWeight: 800, color }}>{value}</div>
    </div>
  );
};
