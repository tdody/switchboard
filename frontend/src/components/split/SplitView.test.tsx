import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { SplitView } from "./SplitView";
import { DEFAULT_SETTINGS, updateSettings } from "../../lib/settings";
import { mkSession, mkWindow } from "../../test/factories";

beforeEach(() => {
  localStorage.clear();
  updateSettings(DEFAULT_SETTINGS);
});

afterEach(() => {
  cleanup();
});

const noop = vi.fn();

describe("SplitView (THI-246 PR 1)", () => {
  it("renders an empty-state hint when no panes match", () => {
    const { container } = render(
      <SplitView windows={[]} sessions={[]} onFocus={noop} />,
    );
    expect(container.querySelector(".sb-rail-empty")).not.toBeNull();
    expect(container.textContent).toMatch(/select a pane/i);
  });

  it("renders one rail row per visible window, grouped under its session", () => {
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({ paneId: "%a", session: "alpha", name: "shell" }),
          mkWindow({ paneId: "%b", session: "alpha", name: "claude" }),
          mkWindow({ paneId: "%c", session: "beta", name: "logs" }),
        ]}
        sessions={[mkSession({ id: "alpha" }), mkSession({ id: "beta" })]}
        onFocus={noop}
      />,
    );
    const paneRows = container.querySelectorAll(".sb-row.pane");
    expect(paneRows).toHaveLength(3);
    // Session headers are present too.
    const heads = container.querySelectorAll(".sb-row.sb-row-head");
    expect(heads).toHaveLength(2);
  });

  it("clicking a rail row persists the selection and swaps the detail pane", () => {
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({ paneId: "%a", session: "alpha", name: "shell" }),
        ]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    // Before click: empty-state hint visible.
    expect(container.querySelector(".sb-detail-empty")).not.toBeNull();
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sb-row.pane")!);
    expect(container.querySelector(".sb-detail-empty")).toBeNull();
    expect(container.querySelector(".sb-pane-hd")).not.toBeNull();
    // And the setting is persisted.
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).selectedPaneId,
    ).toBe("%a");
  });

  it("restores the persisted selection on mount", () => {
    updateSettings({ selectedPaneId: "%a" });
    const { container } = render(
      <SplitView
        windows={[mkWindow({ paneId: "%a", session: "alpha", name: "shell" })]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    // Detail header rendered = the pane was matched and selected on mount.
    expect(container.querySelector(".sb-pane-hd")).not.toBeNull();
    expect(container.querySelector(".sb-row.pane.sel")).not.toBeNull();
  });

  it("uses the rail-width setting for the grid template", () => {
    updateSettings({ splitRailWidth: 360 });
    const { container } = render(
      <SplitView
        windows={[mkWindow({ paneId: "%a", session: "alpha" })]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    const split = container.querySelector<HTMLDivElement>(".sb-split")!;
    expect(split.style.gridTemplateColumns).toContain("360px");
  });

  it("focus button calls onFocus when a pane is selected", () => {
    updateSettings({ selectedPaneId: "%a" });
    const onFocus = vi.fn();
    const { container } = render(
      <SplitView
        windows={[mkWindow({ paneId: "%a", session: "alpha" })]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={onFocus}
      />,
    );
    fireEvent.click(
      container.querySelector<HTMLButtonElement>(
        ".sb-pane-hd button[aria-label='Focus in tmux']",
      )!,
    );
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

describe("SplitView (THI-246 PR 2 — repos mode)", () => {
  it("groups rail rows by repo when groupingMode=repos", () => {
    updateSettings({ groupingMode: "repos" });
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({
            paneId: "%a",
            session: "alpha",
            name: "shell",
            repoKey: "/r/alpha",
            repoLabel: "alpha",
          }),
          mkWindow({
            paneId: "%b",
            session: "alpha",
            name: "claude",
            repoKey: "/r/beta",
            repoLabel: "beta",
          }),
          mkWindow({
            paneId: "%c",
            session: "beta",
            name: "logs",
            repoKey: "/r/beta",
            repoLabel: "beta",
          }),
        ]}
        sessions={[mkSession({ id: "alpha" }), mkSession({ id: "beta" })]}
        onFocus={noop}
      />,
    );
    // Two repo headers: alpha (1 pane), beta (2 panes). Session 'alpha' spans
    // both repos because pane %b lives in /r/beta even though its tmux
    // session is 'alpha' — that's the per-window bucketing rule from THI-243.
    const heads = Array.from(
      container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head .lbl"),
    ).map((el) => el.textContent);
    expect(heads).toEqual(["alpha", "beta"]);
    const counts = Array.from(
      container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head .count"),
    ).map((el) => el.textContent);
    expect(counts).toEqual(["1", "2"]);
  });

  it("shows the session chip on each pane row in repos mode (not in sessions mode)", () => {
    updateSettings({ groupingMode: "repos" });
    const { container, rerender } = render(
      <SplitView
        windows={[
          mkWindow({
            paneId: "%a",
            session: "alpha",
            name: "shell",
            repoKey: "/r/alpha",
            repoLabel: "alpha",
          }),
        ]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    expect(container.querySelector(".sb-row-session")).not.toBeNull();
    expect(container.querySelector(".sb-row-session")!.textContent).toBe("alpha");

    updateSettings({ groupingMode: "sessions" });
    rerender(
      <SplitView
        windows={[
          mkWindow({
            paneId: "%a",
            session: "alpha",
            name: "shell",
            repoKey: "/r/alpha",
            repoLabel: "alpha",
          }),
        ]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    expect(container.querySelector(".sb-row-session")).toBeNull();
  });

  it("renders the empty-state hint when repos mode has no panes", () => {
    updateSettings({ groupingMode: "repos" });
    const { container } = render(
      <SplitView windows={[]} sessions={[]} onFocus={noop} />,
    );
    expect(container.querySelector(".sb-rail-empty")).not.toBeNull();
  });
});

describe("SplitView (THI-246 PR 2 — divider resize)", () => {
  function setup() {
    updateSettings({ splitRailWidth: 280 });
    return render(
      <SplitView
        windows={[mkWindow({ paneId: "%a", session: "alpha" })]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
  }

  it("divider is a keyboard-reachable ARIA separator with the correct bounds", () => {
    const { container } = setup();
    const div = container.querySelector<HTMLDivElement>(".sb-divider")!;
    expect(div.getAttribute("role")).toBe("separator");
    expect(div.getAttribute("aria-orientation")).toBe("vertical");
    expect(div.getAttribute("aria-valuemin")).toBe("200");
    expect(div.getAttribute("aria-valuemax")).toBe("460");
    expect(div.getAttribute("aria-valuenow")).toBe("280");
    expect(div.tabIndex).toBe(0);
  });

  it("pointer-drag updates the grid-template width and persists on pointer-up", () => {
    const { container } = setup();
    const div = container.querySelector<HTMLDivElement>(".sb-divider")!;
    const split = container.querySelector<HTMLDivElement>(".sb-split")!;

    // jsdom's PointerEvent doesn't ship setPointerCapture; stub it so the
    // production capture call doesn't throw under test. The drag math is
    // unaffected.
    div.setPointerCapture = vi.fn();
    div.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(div, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(div, { clientX: 160, pointerId: 1 });
    // Mid-drag: the grid template reflows but settings haven't been written yet.
    expect(split.style.gridTemplateColumns).toContain("340px");
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(280);

    fireEvent.pointerUp(div, { clientX: 160, pointerId: 1 });
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(340);
  });

  it("clamps the drag to [200, 460]", () => {
    const { container } = setup();
    const div = container.querySelector<HTMLDivElement>(".sb-divider")!;
    div.setPointerCapture = vi.fn();
    div.releasePointerCapture = vi.fn();

    // Drag way to the right: 280 + 999 = 1279 → clamps to 460.
    fireEvent.pointerDown(div, { button: 0, clientX: 0, pointerId: 1 });
    fireEvent.pointerUp(div, { clientX: 999, pointerId: 1 });
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(460);

    // Now drag way to the left from 460: 460 - 999 = -539 → clamps to 200.
    fireEvent.pointerDown(div, { button: 0, clientX: 0, pointerId: 2 });
    fireEvent.pointerUp(div, { clientX: -999, pointerId: 2 });
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(200);
  });

  it("disables pointer drag while collapsed (no settings change)", () => {
    updateSettings({ splitRailCollapsed: true });
    const { container } = setup();
    const div = container.querySelector<HTMLDivElement>(".sb-divider")!;
    div.setPointerCapture = vi.fn();
    div.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(div, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(div, { clientX: 999, pointerId: 1 });
    // pointerDown bailed early (collapsed) so width is unchanged.
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(280);
  });

  it("arrow keys nudge the width; Shift makes the step larger", () => {
    const { container } = setup();
    const div = container.querySelector<HTMLDivElement>(".sb-divider")!;

    fireEvent.keyDown(div, { key: "ArrowRight" });
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(290);

    fireEvent.keyDown(div, { key: "ArrowLeft", shiftKey: true });
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(240);

    fireEvent.keyDown(div, { key: "Home" });
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(200);

    fireEvent.keyDown(div, { key: "End" });
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailWidth,
    ).toBe(460);
  });
});

describe("SplitView (THI-246 PR 2 — collapse)", () => {
  it("toggle button flips the splitRailCollapsed setting", () => {
    const { container } = render(
      <SplitView
        windows={[mkWindow({ paneId: "%a", session: "alpha" })]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      ".sb-rail-collapse",
    )!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).splitRailCollapsed,
    ).toBe(true);
  });

  it("renders a 44px column with dot rows only while collapsed", () => {
    updateSettings({ splitRailCollapsed: true });
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({ paneId: "%a", session: "alpha", name: "shell", status: "idle" }),
          mkWindow({ paneId: "%b", session: "alpha", name: "claude", status: "waiting" }),
        ]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    expect(
      container.querySelector<HTMLDivElement>(".sb-split")!.style.gridTemplateColumns,
    ).toContain("44px");
    expect(container.querySelector(".sb-rail.is-collapsed")).not.toBeNull();
    // No pane rows or group heads while collapsed — just dots.
    expect(container.querySelectorAll(".sb-row")).toHaveLength(0);
    const dots = container.querySelectorAll(".sb-dot");
    expect(dots).toHaveLength(2);
    expect(dots[0]!.className).toContain("tone-gray"); // idle
    expect(dots[1]!.className).toContain("tone-amber"); // waiting
  });

  it("clicking a dot expands the rail and selects that pane", () => {
    updateSettings({ splitRailCollapsed: true });
    const { container } = render(
      <SplitView
        windows={[mkWindow({ paneId: "%a", session: "alpha", name: "shell" })]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".sb-dot")!);
    const stored = JSON.parse(localStorage.getItem("switchboard:settings")!);
    expect(stored.splitRailCollapsed).toBe(false);
    expect(stored.selectedPaneId).toBe("%a");
  });
});
