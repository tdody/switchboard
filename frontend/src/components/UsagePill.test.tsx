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
