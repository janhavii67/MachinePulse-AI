/**
 * API client — all calls go through this module.
 * Base URL is read from environment (VITE_API_URL) or defaults to /api via Vite proxy.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api';

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const reqHeaders: Record<string, string> = {};
  if (!isFormData) {
    reqHeaders['Content-Type'] = 'application/json';
  }
  if (options.headers) {
    Object.assign(reqHeaders, options.headers);
  }
  if (isFormData && reqHeaders['Content-Type']) {
    delete reqHeaders['Content-Type'];
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: reqHeaders,
    });
  } catch (err: any) {
    throw new Error(
      err?.message === 'Failed to fetch'
        ? 'Could not connect to MachinePulse AI server. Please verify the backend is running on port 8001.'
        : (err?.message || 'Network request failed')
    );
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? body.message ?? (typeof body === 'string' ? body : JSON.stringify(body));
    } catch {
      detail = `${res.status} ${res.statusText || 'Error'} - Check if FastAPI backend is running on port 8001`;
    }
    throw new Error(detail);
  }
  return res.json();
}

/** Signal-aware fetch — uses AbortController to cancel in-flight requests */
async function requestWithSignal<T>(
  path: string,
  options: RequestInit & { signal?: AbortSignal } = {}
): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const reqHeaders: Record<string, string> = {};
  if (!isFormData) {
    reqHeaders['Content-Type'] = 'application/json';
  }
  if (options.headers) {
    Object.assign(reqHeaders, options.headers);
  }
  if (isFormData && reqHeaders['Content-Type']) {
    delete reqHeaders['Content-Type'];
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: reqHeaders,
    });
  } catch (err: any) {
    const netErr = new Error(
      err?.message === 'Failed to fetch'
        ? 'Could not connect to MachinePulse AI server. Please verify the backend is running on port 8001.'
        : (err?.message || 'Network request failed')
    );
    throw netErr;
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      // FastAPI 422: { error, message, details: [{field, message, type}] }
      if (body.details && Array.isArray(body.details)) {
        detail = body.details.map((d: { field?: string; message?: string }) =>
          d.message ?? JSON.stringify(d)
        ).join('; ');
      } else {
        detail = body.detail ?? body.message ?? (typeof body === 'string' ? body : JSON.stringify(body));
      }
    } catch {
      detail = `${res.status} ${res.statusText || 'Error'} - Check if FastAPI backend is running on port 8001`;
    }
    const err = new Error(detail);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface MissingValueSummary {
  column: string;
  missing_count: number;
  missing_pct: number;
}

export interface DataQualityReport {
  row_count: number;
  column_count: number;
  duplicate_rows: number;
  missing_values: MissingValueSummary[];
  numeric_columns: string[];
  categorical_columns: string[];
  candidate_identifiers: string[];
  candidate_timestamps: string[];
  candidate_targets: string[];
  warnings: string[];
}

export interface Dataset {
  id: string;
  original_filename: string;
  row_count: number;
  column_count: number;
  original_columns: string[];
  mapped_columns: Record<string, string>;
  quality_report: DataQualityReport;
  validation_status: string;
  warnings: string[];
  created_at: string;
}

export interface DatasetPreview {
  id: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total_rows: number;
}

export interface TrainingConfig {
  target_column?: string | null;
  test_size?: number;
  random_state?: number;
  model_type?: string;
}

