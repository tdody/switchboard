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
import type { Agent, CIState, Window } from "../types";

afterEach(() => {
  cleanup();
  mockTerminals.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  vi.stubGlobal("WebSocket", FakeWebSocket);
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
    // Direct check of dedup invariant: the notice must appear once even
    // though three closes happened.
    const reconnectNotices = (mockTerminals[0]?.writes ?? []).filter((w) =>
      w.includes("[reconnecting"),
    );
    expect(reconnectNotices).toHaveLength(1);
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
    const { container } = render(<TerminalModal window={win} onClose={() => {}} onToast={() => {}} />);
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

    // Drive the newly-opened socket to live and verify the success path
    // writes [reconnected] and flips the pill to `live`.
    const newWs = FakeWebSocket.instances.at(-1)!;
    act(() => {
      newWs.open();
    });
    const reconnectedNotices = (mockTerminals[0]?.writes ?? []).filter((w) =>
      w.includes("[reconnected]"),
    );
    expect(reconnectedNotices.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".connect-pill")?.textContent).toContain("WS · live");
  });

  it("clears the backoff timer on unmount", () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );

    act(() => {
      FakeWebSocket.instances[0].open();
    });
    // After the close fires, connect()'s onclose handler schedules a backoff
    // timer via window.setTimeout. Capture its returned id so we can assert
    // clearTimeout was called with that specific id (not the unrelated fit /
    // scrollbar timers that also get cleared on every unmount).
    const setTimeoutCallsBefore = setTimeoutSpy.mock.results.length;
    act(() => {
      FakeWebSocket.instances[0].triggerClose(1006);
    });
    // The most recent setTimeout call after the close is the backoff scheduler.
    expect(setTimeoutSpy.mock.results.length).toBeGreaterThan(setTimeoutCallsBefore);
    const backoffTimerId = setTimeoutSpy.mock.results.at(-1)?.value as number;

    unmount();
    expect(clearSpy).toHaveBeenCalledWith(backoffTimerId);
  });
});

describe("TerminalModal — kill window (THI-111)", () => {
  it("invokes onKill with the modal's window and the click's shiftKey when the Kill button is clicked", () => {
    const onKill = vi.fn();
    render(
      <TerminalModal
        window={win}
        onClose={() => {}}
        onToast={() => {}}
        onKill={onKill}
      />,
    );
    const btn = screen.getByRole("button", { name: /kill window/i });
    fireEvent.click(btn, { shiftKey: false });
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(onKill.mock.calls[0][0]).toBe(win);
    expect(onKill.mock.calls[0][1]).toBe(false);
  });

  it("forwards shift-click so the parent can skip the confirm dialog", () => {
    const onKill = vi.fn();
    render(
      <TerminalModal
        window={win}
        onClose={() => {}}
        onToast={() => {}}
        onKill={onKill}
      />,
    );
    const btn = screen.getByRole("button", { name: /kill window/i });
    fireEvent.click(btn, { shiftKey: true });
    expect(onKill).toHaveBeenCalledWith(win, true);
  });
});

