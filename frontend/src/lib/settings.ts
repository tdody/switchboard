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
/** THI-246: "split" is the 4th display type — persistent rail + detail
 *  workspace. It's a peer of Kanban/Grid/List, not a replacement. */
export type Layout = "kanban" | "grid" | "list" | "split";
export type ColumnSize = "narrow" | "normal" | "wide";
/** Ordered narrow → normal → wide so +/- controls can step linearly (THI-128). */
export const COLUMN_SIZE_ORDER: readonly ColumnSize[] = ["narrow", "normal", "wide"];

export interface Settings {
  theme: Theme;
  accent: Accent;
  density: Density;
  layout: Layout;
  /** Kanban column width (THI-128). Orthogonal to `density`. */
  columnSize: ColumnSize;
  reducedMotion: boolean;
  pollIntervalMs: number;
  wsStreamEnabled: boolean;
  notifyBadge: boolean;
  notifyBrowser: boolean;
  /** xterm.js font size for the terminal modal, in px. Zoomed via THI-102. */
  terminalFontSize: number;
  /** User-picked IDE for "Open in IDE" (THI-146 PR 4). Empty string ⇒ use
   *  the server's default (env-var or first probed). The Settings dropdown
   *  writes this; TerminalModal reads it and forwards as `ide=` to /api/open. */
  selectedIde: string;
  /** Threshold for "Clean up idle panes…" in days. 0 hides the action.
   *  Default 7. Stored as a number; clamped at the UI layer (0–365). */
  idleCleanupDays: number;
  /** THI-246: which pane the Split view's detail pane shows. Empty string
   *  ⇒ no selection yet. Persisted so a reload restores the last selection. */
  selectedPaneId: string;
  /** THI-246: width of the Split view's rail in pixels. Clamped 200–460 at
   *  the UI layer. The divider's drag-handle updates this. */
  splitRailWidth: number;
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

/**
 * Theme-aware per-accent tuning. Inline styles written here ALWAYS win
 * over `[data-theme="…"]` declarations in styles.css, so the per-theme
 * accent-edge / accent-soft variants must live here — the CSS rules
 * would be shadowed otherwise.
 *
 * - `lDelta`: shift the OKLCH lightness so the accent reads on the
 *   theme's surface. Light mode darkens to ≈0.455 (4.5:1 vs --panel
 *   for focus ring composites, per THI-151).
 * - `edgeAlpha` / `softAlpha`: the `--accent-edge` / `--accent-soft`
 *   opacities. Light bumps both so focus rings and selection bands
 *   clear their respective WCAG floors on near-white surfaces.
 */
const THEME_ACCENT_TUNING: Record<
  Theme,
  { lDelta: number; edgeAlpha: number; softAlpha: number }
> = {
  // THI-151 (edge): 0.55 alpha gave a 2.58:1 focus-ring composite on
  // white; 0.70 lands at 3.52:1. THI-155 (soft): 0.16 alpha gave a
  // 1.27:1 selection composite on white; 0.30 lands at 1.34:1. The
  // L darkening also helps text/icon legibility on light surfaces.
  light: { lDelta: -0.325, edgeAlpha: 0.7, softAlpha: 0.3 },
  // High-contrast bumps soft alpha so the ::selection band clears the
  // visibility floor on the theme's pure-black bg-elev (THI-155).
  contrast: { lDelta: 0, edgeAlpha: 0.55, softAlpha: 0.3 },
  dark: { lDelta: 0, edgeAlpha: 0.55, softAlpha: 0.16 },
  phosphor: { lDelta: 0, edgeAlpha: 0.55, softAlpha: 0.16 },
};

/** Write the chosen accent (with theme-aware tuning) to the --accent* CSS vars on <html>. */
export function applyAccent(accent: Accent, theme: Theme = "dark"): void {
  const t = ACCENT_TOKENS[accent] ?? ACCENT_TOKENS.aurora;
  const o = THEME_ACCENT_TUNING[theme] ?? THEME_ACCENT_TUNING.dark;
  const L = Math.max(0.1, Math.min(0.95, t.l + o.lDelta));
  const root = document.documentElement;
  root.style.setProperty("--accent", `oklch(${L} ${t.c} ${t.h})`);
  root.style.setProperty("--accent-soft", `oklch(${L} ${t.c} ${t.h} / ${o.softAlpha})`);
  root.style.setProperty("--accent-edge", `oklch(${L} ${t.c} ${t.h} / ${o.edgeAlpha})`);
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
  columnSize: "normal",
  // Honor the OS preference out of the box; the user can still override it.
  reducedMotion: prefersReducedMotion(),
  pollIntervalMs: 3000,
  wsStreamEnabled: true,
  notifyBadge: true,
  notifyBrowser: false,
  terminalFontSize: 13,
  selectedIde: "",
  idleCleanupDays: 7,
  selectedPaneId: "",
  splitRailWidth: 280,
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

/**
 * Selector hook (THI-186). Subscribes to a single Settings field; `Object.is`
 * comparison inside `useSyncExternalStore` short-circuits the re-render when
 * the selected field is unchanged, so a `updateSettings({ theme: "light" })`
 * does not re-render consumers of unrelated keys (`pollIntervalMs`,
 * `density`, etc.).
 *
 * Prefer this over `useSettings()` when a component only needs a handful of
 * specific fields. `useSettings()` stays available for backward compat with
 * callers that read most of the object at once.
 */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useSyncExternalStore(
    subscribe,
    () => current[key],
    () => current[key],
  );
}
