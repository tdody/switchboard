import { useCallback, useEffect, useState } from "react";

/**
 * Two-way binding between a URL query param and React state.
 *
 * Updates push to window.history (no full reload) so back/forward navigates
 * between states. A popstate listener keeps in-memory state in sync if the
 * user hits the browser back button.
 */
export function useURLParam(
  key: string,
  defaultValue: string,
): [string, (next: string) => void] {
  const read = useCallback(() => {
    if (typeof window === "undefined") return defaultValue;
    return new URLSearchParams(window.location.search).get(key) ?? defaultValue;
  }, [key, defaultValue]);

  const [value, setValue] = useState<string>(read);

  useEffect(() => {
    const onPop = () => setValue(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [read]);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      const url = new URL(window.location.href);
      if (next === defaultValue || next === "") url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState({}, "", url.toString());
    },
    [key, defaultValue],
  );

  return [value, update];
}
