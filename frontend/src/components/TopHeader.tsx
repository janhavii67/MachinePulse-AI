import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { api } from '../api/client';

interface TopHeaderProps {
  onToggleSidebar?: () => void;
  mobileOpen?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ onToggleSidebar, mobileOpen }) => {
  const location = useLocation();
  const [isOnline, setIsOnline] = useState<boolean>(true);

  useEffect(() => {
    api.health()
      .then((h) => {
        setIsOnline(h.status === 'ok' || h.status === 'healthy');
      })
      .catch(() => setIsOnline(false));
  }, []);

  // Format page title from route
  const getPageTitle = (path: string) => {
    if (path === '/') return 'Operational Overview';
    if (path.startsWith('/datasets')) return 'Dataset Management';
    if (path.startsWith('/training')) return 'Model Training';
    if (path.startsWith('/predict')) return 'Inference Console';
    if (path.startsWith('/history/')) return 'Prediction Attribution & Detail';
    if (path.startsWith('/history')) return 'Prediction History';
    if (path.startsWith('/what-if')) return 'What-if Simulation Lab';
    if (path.startsWith('/sensitivity')) return 'Sensitivity Analysis Lab';
    if (path.startsWith('/alerts')) return 'Operational Alerts';
    return 'MachinePulse AI';
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <button
          className="mobile-nav-toggle"
          onClick={onToggleSidebar}
          aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        <div className="header-breadcrumbs">
          <span className="header-crumb-brand">MachinePulse AI</span>
          <span className="header-crumb-sep">/</span>
          <span className="header-crumb-page">{getPageTitle(location.pathname)}</span>
        </div>
      </div>

      <div className="header-meta">
        <div className="header-status-pill">
          <span className={`header-pulse-dot ${isOnline ? '' : 'offline'}`} />
          <span style={{ color: isOnline ? 'var(--color-normal)' : 'var(--color-critical)', fontWeight: 600 }}>
            {isOnline ? 'System Online' : 'Backend Disconnected'}
          </span>
        </div>

        <span className="header-engine-badge">
          AI4I 2020 ENGINE
        </span>
      </div>
    </header>
  );
};
