import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Dataset, type ModelVersion, type TrainingRun } from '../api/client';
import {
  LoadingState, EmptyState, SectionHeader, StatusBadge,
} from '../components/Common';
import { Cpu, Play, Terminal, Layers, AlertTriangle } from 'lucide-react';

const MetricRow: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <div className="flex-row" style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
    <span className="text-xs text-muted" style={{ minWidth: 160, fontWeight: 500, textTransform: 'capitalize' }}>
      {label.replace(/_/g, ' ')}
    </span>
    <span className="text-sm monospace" style={{ color: 'var(--color-text-primary)' }}>{String(value ?? '—')}</span>
  </div>
);

export const TrainingPage: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [models, setModels] = useState<ModelVersion[]>([]);
  const [selectedDs, setSelectedDs] = useState('');
  const [targetCol, setTargetCol] = useState('');
  const [run, setRun] = useState<TrainingRun | null>(null);
  const [polling, setPolling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const logRef = useRef<HTMLPreElement>(null);
  const userScrolledUpRef = useRef(false);

  const refresh = useCallback(() => {
    return Promise.all([api.listDatasets(), api.listModelVersions()])
      .then(([ds, mv]) => { setDatasets(ds.items); setModels(mv); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll training run status
  useEffect(() => {
    if (!run || !polling) return;
    if (run.status === 'done' || run.status === 'failed') { setPolling(false); refresh(); return; }
    const id = setTimeout(async () => {
      try {
        const updated = await api.getTrainingRun(run.id);
        setRun(updated);
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearTimeout(id);
  }, [run, polling, refresh]);

  // Handle user scroll in console to avoid forcing bottom scroll if inspecting earlier logs
  const handleScroll = () => {
    if (!logRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    userScrolledUpRef.current = !isAtBottom;
  };

  // Auto-scroll to bottom only when user hasn't explicitly scrolled up
  useEffect(() => {
    if (!logRef.current || userScrolledUpRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [run?.log]);

  const startTraining = async () => {
    if (!selectedDs) return;
    setError('');
    setSubmitting(true);
    userScrolledUpRef.current = false;
    try {
      const r = await api.startTraining(selectedDs, { target_column: targetCol || undefined });
      setRun(r);
      setPolling(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const ds = datasets.find((d) => d.id === selectedDs);
  const candidateTargets = ds?.quality_report?.candidate_targets ?? [];

  return (
    <div className="page">
      <SectionHeader
        title="Model Training"
        subtitle="Train and evaluate supervised failure classifiers or unsupervised anomaly models on telemetric datasets."
        badge={
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(139, 92, 246, 0.12)',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              color: '#c4b5fd',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            ML PIPELINE RUNNER
          </span>
        }
      />

      <div className="grid-2" style={{ marginBottom: 'var(--space-6)' }}>
        {/* Training Form */}
        <div className="card card-shine">
          <h3 className="card-title" style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Cpu size={18} style={{ color: 'var(--color-accent)' }} /> Configure & Launch Training Run
          </h3>
          {error && <div className="alert-banner error" style={{ marginBottom: 'var(--space-4)' }}><span>⚠ </span><span>{error}</span></div>}

          <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
            <label className="form-label" htmlFor="ds-select">Select Training Dataset</label>
            <select
              id="ds-select"
              className="form-select"
              value={selectedDs}
              onChange={(e) => { setSelectedDs(e.target.value); setTargetCol(''); }}
            >
              <option value="">— Select dataset —</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>{d.original_filename} ({d.row_count.toLocaleString()} rows)</option>
              ))}
            </select>
          </div>

          {candidateTargets.length > 0 && (
            <div className="form-group" style={{ marginBottom: 'var(--space-4)' }}>
              <label className="form-label" htmlFor="target-select">
                Target Column (optional — auto-detected if blank)
              </label>
              <select
                id="target-select"
                className="form-select"
                value={targetCol}
                onChange={(e) => setTargetCol(e.target.value)}
              >
                <option value="">Auto-detect default</option>
                {candidateTargets.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          <div className="alert-banner info" style={{ marginBottom: 'var(--space-4)' }}>
            <span>ℹ</span>
            <span style={{ fontSize: '0.82rem', lineHeight: 1.4 }}>
              Supervised gradient boosting classification is chosen when a binary failure ground-truth column is present.
              Otherwise, unsupervised Isolation Forest anomaly detection is applied.
            </span>
          </div>

          <button
            id="start-training-btn"
            className="btn btn-primary btn-lg w-full"
            disabled={!selectedDs || submitting || polling}
            onClick={startTraining}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
          >
            <Play size={16} />
            {submitting ? 'Starting pipeline…' : polling ? `Training in progress (${run?.status})…` : 'Start Training Run'}
          </button>
        </div>

        {/* Current Run Status & Console */}
        <div className="card card-shine" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, boxSizing: 'border-box' }}>
          <div
            className="card-header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-3)',
              gap: 'var(--space-3)',
              flexWrap: 'wrap',
            }}
          >
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', margin: 0, fontSize: '1.05rem' }}>
              <Terminal size={17} style={{ color: 'var(--color-accent-violet)' }} /> Pipeline Execution Console
            </h3>
            {run && <StatusBadge status={run.status} />}
          </div>

          {!run ? (
            <div style={{ flex: 1, minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState
                icon={<Cpu size={36} style={{ color: 'var(--color-text-muted)' }} />}
                title="No active training job"
                subtitle="Select a registered dataset on the left and start a run."
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '8px',
                  marginBottom: 'var(--space-3)',
                  padding: '6px 12px',
                  background: 'rgba(14, 20, 38, 0.65)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 500, flexShrink: 0 }}>Run ID:</span>
                <span
                  style={{
                    fontFamily: "'Consolas', 'Cascadia Code', 'Fira Code', monospace",
                    color: 'var(--color-accent)',
                    wordBreak: 'break-all',
                    userSelect: 'all',
                  }}
                >
                  {run.id}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  background: '#070a14',
                  border: '1px solid rgba(56, 189, 248, 0.22)',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.6)',
                }}
              >
                {/* Terminal top chrome bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: 'rgba(14, 20, 38, 0.75)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    fontSize: '0.72rem',
                    color: 'var(--color-text-muted)',
                    fontFamily: "'Consolas', 'Cascadia Code', monospace",
                  }}
                >
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', opacity: 0.85 }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308', opacity: 0.85 }} />
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', opacity: 0.85 }} />
                  </div>
                  <span style={{ marginLeft: '6px' }}>bash · runner-log.stdout</span>
                </div>

                {/* Terminal Log Viewport */}
                {run.log ? (
                  <pre
                    ref={logRef}
                    onScroll={handleScroll}
                    style={{
                      flex: 1,
                      minHeight: 280,
                      maxHeight: 460,
                      margin: 0,
                      padding: '14px 16px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 0,
                      fontFamily: "'Consolas', 'Cascadia Code', 'Fira Code', 'Courier New', monospace",
                      fontSize: '13.5px',
                      lineHeight: 1.5,
                      color: '#e2e8f0',
                      whiteSpace: 'pre',
                      overflowX: 'auto',
                      overflowY: 'auto',
                      boxSizing: 'border-box',
                      scrollbarGutter: 'stable',
                    }}
                  >
                    {run.log}
                  </pre>
                ) : polling ? (
                  <div style={{ padding: 'var(--space-6)', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div className="spinner" style={{ margin: '0 auto var(--space-3)' }} />
                    <p className="text-sm text-muted">Awaiting initial execution output…</p>
                  </div>
                ) : (
                  <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                    No log output recorded for this run.
                  </div>
                )}

                {polling && run.log && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 12px',
                      background: 'rgba(56, 189, 248, 0.08)',
                      borderTop: '1px solid rgba(56, 189, 248, 0.15)',
                      fontSize: '0.75rem',
                      color: 'var(--color-accent)',
                    }}
                  >
                    <div className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
                    <span>Pipeline training in progress…</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Model versions */}
      <div className="card card-shine">
        <div className="card-header">
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Layers size={17} style={{ color: 'var(--color-accent)' }} /> Saved Pipeline Versions
            </h3>
            <span className="text-xs text-muted">Model artifacts stored on server for inference and explainability</span>
          </div>
        </div>

        {loading ? (
          <LoadingState label="Loading model versions…" />
        ) : models.length === 0 ? (
          <EmptyState icon="📦" title="No models trained yet" />
        ) : (
          models.map((mv) => (
            <div
              key={mv.id}
              style={{
                background: mv.is_active ? 'rgba(57, 185, 255, 0.05)' : 'rgba(14, 20, 38, 0.65)',
                border: `1px solid ${mv.is_active ? 'rgba(57, 185, 255, 0.4)' : 'var(--color-border-glass)'}`,
                borderRadius: 'var(--radius)',
                padding: 'var(--space-5)',
                marginBottom: 'var(--space-4)',
                boxShadow: mv.is_active ? '0 0 20px rgba(57, 185, 255, 0.12)' : 'none',
              }}
            >
              <div className="flex-row" style={{ marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                <span className="monospace text-sm font-bold" style={{ color: mv.is_active ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                  {mv.id}
                </span>
                {mv.is_active && <span className="badge info" style={{ fontWeight: 700 }}>Active Champion</span>}
                <span className="chip monospace">{mv.task_type}</span>
                <span className="text-xs text-muted ml-auto font-mono">{new Date(mv.created_at).toLocaleString()}</span>
              </div>

              {mv.target_column && <MetricRow label="Target Column" value={mv.target_column} />}
              <MetricRow label="Split Strategy" value={mv.split_strategy} />
              <MetricRow label="Feature Columns" value={(mv.feature_schema ?? []).join(', ') || '—'} />
              {mv.metrics && Object.entries(mv.metrics)
                .filter(([k]) => ['accuracy', 'f1', 'precision', 'recall', 'roc_auc', 'contamination_rate', 'model_name', 'train_size', 'test_size'].includes(k))
                .map(([k, v]) => (
                  <MetricRow key={k} label={k} value={typeof v === 'number' ? v.toFixed(4) : v} />
                ))
              }
              {Boolean(mv.metrics?.note) && (
                <div className="alert-banner warning" style={{ marginTop: 'var(--space-3)' }}>
                  <AlertTriangle size={15} /><span>{String(mv.metrics?.note)}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
