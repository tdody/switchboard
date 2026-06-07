import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, updateSettings } from "./settings";

const STORAGE_KEY = "switchboard:settings";

afterEach(() => {
  // Reset settings so prior-test mutations don't leak. Mirrors the
  // convention in settings.test.tsx; localStorage.clear() alone would
  // leave the in-memory `current` out of sync with storage.
  updateSettings(DEFAULT_SETTINGS);
});

describe("settings.selectedPaneId + splitRailWidth (THI-246)", () => {
  it("defaults the selected pane to empty string and the rail to 280px", () => {
    expect(DEFAULT_SETTINGS.selectedPaneId).toBe("");
    expect(DEFAULT_SETTINGS.splitRailWidth).toBe(280);
  });

  it("round-trips both through localStorage", () => {
    updateSettings({ selectedPaneId: "%42", splitRailWidth: 320 });
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY)!,
    ) as { selectedPaneId: string; splitRailWidth: number };
    expect(parsed.selectedPaneId).toBe("%42");
    expect(parsed.splitRailWidth).toBe(320);
  });
});

describe("settings.idleCleanupDays", () => {
  it("is present in DEFAULT_SETTINGS with value 7", () => {
    expect(DEFAULT_SETTINGS.idleCleanupDays).toBe(7);
  });

  it("round-trips through localStorage via updateSettings", () => {
    updateSettings({ idleCleanupDays: 14 });
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { idleCleanupDays: number };
    expect(parsed.idleCleanupDays).toBe(14);
  });
});
