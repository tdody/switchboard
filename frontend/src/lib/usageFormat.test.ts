import { describe, expect, it } from "vitest";

import {
  ACTIVE_TOKEN_DANGER_THRESHOLD,
  ACTIVE_TOKEN_WARN_THRESHOLD,
  activeTokens,
  fmtResetCountdown,
  fmtTokens,
  meterTone,
  tokenTone,
} from "./usageFormat";

describe("fmtTokens", () => {
  it("renders sub-thousand counts verbatim", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(42)).toBe("42");
    expect(fmtTokens(999)).toBe("999");
  });

  it("renders thousands with one decimal + 'k' suffix", () => {
    expect(fmtTokens(1_000)).toBe("1.0k");
    expect(fmtTokens(1_532)).toBe("1.5k");
    expect(fmtTokens(99_999)).toBe("100.0k");
  });

  it("renders millions with two decimals + 'M' suffix", () => {
    expect(fmtTokens(1_000_000)).toBe("1.00M");
    expect(fmtTokens(1_240_000)).toBe("1.24M");
    expect(fmtTokens(4_700_000)).toBe("4.70M");
  });
});

describe("fmtResetCountdown", () => {
  // Anchor: 2026-05-23T20:00:00Z = 1779559200
  const NOW = 1779559200 * 1000;

  it("returns null when no reset anchor is set", () => {
    expect(fmtResetCountdown(null, NOW)).toBe(null);
  });

  it("returns 'now' when reset is at-or-before now", () => {
    expect(fmtResetCountdown(1779559200, NOW)).toBe("now");
    expect(fmtResetCountdown(1779559199, NOW)).toBe("now");
  });

  it("formats sub-hour intervals as minutes only", () => {
    // +4 minutes
    expect(fmtResetCountdown(1779559200 + 4 * 60, NOW)).toBe("in 4m");
    expect(fmtResetCountdown(1779559200 + 59 * 60, NOW)).toBe("in 59m");
  });

  it("formats over-hour intervals as h+m", () => {
    expect(fmtResetCountdown(1779559200 + 2 * 3600 + 11 * 60, NOW)).toBe("in 2h 11m");
    expect(fmtResetCountdown(1779559200 + 5 * 3600, NOW)).toBe("in 5h 0m");
  });
});

describe("activeTokens", () => {
  it("sums input + cache_creation + output and excludes cache_read", () => {
    expect(
      activeTokens({ inputTokens: 100, cacheCreationTokens: 200, outputTokens: 50 }),
    ).toBe(350);
  });

  it("ignores the cache_read field even when it dominates", () => {
    // The whole point of split-out 'active': a 100M cache-read read shouldn't
    // pin the pill in danger when the user's real spend is tiny.
    expect(
      activeTokens({ inputTokens: 1, cacheCreationTokens: 0, outputTokens: 1 }),
    ).toBe(2);
  });
});

describe("tokenTone", () => {
  it("flips at the warn + danger thresholds (active tokens)", () => {
    expect(tokenTone(0)).toBe("ok");
    expect(tokenTone(ACTIVE_TOKEN_WARN_THRESHOLD - 1)).toBe("ok");
    expect(tokenTone(ACTIVE_TOKEN_WARN_THRESHOLD)).toBe("warn");
    expect(tokenTone(ACTIVE_TOKEN_DANGER_THRESHOLD - 1)).toBe("warn");
    expect(tokenTone(ACTIVE_TOKEN_DANGER_THRESHOLD)).toBe("danger");
  });
});

describe("meterTone", () => {
  it("flips at the warn + danger thresholds (percentages)", () => {
    expect(meterTone(0)).toBe("ok");
    expect(meterTone(69)).toBe("ok");
    expect(meterTone(70)).toBe("warn");
    expect(meterTone(89)).toBe("warn");
    expect(meterTone(90)).toBe("danger");
    expect(meterTone(100)).toBe("danger");
  });
});
