import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, updateSettings } from "./settings";

const STORAGE_KEY = "switchboard:settings";

afterEach(() => {
  // Reset settings so prior-test mutations don't leak. Mirrors the
  // convention in settings.test.tsx; localStorage.clear() alone would
  // leave the in-memory `current` out of sync with storage.
  updateSettings(DEFAULT_SETTINGS);
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

describe("settings.defaultDirectory (THI-244)", () => {
  it("is empty string in DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS.defaultDirectory).toBe("");
  });

  it("round-trips through localStorage via updateSettings", () => {
    updateSettings({ defaultDirectory: "~/dev" });
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw!) as { defaultDirectory: string };
    expect(parsed.defaultDirectory).toBe("~/dev");
  });
});
