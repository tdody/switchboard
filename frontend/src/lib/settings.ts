import { useSyncExternalStore } from "react";

/**
 * Client-side user preferences, persisted to localStorage.
 *
 * Backed by a tiny external store so every `useSettings()` consumer stays in
 * sync when any of them calls `updateSettings()` — no context provider needed.
 *
 * Most keys (theme/accent/density/layout/reducedMotion) have no UI control
 * yet; THI-62/63/64/70 add those rows to the Settings modal. The store + the
 * apply-on-init wiring already exist, so those tickets are control-only.
 */

export type Theme = "dark" | "light" | "contrast" | "phosphor";
export type Accent = "aurora" | "amber" | "sky" | "magenta" | "lilac";
export type Density = "compact" | "comfy" | "preview";
export type Layout = "kanban" | "grid" | "list";

export interface Settings {
  theme: Theme;
  accent: Accent;
  density: Density;
  layout: Layout;
  reducedMotion: boolean;
  showPreviews: boolean;
  pollIntervalMs: number;
  wsStreamEnabled: boolean;
  notifyBadge: boolean;
  notifyBrowser: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: "aurora",
  density: "comfy",
  layout: "kanban",
  reducedMotion: false,
  showPreviews: false,
  pollIntervalMs: 3000,
  wsStreamEnabled: true,
  notifyBadge: true,
  notifyBrowser: false,
};

export const POLL_MIN_S = 1;
export const POLL_MAX_S = 30;

const STORAGE_KEY = "switchboard:settings";

function load(): Settings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      // Merge over defaults so a newly-added key is filled in for old clients.
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    }
  } catch {
    /* corrupt or unavailable storage — fall through to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

let current: Settings = load();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable (private mode / SSR) — keep the in-memory value */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
