import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
  agent: null,
  preview: [],
};

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

  it("uses a textarea so the browser inserts newlines on Shift+Enter", () => {
    // Pin the element type — if someone reverts to <input>, multi-line is
    // gone and the Shift+Enter behavior tested above stops being meaningful.
    render(<CommandPalette target={TARGET} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Send to dev:0/);
    expect(input.tagName).toBe("TEXTAREA");
  });
});