export interface TrainingRun {
  id: string;
  dataset_id: string;
  status: string;
  config: TrainingConfig | null;
  log: string | null;
  model_version_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ModelVersion {
  id: string;
  task_type: string;
  target_column: string | null;
  feature_schema: string[] | null;
  metrics: Record<string, unknown> | null;
  split_strategy: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ExplanationEntry {
  feature: string;
  contribution: number;
  value: unknown;
}

export interface Prediction {
  id: string;
  prediction_id: string;
  machine_id: string | null;
  observed_at: string | null;
  predicted_at: string;
  status: string;
  task_type: string;
  predicted_label: string | null;
  failure_probability: number;
  decision_threshold: number;
  anomaly_score: number | null;
  risk_score: number | null;
  rul_estimate: string | null;
  recommendation: string | null;
  model_version: string;
  input_snapshot: Record<string, unknown>;
  is_simulated: boolean;
  data_quality_warnings: string[];
  explanation: ExplanationEntry[];
  limitations: string;
}

export interface FeatureContribution {
  feature: string;
  original_value: number | string;
  baseline_value: number | string;
  contribution: number;
  absolute_contribution: number;
  direction: 'increases_risk' | 'decreases_risk' | 'neutral';
}

export interface LocalExplanation {
  method: string;
  method_description: string;
  prediction_id?: string;
  failure_probability: number;
  decision_threshold: number;
  failure_predicted: boolean;
  predicted_label: 'Healthy' | 'Failure';
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendation?: string;
  contributions: FeatureContribution[];
  outside_range_warnings: string[];
  baseline_used: Record<string, unknown>;
  features_analyzed: Record<string, unknown>;
  recommendations?: RecommendationResult;
  disclaimer: string;
}

export interface RuleIndicator {
  rule_id: 'HDF' | 'PWF' | 'OSF' | 'TWF_PROXIMITY';
  name: string;
  status: 'normal' | 'approaching' | 'triggered';
  measured_values: Record<string, unknown>;
  actual_value: number;
  threshold: string | number;
  unit: string;
  comparison: string;
  recommendation: string | null;
  source_text: string;
  threshold_status: 'VERIFIED' | 'HEURISTIC';
}

export interface WearBudgetProxy {
  tool_wear_min: number;
  assumed_limit_min: number;
  percentage_consumed: number;
  is_over_limit: boolean;
  label: 'wear-budget proxy - not RUL';
  limit_source: string;
  interpretation: string;
}

export interface AgreementResult {
  status: 'agree_failure' | 'agree_normal' | 'model_only' | 'rules_only';
  explanation: string;
}

export interface RecommendationResult {
  product_type: string;
  readings_used: Record<string, unknown>;
  indicators: RuleIndicator[];
  wear_budget_proxy: WearBudgetProxy;
  model_probability: number;
  model_threshold: number;
  model_predicted_class: number;
  risk_tier: 'NORMAL' | 'WATCH' | 'HIGH' | 'CRITICAL';
  tier_definitions: Record<string, string>;
  agreement: AgreementResult;
  recommended_actions: string[];
  notes: string[];
}

export interface GlobalImportanceItem {
  feature: string;
  importance_mean: number;
  importance_std: number;
  rank: number;
}

export interface GlobalImportance {
  method: string;
  description: string;
  metric: string;
  n_repeats: number;
  random_state: number;
  evaluation_split: string;
  test_sample_size: number;
  pipeline_artifact: string;
  generated_at: string;
  importances: GlobalImportanceItem[];
  interpretation: string;
}

export interface PredictionListItem {
  prediction_id: string;
  machine_id: string | null;
  predicted_at: string;
  status: string;
  task_type: string;
  model_version: string;
}

// ── What-if Lab types ───────────────────────────────────────────────────────

/** Request payload for POST /api/explain (What-if) */
export interface WhatIfRequest {
  type: string;
  air_temperature: number;
  process_temperature: number;
  rotational_speed: number;
  torque: number;
  tool_wear: number;
}

/** Full response from POST /api/explain (same shape as LocalExplanation, with recommendations embedded) */
export type WhatIfResponse = LocalExplanation;

/** Feature range info from /api/explain/baseline */
export interface BaselineFeatureRange {
  min: number;
  max: number;
  q25?: number;
  median?: number;
  q75?: number;
  std?: number;
  non_fail_median?: number;
  allowed_values?: string[];
  distribution?: Record<string, number>;
  mode?: string;
}

/** Full /api/explain/baseline response */
export interface BaselineInfo {
  method: string;
  description: string;
  source_dataset: string;
  generated_at: string;
  total_records: number;
  non_failure_records: number;
  failure_records: number;
  /** Healthy median/mode values keyed by AI4I column names (e.g. 'Air temperature [K]') */
  baseline_values: Record<string, number | string>;
  /** Training data ranges keyed by AI4I column names */
  training_ranges: Record<string, BaselineFeatureRange>;
  limitations_note: string;
}

export interface Alert {
  id: string;
  prediction_id: string | null;
  machine_id: string | null;
  rule_id: string;
  severity: string;
  reason: string;
  observed_value: string | null;
  threshold_description: string | null;
  recommendation: string | null;
  status: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface SimulatorStatus {
  status: 'stopped' | 'running' | 'paused';
  current_index: number;
  total_rows: number;
  speed_seconds: number;
  simulated_count: number;
  is_dataset_loaded: boolean;
  data_source: string;
}

export interface DashboardStats {
  total_predictions: number;
  normal_count: number;
  warning_count: number;
  critical_count: number;
  open_alerts: number;
  total_alerts: number;
  failure_rate_pct: number;
  trend: Array<{ time: string; probability: number; status: string }>;
}

export interface LivePredictionPayload {
  type: 'L' | 'M' | 'H';
  air_temperature: number;
  process_temperature: number;
  rotational_speed: number;
  torque: number;
  tool_wear: number;
}

// ── API functions ──────────────────────────────────────────────────────────

export const api = {
  health: () => request<{ status: string; model_version?: string; version?: string }>('/health'),
  stats: () => request<DashboardStats>('/stats'),

  // Simulator
  getSimulatorStatus: () => request<SimulatorStatus>('/simulator/status'),
  startSimulator: (speed_seconds = 1.5, start_index?: number) =>
    request<SimulatorStatus>('/simulator/start', {
      method: 'POST',
      body: JSON.stringify({ speed_seconds, start_index }),
    }),
  pauseSimulator: () =>
    request<SimulatorStatus>('/simulator/pause', { method: 'POST' }),
  resumeSimulator: () =>
    request<SimulatorStatus>('/simulator/resume', { method: 'POST' }),
  stopSimulator: () =>
    request<SimulatorStatus>('/simulator/stop', { method: 'POST' }),
  resetSimulator: () =>
    request<SimulatorStatus>('/simulator/reset', { method: 'POST' }),
  stepSimulator: () =>
    request<{ status: SimulatorStatus; prediction: Record<string, unknown> }>('/simulator/step', {
      method: 'POST',
    }),

  // Datasets
  uploadDataset: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Dataset>('/datasets', {
      method: 'POST',
      body: form,
    });
  },
  acquireAi4iDataset: () =>
    request<Dataset>('/datasets/acquire/ai4i', { method: 'POST' }),
  listDatasets: (limit = 50, offset = 0) =>
    request<{ items: Dataset[]; total: number }>(`/datasets?limit=${limit}&offset=${offset}`),
  getDataset: (id: string) => request<Dataset>(`/datasets/${id}`),
  previewDataset: (id: string, limit = 50) =>
    request<DatasetPreview>(`/datasets/${id}/preview?limit=${limit}`),

  // Training & Model Versions
  startTraining: (dataset_id: string, config: TrainingConfig = {}) =>
    request<TrainingRun>('/training-runs', {
      method: 'POST',
      body: JSON.stringify({ dataset_id, config }),
    }),
  getTrainingRun: (id: string) => request<TrainingRun>(`/training-runs/${id}`),
  listModelVersions: () => request<ModelVersion[]>('/model-versions'),
  getActiveModel: () => request<ModelVersion | null>('/model-versions/active'),

  // Predictions
  predictLive: (payload: LivePredictionPayload) =>
    request<any>('/predict', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  predict: (dataset_id: string, machine_id?: string, row_index?: number) =>
    request<Prediction[]>('/predictions', {
      method: 'POST',
      body: JSON.stringify({ dataset_id, machine_id, row_index }),
    }),
  listPredictions: (limit = 50, offset = 0) =>
    request<{ items: PredictionListItem[]; total: number }>(
      `/predictions?limit=${limit}&offset=${offset}`
    ),
  getPrediction: (id: string) => request<Prediction>(`/predictions/${id}`),
  getPredictionExplanation: (id: string) =>
    request<LocalExplanation>(`/predictions/${id}/explain`),
  getPredictionRecommendations: (id: string) =>
    request<RecommendationResult>(`/predictions/${id}/recommendations`),

  // Explainability & Global Importance
  getGlobalImportance: () =>
    request<GlobalImportance>('/explain/global'),
  getExplainBaseline: () =>
    request<Record<string, unknown>>('/explain/baseline'),

  // ── What-if Lab ──────────────────────────────────────────────────────────
  /** Run What-if: POST /api/explain — ZERO database writes, no alerts, no history created. */
  runWhatIf: (payload: WhatIfRequest, signal?: AbortSignal) =>
    requestWithSignal<WhatIfResponse>('/explain', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    }),
  /** Get baseline + training ranges for slider bounds and defaults */
  getBaselineInfo: (signal?: AbortSignal) =>
    requestWithSignal<BaselineInfo>('/explain/baseline', { signal }),

  // Alerts
  listAlerts: (limit = 100, offset = 0) =>
    request<{ items: Alert[]; total: number }>(`/alerts?limit=${limit}&offset=${offset}`),
  patchAlert: (id: string, status: 'acknowledged' | 'resolved') =>
    request<Alert>(`/alerts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
