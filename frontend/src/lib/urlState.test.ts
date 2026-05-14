import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useURLParam } from "./urlState";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("useURLParam", () => {
  it("returns the default when the param is absent", () => {
    const { result } = renderHook(() => useURLParam("filter", "all"));
    expect(result.current[0]).toBe("all");
  });

  it("reads an existing param from the URL", () => {
    window.history.replaceState({}, "", "/?filter=waiting");
    const { result } = renderHook(() => useURLParam("filter", "all"));
    expect(result.current[0]).toBe("waiting");
  });

  it("update() writes to both state and the URL", () => {
    const { result } = renderHook(() => useURLParam("q", ""));
    act(() => result.current[1]("kind:agent"));
    expect(result.current[0]).toBe("kind:agent");
    expect(new URLSearchParams(window.location.search).get("q")).toBe("kind:agent");
  });

  it("setting the value back to the default drops the param from the URL", () => {
    window.history.replaceState({}, "", "/?filter=waiting");
    const { result } = renderHook(() => useURLParam("filter", "all"));
    act(() => result.current[1]("all"));
    expect(window.location.search).toBe("");
  });

  it("syncs on popstate (browser back/forward)", () => {
    const { result } = renderHook(() => useURLParam("open", ""));
    act(() => {
      window.history.pushState({}, "", "/?open=abc");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("abc");
  });
});
