import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { Window } from "../types";
import { ListView } from "./ListView";

afterEach(() => cleanup());

function mkWindow(over: Partial<Window> = {}): Window {
  return {
    id: "main:0",
    paneId: "%0",
    session: "main",
    index: 0,
    name: "shell",
    kind: "shell",
    status: "idle",
    lastActivity: 1_700_000_000,
    cpu: 0,
    mem: 0,
    cmd: "zsh",
    cwd: "/tmp",
    pendingInput: false,
    branch: null,
    pr: null,
    prUrl: null,
    ci: null,
    repoUrl: null,
    agent: null,
    preview: [],
    ...over,
  };
}

const noop = vi.fn();

function renderList(
  windows: Window[],
  overrides: Partial<React.ComponentProps<typeof ListView>> = {},
) {
  return render(
    <ListView
      windows={windows}
      focusedId={null}
      highlightedId={null}
      onOpen={noop}
      onSend={noop}
      onRename={noop}
      onFocus={noop}
      onKill={noop}
      {...overrides}
    />,
  );
}

describe("ListView (THI-60)", () => {
  it("renders one row per visible window", () => {
    const { container } = renderList([
      mkWindow({ paneId: "%1", name: "a" }),
      mkWindow({ paneId: "%2", name: "b", session: "dev" }),
    ]);
    expect(container.querySelectorAll(".list-row")).toHaveLength(2);
  });

  it("each row shows status dot, session/name, and a status pill", () => {
    const { container } = renderList([
      mkWindow({ paneId: "%1", name: "agent-x", session: "main", status: "waiting" }),
    ]);
    const row = container.querySelector(".list-row")!;
    // Status dot styled by status tone (waiting → amber).
    expect(row.querySelector(".list-status-dot")).not.toBeNull();
    expect(row.textContent).toContain("agent-x");
    expect(row.textContent).toContain("main");
    expect(row.querySelector(".card-status")).not.toBeNull();
  });

  it("clicking the row body opens the window", () => {
    const onOpen = vi.fn();
    const { container } = renderList([mkWindow()], { onOpen });
    fireEvent.click(container.querySelector(".list-row-body")!);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("Pin button calls onTogglePin without opening the window", () => {
    const onOpen = vi.fn();
    const onTogglePin = vi.fn();
    const { container } = renderList([mkWindow()], {
      onOpen,
      pinnedPaneIds: new Set(),
      onTogglePin,
    });
    fireEvent.click(container.querySelector<HTMLButtonElement>("button.act-pin")!);
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("pinned windows render with is-pinned styling and sort to the top", () => {
    const { container } = renderList(
      [
        mkWindow({ paneId: "%1", name: "first", index: 0 }),
        mkWindow({ paneId: "%2", name: "pinned", index: 1 }),
      ],
      { pinnedPaneIds: new Set(["%2"]), onTogglePin: vi.fn() },
    );
    const names = Array.from(
      container.querySelectorAll<HTMLElement>(".list-row .list-name"),
    ).map((el) => el.textContent);
    expect(names).toEqual(["pinned", "first"]);
    expect(container.querySelector(".list-row.is-pinned")).not.toBeNull();
  });

  it("kill action receives the shift state for skip-confirm parity", () => {
    const onKill = vi.fn();
    const { container } = renderList([mkWindow()], { onKill });
    const killBtn = container.querySelector<HTMLButtonElement>(
      "button.act-icon.act-danger",
    )!;
    fireEvent.click(killBtn, { shiftKey: true });
    expect(onKill).toHaveBeenCalledWith(expect.objectContaining({ paneId: "%0" }), true);
  });

  it("shows an empty placeholder when there are no visible windows", () => {
    const { container } = renderList([]);
    expect(container.textContent).toMatch(/no matching/i);
  });
});
