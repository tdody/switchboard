import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_SETTINGS, updateSettings } from "../lib/settings";
import { SettingsModal } from "./SettingsModal";

// Stub the network-dependent helpers so the modal renders cleanly.
vi.mock("../api/client", () => ({
  fetchAiStatus: () => new Promise(() => {}),
  fetchUsageConfig: () => new Promise(() => {}),
}));

vi.mock("../lib/useIdeConfig", () => ({
  useIdeConfig: () => ({ available: [], default: null }),
}));

afterEach(() => {
  // Reset settings so prior-test mutations don't leak. Matches the
  // convention in settings.test.tsx; localStorage.clear() alone would
  // leave the in-memory `current` out of sync with storage.
  updateSettings(DEFAULT_SETTINGS);
  cleanup();
});

function renderSettings(onOpenCleanup = () => {}) {
  return render(
    <SettingsModal
      serverAddr="127.0.0.1:8765"
      sessionCount={0}
      windowCount={0}
      onClose={() => {}}
      onOpenCleanup={onOpenCleanup}
    />,
  );
}

describe("SettingsModal — Maintenance section", () => {
  it("renders the Maintenance heading", () => {
    renderSettings();
    expect(screen.getByText(/maintenance/i)).toBeTruthy();
  });

  it("renders the idle threshold input with the current value", () => {
    renderSettings();
    const input = screen.getByLabelText(/idle-pane cleanup threshold/i) as HTMLInputElement;
    expect(input.value).toBe("7"); // DEFAULT_SETTINGS.idleCleanupDays
  });

  it("renders the 'Clean up idle panes…' button when threshold > 0", () => {
    renderSettings();
    expect(screen.getByRole("button", { name: /clean up idle panes/i })).toBeTruthy();
  });

  it("invokes onOpenCleanup when the button is clicked", () => {
    const onOpenCleanup = vi.fn();
    renderSettings(onOpenCleanup);
    fireEvent.click(screen.getByRole("button", { name: /clean up idle panes/i }));
    expect(onOpenCleanup).toHaveBeenCalled();
  });

  it("hides the action button when threshold is 0", () => {
    renderSettings();
    const input = screen.getByLabelText(/idle-pane cleanup threshold/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.queryByRole("button", { name: /clean up idle panes/i })).toBeNull();
  });
});
