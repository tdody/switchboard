import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { CommandPalette } from "./CommandPalette";
import type { Window } from "../types";

const sendKeysMock = vi.fn(async (..._args: unknown[]) => true);
vi.mock("../api/client", () => ({
  sendKeys: (...args: unknown[]) => sendKeysMock(...args),
}));

const TARGET: Window = {
  id: "dev:0",
  paneId: "%0",
  session: "dev",
  index: 0,
  name: "scratch",
  kind: "shell",
  status: "idle",
  lastActivity: 0,
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
    repoKey: null,
    repoLabel: null,
  agent: null,
  preview: [],
};

beforeEach(() => {
  localStorage.clear();
  sendKeysMock.mockImplementation(async () => true);
});

afterEach(() => {
  cleanup();
  sendKeysMock.mockClear();
});

describe("CommandPalette", () => {
  it("submits the typed query on plain Enter", async () => {
    const onClose = vi.fn();
    render(<CommandPalette target={TARGET} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    fireEvent.change(input, { target: { value: "echo hi" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // sendKeys is awaited inside the handler — flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(sendKeysMock).toHaveBeenCalledWith("dev", 0, {
      paste: "echo hi",
      keys: ["Enter"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT submit on Shift+Enter — that inserts a newline", async () => {
    // The palette's input must accept multi-line text (so backend's bracket-
    // paste path can be exercised). Shift+Enter is the Claude-Code-style
    // newline; plain Enter still submits.
    const onClose = vi.fn();
    render(<CommandPalette target={TARGET} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    fireEvent.change(input, { target: { value: "line 1" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    await Promise.resolve();
    expect(sendKeysMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends a multi-line query as a single paste plus one Enter", async () => {
    // Backend's deliver_text bracket-pastes the block; the lone trailing
    // Enter submits once. The frontend just hands it the literal text.
    const onClose = vi.fn();
    render(<CommandPalette target={TARGET} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    fireEvent.change(input, { target: { value: "line 1\nline 2\nline 3" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
    await Promise.resolve();
    expect(sendKeysMock).toHaveBeenCalledWith("dev", 0, {
      paste: "line 1\nline 2\nline 3",
      keys: ["Enter"],
    });
  });

  it("records a sent command in per-session recents on next open", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<CommandPalette target={TARGET} onClose={onClose} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    fireEvent.change(input, { target: { value: "echo persisted" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    // Re-open: the recents section should now lead with the sent command.
    render(<CommandPalette target={TARGET} onClose={vi.fn()} />);
    expect(screen.getByText("echo persisted")).toBeTruthy();
  });

  it("does NOT record a recent when sendKeys fails", async () => {
    sendKeysMock.mockImplementationOnce(async () => false);
    const { unmount } = render(<CommandPalette target={TARGET} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    fireEvent.change(input, { target: { value: "echo nope" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    render(<CommandPalette target={TARGET} onClose={vi.fn()} />);
    expect(screen.queryByText("echo nope")).toBeNull();
  });

  it("removes a recent via the ✕ button without sending it", async () => {
    const { unmount } = render(<CommandPalette target={TARGET} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    fireEvent.change(input, { target: { value: "echo doomed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
    await Promise.resolve();
    sendKeysMock.mockClear();
    unmount();
    render(<CommandPalette target={TARGET} onClose={vi.fn()} />);
    const row = screen.getByText("echo doomed").closest("button") as HTMLElement;
    const rm = within(row).getByRole("button", { name: /Remove echo doomed/ });
    fireEvent.click(rm);
    expect(screen.queryByText("echo doomed")).toBeNull();
    expect(sendKeysMock).not.toHaveBeenCalled();
  });

  it("uses a textarea so the browser inserts newlines on Shift+Enter", () => {
    // Pin the element type — if someone reverts to <input>, multi-line is
    // gone and the Shift+Enter behavior tested above stops being meaningful.
    render(<CommandPalette target={TARGET} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    expect(input.tagName).toBe("TEXTAREA");
  });
});

describe("CommandPalette broadcast mode (THI-66)", () => {
  const A: Window = { ...TARGET, paneId: "%1", session: "main", index: 1, name: "alpha" };
  const B: Window = { ...TARGET, paneId: "%2", session: "dev", index: 4, name: "beta" };
  const C: Window = { ...TARGET, paneId: "%3", session: "ops", index: 0, name: "gamma" };

  it("renders an amber broadcast pill in the header", () => {
    const { container } = render(
      <CommandPalette
        target={A}
        broadcastTargets={[A, B, C]}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector(".palette-broadcast-pill")).not.toBeNull();
  });

  it("renders one chip per broadcast target", () => {
    const { container } = render(
      <CommandPalette
        target={A}
        broadcastTargets={[A, B, C]}
        onClose={vi.fn()}
      />,
    );
    const chips = container.querySelectorAll(".palette-target-chip");
    expect(chips).toHaveLength(3);
    const texts = Array.from(chips).map((c) => c.textContent);
    expect(texts.join(" ")).toContain("alpha");
    expect(texts.join(" ")).toContain("beta");
    expect(texts.join(" ")).toContain("gamma");
  });

  it('footer shows "target: N panes" when broadcasting', () => {
    const { container } = render(
      <CommandPalette
        target={A}
        broadcastTargets={[A, B, C]}
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent).toMatch(/target:\s*3 panes/i);
  });

  it("submit iterates sendKeys for every target", async () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        target={A}
        broadcastTargets={[A, B, C]}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText(/Broadcast to 3 panes/);
    fireEvent.change(input, { target: { value: "uptime" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Drain microtasks so the Promise.allSettled batch resolves.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(sendKeysMock).toHaveBeenCalledTimes(3);
    const sessions = sendKeysMock.mock.calls.map((c) => c[0]).sort();
    expect(sessions).toEqual(["dev", "main", "ops"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("fires every sendKeys in parallel before any resolves (THI-218)", async () => {
    // Hold every sendKeys promise open with a manual deferred. If the loop
    // were still sequential, only the first call would have happened by the
    // time we inspect the mock; with Promise.allSettled all three fire
    // synchronously after the microtask flip.
    const deferreds: Array<{
      resolve: (v: boolean) => void;
      promise: Promise<boolean>;
    }> = [];
    sendKeysMock.mockImplementation(() => {
      let resolve!: (v: boolean) => void;
      const promise = new Promise<boolean>((r) => {
        resolve = r;
      });
      deferreds.push({ resolve, promise });
      return promise;
    });
    const onClose = vi.fn();
    render(
      <CommandPalette
        target={A}
        broadcastTargets={[A, B, C]}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText(/Broadcast to 3 panes/);
    fireEvent.change(input, { target: { value: "uptime" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // One microtask flip is enough to fire every sendKeys call when they're
    // launched in parallel — none of them have resolved yet.
    await Promise.resolve();
    expect(sendKeysMock).toHaveBeenCalledTimes(3);
    expect(onClose).not.toHaveBeenCalled();
    // Now resolve all in-flight calls and confirm the palette closes.
    deferreds.forEach((d) => d.resolve(true));
    await Promise.resolve();
    await Promise.resolve();
    expect(onClose).toHaveBeenCalled();
  });

  it("a broadcastTargets list of length 1 falls back to single-target UI", () => {
    const { container } = render(
      <CommandPalette
        target={A}
        broadcastTargets={[A]}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelector(".palette-broadcast-pill")).toBeNull();
    expect(container.querySelector(".palette-target-chip")).toBeNull();
  });

  it("clicking the X on a target chip removes it from the broadcast set", () => {
    const { container } = render(
      <CommandPalette
        target={A}
        broadcastTargets={[A, B, C]}
        onClose={vi.fn()}
      />,
    );
    const chipB = Array.from(
      container.querySelectorAll<HTMLElement>(".palette-target-chip"),
    ).find((c) => c.textContent?.includes("beta"))!;
    const rm = chipB.querySelector<HTMLButtonElement>(".palette-target-rm")!;
    fireEvent.click(rm);
    const remaining = Array.from(
      container.querySelectorAll(".palette-target-chip"),
    ).map((c) => c.textContent);
    expect(remaining.join(" ")).not.toContain("beta");
    expect(container.textContent).toMatch(/target:\s*2 panes/i);
  });
});
