import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { CleanupModal } from "./CleanupModal";
import { mkWindow } from "../test/factories";

const killWindowMock = vi.fn<(s: string, i: number) => Promise<boolean>>();

vi.mock("../api/client", () => ({
  killWindow: (s: string, i: number) => killWindowMock(s, i),
}));

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const DAY_MS = 86_400_000;
const NOW = 100 * DAY_MS;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  killWindowMock.mockReset();
});

function renderModal(
  windows: ReturnType<typeof mkWindow>[],
  pinnedIds = new Set<string>(),
  thresholdDays = 7,
) {
  return render(
    <CleanupModal
      windows={windows}
      pinnedIds={pinnedIds}
      thresholdDays={thresholdDays}
      onClose={() => {}}
      onAfterCleanup={() => {}}
    />,
  );
}

describe("CleanupModal — Step 1", () => {
  it("renders Step-1 header with the candidate count", () => {
    renderModal([
      mkWindow({ paneId: "%a", session: "alpha", lastActivity: NOW - 30 * DAY_MS }),
      mkWindow({ paneId: "%b", session: "beta", lastActivity: NOW - 14 * DAY_MS }),
    ]);
    expect(screen.getByText(/2 candidates/i)).toBeTruthy();
  });

  it("renders one row per candidate (oldest first)", () => {
    renderModal([
      mkWindow({ paneId: "%a", session: "alpha", name: "old-one", lastActivity: NOW - 30 * DAY_MS }),
      mkWindow({ paneId: "%b", session: "beta", name: "newer-one", lastActivity: NOW - 14 * DAY_MS }),
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("alpha");
    expect(rows[0]!.textContent).toContain("old-one");
    expect(rows[1]!.textContent).toContain("beta");
  });

  it("disables the Review button when no rows are checked", () => {
    renderModal([
      mkWindow({ paneId: "%a", lastActivity: NOW - 30 * DAY_MS }),
    ]);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);  // uncheck
    const reviewBtn = screen.getByRole("button", { name: /review/i });
    expect((reviewBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("auto-unchecks mid-turn agent rows with the 'agent active' tag", () => {
    renderModal([
      mkWindow({
        paneId: "%a",
        session: "alpha",
        kind: "agent",
        status: "running",
        lastActivity: NOW - 30 * DAY_MS,
      }),
    ]);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/agent active/i)).toBeTruthy();
  });

  it("auto-unchecks pinned rows with the 'pinned' tag", () => {
    renderModal(
      [mkWindow({ paneId: "%p", session: "p", lastActivity: NOW - 30 * DAY_MS })],
      new Set(["%p"]),
    );
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText(/pinned/i)).toBeTruthy();
  });

  it("leaves non-pinned, non-mid-turn rows checked by default", () => {
    // Use an agent with status "idle" to confirm the non-running agent path
    // takes the default-checked branch (the more interesting boundary than
    // the trivial shell case, which is also covered by the toggle test).
    renderModal([
      mkWindow({
        paneId: "%a",
        session: "a",
        kind: "agent",
        status: "idle",
        lastActivity: NOW - 30 * DAY_MS,
      }),
    ]);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("toggles row checkbox and updates the Review button count", () => {
    renderModal([
      mkWindow({ paneId: "%a", session: "a", lastActivity: NOW - 30 * DAY_MS }),
      mkWindow({ paneId: "%b", session: "b", lastActivity: NOW - 20 * DAY_MS, index: 2, id: "b:2" }),
    ]);
    expect(screen.getByRole("button", { name: /review 2 selected/i })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByRole("button", { name: /review 1 selected/i })).toBeTruthy();
  });
});

describe("CleanupModal — Step 2 (Confirm)", () => {
  it("advances to the Confirm view when clicking 'Review N selected'", () => {
    renderModal([
      mkWindow({ paneId: "%a", session: "alpha", name: "old", lastActivity: NOW - 30 * DAY_MS }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    expect(screen.getByText(/close 1 panes\?/i)).toBeTruthy();
    expect(screen.getByText(/these 1 panes will be closed/i)).toBeTruthy();
    const list = screen.getByRole("list");
    expect(within(list).getByText("alpha")).toBeTruthy();
    expect(within(list).getByText("old")).toBeTruthy();
  });

  it("renders 'Back' and 'Confirm close' on Step 2 (no Cancel)", () => {
    renderModal([
      mkWindow({ paneId: "%a", session: "alpha", lastActivity: NOW - 30 * DAY_MS }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    expect(screen.getByRole("button", { name: /← back/i })).toBeTruthy();
    const confirmBtn = screen.getByRole("button", {
      name: /confirm close/i,
    }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
    // Cancel is a Step-1 footer button; it must be gone on Step 2.
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("preserves selection when navigating Back from Step 2", () => {
    renderModal([
      mkWindow({ paneId: "%a", session: "a", lastActivity: NOW - 30 * DAY_MS }),
      mkWindow({ paneId: "%b", session: "b", lastActivity: NOW - 20 * DAY_MS, index: 2, id: "b:2" }),
    ]);
    // Uncheck the first row, advance, then go back.
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /← back/i }));
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes[0]!.checked).toBe(false); // unchecked state preserved
    expect(boxes[1]!.checked).toBe(true);
  });

  it("shows the last-window hint when the selection covers all windows of a session", () => {
    renderModal([
      // alpha has one window; selecting it triggers the hint.
      mkWindow({ paneId: "%a", session: "alpha", lastActivity: NOW - 30 * DAY_MS }),
      // beta has two; selecting one wouldn't trigger the hint.
      mkWindow({ paneId: "%b", session: "beta", index: 1, id: "beta:1", lastActivity: NOW - 25 * DAY_MS }),
      mkWindow({ paneId: "%c", session: "beta", index: 2, id: "beta:2", lastActivity: NOW - 20 * DAY_MS }),
    ]);
    // Uncheck the two `beta` rows, keep `alpha` checked.
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[1]!);
    fireEvent.click(boxes[2]!);
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    const warn = screen.getByText(/closes the session/i);
    // The hint must name the affected session — alpha being elsewhere
    // in the DOM (the list row) is not enough.
    expect(warn.textContent).toMatch(/alpha/i);
  });

  it("hides the last-window hint when no selected row is alone in its session", () => {
    renderModal([
      mkWindow({ paneId: "%a", session: "a", index: 1, id: "a:1", lastActivity: NOW - 30 * DAY_MS }),
      mkWindow({ paneId: "%b", session: "a", index: 2, id: "a:2", lastActivity: NOW - 20 * DAY_MS }),
    ]);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!); // uncheck one
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    expect(screen.queryByText(/closes the session/i)).toBeNull();
  });

  it("Step-2 summary does not change when `windows` prop updates mid-review", () => {
    const w0 = mkWindow({ paneId: "%a", session: "alpha", lastActivity: NOW - 30 * DAY_MS });
    const { rerender } = renderModal([w0]);
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    expect(screen.getByText("alpha")).toBeTruthy();

    // Simulate a background /api/state poll wiping the candidate list.
    rerender(
      <CleanupModal
        windows={[]}
        pinnedIds={new Set()}
        thresholdDays={7}
        onClose={() => {}}
        onAfterCleanup={() => {}}
      />,
    );
    // The Step-2 snapshot is still the alpha row.
    expect(screen.getByText("alpha")).toBeTruthy();
  });

  it("last-window hint stays visible after a background poll adds a new window to the session", () => {
    const alpha = mkWindow({ paneId: "%a", session: "alpha", lastActivity: NOW - 30 * DAY_MS });
    const { rerender } = renderModal([alpha]);
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    // Pre-condition: hint is visible because alpha has 1 total window, 1 selected.
    expect(screen.getByText(/closes the session/i)).toBeTruthy();

    // Simulate a /api/state poll that adds a second window to session "alpha".
    // If snapshotAllWindows were live-bound, lastWindowSessions would now
    // compute selected(1) < total(2) and suppress the hint.
    const alpha2 = mkWindow({
      paneId: "%a2",
      session: "alpha",
      index: 2,
      id: "alpha:2",
      lastActivity: NOW - 5 * DAY_MS,  // fresh; wouldn't be a candidate anyway
    });
    rerender(
      <CleanupModal
        windows={[alpha, alpha2]}
        pinnedIds={new Set()}
        thresholdDays={7}
        onClose={() => {}}
        onAfterCleanup={() => {}}
      />,
    );

    // The hint MUST still be visible because snapshotAllWindows was frozen
    // when the user clicked "Review 1 selected →" above.
    expect(screen.getByText(/closes the session/i)).toBeTruthy();
  });
});

describe("CleanupModal — execute + Esc", () => {
  it("calls killWindow once per snapshot row on Confirm close", async () => {
    killWindowMock.mockResolvedValue(true);
    const onClose = vi.fn();
    const onAfterCleanup = vi.fn<(s: { ok: number; failed: number }) => void>();
    render(
      <CleanupModal
        windows={[
          mkWindow({ paneId: "%a", session: "a", index: 1, lastActivity: NOW - 30 * DAY_MS }),
          mkWindow({ paneId: "%b", session: "b", index: 2, id: "b:2", lastActivity: NOW - 20 * DAY_MS }),
        ]}
        pinnedIds={new Set()}
        thresholdDays={7}
        onClose={onClose}
        onAfterCleanup={onAfterCleanup}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /review 2 selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm close/i }));
    await flushPromises();
    expect(killWindowMock).toHaveBeenCalledTimes(2);
    expect(killWindowMock).toHaveBeenCalledWith("a", 1);
    expect(killWindowMock).toHaveBeenCalledWith("b", 2);
    expect(onAfterCleanup).toHaveBeenCalledWith({ ok: 2, failed: 0 });
    expect(onClose).toHaveBeenCalled();
  });

  it("counts non-2xx kills as failures in the summary", async () => {
    killWindowMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const onClose = vi.fn();
    const onAfterCleanup = vi.fn<(s: { ok: number; failed: number }) => void>();
    render(
      <CleanupModal
        windows={[
          mkWindow({ paneId: "%a", session: "a", index: 1, lastActivity: NOW - 30 * DAY_MS }),
          mkWindow({ paneId: "%b", session: "b", index: 2, id: "b:2", lastActivity: NOW - 20 * DAY_MS }),
        ]}
        pinnedIds={new Set()}
        thresholdDays={7}
        onClose={onClose}
        onAfterCleanup={onAfterCleanup}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /review 2 selected/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm close/i }));
    await flushPromises();
    expect(onAfterCleanup).toHaveBeenCalledWith({ ok: 1, failed: 1 });
    // onClose must still fire even on partial failure.
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc from Step 1 closes the modal", () => {
    const onClose = vi.fn();
    render(
      <CleanupModal
        windows={[mkWindow({ paneId: "%a", lastActivity: NOW - 30 * DAY_MS })]}
        pinnedIds={new Set()}
        thresholdDays={7}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc from Step 2 returns to Step 1 (does NOT close)", () => {
    const onClose = vi.fn();
    render(
      <CleanupModal
        windows={[mkWindow({ paneId: "%a", session: "alpha", lastActivity: NOW - 30 * DAY_MS })]}
        pinnedIds={new Set()}
        thresholdDays={7}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /review 1 selected/i }));
    expect(screen.getByText(/close 1 panes\?/i)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /review 1 selected/i })).toBeTruthy(); // back on Step 1
    // Also confirm Step-2 content is actually gone, not just that Step-1 is present.
    expect(screen.queryByText(/close 1 panes\?/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm close/i })).toBeNull();
  });
});
