import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { usePins } from "./usePins";

const STORAGE_KEY = "switchboard:pins";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("usePins", () => {
  it("starts with nothing pinned", () => {
    const { result } = renderHook(() => usePins());
    expect(result.current.pinnedIds.size).toBe(0);
    expect(result.current.isPinned("%1")).toBe(false);
  });

  it("toggle pins and unpins a pane id", () => {
    const { result } = renderHook(() => usePins());

    act(() => result.current.togglePin("%1"));
    expect(result.current.isPinned("%1")).toBe(true);

    act(() => result.current.togglePin("%1"));
    expect(result.current.isPinned("%1")).toBe(false);
  });

  it("persists pinned ids to localStorage", () => {
    const { result } = renderHook(() => usePins());
    act(() => {
      result.current.togglePin("%1");
      result.current.togglePin("%2");
    });
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).sort()).toEqual(["%1", "%2"]);
  });

  it("hydrates from localStorage on mount", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["%a", "%b"]));
    const { result } = renderHook(() => usePins());
    expect(result.current.isPinned("%a")).toBe(true);
    expect(result.current.isPinned("%b")).toBe(true);
    expect(result.current.pinnedIds.size).toBe(2);
  });

  it("tolerates corrupt localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    const { result } = renderHook(() => usePins());
    expect(result.current.pinnedIds.size).toBe(0);
  });
});