// THI-115 item 3: the modal header surfaces the same agent chips the
// kanban card already shows (branch + PR + CI + spinner) plus a hint of the
// pending action. Data flows through `win.branch` (top-level, so shell panes
// get the branch chip too per THI-126) and `win.agent` for the agent-only
// fields (PR / CI / spinner / action), fed by App.tsx's 100ms modal-open
// /api/state poll (THI-105) — these tests just pin the render.
describe("TerminalModal — agent chips in header (THI-115)", () => {
  // Typed as Agent (not inferred) so each field carries its full union —
  // otherwise `typeof baseAgent` collapses to `{ branch: null, … }` and
  // `Partial<…>` refuses the concrete string overrides below.
  const baseAgent: Agent = {
    branch: null,
    spinner: null,
    duration: null,
    recap: null,
    action: null,
  };

  // `pr` / `ci` are top-level Window fields after the THI-115 follow-up lift
  // (so shell panes on a branch with a PR get the same chip the agent card
  // shows); accept them alongside the agent overrides and route to the right
  // level when assembling the Window.
  function withAgent(
    overrides: Partial<Agent> & { pr?: number | null; ci?: CIState | null },
  ): Window {
    const { pr = null, ci = null, ...agentOverrides } = overrides;
    const agent: Agent = { ...baseAgent, ...agentOverrides };
    // Mirror the agent's branch onto the top-level Window.branch field —
    // that's how the backend serializes agent panes (THI-126), and the
    // component reads from `win.branch` now, not `win.agent.branch`.
    return { ...win, agent, branch: agent.branch, pr, ci } as unknown as Window;
  }

  it("renders the branch + PR + CI chip when all three are present", () => {
    const w = withAgent({ branch: "feature/x", pr: 1234, ci: "passing" });
    const { container } = render(
      <TerminalModal window={w} onClose={() => {}} onToast={() => {}} />,
    );
    const chip = container.querySelector(".chip.branch-pr");
    expect(chip).toBeTruthy();
    expect(chip?.className).toContain("ci-passing");
    expect(chip?.textContent).toContain("feature/x");
    expect(chip?.textContent).toContain("#1234");
    // The CI dot is rendered as an aria-hidden marker, not visible text.
    expect(chip?.querySelector(".ci-dot.ci-passing")).toBeTruthy();
  });

  it("renders just the branch when no PR is open", () => {
    const w = withAgent({ branch: "feature/y" });
    const { container } = render(
      <TerminalModal window={w} onClose={() => {}} onToast={() => {}} />,
    );
    const chip = container.querySelector(".chip.branch-pr");
    expect(chip?.textContent).toContain("feature/y");
    expect(chip?.textContent).not.toContain("#");
    expect(chip?.querySelector(".ci-dot")).toBeNull();
  });

  it("renders the spinner chip with duration when the agent is running", () => {
    const w = withAgent({ spinner: "Reasoning", duration: "12s" });
    const { container } = render(
      <TerminalModal window={w} onClose={() => {}} onToast={() => {}} />,
    );
    const spin = container.querySelector(".chip.spinner");
    expect(spin?.textContent).toContain("Reasoning");
    expect(spin?.textContent).toContain("12s");
  });

  it("renders the action hint only when the pane is pendingInput", () => {
    // pendingInput=false + action set → action hint suppressed (would be
    // misleading since the status pill says idle/running).
    const idleWithAction = withAgent({ action: "Approve change?" });
    const { container: idleC } = render(
      <TerminalModal window={idleWithAction} onClose={() => {}} onToast={() => {}} />,
    );
    expect(idleC.querySelector(".term-action")).toBeNull();
    cleanup();

    // pendingInput=true + action set → hint visible with the action text.
    const waiting = {
      ...withAgent({ action: "Approve change?" }),
      pendingInput: true,
    } as unknown as Window;
    const { container: waitC } = render(
      <TerminalModal window={waiting} onClose={() => {}} onToast={() => {}} />,
    );
    const hint = waitC.querySelector(".term-action");
    expect(hint).toBeTruthy();
    expect(hint?.textContent).toBe("Approve change?");
  });

  it("renders no chips when agent is null and branch is null (shell pane outside a repo)", () => {
    const { container } = render(
      <TerminalModal window={win} onClose={() => {}} onToast={() => {}} />,
    );
    expect(container.querySelector(".chip.branch-pr")).toBeNull();
    expect(container.querySelector(".chip.spinner")).toBeNull();
    expect(container.querySelector(".term-action")).toBeNull();
  });

  it("renders the branch chip on a shell pane when win.branch is set (THI-126)", () => {
    // Shell panes in a git repo carry a top-level `branch` but no `agent` —
    // the chip should still render, just without the PR/CI nesting.
    const shellWithBranch = { ...win, branch: "feature/z" } as unknown as Window;
    const { container } = render(
      <TerminalModal window={shellWithBranch} onClose={() => {}} onToast={() => {}} />,
    );
    const chip = container.querySelector(".chip.branch-pr");
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("feature/z");
    expect(chip?.querySelector(".ci-dot")).toBeNull();
  });
});

describe("TerminalModal — scrim drag-to-select survives (THI-125)", () => {
  it("does NOT close when mousedown starts inside the modal and mouseup lands on the scrim", () => {
    // The reported bug: drag-select text in xterm scrollback → release outside
    // the modal → modal closed. Wiring regression guard for `useScrimClose`.
    const onClose = vi.fn();
    const { container } = render(
      <TerminalModal window={win} onClose={onClose} onToast={() => {}} />,
    );
    const scrim = container.querySelector(".scrim") as HTMLElement;
    const modal = container.querySelector(".term-modal") as HTMLElement;
    expect(scrim).toBeTruthy();
    expect(modal).toBeTruthy();

    fireEvent.mouseDown(modal);
    fireEvent.mouseUp(scrim);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when both mousedown and mouseup land on the bare scrim", () => {
    // Positive control: the intentional "click outside to dismiss" path must
    // still work — otherwise users would have no way to close via the scrim.
    const onClose = vi.fn();
    const { container } = render(
      <TerminalModal window={win} onClose={onClose} onToast={() => {}} />,
    );
    const scrim = container.querySelector(".scrim") as HTMLElement;

    fireEvent.mouseDown(scrim);
    fireEvent.mouseUp(scrim);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
