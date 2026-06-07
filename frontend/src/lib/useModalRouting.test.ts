import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useModalRouting } from "./useModalRouting";

describe("useModalRouting", () => {
  it("starts with every flag closed and anyOpen=false", () => {
    const { result } = renderHook(() => useModalRouting());
    const { flags, anyOpen } = result.current;
    expect(anyOpen).toBe(false);
    expect(flags.settings).toBe(false);
    expect(flags.cleanup).toBe(false);
    expect(flags.shortcuts).toBe(false);
    expect(flags.search).toBe(false);
    expect(flags.templates).toBe(false);
    expect(flags.docs).toBe(false);
    expect(flags.newSession).toBe(false);
    expect(flags.paletteTargetId).toBeNull();
    expect(flags.broadcastTargetIds).toBeNull();
    expect(flags.renameTargetId).toBeNull();
    expect(flags.newWindowSession).toBeNull();
    expect(flags.renameSessionTarget).toBeNull();
    expect(flags.autoRenameSession).toBeNull();
    expect(flags.confirm).toBeNull();
  });

  it("flipping any boolean flips anyOpen to true", () => {
    const { result } = renderHook(() => useModalRouting());
    act(() => result.current.setters.setSearch(true));
    expect(result.current.flags.search).toBe(true);
    expect(result.current.anyOpen).toBe(true);
    act(() => result.current.setters.setSearch(false));
    expect(result.current.anyOpen).toBe(false);
  });

  it("setting any target id flips anyOpen to true", () => {
    const { result } = renderHook(() => useModalRouting());
    act(() => result.current.setters.setPaletteTargetId("%1"));
    expect(result.current.flags.paletteTargetId).toBe("%1");
    expect(result.current.anyOpen).toBe(true);
    act(() => result.current.setters.setPaletteTargetId(null));
    expect(result.current.anyOpen).toBe(false);
  });

  it("setting confirm flips anyOpen to true", () => {
    const { result } = renderHook(() => useModalRouting());
    const confirmState = {
      title: "Kill window",
      message: "Are you sure?",
      confirmLabel: "Kill",
      onConfirm: async () => {},
    };
    act(() => result.current.setters.setConfirm(confirmState));
    expect(result.current.flags.confirm).toBe(confirmState);
    expect(result.current.anyOpen).toBe(true);
  });

  it("closeAll resets every flag in one call", () => {
    const { result } = renderHook(() => useModalRouting());
    act(() => {
      result.current.setters.setSettings(true);
      result.current.setters.setSearch(true);
      result.current.setters.setPaletteTargetId("%1");
      result.current.setters.setBroadcastTargetIds(["%1", "%2"]);
      result.current.setters.setConfirm({
        title: "x",
        message: "y",
        confirmLabel: "z",
        onConfirm: async () => {},
      });
    });
    expect(result.current.anyOpen).toBe(true);

    act(() => result.current.closeAll());
    expect(result.current.anyOpen).toBe(false);
    expect(result.current.flags.settings).toBe(false);
    expect(result.current.flags.search).toBe(false);
    expect(result.current.flags.paletteTargetId).toBeNull();
    expect(result.current.flags.broadcastTargetIds).toBeNull();
    expect(result.current.flags.confirm).toBeNull();
  });

  it("setters object is referentially stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useModalRouting());
    const first = result.current.setters;
    act(() => result.current.setters.setSearch(true));
    rerender();
    expect(result.current.setters).toBe(first);
  });

  it("anyOpen stays true while ANY single flag is open", () => {
    const { result } = renderHook(() => useModalRouting());
    act(() => {
      result.current.setters.setSettings(true);
      result.current.setters.setSearch(true);
    });
    expect(result.current.anyOpen).toBe(true);
    act(() => result.current.setters.setSettings(false));
    expect(result.current.anyOpen).toBe(true); // search still open
    act(() => result.current.setters.setSearch(false));
    expect(result.current.anyOpen).toBe(false);
  });
});
