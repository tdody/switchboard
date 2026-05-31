import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInputActive } from "./useInputActive";

describe("useInputActive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fireKeydownOn(target: EventTarget): void {
    const ev = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ev, "target", { value: target, writable: false });
    target.dispatchEvent(ev);
  }

  it("starts inactive and stays inactive until a keydown lands on a typing target", () => {
    const { result } = renderHook(() => useInputActive(800));
    expect(result.current).toBe(false);
    // A non-typing target (e.g. a button) should not flip the flag.
    const button = document.createElement("button");
    document.body.appendChild(button);
    act(() => fireKeydownOn(button));
    expect(result.current).toBe(false);
    button.remove();
  });

  it("flips true on keydown into an <input type='text'> and decays after the timeout", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    const { result } = renderHook(() => useInputActive(800));
    expect(result.current).toBe(false);

    act(() => fireKeydownOn(input));
    expect(result.current).toBe(true);

    // Halfway through the decay — should still be active.
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe(true);

    // Past the decay — should flip back to false.
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(false);

    input.remove();
  });

  it("resets the decay timer on each keystroke (sustained typing keeps it high)", () => {
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);

    const { result } = renderHook(() => useInputActive(800));

    act(() => fireKeydownOn(input));
    expect(result.current).toBe(true);

    // Mid-typing: another key lands before the decay completes. The timer
    // should reset, keeping the flag high.
    act(() => vi.advanceTimersByTime(500));
    act(() => fireKeydownOn(input));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(true);

    // Past the new decay — flips back.
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe(false);

    input.remove();
  });

  it("flips true for <textarea>, ignores non-text input types like checkbox", () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    document.body.appendChild(checkbox);

    const { result } = renderHook(() => useInputActive(800));

    act(() => fireKeydownOn(checkbox));
    expect(result.current).toBe(false);

    act(() => fireKeydownOn(textarea));
    expect(result.current).toBe(true);

    textarea.remove();
    checkbox.remove();
  });

  it("ignores keystrokes on xterm's helper textarea (pane typing doesn't lag React)", () => {
    // xterm's hidden helper textarea sits inside `.xterm`. The hook
    // should NOT flip active for those — backing off the cadence every
    // time the user touches the terminal would defeat the modal-open
    // tier entirely.
    const xterm = document.createElement("div");
    xterm.className = "xterm";
    const helper = document.createElement("textarea");
    helper.className = "xterm-helper-textarea";
    xterm.appendChild(helper);
    document.body.appendChild(xterm);

    const { result } = renderHook(() => useInputActive(800));
    act(() => fireKeydownOn(helper));
    expect(result.current).toBe(false);

    xterm.remove();
  });
});
