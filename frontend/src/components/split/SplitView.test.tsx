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
