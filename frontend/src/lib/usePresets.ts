import { useCallback, useEffect, useState } from "react";

import type { KindFilter, StatusFilter } from "./filter";

/**
 * THI-98: saved-filter presets. A preset captures the four user-facing
 * filter dimensions — status, kind chip, free-text query — under a name,
 * so workflows like "Stuck agents" or "Dev stack" can be one click away.
 *
 * Stored as a JSON array of `FilterPreset` in localStorage. Re-saving with
 * an existing name overwrites in place (acts as edit-in-place).
 */

const STORAGE_KEY = "switchboard:presets";

export interface FilterPreset {
  name: string;
  filter: StatusFilter;
  kind: KindFilter;
  query: string;
}

const STATUS_VALUES: StatusFilter[] = ["all", "waiting", "running", "idle"];
const KIND_VALUES: KindFilter[] = ["", "agent", "shell"];

function isPreset(x: unknown): x is FilterPreset {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.query === "string" &&
    STATUS_VALUES.includes(o.filter as StatusFilter) &&
    KIND_VALUES.includes(o.kind as KindFilter)
  );
}

function load(): FilterPreset[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPreset);
  } catch {
    return [];
  }
}

function save(presets: FilterPreset[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    /* quota / private mode — keep in-memory */
  }
}

export function usePresets(): {
  presets: FilterPreset[];
  savePreset: (p: FilterPreset) => void;
  deletePreset: (name: string) => void;
} {
  const [presets, setPresets] = useState<FilterPreset[]>(load);

  useEffect(() => {
    save(presets);
  }, [presets]);

  const savePresetFn = useCallback((p: FilterPreset) => {
    setPresets((prev) => {
      const i = prev.findIndex((x) => x.name === p.name);
      if (i === -1) return [...prev, p];
      const next = prev.slice();
      next[i] = p;
      return next;
    });
  }, []);

  const deletePreset = useCallback((name: string) => {
    setPresets((prev) => prev.filter((p) => p.name !== name));
  }, []);

  return { presets, savePreset: savePresetFn, deletePreset };
}
