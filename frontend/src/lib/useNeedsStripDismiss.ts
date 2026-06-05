import { useCallback, useEffect, useMemo, useState } from "react";

import type { Window } from "../types";

/**
 * THI-89: track which pending panes the user has already dismissed in the
 * NeedsStrip, persist that set per-tab via sessionStorage, and re-show the
 * strip when a NEW pending pane appears (one not in the dismissed set).
 *
 * GC: when a previously-dismissed pane is no longer pending, drop its id from
 * the set so that pane becoming pending again later counts as "new" and
 * surfaces in the strip again.
 */

const STORAGE_KEY = "switchboard:needsStrip:dismissed";

function load(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function save(ids: Set<string>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode / quota — keep the in-memory value */
  }
}

export function useNeedsStripDismiss(pendingWindows: Window[]): {
  visibleWindows: Window[];
  dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState<Set<string>>(load);

  // GC stale ids: a pane that was dismissed but is no longer pending should
  // drop out of the set so a future re-pend on the same pane is treated as
  // new. Runs whenever the pending list changes.
  useEffect(() => {
    const pendingIds = new Set(pendingWindows.map((w) => w.paneId));
    setDismissed((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (pendingIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [pendingWindows]);

  // Persist on every change so a reload picks the latest set back up.
  useEffect(() => {
    save(dismissed);
  }, [dismissed]);

  const visibleWindows = useMemo(
    () => pendingWindows.filter((w) => !dismissed.has(w.paneId)),
    [pendingWindows, dismissed],
  );

  const dismiss = useCallback(() => {
    setDismissed(new Set(pendingWindows.map((w) => w.paneId)));
  }, [pendingWindows]);

  return { visibleWindows, dismiss };
}
