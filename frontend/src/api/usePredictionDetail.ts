import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './client';
import type {
  Prediction,
  LocalExplanation,
  RecommendationResult,
  GlobalImportance,
} from './client';

export type ErrorKind = 'not_found' | 'invalid_snapshot' | 'unavailable' | 'network' | 'invalid_id' | 'unknown';

export interface ResourceError {
  kind: ErrorKind;
  message: string;
}

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: ResourceError | null;
  reload: () => void;
}

export interface ConsistencyMismatch {
  hasMismatch: boolean;
  warnings: string[];
}

function parseErrorKind(errorMsg: string): ErrorKind {
  const lower = errorMsg.toLowerCase();
  if (lower.includes('404') || lower.includes('not found')) return 'not_found';
  if (lower.includes('422') || lower.includes('invalid') || lower.includes('snapshot')) return 'invalid_snapshot';
  if (lower.includes('503') || lower.includes('unavailable') || lower.includes('missing')) return 'unavailable';
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('connect')) return 'network';
  return 'unknown';
}

export function validatePredictionId(id?: string): boolean {
  if (!id) return false;
  const trimmed = id.trim();
  if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') return false;
  // Valid ID: alphanumeric, dashes, underscores (e.g. standard UUIDv4 or test ID)
  return /^[a-zA-Z0-9_-]{1,64}$/.test(trimmed);
}

export function checkConsistency(
  pred: Prediction | null,
  exp: LocalExplanation | null,
  rec: RecommendationResult | null
): ConsistencyMismatch {
  const warnings: string[] = [];
  const probs: { source: string; value: number }[] = [];
  const thresholds: { source: string; value: number }[] = [];

  if (pred?.failure_probability !== undefined && pred.failure_probability !== null) {
    probs.push({ source: 'Stored Prediction Record', value: pred.failure_probability });
  }
  if (exp?.failure_probability !== undefined && exp.failure_probability !== null) {
    probs.push({ source: 'Local Explanation (/explain)', value: exp.failure_probability });
  }
  if (rec?.model_probability !== undefined && rec.model_probability !== null) {
    probs.push({ source: 'Recommendation Engine (/recommendations)', value: rec.model_probability });
  }

  if (pred?.decision_threshold !== undefined && pred.decision_threshold !== null) {
    thresholds.push({ source: 'Stored Prediction Record', value: pred.decision_threshold });
  }
  if (exp?.decision_threshold !== undefined && exp.decision_threshold !== null) {
    thresholds.push({ source: 'Local Explanation (/explain)', value: exp.decision_threshold });
  }
  if (rec?.model_threshold !== undefined && rec.model_threshold !== null) {
    thresholds.push({ source: 'Recommendation Engine (/recommendations)', value: rec.model_threshold });
  }

  // Check probability pairwise consistency (> 0.005 difference)
  for (let i = 0; i < probs.length; i++) {
    for (let j = i + 1; j < probs.length; j++) {
      const diff = Math.abs(probs[i].value - probs[j].value);
      if (diff > 0.005) {
        warnings.push(
          `Probability mismatch: ${probs[i].source} reports ${(probs[i].value * 100).toFixed(1)}% vs ` +
          `${probs[j].source} reports ${(probs[j].value * 100).toFixed(1)}% (delta: ${(diff * 100).toFixed(1)}%).`
        );
      }
    }
  }

  // Check threshold pairwise consistency (> 0.001 difference)
  for (let i = 0; i < thresholds.length; i++) {
    for (let j = i + 1; j < thresholds.length; j++) {
      const diff = Math.abs(thresholds[i].value - thresholds[j].value);
      if (diff > 0.001) {
        warnings.push(
          `Threshold mismatch: ${thresholds[i].source} specifies ${(thresholds[i].value * 100).toFixed(1)}% vs ` +
          `${thresholds[j].source} specifies ${(thresholds[j].value * 100).toFixed(1)}%.`
        );
      }
    }
  }

  return {
    hasMismatch: warnings.length > 0,
    warnings,
  };
}

