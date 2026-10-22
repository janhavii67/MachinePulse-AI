import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Dataset, ModelVersion, Prediction, LivePredictionPayload } from '../api/client';
import {
  LoadingState, ErrorBanner, SectionHeader,
  StatusBadge, WarningList,
} from '../components/Common';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { Zap, Play, BarChart2, ShieldCheck, Thermometer, Gauge, Wrench, Sparkles } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  normal:   '#34d399',
  warning:  '#fbbf24',
  critical: '#fb7185',
  unknown:  '#94a3b8',
};

export const PredictPage: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeModel, setActiveModel] = useState<ModelVersion | null>(null);
  const [selectedDs, setSelectedDs] = useState('');
  const [machineId, setMachineId] = useState('');
  const [results, setResults] = useState<Prediction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState('');
  const [predError, setPredError] = useState('');

  // Manual interactive prediction state
  const [manualForm, setManualForm] = useState<LivePredictionPayload>({
    type: 'M',
    air_temperature: 298.5,
    process_temperature: 308.7,
    rotational_speed: 1500,
    torque: 40.0,
    tool_wear: 60,
  });
  const [manualResult, setManualResult] = useState<any>(null);
  const [manualPredicting, setManualPredicting] = useState(false);
  const [manualError, setManualError] = useState('');

  useEffect(() => {
    Promise.all([api.listDatasets(), api.getActiveModel()])
      .then(([ds, mv]) => {
        setDatasets(ds.items);
        if (ds.items.length > 0) setSelectedDs(ds.items[0].id);
        setActiveModel(mv);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const runPrediction = async () => {
    if (!selectedDs) return;
    setPredError('');
    setResults(null);
    setPredicting(true);
    try {
      const preds = await api.predict(selectedDs, machineId || undefined);
      setResults(preds);
    } catch (e: any) {
      setPredError(e.message);
    } finally {
      setPredicting(false);
    }
  };

  const handleManualPredict = async () => {
    setManualError('');
    setManualResult(null);
    setManualPredicting(true);
    try {
      const res = await api.predictLive(manualForm);
      setManualResult(res);
    } catch (e: any) {
      setManualError(e.message);
    } finally {
      setManualPredicting(false);
    }
  };

  const loadPreset = (presetName: string) => {
    if (presetName === 'healthy') {
      setManualForm({
        type: 'M',
        air_temperature: 298.1,
        process_temperature: 308.5,
        rotational_speed: 1550,
        torque: 38.0,
        tool_wear: 25,
      });
    } else if (presetName === 'thermal') {
      setManualForm({
        type: 'H',
        air_temperature: 304.0,
        process_temperature: 313.8,
        rotational_speed: 1320,
        torque: 58.0,
        tool_wear: 140,
      });
    } else if (presetName === 'critical') {
      setManualForm({
        type: 'L',
        air_temperature: 302.5,
        process_temperature: 311.5,
        rotational_speed: 1240,
        torque: 74.5,
        tool_wear: 238,
      });
    }
  };

  if (loading) return <LoadingState label="Loading ML inference engine & datasets…" />;

  return (
    <div className="page">
      <SectionHeader
        title="Inference Console"
        subtitle="Evaluate machine telemetry in real-time or run batch scoring on uploaded datasets."
        badge={
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(57, 185, 255, 0.12)',
              border: '1px solid rgba(57, 185, 255, 0.35)',
              color: 'var(--color-accent)',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            REAL INFERENCE ENGINE
          </span>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Model Info Banner */}
      {activeModel ? (
        <div className="alert-banner info" style={{ marginBottom: 'var(--space-5)' }}>
          <ShieldCheck size={20} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <div>
            <strong>Active Champion Model:</strong> {activeModel.id} · Task: <strong>{activeModel.task_type}</strong> · Target: <strong>{activeModel.target_column}</strong>
            <div style={{ marginTop: 3, fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
              Pipeline: HistGradientBoostingClassifier (90.2% recall on held-out test data) · Decision threshold: 0.66
            </div>
          </div>
        </div>
      ) : (
        <div className="alert-banner warning" style={{ marginBottom: 'var(--space-5)' }}>
          <span>⚠</span>
          <span>No active champion model loaded. Ensure the backend server is running.</span>
        </div>
      )}

      {/* Interactive Manual Telemetry Scoring Card */}
      <div className="card card-shine telemetry-scorer-card">
        <div className="card-header telemetry-scorer-header">
          <div className="telemetry-scorer-title-group">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Zap size={18} style={{ color: 'var(--color-accent)' }} /> Interactive Telemetry Scorer
            </h3>
            <p className="text-xs text-muted" style={{ marginTop: 4 }}>
              Score custom sensor readings against the live HistGradientBoosting pipeline.
            </p>
          </div>
          <div className="telemetry-scorer-presets">
            <button className="telemetry-preset-btn" onClick={() => loadPreset('healthy')}>Healthy Preset</button>
            <button className="telemetry-preset-btn" onClick={() => loadPreset('thermal')}>Thermal Stress</button>
            <button className="telemetry-preset-btn" onClick={() => loadPreset('critical')}>Failure Imminent</button>
          </div>
        </div>

        {manualError && <div className="alert-banner error" style={{ marginBottom: 'var(--space-4)' }}><span>⚠ </span><span>{manualError}</span></div>}

        <div className="telemetry-input-grid">
          <div className="telemetry-field">
            <label className="telemetry-field-label">Product Type</label>
            <select
              className="telemetry-field-select"
              value={manualForm.type}
              onChange={(e) => setManualForm({ ...manualForm, type: e.target.value as any })}
            >
              <option value="L">L (Low - 50%)</option>
              <option value="M">M (Medium - 30%)</option>
              <option value="H">H (High - 20%)</option>
            </select>
          </div>
          <div className="telemetry-field">
            <label className="telemetry-field-label">
              <Thermometer size={14} /> Air Temp [K]
            </label>
            <input
              type="number"
              step="0.1"
              className="telemetry-field-input monospace"
              value={manualForm.air_temperature}
              onChange={(e) => setManualForm({ ...manualForm, air_temperature: parseFloat(e.target.value) || 298.0 })}
            />
          </div>
          <div className="telemetry-field">
            <label className="telemetry-field-label">
              <Thermometer size={14} /> Process Temp [K]
            </label>
            <input
              type="number"
              step="0.1"
              className="telemetry-field-input monospace"
              value={manualForm.process_temperature}
              onChange={(e) => setManualForm({ ...manualForm, process_temperature: parseFloat(e.target.value) || 308.0 })}
            />
          </div>
          <div className="telemetry-field">
            <label className="telemetry-field-label">
              <Gauge size={14} /> Rotational Speed [rpm]
            </label>
            <input
              type="number"
              className="telemetry-field-input monospace"
              value={manualForm.rotational_speed}
              onChange={(e) => setManualForm({ ...manualForm, rotational_speed: parseFloat(e.target.value) || 1500 })}
            />
          </div>
          <div className="telemetry-field">
            <label className="telemetry-field-label">
              <Zap size={14} /> Torque [Nm]
            </label>
            <input
              type="number"
              step="0.1"
              className="telemetry-field-input monospace"
              value={manualForm.torque}
              onChange={(e) => setManualForm({ ...manualForm, torque: parseFloat(e.target.value) || 40.0 })}
            />
          </div>
          <div className="telemetry-field">
            <label className="telemetry-field-label">
              <Wrench size={14} /> Tool Wear [min]
            </label>
            <input
              type="number"
              className="telemetry-field-input monospace"
              value={manualForm.tool_wear}
              onChange={(e) => setManualForm({ ...manualForm, tool_wear: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className="telemetry-action-row">
          <button
            className="btn btn-primary telemetry-score-btn"
            onClick={handleManualPredict}
            disabled={manualPredicting}
            id="manual-score-btn"
          >
            <Sparkles size={16} />
            {manualPredicting ? 'Evaluating Inference…' : 'Score Telemetry'}
          </button>
        </div>

        {/* Manual Result Card */}
        {manualResult && (
          <div
            className="telemetry-result-panel"
            style={{
              border: `1px solid ${manualResult.failure_predicted ? 'var(--color-critical)' : 'var(--color-normal)'}`,
              boxShadow: `0 0 20px ${manualResult.failure_predicted ? 'rgba(251, 113, 133, 0.2)' : 'rgba(52, 211, 153, 0.15)'}`,
            }}
          >
            <div className="telemetry-result-header-row">
              <div className="telemetry-result-status-group">
                <StatusBadge status={manualResult.risk_level === 'CRITICAL' ? 'critical' : manualResult.risk_level === 'HIGH' ? 'warning' : 'normal'} />
                <span className="font-bold" style={{ fontSize: '1rem', color: 'var(--color-text-primary)' }}>
                  {manualResult.failure_predicted ? 'Failure Predicted' : 'Normal Machine Condition'}
                </span>
              </div>
              <div className="telemetry-result-metric-group">
                <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Failure Probability:{' '}
                </span>
                <span
                  className="font-bold monospace"
                  style={{
                    fontSize: '1.25rem',
                    color: manualResult.failure_predicted ? 'var(--color-critical)' : 'var(--color-normal)',
                  }}
                >
                  {(manualResult.failure_probability * 100).toFixed(2)}%
                </span>
                <span className="text-xs text-muted font-mono" style={{ marginLeft: 6 }}>
                  (Threshold: {(manualResult.decision_threshold * 100).toFixed(0)}%)
                </span>
              </div>
            </div>
            <div className="telemetry-result-recommendation-row">
              <strong style={{ color: 'var(--color-text-secondary)', marginRight: 6 }}>Recommendation:</strong>
              <span>{manualResult.recommendation}</span>
            </div>
          </div>
        )}
      </div>

      {/* Dataset Batch Prediction Card */}
      <div className="card card-shine" style={{ marginBottom: 'var(--space-6)' }}>
        <h3 className="card-title" style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <BarChart2 size={18} style={{ color: 'var(--color-accent)' }} /> Batch Dataset Scoring (AI4I 2020)
        </h3>
        {predError && <div className="alert-banner error" style={{ marginBottom: 'var(--space-4)' }}><span>⚠ </span><span>{predError}</span></div>}

        <div className="grid-2" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="form-group">
            <label className="form-label" htmlFor="pred-ds-select">Target Telemetry Dataset</label>
            <select
              id="pred-ds-select"
              className="form-select"
              value={selectedDs}
              onChange={(e) => setSelectedDs(e.target.value)}
            >
              <option value="">— Select dataset —</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>{d.original_filename} ({d.row_count.toLocaleString()} rows)</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="machine-id-input">Machine ID Label Filter (optional)</label>
            <input
              id="machine-id-input"
              className="form-input monospace"
              placeholder="e.g. M14860"
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
            />
          </div>
        </div>

        <button
          id="run-prediction-btn"
          className="btn btn-secondary btn-lg"
          disabled={!selectedDs || !activeModel || predicting}
          onClick={runPrediction}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <Play size={16} />
          {predicting ? 'Scoring Telemetry Batch…' : 'Run Batch Prediction'}
        </button>
      </div>

      {predicting && <LoadingState label="Scoring AI4I dataset observations through ML model…" />}

      {results && results.length > 0 && (
        <>
          {/* Summary chart */}
          <div className="card card-shine" style={{ marginBottom: 'var(--space-6)' }}>
            <div className="card-header">
              <h3 className="card-title">Status Distribution ({results.length.toLocaleString()} rows scored)</h3>
            </div>
            {(() => {
              const counts: Record<string, number> = {};
              results.forEach((r) => { counts[r.status] = (counts[r.status] ?? 0) + 1; });
              const data = Object.entries(counts).map(([name, value]) => ({ name, value }));
              return (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fill: '#627193', fontSize: 12 }} stroke="rgba(255,255,255,0.08)" />
                    <YAxis tick={{ fill: '#627193', fontSize: 12 }} stroke="rgba(255,255,255,0.08)" />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(14, 20, 38, 0.95)',
                        border: '1px solid var(--color-border-glass)',
                        borderRadius: 8,
                        color: '#f4f7ff',
                        fontSize: '0.8rem',
                      }}
                      labelStyle={{ color: '#9ba8c7' }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {data.map((entry) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? '#94a3b8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* Results table */}
          <div className="card card-shine">
            <div className="card-header">
              <h3 className="card-title">Prediction Batch Results</h3>
              <span className="text-xs text-muted">Showing first 50 observations</span>
            </div>
            <WarningList warnings={results[0]?.data_quality_warnings ?? []} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Machine</th>
                    <th>Status</th>
                    <th>Predicted Label</th>
                    <th>Failure Probability</th>
                  </tr>
                </thead>
                <tbody>
                  {results.slice(0, 50).map((r, i) => (
                    <tr key={r.prediction_id || i}>
                      <td className="text-xs monospace">{i + 1}</td>
                      <td className="monospace font-bold" style={{ color: 'var(--color-accent)' }}>{r.machine_id ?? '—'}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="text-sm">{r.predicted_label ?? '—'}</td>
                      <td className="monospace text-sm font-bold">
                        {r.anomaly_score !== null && r.anomaly_score !== undefined
                          ? `${(r.anomaly_score * 100).toFixed(2)}%`
                          : r.risk_score !== null && r.risk_score !== undefined
                          ? `${(r.risk_score * 100).toFixed(2)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
