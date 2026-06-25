import { startTransition, useEffect, useRef, useState } from "react";

import { nextDegraded, updateLatencyEwma } from "../lib/pollTier";

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  consecutiveErrors: number;
  /** True when responses have been slow or polls keep getting superseded
   *  (we're outpacing the backend). Consumers can widen the poll cadence to
   *  let a struggling backend recover — see `pickPollInterval(..., degraded)`. */
  degraded: boolean;
  refresh: () => void;
}

/**
 * Visibility-aware polling hook with in-flight cancellation.
 *
 * - By default, skips ticks when the document is hidden and immediately
 *   re-fires on visibility-return — the right tradeoff for most UI polls.
 * - When `pollWhenHidden` is true, keeps polling regardless of visibility
 *   (subject to the browser's own background-timer throttling, which is
 *   ~1Hz dropping to ~1/min after sustained hiding). Use for data that
 *   drives background notifications — otherwise the user backgrounds the
 *   tab and the notification path goes dark exactly when they need it.
 * - Aborts any in-flight request before issuing a new one so a hung backend
 *   can't pile up a backlog of stacked fetches.
 * - `fn` receives an AbortSignal; pass it through to `fetch(..., { signal })`.
 */
export function usePolling<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  pollWhenHidden = false,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [degraded, setDegraded] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tickRef = useRef<() => Promise<void>>(async () => {});
  // Latency-tracking state lives in refs (not effect-locals) so it survives the
  // effect re-run when `ms` changes — backing off (which changes `ms`) must not
  // reset the degraded signal that triggered it.
  const ewmaRef = useRef<number | null>(null);
  const supersedesRef = useRef(0);
  const degradedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let inflight: AbortController | null = null;

    // Fold a completed (or superseded) poll into the degraded signal. A
    // completed poll records its latency and resets the supersede run; a
    // superseded one (aborted by the next tick before finishing) bumps the
    // run — the EWMA can't see those since they never complete to be measured.
    const recordSample = (latencyMs: number | null, superseded: boolean) => {
      if (superseded) {
        supersedesRef.current += 1;
      } else {
        supersedesRef.current = 0;
        if (latencyMs !== null) {
          ewmaRef.current = updateLatencyEwma(ewmaRef.current, latencyMs);
        }
      }
      const next = nextDegraded(degradedRef.current, ewmaRef.current, supersedesRef.current);
      if (next !== degradedRef.current) {
        degradedRef.current = next;
        startTransition(() => setDegraded(next));
      }
    };

    const tick = async () => {
      if (!alive) return;
      if (!pollWhenHidden && document.visibilityState === "hidden") return;
      inflight?.abort();
      const ctrl = new AbortController();
      inflight = ctrl;
      const startedAt = performance.now();
      try {
        const v = await fnRef.current(ctrl.signal);
        if (!alive) return;
        // Completed → a real latency sample, even if a newer tick superseded
        // us in the meantime (we still got the response time).
        recordSample(performance.now() - startedAt, false);
        if (ctrl.signal.aborted) return;
        // startTransition marks these as non-urgent so React can interrupt
        // the resulting render commit to handle user input (typing in a
        // modal, palette search) ahead of the polling update. Polling is
        // background work; keystrokes are not. (THI-138)
        startTransition(() => {
          setData(v);
          setError(null);
          setConsecutiveErrors(0);
        });
      } catch (e) {
        if (!alive) return;
        const err = e as Error;
        if (err.name === "AbortError") {
          // Aborted while still mounted → superseded by the next tick before
          // completing, i.e. we're polling faster than the backend answers.
          // (Unmount/re-key sets alive=false first, so it's excluded above.)
          recordSample(null, true);
          return;
        }
        if (ctrl.signal.aborted) return;
        startTransition(() => {
          setError(err);
          setConsecutiveErrors((n) => n + 1);
        });
      } finally {
        if (inflight === ctrl) inflight = null;
      }
    };
    tickRef.current = tick;
    void tick();
    const id = window.setInterval(() => void tick(), ms);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      inflight?.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms, pollWhenHidden]);

  return { data, error, consecutiveErrors, degraded, refresh: () => void tickRef.current() };
}