export function usePredictionDetail(id?: string) {
  const [predState, setPredState] = useState<{
    data: Prediction | null;
    loading: boolean;
    error: ResourceError | null;
  }>({ data: null, loading: true, error: null });

  const [expState, setExpState] = useState<{
    data: LocalExplanation | null;
    loading: boolean;
    error: ResourceError | null;
  }>({ data: null, loading: true, error: null });

  const [recState, setRecState] = useState<{
    data: RecommendationResult | null;
    loading: boolean;
    error: ResourceError | null;
  }>({ data: null, loading: true, error: null });

  const [globState, setGlobState] = useState<{
    data: GlobalImportance | null;
    loading: boolean;
    error: ResourceError | null;
  }>({ data: null, loading: false, error: null });

  const isMountedRef = useRef(true);
  const currentIdRef = useRef<string | undefined>(id);
  currentIdRef.current = id;

  const isValidId = validatePredictionId(id);

  // Independent fetchers
  const fetchPrediction = useCallback((predId: string) => {
    setPredState((prev) => ({ ...prev, loading: true, error: null }));
    api.getPrediction(predId)
      .then((data) => {
        if (!isMountedRef.current || currentIdRef.current !== predId) return;
        setPredState({ data, loading: false, error: null });
      })
      .catch((err: any) => {
        if (!isMountedRef.current || currentIdRef.current !== predId) return;
        setPredState({
          data: null,
          loading: false,
          error: { kind: parseErrorKind(err.message), message: err.message },
        });
      });
  }, []);

  const fetchExplanation = useCallback((predId: string) => {
    setExpState((prev) => ({ ...prev, loading: true, error: null }));
    api.getPredictionExplanation(predId)
      .then((data) => {
        if (!isMountedRef.current || currentIdRef.current !== predId) return;
        setExpState({ data, loading: false, error: null });
      })
      .catch((err: any) => {
        if (!isMountedRef.current || currentIdRef.current !== predId) return;
        setExpState({
          data: null,
          loading: false,
          error: { kind: parseErrorKind(err.message), message: err.message },
        });
      });
  }, []);

  const fetchRecommendations = useCallback((predId: string) => {
    setRecState((prev) => ({ ...prev, loading: true, error: null }));
    api.getPredictionRecommendations(predId)
      .then((data) => {
        if (!isMountedRef.current || currentIdRef.current !== predId) return;
        setRecState({ data, loading: false, error: null });
      })
      .catch((err: any) => {
        if (!isMountedRef.current || currentIdRef.current !== predId) return;
        setRecState({
          data: null,
          loading: false,
          error: { kind: parseErrorKind(err.message), message: err.message },
        });
      });
  }, []);

  const fetchGlobalImportance = useCallback(() => {
    setGlobState((prev) => ({ ...prev, loading: true, error: null }));
    api.getGlobalImportance()
      .then((data) => {
        if (!isMountedRef.current) return;
        setGlobState({ data, loading: false, error: null });
      })
      .catch((err: any) => {
        if (!isMountedRef.current) return;
        setGlobState({
          data: null,
          loading: false,
          error: { kind: parseErrorKind(err.message), message: err.message },
        });
      });
  }, []);

  // Main lifecycle: load independent resources in parallel
  useEffect(() => {
    isMountedRef.current = true;

    if (!isValidId || !id) {
      setPredState({
        data: null,
        loading: false,
        error: { kind: 'invalid_id', message: `Invalid prediction ID '${id ?? ''}'. Expected a valid alphanumeric/UUID string.` },
      });
      setExpState({ data: null, loading: false, error: null });
      setRecState({ data: null, loading: false, error: null });
      return;
    }

    fetchPrediction(id);
    fetchExplanation(id);
    fetchRecommendations(id);
    fetchGlobalImportance();

    return () => {
      isMountedRef.current = false;
    };
  }, [id, isValidId, fetchPrediction, fetchExplanation, fetchRecommendations, fetchGlobalImportance]);

  // Compute consistency guard
  const consistency = checkConsistency(predState.data, expState.data, recState.data);

  return {
    isValidId,
    consistency,
    prediction: {
      ...predState,
      reload: () => id && isValidId && fetchPrediction(id),
    },
    explanation: {
      ...expState,
      reload: () => id && isValidId && fetchExplanation(id),
    },
    recommendations: {
      ...recState,
      reload: () => id && isValidId && fetchRecommendations(id),
    },
    globalImportance: {
      ...globState,
      reload: fetchGlobalImportance,
    },
  };
}
