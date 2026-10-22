import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, AlertTriangle, AlertOctagon, ArrowRight, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import type { Alert } from '../api/client';
import { LoadingState, ErrorBanner, EmptyState, SectionHeader, StatusBadge } from '../components/Common';

export const AlertsPage: React.FC = () => {
  const [alerts, setAlerts]   = useState<Alert[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [patching, setPatching] = useState<string | null>(null);

  const load = useCallback(() => {
    return api.listAlerts(200, 0)
      .then((r) => { setAlerts(r.items); setTotal(r.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const patch = async (id: string, status: 'acknowledged' | 'resolved') => {
    setPatching(id);
    try {
      await api.patchAlert(id, status);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPatching(null);
    }
  };

  const open       = alerts.filter((a) => a.status === 'open');
  const acked      = alerts.filter((a) => a.status === 'acknowledged');
  const resolved   = alerts.filter((a) => a.status === 'resolved');

  return (
    <div className="page">
      <SectionHeader
        title="Operational Alerts"
        subtitle={`${total} total alerts · ${open.length} active attention items · All alerts serve as decision support recommendations`}
        badge={
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
              background: open.length > 0 ? 'rgba(251, 113, 133, 0.12)' : 'rgba(52, 211, 153, 0.12)',
              border: `1px solid ${open.length > 0 ? 'rgba(251, 113, 133, 0.35)' : 'rgba(52, 211, 153, 0.35)'}`,
              color: open.length > 0 ? 'var(--color-critical)' : 'var(--color-normal)',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            {open.length > 0 ? `${open.length} UNRESOLVED` : 'ALL RESOLVED'}
          </span>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {loading ? (
        <LoadingState label="Querying operational alerts from SQLite…" />
      ) : alerts.length === 0 ? (
        <EmptyState icon={<Bell size={42} style={{ color: 'var(--color-accent)' }} />} title="No alerts recorded" subtitle="Alerts are triggered automatically when machine telemetry crosses safety limits." />
      ) : (
        <>
          {/* Open Alerts Section */}
          {open.length > 0 && (
            <div className="card card-shine" style={{ marginBottom: 'var(--space-6)', borderColor: 'rgba(251, 113, 133, 0.35)' }}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <AlertOctagon size={18} style={{ color: 'var(--color-critical)' }} />
                  <h3 className="card-title">Open Operational Alerts</h3>
                </div>
                <span className="badge critical">{open.length} Action Required</span>
              </div>
              <AlertTable alerts={open} patching={patching} onPatch={patch} showActions />
            </div>
          )}

          {/* Acknowledged Section */}
          {acked.length > 0 && (
            <div className="card card-shine" style={{ marginBottom: 'var(--space-6)', borderColor: 'rgba(251, 191, 36, 0.3)' }}>
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />
                  <h3 className="card-title">Acknowledged Alerts</h3>
                </div>
                <span className="badge warning">{acked.length} In Progress</span>
              </div>
              <AlertTable alerts={acked} patching={patching} onPatch={patch} showActions />
            </div>
          )}

          {/* Resolved Section */}
          {resolved.length > 0 && (
            <div className="card card-shine">
              <div className="card-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <ShieldCheck size={18} style={{ color: 'var(--color-normal)' }} />
                  <h3 className="card-title">Resolved Alerts</h3>
                </div>
                <span className="badge normal">{resolved.length} Cleared</span>
              </div>
              <AlertTable alerts={resolved} patching={patching} onPatch={patch} showActions={false} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

interface AlertTableProps {
  alerts: Alert[];
  patching: string | null;
  onPatch: (id: string, status: 'acknowledged' | 'resolved') => void;
  showActions: boolean;
}

const AlertTable: React.FC<AlertTableProps> = ({ alerts, patching, onPatch, showActions }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
    {alerts.map((a) => (
      <div
        key={a.id}
        style={{
          background: 'var(--color-surface-2)',
          border: `1px solid ${
            a.severity === 'critical'
              ? 'rgba(251, 113, 133, 0.4)'
              : a.severity === 'warning'
              ? 'rgba(251, 191, 36, 0.35)'
              : 'var(--color-border-glass)'
          }`,
          borderLeft: `4px solid ${
            a.severity === 'critical'
              ? 'var(--color-critical)'
              : a.severity === 'warning'
              ? 'var(--color-warning)'
              : 'var(--color-normal)'
          }`,
          borderRadius: 'var(--radius)',
          padding: '20px 24px',
          boxShadow: a.severity === 'critical' ? '0 0 20px rgba(251, 113, 133, 0.12)' : 'none',
        }}
      >
        <div className="flex-row" style={{ marginBottom: 'var(--space-3)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <StatusBadge status={a.severity} />
          <StatusBadge status={a.status} />
          {a.machine_id && (
            <span className="chip" style={{ color: 'var(--color-accent)', fontWeight: 600, fontSize: '0.85rem' }}>
              🖥 Machine {a.machine_id}
            </span>
          )}
          <span className="chip monospace" style={{ fontSize: '0.82rem' }}>{a.rule_id}</span>
          <span className="text-xs text-muted ml-auto font-mono" style={{ fontSize: '0.82rem' }}>
            {new Date(a.last_seen_at).toLocaleString()}
          </span>
        </div>

        <div style={{ margin: 'var(--space-2) 0 var(--space-3)' }}>
          <strong style={{ fontSize: '1.05rem', color: 'var(--color-text-primary)', lineHeight: 1.4 }}>{a.reason}</strong>
        </div>

        {a.observed_value && (
          <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-3)', fontSize: '0.85rem' }}>
            Observed Value: <span className="monospace" style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{a.observed_value}</span>
            {a.threshold_description && <> · Operating Limit: <span className="monospace">{a.threshold_description}</span></>}
          </div>
        )}

        {a.recommendation && (
          <div
            style={{
              background: 'var(--color-surface-inset)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '12px 16px',
              fontSize: '0.88rem',
              color: 'var(--color-text-secondary)',
              marginBottom: 'var(--space-4)',
              borderLeft: '3px solid var(--color-accent)',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--color-accent)' }}>Diagnostic Action:</strong> {a.recommendation}
          </div>
        )}

        <div className="flex-row gap-2" style={{ alignItems: 'center', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
          {showActions && (
            <>
              {a.status === 'open' && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={patching === a.id}
                  onClick={() => onPatch(a.id, 'acknowledged')}
                  id={`ack-alert-${a.id.slice(0, 8)}`}
                >
                  {patching === a.id ? 'Updating…' : 'Acknowledge Alert'}
                </button>
              )}
              {a.status !== 'resolved' && (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={patching === a.id}
                  onClick={() => onPatch(a.id, 'resolved')}
                  id={`resolve-alert-${a.id.slice(0, 8)}`}
                >
                  {patching === a.id ? 'Updating…' : 'Mark Resolved'}
                </button>
              )}
            </>
          )}

          {a.prediction_id && (
            <Link
              to={`/history/${a.prediction_id}`}
              className="btn btn-secondary btn-sm"
              style={{ marginLeft: showActions ? 'auto' : '0', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              id={`view-pred-${a.id.slice(0, 8)}`}
            >
              Inspect Prediction <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </div>
    ))}
  </div>
);
