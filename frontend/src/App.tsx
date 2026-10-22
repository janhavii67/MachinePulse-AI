import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { OverviewPage }  from './pages/OverviewPage';
import { DatasetsPage }  from './pages/DatasetsPage';
import { TrainingPage }  from './pages/TrainingPage';
import { PredictPage }   from './pages/PredictPage';
import { HistoryPage }   from './pages/HistoryPage';
import { PredictionDetailPage } from './pages/PredictionDetailPage';
import { WhatIfLabPage } from './pages/WhatIfLabPage';
import { SensitivityLabPage } from './pages/SensitivityLabPage';
import { AlertsPage }    from './pages/AlertsPage';

const App: React.FC = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <BrowserRouter>
      <div className="app-layout">
        <a href="#main-content-region" className="skip-link">Skip to main content</a>
        <Sidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
        <div className="main-content" id="main-content-region">
          <TopHeader onToggleSidebar={() => setMobileOpen(!mobileOpen)} mobileOpen={mobileOpen} />
          <Routes>
            <Route path="/"         element={<OverviewPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/predict"  element={<PredictPage />} />
            <Route path="/history"  element={<HistoryPage />} />
            <Route path="/history/:id" element={<PredictionDetailPage />} />
            <Route path="/what-if"       element={<WhatIfLabPage />} />
            <Route path="/sensitivity"  element={<SensitivityLabPage />} />
            <Route path="/alerts"        element={<AlertsPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
};

export default App;
