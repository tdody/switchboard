import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { UsagePill } from "./UsagePill";
import type { UsageResponse } from "../types";

const baseTokens = {
  available: true,
  windowHours: 5.0,
  messages: 4,
  inputTokens: 200,
  cacheCreationTokens: 50,
  cacheReadTokens: 1_000,
  outputTokens: 150,
  totalTokens: 1_400,
  resetAt: null as number | null,
};

afterEach(cleanup);

describe("UsagePill", () => {
  it("renders nothing when usage is null", () => {
    const { container } = render(<UsagePill usage={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when tokens are unavailable and there is no scrape", () => {
    const usage: UsageResponse = {
      tokens: { ...baseTokens, available: false },
      scrape: null,
    };
    const { container } = render(<UsagePill usage={usage} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the token window with compact formatting (active tokens only)", () => {
    const usage: UsageResponse = { tokens: baseTokens, scrape: null };
    render(<UsagePill usage={usage} />);
    expect(screen.getByText("5h")).toBeTruthy();
    // baseTokens: input 200 + cache_creation 50 + output 150 = 400 active.
    // (cache_read 1000 is excluded — see activeTokens helper.)
    expect(screen.getByText("400")).toBeTruthy();
  });

  it("excludes cache_read tokens from the pill headline", () => {
    // Sanity guard: a huge cache_read shouldn't show in the headline number,
    // since plan throttling is driven by active tokens.
    const usage: UsageResponse = {
      tokens: { ...baseTokens, cacheReadTokens: 100_000_000 },
      scrape: null,
    };
    render(<UsagePill usage={usage} />);
    expect(screen.queryByText(/100\.00M/)).toBeNull();
    expect(screen.getByText("400")).toBeTruthy();
  });

  it("omits the countdown when resetAt is null", () => {
    const usage: UsageResponse = { tokens: baseTokens, scrape: null };
    render(<UsagePill usage={usage} />);
    // The "resets …" label only appears when there's a real anchor.
    expect(screen.queryByText(/resets/)).toBeNull();
  });

  it("includes the countdown when resetAt is set", () => {
    const usage: UsageResponse = {
      tokens: { ...baseTokens, resetAt: Math.floor(Date.now() / 1000) + 2 * 3600 + 15 * 60 },
      scrape: null,
    };
    render(<UsagePill usage={usage} />);
    // Allow a tiny window for ms drift (countdown computes from Date.now()
    // inside the format helper) — accept 2h 14m or 2h 15m.
    const node = screen.getByText(/resets in 2h 1[45]m/);
    expect(node).toBeTruthy();
  });

  it("renders the meters branch when scrape data is available", () => {
    const usage: UsageResponse = {
      tokens: baseTokens,
      scrape: {
        available: true,
        meters: {
          session: { label: "Current session", percent: 35, resets: "12:20am" },
          week_all: { label: "Current week (all models)", percent: 4, resets: "" },
        },
      },
    };
    const { container } = render(<UsagePill usage={usage} />);
    // The pill switches to the meters variant.
    const pill = container.querySelector(".usage-pill");
    expect(pill?.className).toContain("usage-pill-meters");
    // Both meters render with their percentages.
    expect(screen.getByText("35%")).toBeTruthy();
    expect(screen.getByText("4%")).toBeTruthy();
    // Short labels — full labels live in the title tooltip.
    expect(screen.getByText("session")).toBeTruthy();
    expect(screen.getByText("week")).toBeTruthy();
  });

  it("ignores unknown meter keys gracefully", () => {
    // Defends against a future claude release adding a fourth bar with a key
    // we don't know about — the pill should still render the known ones,
    // not crash.
    const usage: UsageResponse = {
      tokens: baseTokens,
      scrape: {
        available: true,
        meters: {
          session: { label: "Current session", percent: 12, resets: "" },
          // Hypothetical future key — not in METER_ORDER, must be skipped:
          some_new_meter: { label: "Future", percent: 99, resets: "" },
        },
      },
    };
    render(<UsagePill usage={usage} />);
    expect(screen.getByText("12%")).toBeTruthy();
    expect(screen.queryByText("99%")).toBeNull();
  });

  it("falls through to the token branch when scrape.available is false", () => {
    const usage: UsageResponse = {
      tokens: baseTokens,
      scrape: { available: false, meters: {} },
    };
    render(<UsagePill usage={usage} />);
    // Token branch active: 5h chip visible, no meter bars.
    expect(screen.getByText("5h")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("applies the danger tone class above the danger threshold (active tokens)", () => {
    const usage: UsageResponse = {
      tokens: {
        ...baseTokens,
        // 6M active tokens: 5M cache_creation + 500k input + 500k output.
        inputTokens: 500_000,
        cacheCreationTokens: 5_000_000,
        outputTokens: 500_000,
      },
      scrape: null,
    };
    const { container } = render(<UsagePill usage={usage} />);
    const pill = container.querySelector(".usage-pill");
    expect(pill?.className).toContain("usage-pill-danger");
  });
});
