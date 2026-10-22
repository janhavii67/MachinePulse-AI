import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Gauge,
  Sliders,
  ShieldAlert,
  FlaskConical,
  Cpu,
  Layers,
  HeartPulse,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { usePredictionDetail } from '../api/usePredictionDetail';
import {
  OriginBadge,
  LoadingState,
  StatusBadge,
  EmptyState,
} from '../components/Common';

// Human-friendly label mapping for AI4I sensor features
const FEATURE_DISPLAY_MAP: Record<string, { label: string; unit: string }> = {
  'Torque [Nm]': { label: 'Cutting Torque', unit: 'Nm' },
  'Tool wear [min]': { label: 'Tool Wear', unit: 'min' },
  'Rotational speed [rpm]': { label: 'Rotational Speed', unit: 'rpm' },
  'Air temperature [K]': { label: 'Air Temperature', unit: 'K' },
  'Process temperature [K]': { label: 'Process Temperature', unit: 'K' },
  'Type': { label: 'Product Type Variant', unit: '' },
};

export const PredictionDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    isValidId,
    consistency,
    prediction,
    explanation,
    recommendations,
    globalImportance,
  } = usePredictionDetail(id);

  const [showAllContributions, setShowAllContributions] = useState(false);
  const [showHowComputed, setShowHowComputed] = useState(false);
  const [showGlobalImportance, setShowGlobalImportance] = useState(false);

  // Return to previous history list state
  const handleBack = () => {
    if (location.state && (location.state as any).from) {
      navigate(`/history${(location.state as any).from}`);
    } else {
      navigate('/history');
    }
  };

  // ── Route ID Validation State ──────────────────────────────────────────────
  if (!isValidId) {
    return (
      <div className="page">
        <button className="btn btn-secondary" onClick={handleBack} style={{ marginBottom: 'var(--space-5)' }}>
          <ArrowLeft size={16} /> Back to Prediction History
        </button>
        <div className="card" style={{ borderLeft: '4px solid var(--color-critical)', padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--color-critical)' }}>
            <AlertCircle size={32} />
            <div>
              <h3>Invalid Prediction Identifier</h3>
              <p style={{ marginTop: 6, fontSize: '0.95rem' }}>
                The specified prediction identifier <code>"{id ?? 'undefined'}"</code> is not a valid format. Expected a non-empty alphanumeric/UUID identifier.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Record 404 Not Found State ─────────────────────────────────────────────
  if (prediction.error?.kind === 'not_found') {
    return (
      <div className="page">
        <button className="btn btn-secondary" onClick={handleBack} style={{ marginBottom: 'var(--space-5)' }}>
          <ArrowLeft size={16} /> Back to Prediction History
        </button>
        <div className="card" style={{ borderLeft: '4px solid var(--color-warning)', padding: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', color: 'var(--color-warning)' }}>
            <AlertTriangle size={32} />
            <div>
              <h3>Prediction Record Not Found (HTTP 404)</h3>
              <p style={{ marginTop: 6, fontSize: '0.95rem' }}>
                No stored prediction was found with ID <code>"{id}"</code>. It may have been cleared during a database reset.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pred = prediction.data;
  const exp = explanation.data;
  const rec = recommendations.data;

  // Use stored probability and threshold directly (read from API payload, never hardcoded)
  const failureProb = pred?.failure_probability ?? exp?.failure_probability ?? rec?.model_probability ?? 0.0;
  const decisionThresh = pred?.decision_threshold ?? exp?.decision_threshold ?? rec?.model_threshold ?? 0.66;
  const probPct = (failureProb * 100).toFixed(1);
  const threshPct = (decisionThresh * 100).toFixed(1);
  const isFailure = failureProb >= decisionThresh;

  // Raw features from snapshot or explain
  const snapshot = pred?.input_snapshot || (exp?.features_analyzed as Record<string, any>) || {};
  const machineType = String(snapshot['Type'] || snapshot['type'] || rec?.product_type || '—');
  const airTemp = snapshot['Air temperature [K]'] ?? snapshot['air_temperature'] ?? '—';
  const procTemp = snapshot['Process temperature [K]'] ?? snapshot['process_temperature'] ?? '—';
  const speed = snapshot['Rotational speed [rpm]'] ?? snapshot['rotational_speed'] ?? '—';
  const torque = snapshot['Torque [Nm]'] ?? snapshot['torque'] ?? '—';
  const wear = snapshot['Tool wear [min]'] ?? snapshot['tool_wear'] ?? '—';

  // Sort and slice contributions
  const contributionsList = exp?.contributions || [];
  const displayedContributions = showAllContributions ? contributionsList : contributionsList.slice(0, 6);

  // Chart data formatting for local explanation
  const contributionChartData = displayedContributions.map((c) => {
    const meta = FEATURE_DISPLAY_MAP[c.feature] || { label: c.feature, unit: '' };
    return {
      feature: c.feature,
      displayLabel: meta.label,
      unit: meta.unit,
      contribution: c.contribution,
      absolute: c.absolute_contribution,
      originalValue: c.original_value,
      baselineValue: c.baseline_value,
      direction: c.direction,
    };
  });

  return (
    <div className="page">
      {/* ── Top Navigation Bar ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <button
          className="btn btn-secondary"
          onClick={handleBack}
          id="detail-back-btn"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <ArrowLeft size={17} /> Back to Prediction History
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            id="open-what-if-btn"
            onClick={() => navigate(`/what-if?from=${id}`)}
            title="Open these sensor readings in What-if Lab for hypothetical analysis"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            <FlaskConical size={17} /> Open in What-if Lab
          </button>
          <span className="chip" style={{ background: 'rgba(14, 165, 233, 0.15)', color: 'var(--color-accent)', borderColor: 'rgba(14, 165, 233, 0.35)', fontWeight: 600 }}>
            📁 Persisted SQLite Record
          </span>
          <OriginBadge type="SIMULATED" label="AI4I 2020 Replay" />
        </div>
      </div>

      {/* ── Consistency Guard Warning ── */}
      {consistency.hasMismatch && (
        <div className="alert-banner warning" style={{ marginBottom: 'var(--space-6)' }}>
          <AlertTriangle size={20} />
          <div>
            <strong>Data Consistency Warning:</strong>
            <ul style={{ margin: '6px 0 0 18px', fontSize: '0.9rem' }}>
              {consistency.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Section A: Historical Record Summary & Lightweight Machine Health Motif ─────────────────────────────── */}
      <div className="card card-shine" style={{ marginBottom: 'var(--space-8)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 'clamp(26px, 2.8vw, 36px)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Cpu size={26} style={{ color: 'var(--color-accent)' }} />
                Machine Unit {pred?.machine_id ?? 'Telemetric Unit'}
              </h2>
              <span className="monospace" style={{ padding: '4px 10px', background: 'var(--color-surface-inset)', border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                UUID: {id}
              </span>
            </div>
            <p style={{ marginTop: 6, fontSize: '0.95rem', color: 'var(--color-text-secondary)' }}>
              Recorded Inference: {pred?.predicted_at ? new Date(pred.predicted_at).toLocaleString() : '—'} · Observation Telemetry: {pred?.observed_at ? new Date(pred.observed_at).toLocaleString() : '—'}
            </p>
          </div>

          {/* Lightweight SVG Machine Health Motif */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 16px', background: 'var(--color-surface-inset)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border-glass)' }}>
            <HeartPulse size={22} style={{ color: isFailure ? 'var(--color-critical)' : 'var(--color-normal)' }} />
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Diagnostic Health</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: isFailure ? 'var(--color-critical)' : 'var(--color-normal)' }}>
                {isFailure ? 'Elevated Anomaly State' : 'Optimal Nominal State'}
              </div>
            </div>
          </div>
        </div>

        {prediction.loading ? (
          <LoadingState label="Loading prediction record from SQLite database…" />
        ) : prediction.error ? (
          <div className="alert-banner error" style={{ margin: 'var(--space-4)' }}>
            <AlertCircle size={18} />
            <span>Failed to load prediction record: {prediction.error.message}</span>
            <button className="btn btn-ghost" onClick={prediction.reload} style={{ marginLeft: 'auto', padding: '4px 10px' }}>
              <RefreshCw size={15} /> Retry
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 'var(--space-5)' }}>
            {/* Sensor Inputs Grid */}
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Recorded Sensor Inputs at Observation Time
                </span>
                <OriginBadge type="SIMULATED" label="AI4I Ground Telemetry" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
                <div className="stat-card accent">
                  <div className="stat-label">Product Type</div>
                  <div className="stat-value" style={{ fontSize: '1.4rem', color: 'var(--color-accent)' }}>Type {machineType}</div>
                  <div className="stat-sub">{machineType === 'L' ? 'Low Variant (50%)' : machineType === 'M' ? 'Medium Variant (30%)' : 'High Variant (20%)'}</div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">Air Temperature</div>
                  <div className="stat-value monospace" style={{ fontSize: '1.4rem' }}>{typeof airTemp === 'number' ? airTemp.toFixed(1) : airTemp} K</div>
                  <div className="stat-sub">{typeof airTemp === 'number' ? `${(airTemp - 273.15).toFixed(1)} °C` : '—'}</div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">Process Temperature</div>
                  <div className="stat-value monospace" style={{ fontSize: '1.4rem' }}>{typeof procTemp === 'number' ? procTemp.toFixed(1) : procTemp} K</div>
                  <div className="stat-sub">
                    {typeof procTemp === 'number' && typeof airTemp === 'number'
                      ? `Δ ${(procTemp - airTemp).toFixed(1)} K dissipation`
                      : '—'}
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">Rotational Speed</div>
                  <div className="stat-value monospace" style={{ fontSize: '1.4rem' }}>{typeof speed === 'number' ? speed.toFixed(0) : speed} rpm</div>
                  <div className="stat-sub">Spindle velocity</div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">Cutting Torque</div>
                  <div className="stat-value monospace" style={{ fontSize: '1.4rem' }}>{typeof torque === 'number' ? torque.toFixed(1) : torque} Nm</div>
                  <div className="stat-sub">Spindle torque load</div>
                </div>

                <div className="stat-card">
                  <div className="stat-label">Tool Wear</div>
                  <div className="stat-value monospace" style={{ fontSize: '1.4rem' }}>{typeof wear === 'number' ? wear.toFixed(0) : wear} min</div>
                  <div className="stat-sub">Cumulative cutting time</div>
                </div>
              </div>
            </div>

            {/* Separate Classification & Risk Tier Blocks */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--space-5)', marginTop: 'var(--space-4)' }}>
              {/* Block 1: Model Output */}
              <div
                style={{
                  background: 'var(--color-surface-inset)',
                  border: '1px solid var(--color-border-glass)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-5)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', letterSpacing: '0.04em' }}>
                    Machine Learning Classification
                  </span>
                  <OriginBadge type="MODEL_OUTPUT" />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                  <StatusBadge status={isFailure ? 'critical' : 'normal'} />
                  <span style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff' }}>
                    {isFailure ? 'Failure Predicted' : 'Healthy Operation'}
                  </span>
                </div>

                <p style={{ fontSize: '0.92rem', color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.5 }}>
                  Calibrated Decision Threshold: <strong style={{ color: 'var(--color-text-primary)' }}>{threshPct}%</strong>. Model classifies failure when predicted failure probability meets or exceeds this calibrated decision threshold.
                </p>
              </div>

              {/* Block 2: Rule-Based Risk Tier & Agreement */}
              <div
                style={{
                  background: 'var(--color-surface-inset)',
                  border: '1px solid var(--color-border-glass)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-5)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-secondary)', letterSpacing: '0.04em' }}>
                    Operational Risk Tier & Agreement
                  </span>
                  <OriginBadge type="RULE_BASED" />
                </div>

                {recommendations.loading ? (
                  <LoadingState label="Evaluating rule indicators…" />
                ) : recommendations.error ? (
                  <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Rules evaluation unavailable: {recommendations.error.message}</div>
                ) : rec ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span
                        className={`badge ${
                          rec.risk_tier === 'CRITICAL' ? 'critical' :
                          rec.risk_tier === 'HIGH' ? 'warning' :
                          rec.risk_tier === 'WATCH' ? 'info' : 'normal'
                        }`}
                        style={{ fontSize: '0.88rem', fontWeight: 700 }}
                      >
                        Tier: {rec.risk_tier}
                      </span>

                      <span className="chip" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                        {rec.agreement.status === 'agree_failure' ? '🤝 Model & Rules Agree: Failure' :
                         rec.agreement.status === 'agree_normal' ? '🤝 Model & Rules Agree: Normal' :
                         rec.agreement.status === 'model_only' ? '⚖ Model Only (Multivariate)' : '⚖ Rules Only (Physical Limit)'}
                      </span>
                    </div>

                    <p style={{ fontSize: '0.92rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                      {rec.agreement.explanation}
                    </p>

                    <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 8, fontStyle: 'italic', opacity: 0.85 }}>
                      * Risk tier is an application policy for maintenance prioritization and does not alter model output.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section B: Probability Meter & Threshold Marker ──────────────────── */}
      <div className="card card-shine" style={{ marginBottom: 'var(--space-8)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Gauge size={20} style={{ color: 'var(--color-accent)' }} /> Failure Probability & Decision Threshold
            </h3>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Quantified risk of machine breakdown</span>
          </div>
          <OriginBadge type="MODEL_OUTPUT" />
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
            <div>
              <span
                className="monospace"
                style={{
                  fontSize: 'clamp(44px, 5vw, 64px)',
                  fontWeight: 900,
                  color: isFailure ? 'var(--color-critical)' : 'var(--color-normal)',
                  textShadow: `0 0 20px ${isFailure ? 'var(--color-critical-glow)' : 'var(--color-normal-glow)'}`,
                }}
              >
                {probPct}%
              </span>
              <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginLeft: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                predicted failure probability
              </span>
            </div>

            <div className="monospace" style={{ fontSize: '1rem', color: 'var(--color-text-muted)' }}>
              Decision Threshold: <strong style={{ color: 'var(--color-text-primary)' }}>{threshPct}%</strong>
            </div>
          </div>

          {/* Accessible Meter Bar */}
          <div
            role="meter"
            aria-valuenow={failureProb}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-label="Model failure probability"
            style={{
              position: 'relative',
              height: 28,
              background: 'var(--color-surface-inset)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              border: '1px solid var(--color-border-glass)',
            }}
          >
            {/* Probability Fill */}
            <div
              style={{
                width: `${Math.min(100, failureProb * 100)}%`,
                height: '100%',
                background: isFailure
                  ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                  : 'linear-gradient(90deg, #0ea5e9, #10b981)',
                transition: 'width 0.4s ease',
                boxShadow: isFailure ? '0 0 16px rgba(239, 68, 68, 0.5)' : '0 0 16px rgba(16, 185, 129, 0.4)',
              }}
            />

            {/* Threshold Line Marker */}
            <div
              style={{
                position: 'absolute',
                left: `${decisionThresh * 100}%`,
                top: 0,
                bottom: 0,
                width: 3,
                background: '#ffffff',
                boxShadow: '0 0 12px rgba(255,255,255,0.95)',
                zIndex: 2,
              }}
              title={`Decision threshold: ${threshPct}%`}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-3)', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            <span>0% Safe Operation</span>
            <span style={{ transform: 'translateX(-50%)', fontWeight: 700, color: '#f8fafc' }}>
              ▲ Calibrated Threshold {threshPct}%
            </span>
            <span>100% Critical Breakdown</span>
          </div>

          <p style={{ marginTop: 'var(--space-4)', fontSize: '0.95rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            {isFailure
              ? `Probability (${probPct}%) meets or exceeds the threshold (${threshPct}%). Model flags this machine as at-risk of failure.`
              : `Probability (${probPct}%) is below the threshold (${threshPct}%). Model classifies operational state as healthy.`}
          </p>
        </div>
      </div>

      {/* ── Section C: Local Feature Attribution (Occlusion vs Healthy Baseline) ── */}
      <div className="card card-shine" style={{ marginBottom: 'var(--space-8)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Sliders size={20} style={{ color: 'var(--color-accent)' }} /> Feature Attribution (Local Occlusion)
            </h3>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Univariate occlusion against healthy non-failure baseline medians
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <OriginBadge type="MODEL_OUTPUT" label="MODEL ATTRIBUTION" />
            {contributionsList.length > 6 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowAllContributions((prev) => !prev)}
                style={{ fontSize: '0.85rem', padding: '4px 10px' }}
              >
                {showAllContributions ? 'Show Top 6' : `Show All (${contributionsList.length})`}
              </button>
            )}
          </div>
        </div>

        {explanation.loading ? (
          <LoadingState label="Computing local occlusion feature contributions…" />
        ) : explanation.error ? (
          <div className="alert-banner error" style={{ margin: 'var(--space-4)' }}>
            <AlertCircle size={18} />
            <div>
              <span>Failed to load explanation: {explanation.error.message}</span>
              {explanation.error.kind === 'unavailable' && (
                <p style={{ marginTop: 4, fontSize: '0.85rem' }}>
                  Artifacts may be missing. Ensure <code>python backend/scripts/build_explain_artifacts.py</code> has been run.
                </p>
              )}
            </div>
            <button className="btn btn-ghost" onClick={explanation.reload} style={{ marginLeft: 'auto', padding: '4px 10px' }}>
              <RefreshCw size={15} /> Retry
            </button>
          </div>
        ) : contributionChartData.length === 0 ? (
          <EmptyState icon="📊" title="No feature contributions available" />
        ) : (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p style={{ fontSize: '0.92rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
              <span style={{ color: 'var(--color-critical)', fontWeight: 700 }}>Positive values (rose)</span> push probability TOWARDS failure compared to a healthy baseline.
              <span style={{ color: 'var(--color-normal)', fontWeight: 700, marginLeft: 'var(--space-4)' }}>Negative values (mint)</span> stabilize the machine away from failure.
            </p>

            {/* Recharts Horizontal Bar Chart */}
            <div style={{ width: '100%', height: Math.max(260, contributionChartData.length * 48) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={contributionChartData}
                  margin={{ top: 10, right: 30, left: 160, bottom: 10 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v) => (v > 0 ? `+${v.toFixed(3)}` : v.toFixed(3))}
                    stroke="rgba(255,255,255,0.1)"
                  />
                  <YAxis
                    type="category"
                    dataKey="displayLabel"
                    tick={{ fill: '#f8fafc', fontSize: 13, fontWeight: 600 }}
                    width={150}
                    stroke="rgba(255,255,255,0.1)"
                  />
                  <ReferenceLine x={0} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} />
                  <Tooltip
                    contentStyle={{
                      background: '#0B1020',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.7)',
                      fontSize: '0.85rem',
                      color: '#F4F7FB',
                      padding: '12px 16px',
                    }}
                    itemStyle={{ color: '#F4F7FB' }}
                    labelStyle={{ color: '#F4F7FB', fontWeight: 700, marginBottom: '6px' }}
                    wrapperStyle={{ zIndex: 1000 }}
                    formatter={(_val: any, _name: any, item: any) => {
                      const c = item.payload;
                      const isRisk = c.contribution > 0;
                      return [
                        <div key="tip" style={{ fontSize: '0.85rem', lineHeight: 1.5, color: '#F4F7FB' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <span style={{ color: '#A8B6CC' }}>Contribution:</span>
                            <strong style={{ color: isRisk ? '#ef4444' : '#22c55e', fontFamily: 'monospace' }}>
                              {c.contribution > 0 ? `+${c.contribution.toFixed(4)}` : c.contribution.toFixed(4)}
                            </strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <span style={{ color: '#A8B6CC' }}>Observed:</span>
                            <span style={{ color: '#F4F7FB', fontFamily: 'monospace' }}>{c.originalValue} {c.unit}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <span style={{ color: '#A8B6CC' }}>Baseline:</span>
                            <span style={{ color: '#F4F7FB', fontFamily: 'monospace' }}>{c.baselineValue} {c.unit}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <span style={{ color: '#A8B6CC' }}>Direction:</span>
                            <span style={{ color: isRisk ? '#ef4444' : '#22c55e', textTransform: 'capitalize', fontWeight: 600 }}>
                              {c.direction.replace('_', ' ')}
                            </span>
                          </div>
                        </div>,
                        c.displayLabel,
                      ];
                    }}
                  />
                  <Bar dataKey="contribution" radius={[4, 4, 4, 4]}>
                    {contributionChartData.map((entry, index) => {
                      const isRisk = entry.contribution > 0;
                      return (
                        <Cell
                          key={`cell-${index}`}
                          fill={isRisk ? '#ef4444' : '#10b981'}
                          fillOpacity={0.9}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Outside Range Warnings */}
            {exp?.outside_range_warnings && exp.outside_range_warnings.length > 0 && (
              <div className="alert-banner warning" style={{ marginTop: 'var(--space-4)' }}>
                <AlertTriangle size={18} />
                <div>
                  <strong>Training Range Deviations:</strong>
                  <ul style={{ margin: '6px 0 0 18px', fontSize: '0.88rem' }}>
                    {exp.outside_range_warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Expandable "How this was computed" section */}
            <div style={{ marginTop: 'var(--space-5)', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-4)' }}>
              <button
                className="btn btn-ghost"
                onClick={() => setShowHowComputed((prev) => !prev)}
                style={{ fontSize: '0.9rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                <HelpCircle size={16} /> How this attribution was computed
                {showHowComputed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {showHowComputed && (
                <div style={{ background: 'var(--color-surface-inset)', border: '1px solid var(--color-border-glass)', padding: 'var(--space-5)', borderRadius: 'var(--radius)', marginTop: 'var(--space-3)', fontSize: '0.92rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  <p>
                    <strong>Method:</strong> <code>{exp?.method ?? 'occlusion_vs_healthy_baseline'}</code>
                  </p>
                  <p style={{ marginTop: 8 }}>
                    This attribution measures the change in model-predicted failure probability when substituting each observed sensor reading with the median value of healthy non-failure machines from the AI4I 2020 training split.
                  </p>
                  <p style={{ marginTop: 8 }}>
                    <strong>Healthy Non-Failure Baseline Values:</strong>
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, margin: '10px 0' }}>
                    {exp?.baseline_used && Object.entries(exp.baseline_used).map(([k, v]) => (
                      <div key={k} className="monospace" style={{ background: 'rgba(9, 13, 20, 0.8)', border: '1px solid var(--color-border-subtle)', padding: '6px 10px', borderRadius: 6, fontSize: '0.85rem' }}>
                        {k}: <strong style={{ color: 'var(--color-text-primary)' }}>{String(v)}</strong>
                      </div>
                    ))}
                  </div>
                  <p style={{ marginTop: 8, fontStyle: 'italic', opacity: 0.9 }}>
                    <strong>Scientific Limitations:</strong> Univariate occlusion is an approximation. Cross-sensor interactions are not independently separated. These values describe feature sensitivity inside this specific trained gradient-boosting model, not deterministic physical root causes.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Section D: Rule-Based Indicators & Actionable Recommendations ──── */}
      <div className="card card-shine card-glow-violet" style={{ marginBottom: 'var(--space-8)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <ShieldAlert size={20} style={{ color: 'var(--color-accent-violet)' }} /> Physical Failure-Mode Indicators (Rule Engine)
            </h3>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Independent domain physics checks derived from AI4I failure definitions
            </span>
          </div>

          <OriginBadge type="RULE_BASED" />
        </div>

        {recommendations.loading ? (
          <LoadingState label="Evaluating physical failure-mode rules…" />
        ) : recommendations.error ? (
          <div className="alert-banner error" style={{ margin: 'var(--space-4)' }}>
            <AlertCircle size={18} />
            <span>Failed to load rule indicators: {recommendations.error.message}</span>
            <button className="btn btn-ghost" onClick={recommendations.reload} style={{ marginLeft: 'auto', padding: '4px 10px' }}>
              <RefreshCw size={15} /> Retry
            </button>
          </div>
        ) : rec ? (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-5)' }}>
              * These rules are independent engineering boundary checks, <strong>NOT causes learned by the machine learning model</strong>.
            </p>

            {/* 4 Rule Cards (Triggered first) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 'var(--space-5)' }}>
              {[...rec.indicators]
                .sort((a, b) => (a.status === 'triggered' ? -1 : b.status === 'triggered' ? 1 : a.status === 'approaching' ? -1 : 1))
                .map((ind) => {
                  const isTrig = ind.status === 'triggered';
                  const isApp = ind.status === 'approaching';
                  return (
                    <div
                      key={ind.rule_id}
                      style={{
                        background: 'var(--color-surface-inset)',
                        border: `1px solid ${isTrig ? 'var(--color-critical)' : isApp ? 'var(--color-warning)' : 'var(--color-border-glass)'}`,
                        borderRadius: 'var(--radius)',
                        padding: 'var(--space-5)',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: isTrig ? 'var(--shadow-lg), 0 0 20px rgba(239, 68, 68, 0.2)' : 'var(--shadow)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                        <div>
                          <strong style={{ fontSize: '1.05rem', color: 'var(--color-text-primary)' }}>{ind.name}</strong>
                          <div className="monospace" style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: 2 }}>Rule ID: {ind.rule_id}</div>
                        </div>

                        <span
                          className={`badge ${isTrig ? 'critical' : isApp ? 'warning' : 'normal'}`}
                          style={{ fontSize: '0.8rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          {isTrig ? <AlertCircle size={14} /> : isApp ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                          {ind.status.toUpperCase()}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.9rem', margin: 'var(--space-3) 0', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                        <div><strong>Measured:</strong> <span className="monospace" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{ind.actual_value} {ind.unit}</span></div>
                        <div><strong>Threshold:</strong> <span className="monospace">{String(ind.threshold)}</span> ({ind.comparison})</div>
                        <div style={{ marginTop: 6 }}>
                          <span className="chip" style={{ fontSize: '0.78rem' }}>
                            {ind.threshold_status === 'VERIFIED' ? '✓ VERIFIED RULE' : 'ℹ HEURISTIC INDICATOR'}
                          </span>
                        </div>
                      </div>

                      {ind.recommendation && (
                        <div
                          style={{
                            marginTop: 'auto',
                            padding: 'var(--space-3) var(--space-4)',
                            background: isTrig ? 'var(--color-critical-dim)' : 'var(--color-warning-dim)',
                            borderLeft: `3px solid ${isTrig ? 'var(--color-critical)' : 'var(--color-warning)'}`,
                            borderRadius: '0 6px 6px 0',
                            fontSize: '0.88rem',
                            color: isTrig ? '#fca5a5' : '#fde047',
                            lineHeight: 1.5,
                          }}
                        >
                          {ind.recommendation}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Recommended Maintenance Actions */}
            <div
              style={{
                marginTop: 'var(--space-6)',
                background: 'var(--color-surface-inset)',
                padding: 'var(--space-5)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border-glass)',
              }}
            >
              <h4 style={{ fontSize: '1.05rem', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-primary)' }}>
                <CheckCircle2 size={18} color="var(--color-accent)" /> Recommended Maintenance Actions
              </h4>
              <ul style={{ margin: '6px 0 0 24px', fontSize: '0.95rem', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                {rec.recommended_actions.map((act, i) => (
                  <li key={i}>{act}</li>
                ))}
              </ul>

              {/* Official API Disclaimers */}
              <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-subtle)', fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                {rec.notes.map((n, i) => (
                  <p key={i}>• {n}</p>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Section E: Wear-Budget Proxy ────────────────────────────────────── */}
      <div className="card card-shine" style={{ marginBottom: 'var(--space-8)' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Gauge size={20} style={{ color: 'var(--color-warning)' }} /> Wear-Budget Proxy
            </h3>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Estimated percentage of documented 240 min tool replacement window consumed
            </span>
          </div>

          <OriginBadge type="ESTIMATE_PROXY" />
        </div>

        {recommendations.loading ? (
          <LoadingState label="Computing wear-budget proxy…" />
        ) : rec?.wear_budget_proxy ? (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
              <div>
                <span
                  className="monospace"
                  style={{
                    fontSize: 'clamp(36px, 4.2vw, 54px)',
                    fontWeight: 900,
                    color: rec.wear_budget_proxy.is_over_limit ? 'var(--color-critical)' : 'var(--color-warning)',
                    textShadow: `0 0 16px ${rec.wear_budget_proxy.is_over_limit ? 'rgba(239, 68, 68, 0.4)' : 'rgba(245, 158, 11, 0.3)'}`,
                  }}
                >
                  {rec.wear_budget_proxy.percentage_consumed.toFixed(1)}%
                </span>
                <span style={{ fontSize: '0.92rem', color: 'var(--color-text-muted)', marginLeft: 'var(--space-3)' }}>
                  of assumed 240 min tool life consumed
                </span>
              </div>

              <span className="monospace" style={{ fontSize: '0.95rem', color: 'var(--color-text-muted)' }}>
                Observed: <strong style={{ color: 'var(--color-text-primary)' }}>{rec.wear_budget_proxy.tool_wear_min.toFixed(0)}</strong> / {rec.wear_budget_proxy.assumed_limit_min} min
              </span>
            </div>

            {/* Wear Budget Progress Bar */}
            <div
              style={{
                height: 16,
                background: 'var(--color-surface-inset)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
                border: '1px solid var(--color-border-glass)',
              }}
            >
              <div
                style={{
                  width: `${Math.min(100, rec.wear_budget_proxy.percentage_consumed)}%`,
                  height: '100%',
                  background: rec.wear_budget_proxy.is_over_limit
                    ? 'var(--color-critical)'
                    : rec.wear_budget_proxy.percentage_consumed >= 80
                    ? 'var(--color-warning)'
                    : 'var(--color-normal)',
                  borderRadius: 'var(--radius-full)',
                  boxShadow: `0 0 10px ${
                    rec.wear_budget_proxy.is_over_limit
                      ? 'var(--color-critical)'
                      : rec.wear_budget_proxy.percentage_consumed >= 80
                      ? 'var(--color-warning)'
                      : 'var(--color-normal)'
                  }`,
                }}
              />
            </div>

            <p style={{ marginTop: 'var(--space-3)', fontSize: '0.92rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {rec.wear_budget_proxy.interpretation}
            </p>

            <div
              style={{
                marginTop: 'var(--space-4)',
                padding: '12px 16px',
                background: 'var(--color-warning-dim)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem',
                color: '#fde047',
                lineHeight: 1.5,
              }}
            >
              <strong>Notice:</strong> Wear-budget proxy — not Remaining Useful Life (RUL). The AI4I dataset contains no run-to-failure continuous degradation curves or remaining operating hour annotations.
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Section F: Global Feature Importance Panel (Collapsible) ─────────── */}
      <div className="card card-shine" style={{ marginBottom: 'var(--space-8)' }}>
        <div
          className="card-header"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowGlobalImportance((prev) => !prev)}
        >
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Layers size={20} style={{ color: 'var(--color-accent-violet)' }} /> Global Model Permutation Importance
              {showGlobalImportance ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </h3>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Precomputed ROC-AUC degradation on held-out stratified test data (N=2,000)
            </span>
          </div>

          <OriginBadge type="MODEL_OUTPUT" label="GLOBAL IMPORTANCE" />
        </div>

        {showGlobalImportance && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            {globalImportance.loading ? (
              <LoadingState label="Loading global permutation importance…" />
            ) : globalImportance.error ? (
              <div className="alert-banner warning" style={{ margin: 'var(--space-3)' }}>
                <AlertTriangle size={18} />
                <div>
                  <strong>Global importance artifact is missing or unreachable:</strong>
                  <p style={{ marginTop: 4, fontSize: '0.88rem' }}>
                    Please run <code>python backend/scripts/build_explain_artifacts.py</code> on the server to generate permutation importance.
                  </p>
                </div>
              </div>
            ) : globalImportance.data ? (
              <div>
                <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)', fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
                  <div>Method: <strong style={{ color: 'var(--color-text-primary)' }}>{globalImportance.data.method}</strong></div>
                  <div>Metric: <strong style={{ color: 'var(--color-text-primary)' }}>{globalImportance.data.metric}</strong></div>
                  <div>Repeats: <strong style={{ color: 'var(--color-text-primary)' }}>{globalImportance.data.n_repeats} (Seed {globalImportance.data.random_state})</strong></div>
                  <div>Test Samples: <strong style={{ color: 'var(--color-text-primary)' }}>{globalImportance.data.test_sample_size}</strong></div>
                  <div>Generated: <strong style={{ color: 'var(--color-text-primary)' }}>{new Date(globalImportance.data.generated_at).toLocaleString()}</strong></div>
                </div>

                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={globalImportance.data.importances.map((item) => {
                        const meta = FEATURE_DISPLAY_MAP[item.feature] || { label: item.feature, unit: '' };
                        return {
                          name: meta.label,
                          importance: item.importance_mean,
                          std: item.importance_std,
                          rank: item.rank,
                        };
                      })}
                      margin={{ top: 5, right: 30, left: 160, bottom: 5 }}
                    >
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 12 }} stroke="rgba(255,255,255,0.1)" />
                      <YAxis type="category" dataKey="name" tick={{ fill: '#f8fafc', fontSize: 13, fontWeight: 600 }} width={150} stroke="rgba(255,255,255,0.1)" />
                      <Tooltip
                        contentStyle={{
                          background: 'rgba(9, 13, 20, 0.95)',
                          border: '1px solid var(--color-border-glass)',
                          borderRadius: 8,
                          color: '#f8fafc',
                          fontSize: '0.9rem',
                        }}
                        formatter={(val: any, _name: any, item: any) => [
                          `${val.toFixed(4)} (±${item.payload.std.toFixed(4)})`,
                          'ROC-AUC Drop',
                        ]}
                      />
                      <Bar dataKey="importance" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <p style={{ marginTop: 'var(--space-3)', fontSize: '0.92rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                  {globalImportance.data.interpretation}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
