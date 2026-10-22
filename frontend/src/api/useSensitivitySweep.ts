/**
 * useSensitivitySweep.ts
 * React hook for running sensitivity sweeps against POST /api/explain.
 *
 * Key guarantees:
 * - Requests are sent ONLY when runSweep() is called (never on mount or slider change).
 * - Concurrency is limited to SWEEP_CONCURRENCY_LIMIT (3) parallel requests.
 * - A run-ID guard prevents stale responses from an old run updating current state.
 * - AbortController is used to cancel in-flight requests when Cancel is pressed or unmount.
 * - Cancelled runs keep completed partial results (status = 'partial').
 * - Per-point status tracks success, failure kind, error messages.
 * - Results are stored ordered by sweep value index, not by completion order.
 * - No browser storage. Results live only in component state.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { WhatIfInputs, NumericField } from './whatIfLogic';
import { api } from './client';
import {
  buildSweepRequest,
  SWEEP_CONCURRENCY_LIMIT,
  type SweepPointResult,
  type FailureKind,
} from './sensitivityLogic';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RunState = 'idle' | 'running' | 'completed' | 'partial' | 'cancelled' | 'failed';

export interface SweepProgress {
  completed: number;
  total: number;
  failedCount: number;
}

export interface SweepRunState {
  runState: RunState;
  results: SweepPointResult[];
  progress: SweepProgress;
  /** Set when a run was cancelled or partially completed */
  isPartial: boolean;
  /** Set when configuration has changed after the last run; results are stale */
  isStale: boolean;
  /** Human-readable status message */
  statusMessage: string;
}

