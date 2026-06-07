import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { CleanupModal } from "./CleanupModal";
import { mkWindow } from "../test/factories";

const killWindowMock = vi.fn<(s: string, i: number) => Promise<boolean>>();

vi.mock("../api/client", () => ({
  killWindow: (s: string, i: number) => killWindowMock(s, i),
}));

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
