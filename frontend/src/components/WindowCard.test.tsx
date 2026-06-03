import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

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
