import React from 'react';
import { AlertTriangle, AlertCircle, Inbox } from 'lucide-react';

// ── Status Badge ────────────────────────────────────────────────────────────
export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const s = (status || 'unknown').toLowerCase();
  
  const getColor = () => {
    if (s === 'normal' || s === 'resolved') return 'var(--color-normal)';
    if (s === 'warning' || s === 'watch' || s === 'acknowledged') return 'var(--color-warning)';
    if (s === 'high') return 'var(--color-high)';
    if (s === 'critical' || s === 'open') return 'var(--color-critical)';
    return 'var(--color-unknown)';
  };

  const color = getColor();

  return (
    <span className={`badge ${s}`} role="status">
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}`,
          flexShrink: 0,
        }}
        aria-hidden="true"
      />
      <span>{s}</span>
    </span>
  );
};

// ── Spinner / Loading State ─────────────────────────────────────────────────
export const LoadingState: React.FC<{ label?: string }> = ({ label = 'Loading telemetry…' }) => (
  <div className="state-loading" role="status" aria-live="polite">
    <div className="spinner" />
    <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.05rem', fontWeight: 500 }}>
      {label}
    </p>
  </div>
);

// ── Error Banner ────────────────────────────────────────────────────────────
export const ErrorBanner: React.FC<{ message: string; onDismiss?: () => void }> = ({
  message,
  onDismiss,
}) => (
  <div className="alert-banner error" role="alert" style={{ position: 'relative' }}>
    <AlertCircle size={20} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-critical)' }} />
    <span style={{ flex: 1, fontSize: '0.95rem' }}>{message}</span>
    {onDismiss && (
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          padding: '4px 8px',
          fontWeight: 700,
          fontSize: '1rem',
        }}
        aria-label="Dismiss error"
      >
        ✕
      </button>
    )}
  </div>
);

// ── Empty State ─────────────────────────────────────────────────────────────
export const EmptyState: React.FC<{
  icon?: string | React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}> = ({
  icon,
  title,
  subtitle,
  action,
}) => (
  <div className="state-empty card" style={{ background: 'rgba(19, 26, 41, 0.45)', borderStyle: 'dashed' }}>
    <div style={{ marginBottom: 'var(--space-3)' }}>
      {typeof icon === 'string' ? (
        <span style={{ fontSize: '3rem' }}>{icon}</span>
      ) : icon ? (
        icon
      ) : (
        <Inbox size={48} style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />
      )}
    </div>
    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{title}</h3>
    {subtitle && (
      <p style={{ maxWidth: 520, fontSize: '0.95rem', color: 'var(--color-text-secondary)', margin: '0 auto', lineHeight: 1.6 }}>
        {subtitle}
      </p>
    )}
    {action && <div style={{ marginTop: 'var(--space-4)' }}>{action}</div>}
  </div>
);

// ── Stat Card ────────────────────────────────────────────────────────────────
export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: string;
  variant?: 'accent' | 'normal' | 'warning' | 'critical' | string;
  icon?: React.ReactNode;
}> = ({ label, value, sub, variant = 'accent', icon }) => (
  <div className={`stat-card ${variant}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div className="stat-label">{label}</div>
      {icon && <div style={{ color: 'var(--color-text-muted)', opacity: 0.8 }}>{icon}</div>}
    </div>
    <div className="stat-value">{value}</div>
    {sub && <div className="stat-sub">{sub}</div>}
  </div>
);

// ── Section Header ───────────────────────────────────────────────────────────
export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  badge?: React.ReactNode;
}> = ({ title, subtitle, action, badge }) => (
  <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <h1>{title}</h1>
        {badge}
      </div>
      {subtitle && <p style={{ marginTop: 6, fontSize: '1rem', color: 'var(--color-text-secondary)' }}>{subtitle}</p>}
    </div>
    {action && <div style={{ marginLeft: 'auto' }}>{action}</div>}
  </div>
);

// ── Progress Bar ─────────────────────────────────────────────────────────────
export const ProgressBar: React.FC<{
  value: number;
  max?: number;
  color?: string;
}> = ({ value, max = 100, color = 'var(--color-accent)' }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      style={{
        height: 8,
        background: 'rgba(255, 255, 255, 0.08)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)',
      }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: 'var(--radius-full)',
          transition: 'width 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: `0 0 10px ${color}`,
        }}
      />
    </div>
  );
};

// ── Inline Warning List ──────────────────────────────────────────────────────
export const WarningList: React.FC<{ warnings: string[] }> = ({ warnings }) => {
  if (!warnings?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {warnings.map((w, i) => (
        <div key={i} className="alert-banner warning text-sm" style={{ marginBottom: 0 }}>
          <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-warning)' }} />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
};

// ── Origin Badges ────────────────────────────────────────────────────────────
export type OriginBadgeType = 'MODEL_OUTPUT' | 'RULE_BASED' | 'SIMULATED' | 'ESTIMATE_PROXY' | 'HYPOTHETICAL';

export const OriginBadge: React.FC<{ type: OriginBadgeType; label?: string }> = ({ type, label }) => {
  const configs: Record<OriginBadgeType, { text: string; bg: string; color: string; border: string }> = {
    MODEL_OUTPUT: {
      text: 'MODEL OUTPUT',
      bg: 'rgba(14, 165, 233, 0.15)',
      color: '#38bdf8',
      border: 'rgba(14, 165, 233, 0.4)',
    },
    RULE_BASED: {
      text: 'RULE-BASED',
      bg: 'rgba(139, 92, 246, 0.15)',
      color: '#c4b5fd',
      border: 'rgba(139, 92, 246, 0.4)',
    },
    SIMULATED: {
      text: 'SIMULATED',
      bg: 'rgba(6, 182, 212, 0.15)',
      color: '#22d3ee',
      border: 'rgba(6, 182, 212, 0.4)',
    },
    ESTIMATE_PROXY: {
      text: 'ESTIMATE / PROXY',
      bg: 'rgba(245, 158, 11, 0.15)',
      color: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.4)',
    },
    HYPOTHETICAL: {
      text: 'HYPOTHETICAL',
      bg: 'rgba(244, 114, 182, 0.15)',
      color: '#f472b6',
      border: 'rgba(244, 114, 182, 0.4)',
    },
  };

  const cfg = configs[type];
  return (
    <span
      className="origin-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 'var(--radius-xs)',
        fontSize: '0.8rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        backgroundColor: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        lineHeight: 1.3,
        boxShadow: `0 0 10px ${cfg.bg}`,
      }}
    >
      {label || cfg.text}
    </span>
  );
};
