import React, { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Zap,
  Cpu,
  Radio,
  Clock,
  ExternalLink,
  ChevronDown,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { api } from '../api/client';
import type { PredictionListItem, Alert, DashboardStats, SimulatorStatus } from '../api/client';
import { StatCard, LoadingState, ErrorBanner, StatusBadge, EmptyState, OriginBadge } from '../components/Common';

// Lazy-load the 3D scene to keep non-3D routes light and performant
const IndustrialBayScene = React.lazy(() => import('../scene/IndustrialBayScene'));

interface LiveTelemetryData {
  reading_index: number;
  machine_id: string;
  raw_features: {
    type: string;
    air_temperature: number;
    process_temperature: number;
    rotational_speed: number;
    torque: number;
    tool_wear: number;
  };
  prediction: {
    failure_probability: number;
    decision_threshold: number;
    status: string;
    predicted_label: string;
    recommendation: string;
  };
  label: string;
}

export const OverviewPage: React.FC = () => {
  const [predictions, setPredictions] = useState<PredictionListItem[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [simulator, setSimulator] = useState<SimulatorStatus | null>(null);
  const [liveTelemetry, setLiveTelemetry] = useState<LiveTelemetryData | null>(null);
  const [health, setHealth] = useState<{ status: string; version?: string } | null>(null);
  const [speed, setSpeed] = useState<number>(1.5);
  const [wsConnected, setWsConnected] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);

  // Initial load of persisted data from SQLite database
  const loadInitialData = useCallback(async () => {
    try {
      const [h, s, p, a, sim] = await Promise.all([
        api.health().catch(() => ({ status: 'offline' })),
        api.stats().catch(() => null),
        api.listPredictions(20, 0).catch(() => ({ items: [], total: 0 })),
        api.listAlerts(20, 0).catch(() => ({ items: [], total: 0 })),
        api.getSimulatorStatus().catch(() => null),
      ]);

      setHealth(h);
      if (s) setStats(s);
      setPredictions(p.items);
      setAlerts(a.items);
      if (sim) {
        setSimulator(sim);
        setSpeed(sim.speed_seconds || 1.5);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // WebSocket Live Telemetry Connection with reconnect logic
  useEffect(() => {
    let wsUrl: string;
    if (import.meta.env.VITE_WS_URL) {
      wsUrl = import.meta.env.VITE_WS_URL;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const backendPort = import.meta.env.VITE_BACKEND_PORT || '8001';
      const host = window.location.port === '5173' ? `127.0.0.1:${backendPort}` : window.location.host;
      wsUrl = `${protocol}//${host}/api/ws/live`;
    }

    let isSubscribed = true;

    function connectWs() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!isSubscribed) return;
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          if (!isSubscribed) return;
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'telemetry') {
              const data = message.data;
              if (data.raw_features && data.prediction) {
                setLiveTelemetry({
                  reading_index: data.reading_index,
                  machine_id: data.machine_id,
                  raw_features: data.raw_features,
                  prediction: data.prediction,
                  label: data.label || 'AI4I 2020 Replay',
                });
              }

              if (data.stats) {
                setStats(data.stats);
              }

              if (data.simulator) {
                setSimulator(data.simulator);
              }

              if (data.prediction) {
                const newPred: PredictionListItem = {
                  prediction_id: data.prediction.id || data.prediction.prediction_id,
                  machine_id: data.machine_id,
                  predicted_at: data.prediction.predicted_at,
                  status: data.prediction.status,
                  task_type: data.prediction.task_type || 'failure_classification',
                  model_version: data.prediction.model_version || '1.0.0',
                };
                setPredictions((prev) => [newPred, ...prev.slice(0, 19)]);
              }
            } else if (message.type === 'alert') {
              const alert = message.data;
              setAlerts((prev) => [alert, ...prev.slice(0, 19)]);
              setStats((prev) =>
                prev
                  ? { ...prev, open_alerts: prev.open_alerts + 1, total_alerts: prev.total_alerts + 1 }
                  : null
              );
            }
          } catch (err) {
            console.error('Failed to parse WebSocket message:', err);
          }
        };

        ws.onclose = () => {
          if (!isSubscribed) return;
          setWsConnected(false);
          setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          if (!isSubscribed) return;
          setWsConnected(false);
          ws.close();
        };
      } catch (e) {
        console.warn('WebSocket connection attempt failed:', e);
      }
    }

    connectWs();

    // Fallback polling every 3 seconds to keep data synchronized
    const pollInterval = setInterval(() => {
      if (!wsConnected) {
        api.stats().then(setStats).catch(() => {});
        api.getSimulatorStatus().then(setSimulator).catch(() => {});
        api.listPredictions(10, 0).then((r) => setPredictions(r.items)).catch(() => {});
        api.listAlerts(10, 0).then((r) => setAlerts(r.items)).catch(() => {});
      }
    }, 3000);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [wsConnected]);

  // Simulator Control Handlers
  const handleStart = async () => {
    setActionLoading(true);
    try {
      const res = await api.startSimulator(speed);
      setSimulator(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    try {
      const res = await api.pauseSimulator();
      setSimulator(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      const res = await api.resumeSimulator();
      setSimulator(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      const res = await api.stopSimulator();
      setSimulator(res);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    setError('');
    setActionLoading(true);
    try {
      const res = await api.resetSimulator();
      setSimulator(res);
      setLiveTelemetry(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStep = async () => {
    setError('');
    setActionLoading(true);
    try {
      const res = await api.stepSimulator();
      if (res?.status) setSimulator(res.status);
      if (res?.prediction) {
        const pred = res.prediction as any;
        const raw = pred.input_snapshot || {};
        setLiveTelemetry({
          reading_index: res.status.current_index,
          machine_id: pred.machine_id,
          raw_features: {
            type: raw['Type'] || raw['type'] || 'M',
            air_temperature: raw['Air temperature [K]'] ?? raw['air_temperature'] ?? 300,
            process_temperature: raw['Process temperature [K]'] ?? raw['process_temperature'] ?? 310,
            rotational_speed: raw['Rotational speed [rpm]'] ?? raw['rotational_speed'] ?? 1500,
            torque: raw['Torque [Nm]'] ?? raw['torque'] ?? 40,
            tool_wear: raw['Tool wear [min]'] ?? raw['tool_wear'] ?? 0,
          },
          prediction: {
            failure_probability: pred.failure_probability,
            decision_threshold: pred.decision_threshold,
            status: pred.status,
            predicted_label: pred.predicted_label,
            recommendation: pred.recommendation,
          },
          label: 'AI4I 2020 Single Step Replay',
        });
        const newPred: PredictionListItem = {
          prediction_id: pred.id || pred.prediction_id,
          machine_id: pred.machine_id,
          predicted_at: pred.predicted_at,
          status: pred.status,
          task_type: pred.task_type || 'failure_classification',
          model_version: pred.model_version || '1.0.0',
        };
        setPredictions((prev) => [newPred, ...prev.slice(0, 19)]);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <LoadingState label="Initializing Industrial Machine Bay…" />;

  const isRunning = simulator?.status === 'running';
  const isPaused = simulator?.status === 'paused';
  const isStopped = simulator?.status === 'stopped' || !simulator;
  const isOnline = health?.status === 'healthy' || health?.status === 'ok';

  const latestProb = liveTelemetry?.prediction?.failure_probability;
  const latestTier = liveTelemetry?.prediction?.status || 'NORMAL';


  return (
    <div className="page">
      {/* Real Error Banner */}
      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <ErrorBanner message={error} onDismiss={() => setError('')} />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          HERO SECTION: 3D Machine Bay + Large Typography + Real Status Overlay
          ═══════════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          position: 'relative',
          marginBottom: 'var(--space-6)',
        }}
      >
        {/* Cinematic Headline & Subtitle */}
        <div style={{ marginBottom: 'var(--space-3)', maxWidth: '1000px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <OriginBadge type="SIMULATED" label="SIMULATED TELEMETRY REPLAY" />
            <span
              className={`chip ${isRunning ? 'chip-accent' : isPaused ? 'chip-warning' : ''}`}
              style={{ fontWeight: 700 }}
            >
              {!isOnline
                ? '✖ DISCONNECTED'
                : isRunning
                ? '● STREAMING (AI4I 2020)'
                : isPaused
                ? '⏸ PAUSED'
                : '⏹ SIMULATOR STOPPED'}
            </span>
            <span className="monospace" style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              Row {simulator?.current_index ?? 0} / {simulator?.total_rows ?? 10000}
            </span>
          </div>

          <h1
            style={{
              fontSize: 'clamp(24px, 2.6vw, 36px)',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              lineHeight: 1.15,
              color: '#ffffff',
              marginBottom: '4px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'baseline',
              gap: '8px',
            }}
          >
            <span>PREDICT FAILURE.</span>
            <span
              style={{
                background: 'linear-gradient(135deg, var(--color-accent) 0%, #38bdf8 50%, var(--color-accent-violet) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              PREVENT DOWNTIME.
            </span>
          </h1>

          <p
            style={{
              fontSize: '0.88rem',
              color: 'var(--color-text-muted)',
              lineHeight: 1.45,
            }}
          >
            AI-driven predictive maintenance on simulated AI4I 2020 industrial sensor data.
          </p>
        </div>

        {/* 3D Scene Viewport Container */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: 'clamp(350px, 44vh, 480px)',
            borderRadius: 'var(--radius-xl)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg), 0 0 35px rgba(0, 153, 255, 0.08)',
            border: '1px solid var(--color-border-glass)',
          }}
        >
          <Suspense
            fallback={
              <div className="state-loading" style={{ height: '100%', minHeight: 400 }}>
                <div className="spinner" />
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>
                  Loading 3D industrial robotic bay…
                </p>
              </div>
            }
          >
            <IndustrialBayScene
              simulatorStatus={simulator?.status || 'stopped'}
              rotationalSpeedRpm={liveTelemetry?.raw_features?.rotational_speed || 1500}
              riskTier={latestTier}
              failureProbability={latestProb}
              isOnline={isOnline}
            />
          </Suspense>



          {/* Quick Primary Jump Action */}
          <a
            href="#telemetry-deck"
            style={{
              position: 'absolute',
              bottom: '14px',
              left: '16px',
              zIndex: 20,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              background: 'rgba(5, 8, 14, 0.88)',
              backdropFilter: 'blur(16px)',
              borderRadius: 'var(--radius-full)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#ffffff',
              fontSize: '0.8rem',
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: 'var(--shadow), 0 0 20px rgba(14, 165, 233, 0.25)',
              transition: 'all var(--motion-fast)',
            }}
          >
            <span>Access Monitoring Deck</span>
            <ChevronDown size={14} style={{ color: 'var(--color-accent)' }} />
          </a>
        </div>

        {/* ── Simulator Control Console Bar ── */}
        <div
          style={{
            marginTop: 'var(--space-3)',
            padding: '10px var(--space-5)',
            background: 'var(--color-surface-steel)',
            border: '1px solid var(--color-border-glass)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-3)' }}>
            {isStopped && (
              <button
                className="btn btn-primary"
                onClick={handleStart}
                disabled={actionLoading}
                id="sim-start-btn"
              >
                ▶ Start Simulation
              </button>
            )}

            {isRunning && (
              <button
                className="btn btn-secondary"
                onClick={handlePause}
                disabled={actionLoading}
                id="sim-pause-btn"
              >
                ⏸ Pause
              </button>
            )}

            {isPaused && (
              <button
                className="btn btn-primary"
                onClick={handleResume}
                disabled={actionLoading}
                id="sim-resume-btn"
              >
                ▶ Resume
              </button>
            )}

            {!isStopped && (
              <button
                className="btn btn-secondary"
                onClick={handleStop}
                disabled={actionLoading}
                id="sim-stop-btn"
              >
                ⏹ Stop
              </button>
            )}

            <button
              className="btn btn-secondary"
              onClick={handleStep}
              disabled={actionLoading || isRunning}
              id="sim-step-btn"
              title="Advance one row from AI4I dataset and score through ML model"
            >
              ⏭ Step (1 Reading)
            </button>

            <button
              className="btn btn-ghost"
              onClick={handleReset}
              disabled={actionLoading}
              id="sim-reset-btn"
            >
              ↺ Reset
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <label htmlFor="sim-speed-select" style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
              Replay Interval:
            </label>
            <select
              id="sim-speed-select"
              className="form-select"
              style={{ width: 'auto', padding: '8px 14px', fontSize: '0.9rem' }}
              value={speed}
              onChange={(e) => {
                const s = parseFloat(e.target.value);
                setSpeed(s);
                if (isRunning) api.startSimulator(s).then(setSimulator).catch(() => {});
              }}
            >
              <option value="0.5">0.5s (Fast)</option>
              <option value="1.0">1.0s</option>
              <option value="1.5">1.5s (Standard)</option>
              <option value="3.0">3.0s (Slow)</option>
            </select>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1: SENSOR TELEMETRY & THERMAL DYNAMICS (Anchor target)
          ═══════════════════════════════════════════════════════════════════════ */}
      <section id="telemetry-deck" style={{ marginBottom: 'var(--space-12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 4 }}>
              <span className="monospace" style={{ fontSize: '0.85rem', color: 'var(--color-accent)', fontWeight: 700 }}>01</span>
              <span style={{ color: 'var(--color-border-glass)' }}>/</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Machine Telemetry & Stream
              </span>
            </div>
            <h2>Live Sensor Observations</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Source:</span>
            <OriginBadge type="SIMULATED" label="AI4I 2020 DATASET" />
          </div>
        </div>

        {liveTelemetry ? (
          <div
            style={{
              padding: 'var(--space-6)',
              background: 'var(--color-surface-steel)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border-glass)',
              marginBottom: 'var(--space-8)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div>
                <h3 style={{ margin: 0 }}>Telemetry Snapshot — Machine {liveTelemetry.machine_id}</h3>
                <span className="monospace" style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  Dataset observation index: #{liveTelemetry.reading_index}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <StatusBadge status={liveTelemetry.prediction.status} />
                <span className="monospace" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff' }}>
                  {(liveTelemetry.prediction.failure_probability * 100).toFixed(1)}% prob.
                </span>
              </div>
            </div>

            {/* 6 Core Sensor Reading Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
              <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface-inset)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Machine Type</span>
                <div className="monospace" style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', marginTop: 4 }}>
                  {liveTelemetry.raw_features.type}
                </div>
              </div>
              <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface-inset)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Air Temperature</span>
                <div className="monospace" style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', marginTop: 4 }}>
                  {liveTelemetry.raw_features.air_temperature.toFixed(1)} K
                </div>
              </div>
              <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface-inset)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Process Temp</span>
                <div className="monospace" style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', marginTop: 4 }}>
                  {liveTelemetry.raw_features.process_temperature.toFixed(1)} K
                </div>
              </div>
              <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface-inset)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Rotational Speed</span>
                <div className="monospace" style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', marginTop: 4 }}>
                  {liveTelemetry.raw_features.rotational_speed.toFixed(0)} rpm
                </div>
              </div>
              <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface-inset)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Spindle Torque</span>
                <div className="monospace" style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', marginTop: 4 }}>
                  {liveTelemetry.raw_features.torque.toFixed(1)} Nm
                </div>
              </div>
              <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface-inset)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border-subtle)' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Tool Wear</span>
                <div className="monospace" style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', marginTop: 4 }}>
                  {liveTelemetry.raw_features.tool_wear.toFixed(0)} min
                </div>
              </div>
            </div>

            {liveTelemetry.prediction.recommendation && (
              <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'rgba(14, 165, 233, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(14, 165, 233, 0.25)' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-accent)', marginBottom: 2 }}>Prescriptive Action:</div>
                <div style={{ fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>
                  {liveTelemetry.prediction.recommendation}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              padding: 'var(--space-5)',
              background: 'var(--color-surface-steel)',
              borderRadius: 'var(--radius-lg)',
              border: '1px dashed var(--color-border-glass)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              marginBottom: 'var(--space-8)',
            }}
          >
            <Activity size={20} style={{ color: 'var(--color-text-muted)', opacity: 0.5, flexShrink: 0 }} />
            <span
              className="monospace"
              style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}
            >
              {isStopped ? 'SIMULATOR STOPPED' : isPaused ? 'PAUSED' : 'NO STREAM'}
            </span>
          </div>
        )}

        {/* Real Historical Telemetry Trend Chart */}
        {stats?.trend && stats.trend.length > 0 && (
          <div
            style={{
              padding: 'var(--space-6)',
              background: 'var(--color-surface-steel)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border-glass)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <div>
                <h3 style={{ margin: 0 }}>Probability Trend History</h3>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  Real evaluated inference sequence over time
                </span>
              </div>
              <OriginBadge type="MODEL_OUTPUT" />
            </div>

            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={stats.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="probGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={12} domain={[0, 1]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(9, 13, 20, 0.95)',
                      border: '1px solid var(--color-border-glass)',
                      borderRadius: '8px',
                      color: '#ffffff',
                    }}
                    formatter={(val: any) => [`${(Number(val) * 100).toFixed(1)}%`, 'Failure Prob']}
                  />
                  <Area type="monotone" dataKey="probability" stroke="#0ea5e9" strokeWidth={2} fillOpacity={1} fill="url(#probGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2: FLEET ANOMALY DISTRIBUTION & KPIS
          ═══════════════════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 'var(--space-12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 4 }}>
          <span className="monospace" style={{ fontSize: '0.85rem', color: 'var(--color-accent)', fontWeight: 700 }}>02</span>
          <span style={{ color: 'var(--color-border-glass)' }}>/</span>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            Fleet Intelligence & Risk Distribution
          </span>
        </div>
        <h2 style={{ marginBottom: 'var(--space-6)' }}>Model Health & Classification Counters</h2>

        <div className="stats-grid">
          <StatCard
            label="Total Inferences Stored"
            value={stats?.total_predictions ?? predictions.length}
            variant="accent"
            sub="Persisted in SQLite database"
            icon={<Cpu size={22} />}
          />
          <StatCard
            label="Normal Operating State"
            value={stats?.normal_count ?? 0}
            variant="normal"
            sub="Nominal operating envelope"
            icon={<Activity size={22} />}
          />
          <StatCard
            label="Watch / Warning State"
            value={stats?.warning_count ?? 0}
            variant="warning"
            sub="Elevated risk or wear proxy"
            icon={<Clock size={22} />}
          />
          <StatCard
            label="Critical Failure Risk"
            value={stats?.critical_count ?? 0}
            variant="critical"
            sub="Predicted failure state (≥ threshold)"
            icon={<Zap size={22} />}
          />
          <StatCard
            label="Active Open Alerts"
            value={stats?.open_alerts ?? alerts.filter((a) => a.status === 'open').length}
            variant={(stats?.open_alerts ?? 0) > 0 ? 'critical' : 'normal'}
            sub={`${stats?.total_alerts ?? 0} total lifetime alerts`}
            icon={<Radio size={22} />}
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3: RECENT INFERENCES (Database Persisted with Detail Links)
          ═══════════════════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 'var(--space-12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 4 }}>
              <span className="monospace" style={{ fontSize: '0.85rem', color: 'var(--color-accent)', fontWeight: 700 }}>03</span>
              <span style={{ color: 'var(--color-border-glass)' }}>/</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Inference Audit Log
              </span>
            </div>
            <h2>Recent Predictions & Local Attribution</h2>
          </div>
          <Link
            to="/history"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <span>Open Prediction History</span>
            <ExternalLink size={16} />
          </Link>
        </div>

        {predictions.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No stored predictions"
            subtitle="Start the simulator or click Step to stream AI4I dataset observations through the model."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Machine ID</th>
                  <th>Status & Risk Tier</th>
                  <th>Model Pipeline</th>
                  <th>Observation Timestamp (UTC)</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {predictions.slice(0, 8).map((p) => (
                  <tr key={p.prediction_id}>
                    <td className="monospace font-bold" style={{ color: '#ffffff' }}>
                      {p.machine_id ?? '—'}
                    </td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="monospace" style={{ fontSize: '0.88rem' }}>
                      {p.model_version}
                    </td>
                    <td style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                      {new Date(p.predicted_at).toLocaleTimeString()} ({new Date(p.predicted_at).toLocaleDateString()})
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link
                        to={`/history/${p.prediction_id}`}
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Inspect Detail →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 4: ACTIVE OPERATIONAL ALERTS & PREVENTIVE PROTOCOLS
          ═══════════════════════════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 'var(--space-12)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 4 }}>
              <span className="monospace" style={{ fontSize: '0.85rem', color: 'var(--color-accent)', fontWeight: 700 }}>04</span>
              <span style={{ color: 'var(--color-border-glass)' }}>/</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Safety & Prescriptive Interventions
              </span>
            </div>
            <h2>Operational Alerts & Trigger Rules</h2>
          </div>
          <Link
            to="/alerts"
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
          >
            <span>View All Alerts</span>
            <ExternalLink size={16} />
          </Link>
        </div>

        {alerts.length === 0 ? (
          <EmptyState
            icon="🔔"
            title="No operational alerts"
            subtitle="Alerts trigger automatically when model probabilities or sensor safety rules (HDF, PWF, OSF, TWF) exceed thresholds."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Machine ID</th>
                  <th>Trigger Reason & Threshold</th>
                  <th>Status</th>
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 6).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <StatusBadge status={a.severity} />
                    </td>
                    <td className="monospace font-bold" style={{ color: '#ffffff' }}>
                      {a.machine_id ?? '—'}
                    </td>
                    <td style={{ fontSize: '0.92rem' }}>
                      <div style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{a.reason}</div>
                      {a.recommendation && (
                        <div style={{ fontSize: '0.84rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {a.recommendation}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                    <td style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
                      {new Date(a.last_seen_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Exploration Fast-Links ── */}
      <section
        style={{
          padding: 'var(--space-8)',
          background: 'var(--color-surface-steel)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border-glass)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 'var(--space-6)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-2)' }}>
            <Layers size={18} style={{ color: 'var(--color-accent)' }} />
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>What-if Simulation Lab</h3>
          </div>
          <p style={{ fontSize: '0.92rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Interactively simulate modified machine parameters and inspect hypothetical probability shifts with zero database mutations.
          </p>
          <Link to="/what-if" className="btn btn-secondary btn-sm">
            Launch What-if Lab →
          </Link>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--space-2)' }}>
            <Sparkles size={18} style={{ color: 'var(--color-accent-violet)' }} />
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Sensitivity Sweeps</h3>
          </div>
          <p style={{ fontSize: '0.92rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            Sweep across temperature, speed, torque, and tool wear spans to visualize risk curves and tipping points.
          </p>
          <Link to="/sensitivity" className="btn btn-secondary btn-sm">
            Run Sensitivity Sweep →
          </Link>
        </div>
      </section>
    </div>
  );
};
