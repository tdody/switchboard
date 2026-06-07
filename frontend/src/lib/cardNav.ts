import type { Session, Window } from "../types";
import { sortPendingFirst } from "./filter";

/**
 * Build the per-column ordered list of visible windows.
 *
 * Mirrors the sort applied inside the Kanban so arrow-key navigation matches
 * what the user sees on screen. THI-209: when `pinnedPaneIds` or `windowOrder`
 * are provided, the same `[...pinned, ...drag]` shape Kanban renders is used
 * here — without it, nav would skip / revisit cards whenever the user pinned
 * a pane or drag-reordered tiles.
 *
 * `windowOrder` is the per-session pin-order map used by THI-141 drag-reorder
 * (`Record<sessionId, paneId[]>`). `pinnedPaneIds` outrank drag-order — the
 * comparator's Map de-dupes, so a pane in both arrays takes its pinned-section
 * index (always lower).
 */
export function columnsForNav(
  sessions: Session[],
  windows: Window[],
  options: {
    pinnedPaneIds?: ReadonlySet<string>;
    windowOrder?: Readonly<Record<string, readonly string[]>>;
  } = {},
): { sessionId: string; windows: Window[] }[] {
  const { pinnedPaneIds, windowOrder } = options;
  const sortOrderFor = (sessionId: string): string[] | undefined => {
    const drag = windowOrder?.[sessionId];
    if (!pinnedPaneIds || pinnedPaneIds.size === 0) {
      return drag ? [...drag] : undefined;
    }
    return [...pinnedPaneIds, ...(drag ?? [])];
  };
  return sessions.map((s) => ({
    sessionId: s.id,
    windows: sortPendingFirst(
      windows.filter((w) => w.session === s.id),
      sortOrderFor(s.id),
    ),
  }));
}

export type NavDirection = "up" | "down" | "left" | "right";

/**
 * Given the current highlighted card and a direction, find the next card to
 * highlight. Up/down moves within a column; left/right moves between columns
 * landing on the same vertical index (clamped to the new column's length).
 *
 * Empty columns are skipped on horizontal moves. Returns `null` if no move
 * possible (e.g. left from the first non-empty column).
 */
export function navigateCard(
  cols: { sessionId: string; windows: Window[] }[],
  currentId: string | null,
  dir: NavDirection,
): Window | null {
  const populated = cols.filter((c) => c.windows.length > 0);
  if (populated.length === 0) return null;

  // No current selection — pick the first card of the first populated column.
  if (!currentId) return populated[0].windows[0] ?? null;

  // Find current position. `currentId` is a stable paneId.
  let colIdx = -1;
  let rowIdx = -1;
  for (let i = 0; i < populated.length; i++) {
    const found = populated[i].windows.findIndex((w) => w.paneId === currentId);
    if (found >= 0) {
      colIdx = i;
      rowIdx = found;
      break;
    }
  }
  // Current id isn't on screen — fall back to first card
  if (colIdx < 0) return populated[0].windows[0] ?? null;

  if (dir === "up") {
    const next = populated[colIdx].windows[rowIdx - 1];
    return next ?? populated[colIdx].windows[rowIdx];
  }
  if (dir === "down") {
    const next = populated[colIdx].windows[rowIdx + 1];
    return next ?? populated[colIdx].windows[rowIdx];
  }
  if (dir === "left") {
    if (colIdx === 0) return null;
    const target = populated[colIdx - 1];
    return target.windows[Math.min(rowIdx, target.windows.length - 1)];
  }
  // right
  if (colIdx === populated.length - 1) return null;
  const target = populated[colIdx + 1];
  return target.windows[Math.min(rowIdx, target.windows.length - 1)];
}
