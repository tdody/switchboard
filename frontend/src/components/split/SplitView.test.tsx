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

describe('SplitView (THI-246 PR 2 — "+ New tab")', () => {
  it("renders one new-tab row per session in sessions mode and calls onNewWindow with that session", () => {
    const onNewWindow = vi.fn();
    const alpha = mkSession({ id: "alpha", name: "alpha" });
    const beta = mkSession({ id: "beta", name: "beta" });
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({ paneId: "%a", session: "alpha" }),
          mkWindow({ paneId: "%b", session: "beta" }),
        ]}
        sessions={[alpha, beta]}
        onFocus={noop}
        onNewWindow={onNewWindow}
      />,
    );
    const newTabs = container.querySelectorAll(".sb-newtab");
    expect(newTabs).toHaveLength(2);
    fireEvent.click(newTabs[0]! as HTMLButtonElement);
    expect(onNewWindow).toHaveBeenCalledTimes(1);
    expect(onNewWindow.mock.calls[0]![0]).toBe(alpha);
    fireEvent.click(newTabs[1]! as HTMLButtonElement);
    expect(onNewWindow.mock.calls[1]![0]).toBe(beta);
  });

  it("hides new-tab rows entirely when onNewWindow is not provided", () => {
    const { container } = render(
      <SplitView
        windows={[mkWindow({ paneId: "%a", session: "alpha" })]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
      />,
    );
    expect(container.querySelector(".sb-newtab")).toBeNull();
  });

  it("repos mode: one new-tab per real bucket; targets the first window's session", () => {
    updateSettings({ groupingMode: "repos" });
    const onNewWindow = vi.fn();
    const alpha = mkSession({ id: "alpha", name: "alpha" });
    const beta = mkSession({ id: "beta", name: "beta" });
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({
            paneId: "%a",
            session: "alpha",
            repoKey: "/r/foo",
            repoLabel: "foo",
          }),
          mkWindow({
            paneId: "%b",
            session: "beta",
            repoKey: "/r/foo",
            repoLabel: "foo",
          }),
        ]}
        sessions={[alpha, beta]}
        onFocus={noop}
        onNewWindow={onNewWindow}
      />,
    );
    const newTabs = container.querySelectorAll(".sb-newtab");
    expect(newTabs).toHaveLength(1);
    fireEvent.click(newTabs[0]! as HTMLButtonElement);
    // First window in the foo bucket is %a → session alpha.
    expect(onNewWindow).toHaveBeenCalledWith(alpha);
  });

  it("repos mode: Other bucket has no new-tab row (no repo cwd to inherit)", () => {
    updateSettings({ groupingMode: "repos" });
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({
            paneId: "%a",
            session: "alpha",
            repoKey: null,
            repoLabel: null,
          }),
        ]}
        sessions={[mkSession({ id: "alpha" })]}
        onFocus={noop}
        onNewWindow={vi.fn()}
      />,
    );
    expect(container.querySelector(".sb-newtab")).toBeNull();
  });
});

