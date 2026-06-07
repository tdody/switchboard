import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { Window } from "../types";
import { NeedsStrip } from "./NeedsStrip";

afterEach(() => cleanup());

function mkWindow(over: Partial<Window> = {}): Window {
  return {
    id: "main:0",
    paneId: "%0",
    session: "main",
    index: 0,
    name: "shell",
    kind: "shell",
    status: "waiting",
    lastActivity: 0,
    cpu: 0,
    mem: 0,
    cmd: "zsh",
    cwd: "/tmp",
    pendingInput: true,
    branch: null,
    pr: null,
    prUrl: null,
    ci: null,
    repoUrl: null,
    repoKey: null,
    repoLabel: null,
    agent: null,
    preview: [],
    ...over,
  };
}

describe("NeedsStrip broadcast (THI-66)", () => {
  it("hides the broadcast button when onBroadcast is not wired", () => {
    const { container } = render(
      <NeedsStrip
        windows={[mkWindow(), mkWindow({ paneId: "%1" })]}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.querySelector(".needs-broadcast")).toBeNull();
  });

  it("hides the broadcast button when there is only one pending pane", () => {
    const onBroadcast = vi.fn();
    const { container } = render(
      <NeedsStrip
        windows={[mkWindow()]}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
        onBroadcast={onBroadcast}
      />,
    );
    expect(container.querySelector(".needs-broadcast")).toBeNull();
  });

  it("renders the broadcast button when ≥2 pending panes AND onBroadcast is wired", () => {
    const onBroadcast = vi.fn();
    const { container } = render(
      <NeedsStrip
        windows={[mkWindow(), mkWindow({ paneId: "%1", session: "dev" })]}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
        onBroadcast={onBroadcast}
      />,
    );
    expect(container.querySelector(".needs-broadcast")).not.toBeNull();
  });

  it("clicking broadcast passes the full window list to onBroadcast", () => {
    const onBroadcast = vi.fn();
    const windows = [
      mkWindow({ paneId: "%1", session: "a" }),
      mkWindow({ paneId: "%2", session: "b" }),
      mkWindow({ paneId: "%3", session: "c" }),
    ];
    const { container } = render(
      <NeedsStrip
        windows={windows}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
        onBroadcast={onBroadcast}
      />,
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".needs-broadcast")!);
    expect(onBroadcast).toHaveBeenCalledTimes(1);
    expect(onBroadcast.mock.calls[0][0]).toEqual(windows);
  });
});
