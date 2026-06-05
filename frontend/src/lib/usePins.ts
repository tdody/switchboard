import { useCallback, useEffect, useState } from "react";

/**
 * THI-98: pinned-pane tracking. A pinned pane:
 *   - Stays visible across filter changes (App overlays it on `applyFilter`).
 *   - Sorts to the top of its column (Kanban sort).
 *   - Renders a small pin glyph in the card header.
 *
 * Persisted to localStorage as a JSON array of `pane_id` strings, so the
 * pin sticks across reloads. Keyed by `pane_id` (THI-92's stable identifier)
 * so renames and reordering don't dislodge the pin.
 */

const STORAGE_KEY = "switchboard:pins";

function load(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function save(ids: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode / quota — keep the in-memory value */
  }
}

export function usePins(): {
  pinnedIds: Set<string>;
  isPinned: (paneId: string) => boolean;
  togglePin: (paneId: string) => void;
} {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(load);

  useEffect(() => {
    save(pinnedIds);
  }, [pinnedIds]);

  const isPinned = useCallback(
    (paneId: string) => pinnedIds.has(paneId),
    [pinnedIds],
  );

  const togglePin = useCallback((paneId: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(paneId)) next.delete(paneId);
      else next.add(paneId);
      return next;
    });
  }, []);

  return { pinnedIds, isPinned, togglePin };
}
