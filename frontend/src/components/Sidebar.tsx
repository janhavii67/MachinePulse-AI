import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  Cpu,
  Activity,
  BellRing,
  BarChart3,
  FlaskConical,
  ScanSearch,
  Zap,
} from 'lucide-react';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

interface NavGroup {
  heading: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'OPERATIONS',
    items: [
      { to: '/',         label: 'Overview',           icon: <LayoutDashboard size={17} /> },
      { to: '/alerts',      label: 'Operational Alerts', icon: <BellRing size={17} /> },
      { to: '/history',     label: 'Prediction History', icon: <BarChart3 size={17} /> },
    ],
  },
  {
    heading: 'DIAGNOSTICS & LABS',
    items: [
      { to: '/predict',     label: 'Inference Console',  icon: <Activity size={17} /> },
      { to: '/what-if',     label: 'What-if Lab',        icon: <FlaskConical size={17} /> },
      { to: '/sensitivity', label: 'Sensitivity Sweep',  icon: <ScanSearch size={17} /> },
    ],
  },
  {
    heading: 'DATA & MODELS',
    items: [
      { to: '/datasets',    label: 'Datasets',           icon: <Upload size={17} /> },
      { to: '/training',    label: 'Model Training',     icon: <Cpu size={17} /> },
    ],
  },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const location = useLocation();

  return (
    <>
      <div
        className={`sidebar-backdrop ${mobileOpen ? 'mobile-open' : ''}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-title">
            <div className="brand-icon-box">
              <Zap size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <h1>MachinePulse AI</h1>
              <p>Predictive Maintenance</p>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {NAV_GROUPS.map((group, gIdx) => (
            <div key={gIdx} className="nav-group">
              <div className="nav-group-heading">{group.heading}</div>
              <div className="nav-group-items">
                {group.items.map(({ to, label, icon, badge }) => {
                  const isActive = to === '/'
                    ? location.pathname === '/'
                    : location.pathname.startsWith(to);

                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      onClick={onCloseMobile}
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className="nav-item-icon">{icon}</span>
                      <span className="nav-item-label">{label}</span>
                      {badge && <span className="nav-item-badge">{badge}</span>}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: '0.8rem' }}>Active Model</span>
              <span style={{ color: 'var(--color-normal)', fontWeight: 700, fontSize: '0.76rem', background: 'rgba(16, 185, 129, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>90.2% Rec.</span>
            </div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.74rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              HistGradientBoosting v1.0
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
