import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { Window } from "../types";
import { WindowCard } from "./WindowCard";

afterEach(() => cleanup());

function makeWindow(overrides: Partial<Window> = {}): Window {
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
    cwd: "/Users/test",
    pendingInput: false,
    branch: null,
    pr: null,
    prUrl: null,
    ci: null,
    repoUrl: null,
    agent: null,
    preview: [],
    ...overrides,
  };
}

const noop = vi.fn();

function renderCard(w: Window) {
  return render(
    <WindowCard
      w={w}
      isFocused={false}
      isHighlighted={false}
      onOpen={noop}
      onSendKeys={noop}
      onRename={noop}
      onFocus={noop}
      onKill={noop}
    />,
  );
}

describe("WindowCard memo", () => {
  it("re-renders when prUrl changes on an otherwise-stable window", () => {
    const w1 = makeWindow({
      branch: "main",
      pr: 1,
      prUrl: "https://github.com/x/y/pull/1",
    });
    const w2: Window = { ...w1, pr: 1, prUrl: "https://github.com/x/y/pull/2" };

    const { container, rerender } = renderCard(w1);
    expect(container.querySelector("a.pr-link")?.getAttribute("href")).toBe(
      "https://github.com/x/y/pull/1",
    );

    rerender(
      <WindowCard
        w={w2}
        isFocused={false}
        isHighlighted={false}
        onOpen={noop}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
      />,
    );
    expect(container.querySelector("a.pr-link")?.getAttribute("href")).toBe(
      "https://github.com/x/y/pull/2",
    );
  });

  it("re-renders when preview content changes on an otherwise-stable window", () => {
    const w1 = makeWindow({ preview: ["alpha", "beta"] });
    const w2: Window = { ...w1, preview: ["gamma", "delta", "epsilon"] };

    const { container, rerender } = renderCard(w1);
    expect(container.querySelectorAll(".preview .ln")).toHaveLength(2);

    rerender(
      <WindowCard
        w={w2}
        isFocused={false}
        isHighlighted={false}
        onOpen={noop}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
      />,
    );
    expect(container.querySelectorAll(".preview .ln")).toHaveLength(3);
    const lines = Array.from(
      container.querySelectorAll<HTMLDivElement>(".preview .ln"),
    ).map((el) => el.textContent);
    expect(lines).toEqual(["gamma", "delta", "epsilon"]);
  });

  it("skips re-render when preview is a new array but content is identical", () => {
    // Catches the regression of using `===` directly on preview arrays, which
    // would force a re-render every poll because the backend hands us a fresh
    // array each tick. We want content-equality, not reference-equality.
    const w1 = makeWindow({ preview: ["a", "b"] });
    const w2: Window = { ...w1, preview: ["a", "b"] };

    const { container, rerender } = renderCard(w1);
    const firstNode = container.querySelector(".preview .ln");
    expect(firstNode?.textContent).toBe("a");

    rerender(
      <WindowCard
        w={w2}
        isFocused={false}
        isHighlighted={false}
        onOpen={noop}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
      />,
    );
    // Memo should have short-circuited: the DOM node is the same instance
    // (React skipped reconciliation entirely for this card).
    const secondNode = container.querySelector(".preview .ln");
    expect(secondNode).toBe(firstNode);
  });
});

describe("WindowCard quick actions (THI-97)", () => {
  function renderWithQuickAction(w: Window, onQuickAction: () => void) {
    return render(
      <WindowCard
        w={w}
        isFocused={false}
        isHighlighted={false}
        onOpen={noop}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
        onQuickAction={onQuickAction}
      />,
    );
  }

  it("pending agent: renders y / n / interrupt buttons; y click fires the y payload", () => {
    const onQuickAction = vi.fn();
    const w = makeWindow({
      kind: "agent",
      status: "waiting",
      pendingInput: true,
    });
    const { container } = renderWithQuickAction(w, onQuickAction);

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.act-quick"),
    );
    expect(buttons.map((b) => b.textContent)).toEqual(["y", "n", "⎋"]);

    fireEvent.click(buttons[0]);
    expect(onQuickAction).toHaveBeenCalledTimes(1);
    const [calledWin, calledAction] = onQuickAction.mock.calls[0];
    expect(calledWin).toBe(w);
    expect(calledAction.id).toBe("agent.yes");
    expect(calledAction.payload).toEqual({ paste: "y", keys: ["Enter"] });
  });

  it("non-pending agent: renders only the interrupt button", () => {
    const w = makeWindow({
      kind: "agent",
      status: "running",
      pendingInput: false,
    });
    const { container } = renderWithQuickAction(w, vi.fn());
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.act-quick"),
    );
    expect(buttons.map((b) => b.textContent)).toEqual(["⎋"]);
  });

  it("shell: renders a clear-screen button", () => {
    const w = makeWindow({ kind: "shell" });
    const { container } = renderWithQuickAction(w, vi.fn());
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.act-quick"),
    );
    expect(buttons.map((b) => b.textContent)).toEqual(["⌫"]);
  });

  it("editor: no quick action buttons", () => {
    const w = makeWindow({ kind: "editor" });
    const { container } = renderWithQuickAction(w, vi.fn());
    expect(container.querySelectorAll("button.act-quick")).toHaveLength(0);
  });

  it("does not propagate the quick-action click up to the card's onOpen", () => {
    const onQuickAction = vi.fn();
    const onOpen = vi.fn();
    const w = makeWindow({ kind: "shell" });
    const { container } = render(
      <WindowCard
        w={w}
        isFocused={false}
        isHighlighted={false}
        onOpen={onOpen}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
        onQuickAction={onQuickAction}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>("button.act-quick");
    fireEvent.click(btn!);
    expect(onQuickAction).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("WindowCard pin (THI-98)", () => {
  it("renders a pin button when onTogglePin is provided", () => {
    const onTogglePin = vi.fn();
    const { container } = render(
      <WindowCard
        w={makeWindow()}
        isFocused={false}
        isHighlighted={false}
        onOpen={noop}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
        isPinned={false}
        onTogglePin={onTogglePin}
      />,
    );
    expect(container.querySelector("button.act-pin")).not.toBeNull();
  });

  it("clicking the pin button calls onTogglePin and not onOpen", () => {
    const onTogglePin = vi.fn();
    const onOpen = vi.fn();
    const { container } = render(
      <WindowCard
        w={makeWindow()}
        isFocused={false}
        isHighlighted={false}
        onOpen={onOpen}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
        isPinned={false}
        onTogglePin={onTogglePin}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>("button.act-pin")!;
    fireEvent.click(btn);
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("when pinned, adds the is-pinned class to the pin button and the card", () => {
    const { container } = render(
      <WindowCard
        w={makeWindow()}
        isFocused={false}
        isHighlighted={false}
        onOpen={noop}
        onSendKeys={noop}
        onRename={noop}
        onFocus={noop}
        onKill={noop}
        isPinned={true}
        onTogglePin={noop}
      />,
    );
    expect(container.querySelector(".card.card-pinned")).not.toBeNull();
    expect(container.querySelector("button.act-pin.is-pinned")).not.toBeNull();
  });

  it("omits the pin button entirely when onTogglePin is undefined", () => {
    const { container } = renderCard(makeWindow());
    expect(container.querySelector("button.act-pin")).toBeNull();
  });
});
