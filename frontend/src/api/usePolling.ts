import { startTransition, useEffect, useRef, useState } from "react";

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  consecutiveErrors: number;
  refresh: () => void;
}

/**
 * Visibility-aware polling hook with in-flight cancellation.
 *
 * - Skips ticks when the document is hidden, immediately re-fires on
 *   visibility-return.
 * - Aborts any in-flight request before issuing a new one so a hung backend
 *   can't pile up a backlog of stacked fetches.
 * - `fn` receives an AbortSignal; pass it through to `fetch(..., { signal })`.
 */
export function usePolling<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    let inflight: AbortController | null = null;

    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "hidden") return;
      inflight?.abort();
      const ctrl = new AbortController();
      inflight = ctrl;
      try {
        const v = await fnRef.current(ctrl.signal);
        if (!alive || ctrl.signal.aborted) return;
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
        if (!alive || ctrl.signal.aborted) return;
        const err = e as Error;
        if (err.name === "AbortError") return;
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
  }, [ms]);

  return { data, error, consecutiveErrors, refresh: () => void tickRef.current() };
}
