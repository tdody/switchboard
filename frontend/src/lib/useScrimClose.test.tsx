import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScrimClose } from "./useScrimClose";

// React's mouse-event types include lots of fields; only currentTarget /
// target matter here. Build the minimum needed and cast.
function ev(target: object, currentTarget: object): React.MouseEvent {
  return { target, currentTarget } as unknown as React.MouseEvent;
}

describe("useScrimClose", () => {
  it("closes when mousedown AND mouseup both land on the scrim", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useScrimClose(onClose));
    const scrim = {};
    result.current.onMouseDown(ev(scrim, scrim));
    result.current.onMouseUp(ev(scrim, scrim));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when mousedown is inside the modal and mouseup drifts to the scrim (THI-125)", () => {
    // This is the bug: drag-to-select a terminal scrollback line, release
    // outside the modal — the scrim's mouseup fires but the press never
    // intended to close.
    const onClose = vi.fn();
    const { result } = renderHook(() => useScrimClose(onClose));
    const scrim = {};
    const modal = {};
    result.current.onMouseDown(ev(modal, scrim));
    result.current.onMouseUp(ev(scrim, scrim));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does NOT close when mousedown is on the scrim but mouseup drifts onto the modal", () => {
    // The inverse drag: pressed on the backdrop, dragged into the modal.
    // Treat as "the user didn't release on empty space" → keep modal open.
    const onClose = vi.fn();
    const { result } = renderHook(() => useScrimClose(onClose));
    const scrim = {};
    const modal = {};
    result.current.onMouseDown(ev(scrim, scrim));
    result.current.onMouseUp(ev(modal, scrim));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a stray mouseup with no prior mousedown (e.g. the click that opened the modal)", () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => useScrimClose(onClose));
    const scrim = {};
    result.current.onMouseUp(ev(scrim, scrim));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets the latch between gestures", () => {
    // Gesture 1: drag inside-to-scrim — shouldn't close. Gesture 2: press
    // and release on scrim — should close. The first must not poison the
    // second.
    const onClose = vi.fn();
    const { result } = renderHook(() => useScrimClose(onClose));
    const scrim = {};
    const modal = {};
    result.current.onMouseDown(ev(modal, scrim));
    result.current.onMouseUp(ev(scrim, scrim));
    expect(onClose).not.toHaveBeenCalled();
    result.current.onMouseDown(ev(scrim, scrim));
    result.current.onMouseUp(ev(scrim, scrim));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
