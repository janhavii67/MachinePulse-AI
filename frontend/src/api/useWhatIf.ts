/**
 * useWhatIf.ts
 * React hook for the What-if Lab.
 *
 * Manages:
 * - Baseline + input spec loading from /api/explain/baseline
 * - Starting-point loading (from stored prediction or pure baseline)
 * - Debounced, AbortController-cancelled requests to POST /api/explain
 * - Sequence guard: only the last request's result is applied
 * - Consistency guard: flags probability mismatch when inputs equal original
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';
import type { BaselineInfo, Prediction, WhatIfResponse, WhatIfRequest } from './client';
import type { InputSpec, WhatIfInputs } from './whatIfLogic';
import { NUMERIC_FIELDS } from './whatIfLogic';

export type RequestStatus = 'idle' | 'loading' | 'success' | 'error';
export type ErrorKind = 'validation' | 'unavailable' | 'network' | 'not_found' | 'unknown';

export interface WhatIfError {
  kind: ErrorKind;
  message: string;
}

function classifyError(err: Error): WhatIfError {
  const status = (err as any).status as number | undefined;
  const msg = err.message;
  if (status === 422 || msg.toLowerCase().includes('validation') || msg.toLowerCase().includes('value error')) {
    return { kind: 'validation', message: msg };
  }
  if (status === 404 || msg.toLowerCase().includes('not found')) {
    return { kind: 'not_found', message: msg };
  }
  if (status === 503 || msg.toLowerCase().includes('unavailable') || msg.toLowerCase().includes('missing')) {
    return { kind: 'unavailable', message: msg };
  }
  if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('connect') || msg.toLowerCase().includes('port 8001')) {
    return { kind: 'network', message: msg };
  }
  return { kind: 'unknown', message: msg };
}

/**
 * Map AI4I column names (from baseline_values) to canonical snake_case field names.
 */
function aiColumnToField(col: string): string {
  const map: Record<string, string> = {
    'Type': 'type',
    'Air temperature [K]': 'air_temperature',
    'Process temperature [K]': 'process_temperature',
    'Rotational speed [rpm]': 'rotational_speed',
    'Torque [Nm]': 'torque',
    'Tool wear [min]': 'tool_wear',
  };
  return map[col] ?? col;
}

/**
 * Convert a stored Prediction's input_snapshot to WhatIfInputs.
 * Handles both AI4I column names and snake_case canonical names.
 */
function snapshotToInputs(snapshot: Record<string, unknown>): WhatIfInputs {
  const get = (ai4i: string, snake: string): unknown =>
    snapshot[ai4i] ?? snapshot[snake];

  return {
    type: String(get('Type', 'type') ?? 'L'),
    air_temperature: Number(get('Air temperature [K]', 'air_temperature') ?? 300),
    process_temperature: Number(get('Process temperature [K]', 'process_temperature') ?? 310),
    rotational_speed: Number(get('Rotational speed [rpm]', 'rotational_speed') ?? 1507),
    torque: Number(get('Torque [Nm]', 'torque') ?? 39.9),
    tool_wear: Number(get('Tool wear [min]', 'tool_wear') ?? 107),
  };
}

/**
 * Convert BaselineInfo into InputSpec with canonical (snake_case) keys.
 */
function baselineInfoToInputSpec(bi: BaselineInfo): InputSpec {
  const ranges: InputSpec['ranges'] = {};
  for (const [col, r] of Object.entries(bi.training_ranges)) {
    const field = aiColumnToField(col);
    if (field === 'type') continue;
    ranges[field] = {
      min: r.min,
      max: r.max,
      q25: r.q25,
      median: r.median,
      q75: r.q75,
      std: r.std,
      non_fail_median: r.non_fail_median,
    };
  }

  const baseline: InputSpec['baseline'] = {};
  for (const [col, v] of Object.entries(bi.baseline_values)) {
    const field = aiColumnToField(col);
    baseline[field] = v;
  }

  const typeRange = bi.training_ranges['Type'];

  return {
    ranges,
    baseline,
    typeOptions: typeRange?.allowed_values ?? ['L', 'M', 'H'],
    typeDefault: String(bi.baseline_values['Type'] ?? 'L'),
  };
}

/**
 * Convert baseline values to WhatIfInputs.
 */
function baselineToInputs(spec: InputSpec): WhatIfInputs {
  return {
    type: String(spec.baseline['type'] ?? 'L'),
    air_temperature: Number(spec.baseline['air_temperature'] ?? 300),
    process_temperature: Number(spec.baseline['process_temperature'] ?? 310),
    rotational_speed: Number(spec.baseline['rotational_speed'] ?? 1507),
    torque: Number(spec.baseline['torque'] ?? 39.9),
    tool_wear: Number(spec.baseline['tool_wear'] ?? 107),
  };
}

