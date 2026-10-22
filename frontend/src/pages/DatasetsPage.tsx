import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Dataset, DatasetPreview } from '../api/client';
import {
  LoadingState, ErrorBanner, EmptyState, SectionHeader,
  StatusBadge, WarningList,
} from '../components/Common';
import { Upload, Database, FileSpreadsheet, Eye, Sparkles, CheckCircle2 } from 'lucide-react';

export const DatasetsPage: React.FC = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [uploading, setUploading] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [preview, setPreview]   = useState<DatasetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.listDatasets()
      .then((r) => { setDatasets(r.items); setTotal(r.total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (file: File) => {
    setUploadError('');
    setUploadSuccess('');
    setUploading(true);
    try {
      const ds = await api.uploadDataset(file);
      setUploadSuccess(`Uploaded "${ds.original_filename}" — ${ds.row_count.toLocaleString()} rows, ${ds.column_count} columns.`);
      load();
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const acquireAi4i = async () => {
    setUploadError('');
    setUploadSuccess('');
    setAcquiring(true);
    try {
      const dataset = await api.acquireAi4iDataset();
      setUploadSuccess(
        `UCI AI4I 2020 dataset ready — ${dataset.row_count.toLocaleString()} rows verified. ` +
        'Local artifact cache ready for model training and simulation.',
      );
      load();
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Could not acquire the UCI AI4I 2020 dataset.');
    } finally {
      setAcquiring(false);
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const selectDataset = async (ds: Dataset) => {
    setSelected(ds);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const p = await api.previewDataset(ds.id);
      setPreview(p);
    } catch {/* ignore preview error */}
    finally { setPreviewLoading(false); }
  };

  return (
    <div className="page">
      <SectionHeader
        title="Dataset Management"
        subtitle={`${total} dataset${total !== 1 ? 's' : ''} registered · Preprocessing, schema mapping, and quality checks`}
        badge={
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(57, 185, 255, 0.1)',
              border: '1px solid rgba(57, 185, 255, 0.3)',
              color: 'var(--color-accent)',
              fontSize: '0.75rem',
              fontWeight: 700,
            }}
          >
            AI4I 2020 TELEMETRY
          </span>
        }
      />

      {/* Upload zone */}
      <div className="card card-shine" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="flex-row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-4)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <FileSpreadsheet size={18} style={{ color: 'var(--color-accent)' }} /> Ingest Telemetry Dataset
            </h3>
            <p className="text-xs text-muted" style={{ marginTop: 2 }}>
              Upload local CSV telemetry files or acquire the authentic AI4I 2020 industrial benchmark dataset.
            </p>
          </div>
          <button
            id="acquire-ai4i-btn"
            className="btn btn-primary"
            type="button"
            disabled={acquiring || uploading}
            onClick={acquireAi4i}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            <Sparkles size={15} />
            {acquiring ? 'Acquiring UCI Dataset…' : 'Load UCI AI4I 2020 Dataset'}
          </button>
        </div>

        {uploadError   && <div className="alert-banner error"   style={{marginBottom:'var(--space-3)'}}><span>⚠ </span><span>{uploadError}</span></div>}
        {uploadSuccess && <div className="alert-banner success" style={{marginBottom:'var(--space-3)'}}><CheckCircle2 size={16} /><span>{uploadSuccess}</span></div>}

        <div
          className={`dropzone${dragOver ? ' drag-over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          aria-label="Upload CSV file"
          onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
        >
          <div className="dropzone-icon">
            <Upload size={38} strokeWidth={1.75} />
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>{uploading ? 'Validating and uploading telemetry CSV…' : 'Drag & drop CSV telemetry dataset or click to browse'}</h3>
          <p style={{ marginTop: 4, color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>CSV format · maximum 50 MB · UTF-8 encoding · Auto-normalizes sensor column headers</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={onInputChange}
          id="dataset-file-input"
        />
      </div>

      <div className="grid-2">
        {/* Dataset list */}
        <div className="card card-shine">
          <div className="card-header">
            <h3 className="card-title">
              <Database size={16} style={{ color: 'var(--color-accent)' }} /> Registered Telemetry Datasets
            </h3>
            <span className="text-xs text-muted">Click row to inspect</span>
          </div>
          {loading ? (
            <LoadingState label="Loading datasets…" />
          ) : error ? (
            <ErrorBanner message={error} />
          ) : datasets.length === 0 ? (
            <EmptyState icon="📂" title="No datasets registered" subtitle="Upload a CSV or load UCI AI4I to get started." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Row Count</th>
                    <th>Quality Status</th>
                    <th>Ingested</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((ds) => {
                    const isSel = selected?.id === ds.id;
                    return (
                      <tr
                        key={ds.id}
                        className="table-row-clickable"
                        style={{
                          background: isSel ? 'rgba(57, 185, 255, 0.1)' : undefined,
                          borderColor: isSel ? 'var(--color-accent)' : undefined,
                        }}
                        onClick={() => selectDataset(ds)}
                      >
                        <td className="text-sm font-bold" style={{ color: isSel ? 'var(--color-accent)' : 'var(--color-text-primary)' }}>
                          {ds.original_filename}
                        </td>
                        <td className="monospace">{ds.row_count.toLocaleString()}</td>
                        <td><StatusBadge status={ds.validation_status.includes('warning') ? 'warning' : 'normal'} /></td>
                        <td className="text-xs text-muted monospace">{new Date(ds.created_at).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Dataset detail & preview */}
        <div>
          {selected ? (
            <>
              <div className="card card-shine" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="card-header">
                  <div>
                    <h3 className="card-title">{selected.original_filename}</h3>
                    <span className="text-xs text-muted monospace">Dataset ID: {selected.id}</span>
                  </div>
                  <StatusBadge status={selected.validation_status.includes('warning') ? 'warning' : 'normal'} />
                </div>
                <div className="grid-2" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                  <div style={{ padding: '8px 12px', background: 'rgba(7, 10, 22, 0.75)', border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="text-xs text-muted">Total Observations</div>
                    <div className="text-sm monospace" style={{ fontWeight: 700, fontSize: '1rem', color: '#38bdf8' }}>{selected.row_count.toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '8px 12px', background: 'rgba(7, 10, 22, 0.75)', border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="text-xs text-muted">Feature Columns</div>
                    <div className="text-sm monospace" style={{ fontWeight: 700, fontSize: '1rem' }}>{selected.column_count}</div>
                  </div>
                  <div style={{ padding: '8px 12px', background: 'rgba(7, 10, 22, 0.75)', border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="text-xs text-muted">Duplicate Observations</div>
                    <div className="text-sm monospace" style={{ fontWeight: 700, fontSize: '1rem' }}>{selected.quality_report.duplicate_rows}</div>
                  </div>
                  <div style={{ padding: '8px 12px', background: 'rgba(7, 10, 22, 0.75)', border: '1px solid var(--color-border-glass)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="text-xs text-muted">Numeric Sensor Signals</div>
                    <div className="text-sm monospace" style={{ fontWeight: 700, fontSize: '1rem' }}>{selected.quality_report.numeric_columns.length}</div>
                  </div>
                </div>

                {/* Mapped columns */}
                {Object.keys(selected.mapped_columns).length > 0 && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-2)', fontWeight: 600 }}>Mapped Sensor Features</div>
                    <div className="flex-row flex-wrap gap-2">
                      {Object.entries(selected.mapped_columns).map(([orig, canon]) => (
                        <span key={orig} className="chip">
                          {orig} → <strong style={{ color: 'var(--color-accent)' }}>{canon}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Candidate targets */}
                {selected.quality_report.candidate_targets.length > 0 && (
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <div className="text-xs text-muted" style={{ marginBottom: 'var(--space-2)', fontWeight: 600 }}>Detected Target Candidates</div>
                    <div className="flex-row flex-wrap gap-2">
                      {selected.quality_report.candidate_targets.map((t) => (
                        <span key={t} className="chip" style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}>{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                <WarningList warnings={selected.warnings} />
              </div>

              {/* Preview table */}
              <div className="card card-shine">
                <div className="card-header">
                  <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Eye size={16} style={{ color: 'var(--color-accent)' }} /> Raw Telemetry Preview
                  </h3>
                  {preview && <span className="text-xs text-muted">First {preview.rows.length} rows</span>}
                </div>
                {previewLoading ? (
                  <LoadingState label="Reading CSV rows…" />
                ) : preview ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>{preview.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 15).map((row, i) => (
                          <tr key={i}>
                            {preview.columns.map((c) => (
                              <td key={c} className="text-xs monospace">{String(row[c] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon="👁" title="Preview unavailable" />
                )}
              </div>
            </>
          ) : (
            <div className="card card-shine" style={{ height: '100%', minHeight: 320, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState icon={<Database size={36} style={{ color: 'var(--color-text-muted)' }} />} title="Select a dataset" subtitle="Click any row from the left table to inspect schema mapping and preview observations." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
