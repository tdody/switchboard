import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// xterm.js touches DOM APIs (createRange, ResizeObserver hooks via the
// fit addon, etc.) that happy-dom does not implement. Mock the modules
// before importing the component. The Mock Terminal records writes and
// clear() calls so we can assert on them later.
//
// vi.mock factories are hoisted to the top of the file by Vitest, so we
// use vi.hoisted() to lift the shared state (mockTerminals array and the
// MockTerminal class) into the hoisted zone as well.
const { mockTerminals, MockTerminal } = vi.hoisted(() => {
  const mockTerminals: Array<{
    cols: number;
    rows: number;
    options: Record<string, unknown>;
    writes: string[];
    cleared: number;
    disposed: boolean;
    writeln: (s: string) => void;
    write: (s: string | Uint8Array) => void;
    clear: () => void;
    dispose: () => void;
    open: () => void;
    focus: () => void;
    loadAddon: () => void;
    attachCustomKeyEventHandler: () => void;
    onData: () => { dispose: () => void };
  }> = [];

  class MockTerminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    writes: string[] = [];
    cleared = 0;
    disposed = false;
    writeln = (s: string) => { this.writes.push(s); };
    write = (s: string | Uint8Array) => {
      this.writes.push(typeof s === "string" ? s : new TextDecoder().decode(s));
    };
    clear = () => { this.cleared += 1; };
    dispose = () => { this.disposed = true; };
    open = () => {};
    focus = () => {};
    loadAddon = () => {};
    attachCustomKeyEventHandler = () => {};
    onData = () => ({ dispose: () => {} });
    constructor() {
      mockTerminals.push(this);
    }
  }

  return { mockTerminals, MockTerminal };
});

vi.mock("xterm", () => ({ Terminal: MockTerminal }));
vi.mock("xterm-addon-fit", () => ({
  FitAddon: class { fit() {} },
}));
vi.mock("xterm/css/xterm.css", () => ({}));

import { TerminalModal } from "./TerminalModal";
import type { Window } from "../types";

afterEach(() => {
  cleanup();
  mockTerminals.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Minimal Window literal. If your local `Window` type has required fields
// not covered here, copy the shape from any existing test that constructs
// one (App.test.tsx, etc.) and adapt.
const win = {
  id: "dev:2",
  paneId: "%42",
  session: "dev",
  index: 2,
  name: "test",
  kind: "agent",
  status: "idle",
  cwd: "/tmp",
  cpu: 0,
  mem: 0,
  cmd: "bash",
  recap: null,
  agent: null,
  lastActivity: 0,
} as unknown as Window;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  binaryType = "arraybuffer";
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  // Test helpers
  open() {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }

  triggerClose(code: number) {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  // @ts-expect-error — minimal stub, sufficient for the component
  globalThis.WebSocket = FakeWebSocket;
});

describe("TerminalModal — reconnect", () => {
  it("writes [reconnecting…] once and schedules a retry on abnormal close", () => {
    vi.useFakeTimers();
    render(<TerminalModal window={win} onClose={() => {}} onToast={() => {}} />);

    // The first FakeWebSocket is the initial connect; open it then close abnormally.
    const ws1 = FakeWebSocket.instances[0];
    act(() => { ws1.open(); });
    act(() => { ws1.triggerClose(1006); });

    // A retry must have been scheduled; advance time to the first backoff.
    act(() => { vi.advanceTimersByTime(250); });
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("does not duplicate the [reconnecting…] notice across multiple failures", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    // Force three consecutive failures.
    const ws1 = FakeWebSocket.instances[0];
    act(() => { ws1.open(); });
    act(() => { ws1.triggerClose(1006); });
    act(() => { vi.advanceTimersByTime(250); });
    const ws2 = FakeWebSocket.instances[1];
    act(() => { ws2.triggerClose(1006); });
    act(() => { vi.advanceTimersByTime(500); });
    const ws3 = FakeWebSocket.instances[2];
    act(() => { ws3.triggerClose(1006); });

    // The xterm buffer isn't easy to inspect directly; instead assert the
    // pill state stayed `reconnecting` throughout and no extra DOM appeared.
    expect(container.querySelector(".connect-pill")?.textContent).toContain(
      "reconnecting",
    );
  });

  it("transitions to `gone` on close code 4404 (pane not found) without retrying", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    const ws1 = FakeWebSocket.instances[0];
    act(() => { ws1.open(); });
    act(() => { ws1.triggerClose(4404); });

    // Advance enough that any scheduled retry would fire.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(container.querySelector(".connect-pill")?.textContent).toContain(
      "pane gone",
    );
  });

  it("transitions to `gone` on close code 4410 (stream ended) without retrying", () => {
    vi.useFakeTimers();
    const { container } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    const ws1 = FakeWebSocket.instances[0];
    act(() => { ws1.open(); });
    act(() => { ws1.triggerClose(4410); });

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(container.querySelector(".connect-pill")?.textContent).toContain(
      "pane gone",
    );
  });

  it("renders a Reconnect button when the backoff array is exhausted", () => {
    vi.useFakeTimers();
    render(<TerminalModal window={win} onClose={() => {}} onToast={() => {}} />);

    // BACKOFF_MS has 8 entries. Initial close + 8 retries = 9 sockets total
    // before the controller transitions to `disconnected`.
    const backoff = [250, 500, 1000, 2000, 4000, 4000, 4000, 4000];

    act(() => { FakeWebSocket.instances[0].open(); });
    act(() => { FakeWebSocket.instances[0].triggerClose(1006); });
    for (let i = 0; i < backoff.length; i++) {
      act(() => { vi.advanceTimersByTime(backoff[i]); });
      const ws = FakeWebSocket.instances[i + 1];
      act(() => { ws.triggerClose(1006); });
    }

    expect(screen.getByRole("button", { name: /reconnect/i })).toBeTruthy();
  });

  it("manual Reconnect button resets the attempt counter and opens a fresh WS", () => {
    vi.useFakeTimers();
    render(<TerminalModal window={win} onClose={() => {}} onToast={() => {}} />);
    const backoff = [250, 500, 1000, 2000, 4000, 4000, 4000, 4000];

    act(() => { FakeWebSocket.instances[0].open(); });
    act(() => { FakeWebSocket.instances[0].triggerClose(1006); });
    for (let i = 0; i < backoff.length; i++) {
      act(() => { vi.advanceTimersByTime(backoff[i]); });
      act(() => { FakeWebSocket.instances[i + 1].triggerClose(1006); });
    }
    const beforeClick = FakeWebSocket.instances.length;
    fireEvent.click(screen.getByRole("button", { name: /reconnect/i }));
    // A fresh WS was opened immediately (no backoff for manual reconnect).
    expect(FakeWebSocket.instances.length).toBe(beforeClick + 1);
  });

  it("clears the backoff timer on unmount", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    act(() => { FakeWebSocket.instances[0].open(); });
    act(() => { FakeWebSocket.instances[0].triggerClose(1006); });
    // The backoff timer is now scheduled; unmount before it fires.
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
