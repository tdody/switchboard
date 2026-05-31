import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { AutoRenameResult } from "../api/client";
import { AutoRenameModal } from "./AutoRenameModal";

const autoRenameMock = vi.fn<(s: string) => Promise<AutoRenameResult>>();
const renameMock = vi.fn<(s: string, i: number, n: string) => Promise<boolean>>();

vi.mock("../api/client", () => ({
  autoRenameSession: (s: string) => autoRenameMock(s),
  renameWindow: (s: string, i: number, n: string) => renameMock(s, i, n),
}));

const okResponse = (
  rows: Array<{ index: number; old: string; suggested: string }>,
): AutoRenameResult => ({
  ok: true,
  data: {
    suggestions: rows,
    usage: { inputTokens: 100, outputTokens: 20, estCostUsd: 0.0002 },
  },
});

afterEach(() => {
  cleanup();
  autoRenameMock.mockReset();
  renameMock.mockReset();
});

async function flushPromises() {
  // Drain microtasks so the on-mount fetch promise resolves and the next
  // render happens before assertions.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AutoRenameModal", () => {
  it("shows the loading state before suggestions arrive", () => {
    let resolve: (r: AutoRenameResult) => void = () => {};
    autoRenameMock.mockReturnValueOnce(
      new Promise<AutoRenameResult>((r) => {
        resolve = r;
      }),
    );
    render(
      <AutoRenameModal
        session="main"
        onClose={() => {}}
        onApplied={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(screen.getByText(/asking claude/i)).toBeTruthy();
    resolve(okResponse([]));
  });

  it("renders one row per suggestion with the old + suggested names", async () => {
    autoRenameMock.mockResolvedValueOnce(
      okResponse([
        { index: 1, old: "shell", suggested: "fs-build" },
        { index: 2, old: "claude", suggested: "cohort-inv" },
      ]),
    );
    render(
      <AutoRenameModal
        session="main"
        onClose={() => {}}
        onApplied={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await flushPromises();
    // Old names render as plain text on each row.
    expect(screen.getByText("shell")).toBeTruthy();
    expect(screen.getByText("claude")).toBeTruthy();
    // Suggested names render as input values (accepted by default).
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["fs-build", "cohort-inv"]);
  });

  it("pre-skips no-op rows where suggested === old", async () => {
    autoRenameMock.mockResolvedValueOnce(
      okResponse([
        { index: 3, old: "main", suggested: "main" }, // no-op
        { index: 4, old: "shell", suggested: "fs-build" }, // accepted
      ]),
    );
    render(
      <AutoRenameModal
        session="main"
        onClose={() => {}}
        onApplied={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await flushPromises();
    // Apply button counts only the auto-accepted row.
    expect(screen.getByRole("button", { name: /Apply 1/ })).toBeTruthy();
  });

  it("toggling skip flips the accepted count and the row's input visibility", async () => {
    autoRenameMock.mockResolvedValueOnce(
      okResponse([{ index: 1, old: "shell", suggested: "fs-build" }]),
    );
    render(
      <AutoRenameModal
        session="main"
        onClose={() => {}}
        onApplied={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await flushPromises();
    // Starts accepted: input present + Apply 1.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    // Button label is the visible text "skip" (toggles to "include" when off);
    // the title attribute is supplementary, not the accessible name.
    const skip = screen.getByRole("button", { name: "skip" });
    fireEvent.click(skip);
    // Now skipped: no input (back to plain text), Apply 0 disabled.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    const apply = screen.getByRole("button", { name: /Apply 0/ });
    expect(apply.hasAttribute("disabled")).toBe(true);
  });

  it("editing a name updates what gets sent to /api/rename on apply", async () => {
    autoRenameMock.mockResolvedValueOnce(
      okResponse([{ index: 1, old: "shell", suggested: "fs-build" }]),
    );
    renameMock.mockResolvedValue(true);
    const onApplied = vi.fn();
    const onClose = vi.fn();
    render(
      <AutoRenameModal
        session="main"
        onClose={onClose}
        onApplied={onApplied}
        onOpenSettings={() => {}}
      />,
    );
    await flushPromises();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hand-edited" } });
    fireEvent.click(screen.getByRole("button", { name: /Apply 1/ }));
    await flushPromises();
    expect(renameMock).toHaveBeenCalledWith("main", 1, "hand-edited");
    expect(onApplied).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the cost footer in the ticket-spec format", async () => {
    autoRenameMock.mockResolvedValueOnce({
      ok: true,
      data: {
        suggestions: [{ index: 1, old: "shell", suggested: "fs-build" }],
        usage: { inputTokens: 2000, outputTokens: 421, estCostUsd: 0.00214 },
      },
    });
    render(
      <AutoRenameModal
        session="main"
        onClose={() => {}}
        onApplied={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await flushPromises();
    // 2000 + 421 = 2421 tokens; ticket example: "~$0.0021 · 2.4k tokens"
    expect(screen.getByText("~$0.0021 · 2.4k tokens")).toBeTruthy();
  });

  it("shows the configure-key CTA on a 503 and routes the click to Settings", async () => {
    autoRenameMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "Anthropic API key not set",
    });
    const onOpenSettings = vi.fn();
    const onClose = vi.fn();
    render(
      <AutoRenameModal
        session="main"
        onClose={onClose}
        onApplied={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    );
    await flushPromises();
    expect(screen.getByText(/Auto-rename needs an Anthropic API key/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open Settings/i }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("shows the error detail when the backend returns 502", async () => {
    autoRenameMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      error: "model returned invalid JSON: ...",
    });
    render(
      <AutoRenameModal
        session="main"
        onClose={() => {}}
        onApplied={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    await flushPromises();
    expect(screen.getByText(/Couldn't get suggestions/i)).toBeTruthy();
    expect(screen.getByText(/model returned invalid JSON/i)).toBeTruthy();
  });
});