export interface UseSensitivitySweepReturn extends SweepRunState {
  runSweep: (
    startingInputs: WhatIfInputs,
    featureKey: NumericField,
    sweepValues: number[]
  ) => void;
  cancelSweep: () => void;
  markStale: () => void;
  resetSweep: () => void;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

/**
 * Process an array of tasks with capped parallelism.
 * `poolSize` tasks run concurrently; as each finishes the next starts.
 * Passing `abortSignal.aborted` check before each task prevents queuing new
 * work once cancellation is requested.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  poolSize: number,
  onResult: (index: number, result: T) => void,
  abortSignal: AbortSignal
): Promise<void> {
  const queue = tasks.map((fn, i) => ({ fn, index: i }));
  let queueIndex = 0;

  const runNext = async (): Promise<void> => {
    if (queueIndex >= queue.length) return;
    const { fn, index } = queue[queueIndex++];
    if (abortSignal.aborted) return;
    const result = await fn();
    onResult(index, result);
    return runNext();
  };

  const workers = Array.from({ length: Math.min(poolSize, tasks.length) }, () => runNext());
  await Promise.all(workers);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSensitivitySweep(): UseSensitivitySweepReturn {
  const [runState, setRunState] = useState<RunState>('idle');
  const [results, setResults] = useState<SweepPointResult[]>([]);
  const [progress, setProgress] = useState<SweepProgress>({ completed: 0, total: 0, failedCount: 0 });
  const [isPartial, setIsPartial] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Tracks the active AbortController; updated on each run.
  const abortControllerRef = useRef<AbortController | null>(null);
  // Run ID guard: increments on each new run; each closure captures its own ID.
  // If the captured ID differs from the current on resolve, the response is discarded.
  const runIdRef = useRef(0);
  // Track mounted state to prevent state updates after unmount.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancel any in-flight requests on unmount.
      abortControllerRef.current?.abort();
    };
  }, []);

  const runSweep = useCallback(
    (startingInputs: WhatIfInputs, featureKey: NumericField, sweepValues: number[]) => {
      // Abort any existing run.
      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Increment run ID — this value is captured by the closure below.
      runIdRef.current += 1;
      const thisRunId = runIdRef.current;

      const total = sweepValues.length;

      // Initialize results with all points as 'not_run'.
      const initialResults: SweepPointResult[] = sweepValues.map((value, index) => ({
        index,
        value,
        status: 'not_run',
      }));

      if (!mountedRef.current) return;

      setResults(initialResults);
      setProgress({ completed: 0, total, failedCount: 0 });
      setIsPartial(false);
      setIsStale(false);
      setRunState('running');
      setStatusMessage(`Running sweep: 0 / ${total} evaluated`);

      // Mutable counters captured in closure (safe because only updated in runNext callbacks
      // which are serialized through the runWithConcurrency pool).
      let completedCount = 0;
      let failedCount = 0;
      // A mutable copy of results for building incremental updates.
      const liveResults: SweepPointResult[] = [...initialResults];

      // Build per-point tasks.
      const tasks = sweepValues.map((_value, i) => async (): Promise<SweepPointResult> => {
        const value = sweepValues[i];
        const payload = buildSweepRequest(startingInputs, featureKey, value);

        try {
          const response = await api.runWhatIf(payload, controller.signal);
          return { index: i, value, status: 'success', response };
        } catch (err: unknown) {
          if (controller.signal.aborted) {
            return { index: i, value, status: 'failed', failureKind: 'aborted', errorMessage: 'Cancelled' };
          }

          let failureKind: FailureKind = 'unknown';
          let errorMessage = 'Unknown error';

          if (err instanceof Error) {
            errorMessage = err.message;
            const status = (err as Error & { status?: number }).status;
            if (status === 422) {
              failureKind = 'validation_422';
            } else if (
              errorMessage.includes('NetworkError') ||
              errorMessage.includes('Failed to fetch') ||
              errorMessage.includes('net::')
            ) {
              failureKind = 'network';
            } else if (status === 503 || status === 502 || status === 504) {
              failureKind = 'unavailable';
            }
          }

          return { index: i, value, status: 'failed', failureKind, errorMessage };
        }
      });

      // Handle each result as it arrives.
      const onResult = (index: number, result: SweepPointResult) => {
        // Run-ID guard: discard if this result is from a superseded run.
        if (thisRunId !== runIdRef.current) return;
        if (!mountedRef.current) return;

        liveResults[index] = result;
        completedCount++;
        if (result.status === 'failed') failedCount++;

        const snap = [...liveResults];
        const snapCompleted = completedCount;
        const snapFailed = failedCount;

        setResults(snap);
        setProgress({ completed: snapCompleted, total, failedCount: snapFailed });
        setStatusMessage(
          `Evaluating: ${snapCompleted} / ${total}${snapFailed > 0 ? ` (${snapFailed} failed)` : ''}`
        );
      };

      // Run the sweep.
      runWithConcurrency(tasks, SWEEP_CONCURRENCY_LIMIT, onResult, controller.signal)
        .then(() => {
          if (thisRunId !== runIdRef.current) return;
          if (!mountedRef.current) return;

          const wasAborted = controller.signal.aborted;
          const finalResults = [...liveResults];
          const finalFailed = failedCount;
          const finalCompleted = completedCount;

          setResults(finalResults);
          setProgress({ completed: finalCompleted, total, failedCount: finalFailed });

          if (wasAborted) {
            setRunState('partial');
            setIsPartial(true);
            setStatusMessage(
              `Cancelled after ${finalCompleted} / ${total} evaluations${finalFailed > 0 ? ` (${finalFailed} failed)` : ''}.`
            );
          } else if (finalFailed === total) {
            setRunState('failed');
            setStatusMessage(`All ${total} evaluations failed.`);
          } else if (finalFailed > 0) {
            setRunState('completed');
            setIsPartial(true);
            setStatusMessage(
              `Completed: ${total - finalFailed} succeeded, ${finalFailed} failed of ${total} evaluated.`
            );
          } else {
            setRunState('completed');
            setStatusMessage(`Completed: all ${total} evaluations succeeded.`);
          }
        })
        .catch(() => {
          // The pool itself shouldn't throw, but handle defensively.
          if (thisRunId !== runIdRef.current) return;
          if (!mountedRef.current) return;
          setRunState('failed');
          setStatusMessage('Sweep failed unexpectedly.');
        });
    },
    []
  );

  const cancelSweep = useCallback(() => {
    abortControllerRef.current?.abort();
    // State update happens in the .then() above when signal.aborted is detected.
    setStatusMessage('Cancelling…');
  }, []);

  const markStale = useCallback(() => {
    setIsStale(true);
  }, []);

  const resetSweep = useCallback(() => {
    abortControllerRef.current?.abort();
    runIdRef.current += 1;
    setRunState('idle');
    setResults([]);
    setProgress({ completed: 0, total: 0, failedCount: 0 });
    setIsPartial(false);
    setIsStale(false);
    setStatusMessage('');
  }, []);

  return {
    runState,
    results,
    progress,
    isPartial,
    isStale,
    statusMessage,
    runSweep,
    cancelSweep,
    markStale,
    resetSweep,
  };
}