/** Check if two input sets are equal (within floating point tolerance) */
function inputsEqual(a: WhatIfInputs, b: WhatIfInputs, tol = 0.01): boolean {
  if (a.type !== b.type) return false;
  for (const f of NUMERIC_FIELDS) {
    if (Math.abs(a[f] - b[f]) > tol) return false;
  }
  return true;
}

export interface UseWhatIfReturn {
  /** Input specification (ranges, baseline defaults) — null until loaded */
  inputSpec: InputSpec | null;
  specStatus: RequestStatus;
  specError: WhatIfError | null;

  /** The stored prediction used as starting point (null if starting from baseline) */
  originPrediction: Prediction | null;
  originStatus: RequestStatus;
  originError: WhatIfError | null;

  /** Whether the session starts from a stored prediction or the healthy baseline */
  startingPoint: 'prediction' | 'baseline';

  /** Current What-if input values */
  inputs: WhatIfInputs;
  /** Original starting inputs (for Reset and comparison) */
  originalInputs: WhatIfInputs;

  /** Hypothetical model result for current inputs */
  result: WhatIfResponse | null;
  resultStatus: RequestStatus;
  resultError: WhatIfError | null;

  /**
   * When starting from a stored prediction and inputs = original inputs,
   * warns if the fresh What-if probability differs materially from the stored value.
   */
  consistencyWarning: string | null;

  /** Update a single numeric field */
  setField: (field: keyof WhatIfInputs, value: string | number) => void;
  /** Reset inputs to the original starting values and re-evaluate */
  resetToOriginal: () => void;
  /** Switch starting point to baseline */
  switchToBaseline: () => void;
  /** Retry loading the spec */
  reloadSpec: () => void;
  /** Manually re-trigger evaluation */
  retryResult: () => void;
}

const DEBOUNCE_MS = 350;
const CONSISTENCY_TOLERANCE = 0.01; // 1 percentage point in probability

