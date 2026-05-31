/**
 * First-run tour dismissed-state, persisted to localStorage (THI-96).
 *
 * The `v1` in the key lets us bump to `v2` when the tour content materially
 * changes — users who already saw `v1` will see `v2` once, then never again.
 * Pure storage helpers; the rendering logic lives in `components/Tour.tsx`.
 */

const STORAGE_KEY = "switchboard:tour:v1:dismissed";

export function isTourDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTourDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* storage unavailable — fine, just means the tour will re-show */
  }
}

/** Clear the dismissed flag so the next mount re-shows the tour. Powers the
 *  "Replay tour" button in Settings + DocsModal. Prefer `replayTour` for the
 *  end-user flow — this is the pure storage primitive, used directly only by
 *  tests that don't want a page reload as a side effect. */
export function resetTour(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* same — best effort */
  }
}

/** Clear the dismissed flag AND reload the page so the tour appears
 *  immediately. The `Tour` component reads `isTourDismissed()` once at mount
 *  time, so simply clearing the flag from a button handler isn't enough —
 *  the user would have to manually reload. This wraps the two-step into a
 *  single user-visible "Replay tour" action shared by Settings and DocsModal.
 *  Tests stub `location.reload` to verify intent without actually navigating. */
export function replayTour(): void {
  resetTour();
  // `location.reload` is synchronous from the script's POV — anything after
  // this line is dead code in production, so don't try to schedule cleanup.
  if (typeof window !== "undefined") window.location.reload();
}
