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
 *  "Replay tour" button in Settings. */
export function resetTour(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* same — best effort */
  }
}