export function useWhatIf(fromPredictionId?: string): UseWhatIfReturn {
  // ── InputSpec (baseline info) ──────────────────────────────────────────────
  const [inputSpec, setInputSpec] = useState<InputSpec | null>(null);
  const [specStatus, setSpecStatus] = useState<RequestStatus>('idle');
  const [specError, setSpecError] = useState<WhatIfError | null>(null);

  // ── Origin prediction ──────────────────────────────────────────────────────
  const [originPrediction, setOriginPrediction] = useState<Prediction | null>(null);
  const [originStatus, setOriginStatus] = useState<RequestStatus>('idle');
  const [originError, setOriginError] = useState<WhatIfError | null>(null);

  // ── Inputs and starting point ─────────────────────────────────────────────
  const [startingPoint, setStartingPoint] = useState<'prediction' | 'baseline'>('baseline');
  const [inputs, setInputs] = useState<WhatIfInputs>({
    type: 'L', air_temperature: 300, process_temperature: 310,
    rotational_speed: 1507, torque: 39.9, tool_wear: 107,
  });
  const [originalInputs, setOriginalInputs] = useState<WhatIfInputs>({
    type: 'L', air_temperature: 300, process_temperature: 310,
    rotational_speed: 1507, torque: 39.9, tool_wear: 107,
  });

  // ── Result ─────────────────────────────────────────────────────────────────
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [resultStatus, setResultStatus] = useState<RequestStatus>('idle');
  const [resultError, setResultError] = useState<WhatIfError | null>(null);
  const [consistencyWarning, setConsistencyWarning] = useState<string | null>(null);

  // ── Internal refs ──────────────────────────────────────────────────────────
  const isMountedRef = useRef(true);
  const seqRef = useRef(0);              // sequence counter for stale-response guard
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingInputsRef = useRef<WhatIfInputs | null>(null);

  // ── Load input spec (baseline) ─────────────────────────────────────────────
  const loadSpec = useCallback(async () => {
    setSpecStatus('loading');
    setSpecError(null);
    try {
      const bi = await api.getBaselineInfo();
      if (!isMountedRef.current) return;
      const spec = baselineInfoToInputSpec(bi);
      setInputSpec(spec);
      setSpecStatus('success');
      return spec;
    } catch (err: unknown) {
      if (!isMountedRef.current) return undefined;
      const e = classifyError(err as Error);
      setSpecError(e);
      setSpecStatus('error');
      return undefined;
    }
  }, []);

  // ── Trigger a What-if evaluation ───────────────────────────────────────────
  const evaluate = useCallback((evalInputs: WhatIfInputs) => {
    // Cancel any pending debounce
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    pendingInputsRef.current = evalInputs;

    debounceTimerRef.current = setTimeout(async () => {
      if (!isMountedRef.current) return;
      const thisInputs = pendingInputsRef.current!;

      const seq = ++seqRef.current;
      const ctrl = new AbortController();
      abortControllerRef.current = ctrl;

      setResultStatus('loading');
      setResultError(null);

      const payload: WhatIfRequest = {
        type: thisInputs.type,
        air_temperature: thisInputs.air_temperature,
        process_temperature: thisInputs.process_temperature,
        rotational_speed: thisInputs.rotational_speed,
        torque: thisInputs.torque,
        tool_wear: thisInputs.tool_wear,
      };

      try {
        const res = await api.runWhatIf(payload, ctrl.signal);
        if (!isMountedRef.current || seq !== seqRef.current) return; // stale
        setResult(res);
        setResultStatus('success');
        setResultError(null);
      } catch (err: unknown) {
        if (!isMountedRef.current || seq !== seqRef.current) return; // stale
        // Ignore aborts — user triggered a new request
        if ((err as Error).name === 'AbortError') return;
        const e = classifyError(err as Error);
        setResultError(e);
        setResultStatus('error');
        setResult(null); // Clear stale results on error
      }
    }, DEBOUNCE_MS);
  }, []);

  // ── Compute consistency warning ────────────────────────────────────────────
  useEffect(() => {
    if (result && originPrediction && inputsEqual(inputs, originalInputs)) {
      const storedProb = originPrediction.failure_probability;
      const freshProb = result.failure_probability;
      if (Math.abs(storedProb - freshProb) > CONSISTENCY_TOLERANCE) {
        setConsistencyWarning(
          `Data consistency notice: When using the stored prediction's original inputs unmodified, ` +
          `the What-if model scores ${(freshProb * 100).toFixed(1)}% but the stored record shows ` +
          `${(storedProb * 100).toFixed(1)}%. This can occur if the model was retrained after this record was stored.`
        );
      } else {
        setConsistencyWarning(null);
      }
    } else {
      setConsistencyWarning(null);
    }
  }, [result, originPrediction, inputs, originalInputs]);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    const bootstrap = async () => {
      const spec = await loadSpec();
      if (!isMountedRef.current) return;

      if (fromPredictionId) {
        // Validate id format first
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(fromPredictionId)) {
          setOriginError({ kind: 'validation', message: `Invalid prediction ID format: "${fromPredictionId}".` });
          setOriginStatus('error');
          if (spec) {
            const base = baselineToInputs(spec);
            setInputs(base);
            setOriginalInputs(base);
            setStartingPoint('baseline');
            evaluate(base);
          }
          return;
        }

        setOriginStatus('loading');
        try {
          const pred = await api.getPrediction(fromPredictionId);
          if (!isMountedRef.current) return;
          setOriginPrediction(pred);
          setOriginStatus('success');
          setOriginError(null);
          setStartingPoint('prediction');

          const predInputs = snapshotToInputs(pred.input_snapshot);
          setInputs(predInputs);
          setOriginalInputs(predInputs);
          evaluate(predInputs);
        } catch (err: unknown) {
          if (!isMountedRef.current) return;
          const e = classifyError(err as Error);
          setOriginError(e);
          setOriginStatus('error');
          // Fall back to baseline inputs if spec loaded
          if (spec) {
            const base = baselineToInputs(spec);
            setInputs(base);
            setOriginalInputs(base);
            setStartingPoint('baseline');
            evaluate(base);
          }
        }
      } else {
        // Start from healthy baseline
        if (spec) {
          const base = baselineToInputs(spec);
          setInputs(base);
          setOriginalInputs(base);
          setStartingPoint('baseline');
          evaluate(base);
        }
      }
    };

    bootstrap();

    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromPredictionId]);

  // ── Field setter ───────────────────────────────────────────────────────────
  const setField = useCallback((field: keyof WhatIfInputs, value: string | number) => {
    setInputs((prev) => {
      const next: WhatIfInputs = { ...prev, [field]: typeof value === 'number' ? value : (field === 'type' ? String(value) : parseFloat(String(value)) || 0) };
      evaluate(next);
      return next;
    });
  }, [evaluate]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const resetToOriginal = useCallback(() => {
    setInputs(originalInputs);
    evaluate(originalInputs);
  }, [originalInputs, evaluate]);

  // ── Switch to baseline ─────────────────────────────────────────────────────
  const switchToBaseline = useCallback(() => {
    if (!inputSpec) return;
    const base = baselineToInputs(inputSpec);
    setOriginPrediction(null);
    setStartingPoint('baseline');
    setOriginalInputs(base);
    setInputs(base);
    evaluate(base);
  }, [inputSpec, evaluate]);

  return {
    inputSpec, specStatus, specError,
    originPrediction, originStatus, originError,
    startingPoint,
    inputs, originalInputs,
    result, resultStatus, resultError,
    consistencyWarning,
    setField,
    resetToOriginal,
    switchToBaseline,
    reloadSpec: loadSpec,
    retryResult: () => evaluate(inputs),
  };
}
