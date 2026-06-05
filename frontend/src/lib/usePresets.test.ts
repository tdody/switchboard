import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { type FilterPreset, usePresets } from "./usePresets";

const STORAGE_KEY = "switchboard:presets";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

const sample: FilterPreset = {
  name: "Stuck agents",
  filter: "waiting",
  kind: "agent",
  query: "",
};

describe("usePresets", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => usePresets());
    expect(result.current.presets).toEqual([]);
  });

  it("savePreset adds a new preset; persists to localStorage", () => {
    const { result } = renderHook(() => usePresets());
    act(() => result.current.savePreset(sample));

    expect(result.current.presets).toEqual([sample]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual([sample]);
  });

  it("savePreset with an existing name overwrites the prior version", () => {
    const { result } = renderHook(() => usePresets());
    act(() => result.current.savePreset(sample));
    act(() =>
      result.current.savePreset({ ...sample, kind: "shell", query: "branch:x" }),
    );

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0].kind).toBe("shell");
    expect(result.current.presets[0].query).toBe("branch:x");
  });

  it("deletePreset removes by name", () => {
    const { result } = renderHook(() => usePresets());
    act(() => result.current.savePreset(sample));
    act(() => result.current.savePreset({ ...sample, name: "Other" }));
    expect(result.current.presets).toHaveLength(2);

    act(() => result.current.deletePreset("Stuck agents"));
    expect(result.current.presets.map((p) => p.name)).toEqual(["Other"]);
  });

  it("hydrates from localStorage on mount", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([sample]));
    const { result } = renderHook(() => usePresets());
    expect(result.current.presets).toEqual([sample]);
  });

  it("ignores corrupt or wrong-shape localStorage entries", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    let r = renderHook(() => usePresets());
    expect(r.result.current.presets).toEqual([]);
    r.unmount();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));
    r = renderHook(() => usePresets());
    expect(r.result.current.presets).toEqual([]);
  });
});
