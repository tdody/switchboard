import { useSyncExternalStore } from "react";

/**
 * Client-side user preferences, persisted to localStorage.
 *
 * Backed by a tiny external store so every `useSettings()` consumer stays in
 * sync when any of them calls `updateSettings()` — no context provider needed.
 *
 * App.tsx applies theme / accent / density / reduced-motion to <html> on every
 * change; the Settings modal's Appearance section is the UI for them.
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
  pollIntervalMs: number;
  wsStreamEnabled: boolean;
  notifyBadge: boolean;
  notifyBrowser: boolean;
  /** xterm.js font size for the terminal modal, in px. Zoomed via THI-102. */
  terminalFontSize: number;
}

// OKLCH lightness/chroma/hue for each accent preset.
export const ACCENT_TOKENS: Record<Accent, { l: number; c: number; h: number }> = {
  aurora: { l: 0.78, c: 0.13, h: 145 },
  amber: { l: 0.8, c: 0.14, h: 80 },
  sky: { l: 0.74, c: 0.13, h: 240 },
  magenta: { l: 0.72, c: 0.16, h: 330 },
  lilac: { l: 0.74, c: 0.12, h: 295 },
};

/** The accent's base OKLCH color — handy for rendering swatches. */
export function accentColor(accent: Accent): string {
  const t = ACCENT_TOKENS[accent] ?? ACCENT_TOKENS.aurora;
  return `oklch(${t.l} ${t.c} ${t.h})`;
}

/** Write the chosen accent to the --accent* CSS vars on <html>. */
export function applyAccent(accent: Accent): void {
  const t = ACCENT_TOKENS[accent] ?? ACCENT_TOKENS.aurora;
  const root = document.documentElement;
  root.style.setProperty("--accent", `oklch(${t.l} ${t.c} ${t.h})`);
  root.style.setProperty("--accent-soft", `oklch(${t.l} ${t.c} ${t.h} / 0.16)`);
  root.style.setProperty("--accent-edge", `oklch(${t.l} ${t.c} ${t.h} / 0.55)`);
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: "aurora",
  density: "comfy",
  layout: "kanban",
  // Honor the OS preference out of the box; the user can still override it.
  reducedMotion: prefersReducedMotion(),
  pollIntervalMs: 3000,
  wsStreamEnabled: true,
  notifyBadge: true,
  notifyBrowser: false,
  terminalFontSize: 13,
};

export const POLL_MIN_S = 1;
export const POLL_MAX_S = 30;

/** Terminal-modal zoom bounds (px); default is `DEFAULT_SETTINGS.terminalFontSize`. */
export const TERM_FONT_MIN = 8;
export const TERM_FONT_MAX = 32;
export const TERM_FONT_DEFAULT = 13;

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
