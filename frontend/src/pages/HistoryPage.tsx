import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { PredictionListItem } from '../api/client';
import { LoadingState, ErrorBanner, EmptyState, SectionHeader, StatusBadge, OriginBadge } from '../components/Common';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, Filter, ArrowRight, RotateCcw, BarChart3, Database } from 'lucide-react';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [items, setItems]     = useState<PredictionListItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Read state from URL search params to ensure state preservation on back navigation
  const statusFilter = searchParams.get('status') || 'all';
  const searchTerm   = searchParams.get('search') || '';
  const currentPage  = parseInt(searchParams.get('page') || '1', 10);
  const pageSize     = 15;

  useEffect(() => {
    api.listPredictions(200, 0)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const updateFilter = (newStatus?: string, newSearch?: string, newPage?: number) => {
    const params = new URLSearchParams(searchParams);
    if (newStatus !== undefined) {
      if (newStatus === 'all') params.delete('status');
      else params.set('status', newStatus);
      params.delete('page');
    }
    if (newSearch !== undefined) {
      if (!newSearch.trim()) params.delete('search');
      else params.set('search', newSearch.trim());
      params.delete('page');
    }
    if (newPage !== undefined) {
      if (newPage <= 1) params.delete('page');
      else params.set('page', String(newPage));
    }
    setSearchParams(params);
  };

  const handleRowClick = (predictionId: string) => {
    navigate(`/history/${predictionId}`, {
      state: { from: location.search },
    });
  };

  // Filtered and paginated list
  const filteredItems = useMemo(() => {
    return items.filter((p) => {
      const matchStatus = statusFilter === 'all' || p.status.toLowerCase() === statusFilter.toLowerCase();
      const s = searchTerm.toLowerCase();
      const matchSearch = !s ||
        (p.machine_id && p.machine_id.toLowerCase().includes(s)) ||
        p.prediction_id.toLowerCase().includes(s) ||
        p.task_type.toLowerCase().includes(s);
      return matchStatus && matchSearch;
    });
  }, [items, statusFilter, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageIndex = Math.min(Math.max(1, currentPage), totalPages);
  const paginatedItems = filteredItems.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);

  // Status trend chart data
  const chartData = useMemo(() => {
    return [...items].reverse().map((p, i) => ({
      i: i + 1,
      status: p.status,
      value: p.status === 'critical' ? 3 : p.status === 'warning' || p.status === 'watch' ? 2 : p.status === 'normal' ? 1 : 0,
      time: new Date(p.predicted_at).toLocaleDateString(),
    }));
  }, [items]);

  return (
    <div className="page">
      <SectionHeader
        title="Prediction History & Audit Log"
        subtitle={`${total} total predictions persisted in SQLite database · Select any record to inspect local feature attributions, rule indicators, and wear budget`}
        badge={<OriginBadge type="MODEL_OUTPUT" label="PERSISTED LOGS" />}
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Status Trend Chart */}
      {items.length > 1 && (
        <div className="card card-shine" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="card-header">
            <div>
              <h3 className="card-title">
                <BarChart3 size={20} style={{ color: 'var(--color-accent)' }} />
                Historical Inferences Severity Timeline
              </h3>
              <span style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
                Chronological machine status timeline (1: Normal, 2: Warning, 3: Critical)
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <span className="badge normal">Normal</span>
              <span className="badge warning">Watch</span>
              <span className="badge critical">Critical</span>
            </div>
          </div>

          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 12 }} stroke="rgba(255,255,255,0.1)" />
                <YAxis domain={[0, 3.5]} ticks={[1, 2, 3]} tick={{ fill: '#94a3b8', fontSize: 12 }} stroke="rgba(255,255,255,0.1)" />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(9, 13, 20, 0.95)',
                    border: '1px solid var(--color-border-glass)',
                    borderRadius: 8,
                    boxShadow: 'var(--shadow)',
                    color: '#f8fafc',
                    fontSize: '0.9rem',
                  }}
                  labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                  formatter={(value) => {
                    const statusLabels = ['', 'Normal', 'Warning', 'Critical'];
                    const status = typeof value === 'number' ? statusLabels[value] : undefined;
                    return [status ?? String(value ?? ''), 'Severity Level'];
                  }}
                />
                <Area
                  type="stepAfter"
                  dataKey="value"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fill="url(#trendGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-5) var(--space-6)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Status filter tabs */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginRight: 'var(--space-2)', fontWeight: 600 }}>
              <Filter size={16} /> Filter Status:
            </span>
            {(['all', 'normal', 'warning', 'critical'] as const).map((st) => (
              <button
                key={st}
                className={`btn btn-sm ${statusFilter === st ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => updateFilter(st, undefined, 1)}
                aria-pressed={statusFilter === st}
                style={{
                  borderRadius: 'var(--radius-full)',
                  padding: '6px 16px',
                  textTransform: 'capitalize',
                  fontSize: '0.88rem',
                }}
              >
                {st === 'all' ? 'All Records' : st}
              </button>
            ))}
          </div>

          {/* Search box and Reset */}
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flex: '1 1 320px', maxWidth: 440 }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <Search size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search Machine ID or UUID…"
                value={searchTerm}
                onChange={(e) => updateFilter(undefined, e.target.value, 1)}
                style={{ paddingLeft: 42, fontSize: '0.95rem' }}
                aria-label="Filter predictions"
              />
            </div>

            {(statusFilter !== 'all' || searchTerm) && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => updateFilter('all', '', 1)}
                title="Reset filters"
                aria-label="Reset filters"
                style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
              >
                <RotateCcw size={15} /> Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Predictions Table */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">
              <Database size={19} style={{ color: 'var(--color-accent)' }} />
              Recorded Inferences {filteredItems.length !== total && `(${filteredItems.length} matching of ${total})`}
            </h3>
            <span style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)' }}>
              Press Enter or click any row to inspect local feature attributions, rule indicators, and wear budget
            </span>
          </div>
        </div>

        {loading ? (
          <LoadingState label="Querying prediction records from SQLite…" />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No matching predictions found"
            subtitle={statusFilter !== 'all' || searchTerm ? 'Try clearing your filters or search term.' : 'Run a simulation or manual prediction to generate records.'}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Machine / UDI</th>
                    <th>Model Status & Risk</th>
                    <th>Inference Pipeline</th>
                    <th>Recorded Timestamp</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((p) => (
                    <tr
                      key={p.prediction_id}
                      className="table-row-clickable"
                      tabIndex={0}
                      role="button"
                      aria-label={`View explanation for prediction ${p.prediction_id}`}
                      onClick={() => handleRowClick(p.prediction_id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRowClick(p.prediction_id);
                        }
                      }}
                    >
                      <td>
                        <span className="monospace font-bold" style={{ color: '#ffffff', fontSize: '1rem' }}>
                          {p.machine_id ?? '—'}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="monospace" style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
                        {p.model_version} ({p.task_type})
                      </td>
                      <td className="monospace" style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                        {new Date(p.predicted_at).toLocaleString()}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRowClick(p.prediction_id);
                          }}
                          aria-label={`Inspect detail for prediction ${p.prediction_id}`}
                        >
                          Explain & Inspect <ArrowRight size={15} style={{ marginLeft: 4 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border-subtle)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                  Page <strong style={{ color: 'var(--color-text-primary)' }}>{pageIndex}</strong> of {totalPages} ({filteredItems.length} records)
                </span>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={pageIndex <= 1}
                    onClick={() => updateFilter(undefined, undefined, pageIndex - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={pageIndex >= totalPages}
                    onClick={() => updateFilter(undefined, undefined, pageIndex + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
