import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Tooltip } from "./Tooltip";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Tooltip", () => {
  it("renders the child untouched and shows nothing before hover", () => {
    render(
      <Tooltip content="Focus window">
        <button>focus</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "focus" })).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the tooltip after the hover delay elapses", () => {
    render(
      <Tooltip content="Focus window">
        <button>focus</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    // Pre-delay: nothing yet.
    advance(300);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // Past delay: tooltip appears.
    advance(200);
    expect(screen.getByRole("tooltip").textContent).toContain("Focus window");
  });

  it("does NOT show the tooltip if the mouse leaves before the delay", () => {
    render(
      <Tooltip content="Focus window">
        <button>focus</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button");
    fireEvent.mouseEnter(btn);
    advance(200);
    fireEvent.mouseLeave(btn);
    advance(500);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("hides the tooltip immediately on mouseleave after it has appeared", () => {
    render(
      <Tooltip content="Focus window">
        <button>focus</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button");
    fireEvent.mouseEnter(btn);
    advance(500);
    expect(screen.queryByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("wires aria-describedby on the child to the tooltip's id only while visible", () => {
    render(
      <Tooltip content="Focus window">
        <button>focus</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-describedby")).toBeFalsy();
    fireEvent.mouseEnter(btn);
    advance(500);
    const tip = screen.getByRole("tooltip");
    expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.mouseLeave(btn);
    expect(btn.getAttribute("aria-describedby")).toBeFalsy();
  });

  it("opens on focus and closes on blur for keyboard users", () => {
    render(
      <Tooltip content="Focus window">
        <button>focus</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button");
    fireEvent.focus(btn);
    advance(500);
    expect(screen.queryByRole("tooltip")).toBeTruthy();
    fireEvent.blur(btn);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("renders the keyboard shortcut chip when `shortcut` is provided", () => {
    render(
      <Tooltip content="Help" shortcut="?">
        <button>help</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    advance(500);
    const tip = screen.getByRole("tooltip");
    const kbd = tip.querySelector(".kbd");
    expect(kbd).toBeTruthy();
    expect(kbd?.textContent).toBe("?");
  });

  it("calls the child's existing onMouseEnter and onMouseLeave through", () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    render(
      <Tooltip content="x">
        <button onMouseEnter={onEnter} onMouseLeave={onLeave}>
          hi
        </button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button");
    fireEvent.mouseEnter(btn);
    expect(onEnter).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(btn);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("renders the child verbatim when `disabled` is true (no tooltip ever shows)", () => {
    render(
      <Tooltip content="should not appear" disabled>
        <button>x</button>
      </Tooltip>,
    );
    const btn = screen.getByRole("button");
    fireEvent.mouseEnter(btn);
    advance(1000);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(btn.getAttribute("aria-describedby")).toBeFalsy();
  });
});
