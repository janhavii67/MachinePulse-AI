import React from 'react';
import { Activity } from 'lucide-react';

interface StaticFallbackHeroProps {
  simulatorStatus?: string;
  failureProbability?: number;
  riskTier?: string;
  isSimulated?: boolean;
  message?: string;
}

export const StaticFallbackHero: React.FC<StaticFallbackHeroProps> = ({
  simulatorStatus = 'stopped',
  failureProbability,
  riskTier = 'NORMAL',
  isSimulated = true,
  message,
}) => {
  const probPercent = failureProbability !== undefined ? (failureProbability * 100).toFixed(1) : null;
  const isCritical = riskTier?.toUpperCase() === 'CRITICAL';
  const isHigh = riskTier?.toUpperCase() === 'HIGH';
  const isWarning = riskTier?.toUpperCase() === 'WATCH' || riskTier?.toUpperCase() === 'WARNING';

  const tierColor = isCritical ? 'var(--color-critical)' : isHigh ? 'var(--color-high)' : isWarning ? 'var(--color-warning)' : 'var(--color-normal)';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '520px',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #04060a 0%, #0a0f1d 50%, #060912 100%)',
        border: '1px solid var(--color-border-glass)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
      }}
      role="region"
      aria-label="Industrial machine visual poster"
    >
      {/* Background Graphic Grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(circle at 65% 50%, rgba(0, 153, 255, 0.15) 0%, transparent 65%), linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 32px 32px, 32px 32px',
          opacity: 0.8,
          pointerEvents: 'none',
        }}
      />

      {/* Schematic Robotic Arm Vector Blueprint */}
      <div
        style={{
          position: 'absolute',
          right: '4%',
          top: '8%',
          bottom: '8%',
          width: '48%',
          opacity: 0.28,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 400 400" width="100%" height="100%" fill="none" stroke="currentColor" style={{ color: 'var(--color-accent)' }}>
          {/* Base Pedestal */}
          <rect x="220" y="320" width="140" height="40" rx="4" strokeWidth="2" />
          <ellipse cx="290" cy="320" rx="60" ry="12" strokeWidth="2" />
          {/* Shoulder joint */}
          <circle cx="290" cy="250" r="32" strokeWidth="2.5" />
          <circle cx="290" cy="250" r="14" strokeWidth="1.5" />
          {/* Upper Arm link */}
          <path d="M 280 220 L 240 120" strokeWidth="18" strokeLinecap="round" stroke="#1e293b" />
          <path d="M 280 220 L 240 120" strokeWidth="3" stroke="#0099ff" />
          {/* Elbow Joint */}
          <circle cx="240" cy="115" r="26" strokeWidth="2.5" />
          {/* Forearm Actuator */}
          <path d="M 230 115 L 140 170" strokeWidth="16" strokeLinecap="round" stroke="#1e293b" />
          <path d="M 230 115 L 140 170" strokeWidth="3" stroke="#0099ff" />
          {/* Wrist & Spindle */}
          <circle cx="135" cy="175" r="16" strokeWidth="2" />
          <line x1="135" y1="190" x2="135" y2="245" strokeWidth="5" stroke="#cbd5e1" />
          <polygon points="135,260 130,245 140,245" fill="#0099ff" />
          {/* Workpiece Disc */}
          <ellipse cx="135" cy="275" rx="45" ry="14" strokeWidth="2.5" stroke="#0099ff" />
          <line x1="90" y1="275" x2="90" y2="295" strokeWidth="2" />
          <line x1="180" y1="275" x2="180" y2="295" strokeWidth="2" />
          <ellipse cx="135" cy="295" rx="45" ry="14" strokeWidth="2" />
          {/* T-slot table line */}
          <line x1="20" y1="320" x2="380" y2="320" strokeWidth="3" stroke="#475569" strokeDasharray="8 6" />
        </svg>
      </div>

      {/* Foreground Content */}
      <div style={{ position: 'relative', zIndex: 2, maxWidth: 650, textAlign: 'left', width: '100%' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: 'var(--radius-full)', background: 'rgba(0, 153, 255, 0.15)', border: '1px solid rgba(0, 153, 255, 0.35)', marginBottom: 'var(--space-4)' }}>
          <Activity size={16} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '0.05em' }}>
            {isSimulated ? 'SIMULATED TELEMETRY' : 'PHYSICAL SENSOR LINK'}
          </span>
        </div>

        <h2 style={{ fontSize: 'clamp(28px, 3.2vw, 42px)', fontWeight: 800, color: '#ffffff', lineHeight: 1.15, marginBottom: 'var(--space-3)' }}>
          PREDICT FAILURE.
          <br />
          <span style={{ color: 'var(--color-accent)' }}>PREVENT DOWNTIME.</span>
        </h2>
        <p style={{ fontSize: '1.05rem', color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 'var(--space-6)' }}>
          MachinePulse AI analyses simulated industrial sensor readings to identify potential failure risks and explain model predictions.
        </p>

        {message && (
          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)', padding: '6px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', display: 'inline-block' }}>
            ℹ️ {message}
          </div>
        )}

        {/* Real Live Status Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'center' }}>
          <div style={{ padding: '12px 18px', background: 'rgba(15, 23, 42, 0.85)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border-glass)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Simulator State</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: simulatorStatus === 'running' ? 'var(--color-normal)' : simulatorStatus === 'paused' ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
              {simulatorStatus.toUpperCase()}
            </div>
          </div>

          {probPercent !== null && (
            <div style={{ padding: '12px 18px', background: 'rgba(15, 23, 42, 0.85)', borderRadius: 'var(--radius)', border: '1px solid var(--color-border-glass)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Failure Probability</div>
              <div className="monospace" style={{ fontSize: '1.15rem', fontWeight: 800, color: tierColor }}>
                {probPercent}% ({riskTier})
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
