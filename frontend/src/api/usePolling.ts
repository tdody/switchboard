import { useEffect, useRef, useState } from "react";

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  consecutiveErrors: number;
  refresh: () => void;
}

export function usePolling<T>(fn: () => Promise<T>, ms: number): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (document.visibilityState === "hidden") return;
      try {
        const v = await fnRef.current();
        if (!alive) return;
        setData(v);
        setError(null);
        setConsecutiveErrors(0);
      } catch (e) {
        if (!alive) return;
        setError(e as Error);
        setConsecutiveErrors((n) => n + 1);
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
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms]);

  return { data, error, consecutiveErrors, refresh: () => void tickRef.current() };
}
