import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
});