describe("SplitView (THI-246 PR 2 — drag-to-reorder)", () => {
  function makeSessions() {
    return [
      mkSession({ id: "alpha", name: "alpha" }),
      mkSession({ id: "beta", name: "beta" }),
      mkSession({ id: "gamma", name: "gamma" }),
    ];
  }
  function makeWindows() {
    return [
      mkWindow({ paneId: "%a", session: "alpha", name: "a" }),
      mkWindow({ paneId: "%b", session: "beta", name: "b" }),
      mkWindow({ paneId: "%g", session: "gamma", name: "g" }),
    ];
  }

  it("applies the persisted splitRailSessionOrder; live-new sessions append last", () => {
    updateSettings({ splitRailSessionOrder: ["gamma", "alpha"] });
    const { container } = render(
      <SplitView
        windows={makeWindows()}
        sessions={makeSessions()}
        onFocus={noop}
      />,
    );
    const heads = Array.from(
      container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head .lbl"),
    ).map((el) => el.textContent);
    // Persisted order first (gamma, alpha), then live-new (beta).
    expect(heads).toEqual(["gamma", "alpha", "beta"]);
  });

  it("applies splitRailRepoOrder in repos mode; Other stays last regardless", () => {
    updateSettings({
      groupingMode: "repos",
      splitRailRepoOrder: ["/r/beta", "/r/alpha"],
    });
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({
            paneId: "%a",
            session: "alpha",
            repoKey: "/r/alpha",
            repoLabel: "alpha",
          }),
          mkWindow({
            paneId: "%b",
            session: "beta",
            repoKey: "/r/beta",
            repoLabel: "beta",
          }),
          mkWindow({
            paneId: "%o",
            session: "loose",
            repoKey: null,
            repoLabel: null,
          }),
        ]}
        sessions={makeSessions()}
        onFocus={noop}
      />,
    );
    const heads = Array.from(
      container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head .lbl"),
    ).map((el) => el.textContent);
    expect(heads).toEqual(["beta", "alpha", "Other"]);
  });

  it("dragStart marks the head row dragging; dragOver paints a drop indicator on the target", () => {
    const { container } = render(
      <SplitView
        windows={makeWindows()}
        sessions={makeSessions()}
        onFocus={noop}
      />,
    );
    const heads = container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head");

    fireEvent.dragStart(heads[0]!, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    expect(heads[0]!.className).toContain("is-dragging");

    fireEvent.dragOver(heads[1]!, {
      clientY: 10,
      dataTransfer: { dropEffect: "" },
    });
    // Either indicator class is fine — the exact position depends on the
    // browser-driven layout. We only assert that SOMETHING was painted.
    const target = container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head")[1]!;
    expect(target.className).toMatch(/drop-(before|after)/);
  });

  it("drop persists a new splitRailSessionOrder placing the dragged group at the target", () => {
    const { container } = render(
      <SplitView
        windows={makeWindows()}
        sessions={makeSessions()}
        onFocus={noop}
      />,
    );
    const heads = container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head");
    fireEvent.dragStart(heads[0]!, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    fireEvent.dragOver(heads[2]!, {
      clientY: 100,
      dataTransfer: { dropEffect: "" },
    });
    fireEvent.drop(heads[2]!, { dataTransfer: { dropEffect: "" } });
    const stored = JSON.parse(localStorage.getItem("switchboard:settings")!)
      .splitRailSessionOrder as string[];
    // alpha moved off the front; beta is still first; alpha sits before or
    // after gamma depending on the layout's measured midpoint. Either is fine
    // for the contract test — what matters is that the persist happened and
    // beta hasn't moved.
    expect(stored.length).toBe(3);
    expect(stored[0]).toBe("beta");
    expect(stored.slice(1).sort()).toEqual(["alpha", "gamma"]);
  });

  it("Other bucket's head row is not draggable", () => {
    updateSettings({ groupingMode: "repos" });
    const { container } = render(
      <SplitView
        windows={[
          mkWindow({
            paneId: "%a",
            session: "alpha",
            repoKey: "/r/alpha",
            repoLabel: "alpha",
          }),
          mkWindow({
            paneId: "%o",
            session: "loose",
            repoKey: null,
            repoLabel: null,
          }),
        ]}
        sessions={makeSessions()}
        onFocus={noop}
      />,
    );
    const heads = container.querySelectorAll<HTMLDivElement>(".sb-row.sb-row-head");
    expect(heads[0]!.getAttribute("draggable")).toBe("true"); // alpha
    expect(heads[1]!.getAttribute("draggable")).toBeNull(); // Other
  });

  it("disables drag while the rail is collapsed", () => {
    updateSettings({ splitRailCollapsed: true });
    const { container } = render(
      <SplitView
        windows={makeWindows()}
        sessions={makeSessions()}
        onFocus={noop}
      />,
    );
    expect(container.querySelector(".sb-row.sb-row-head")).toBeNull();
  });
});
