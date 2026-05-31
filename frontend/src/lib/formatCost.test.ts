import { describe, expect, it } from "vitest";

import { formatCost, formatTokens, formatUsd } from "./formatCost";

describe("formatUsd", () => {
  it("renders sub-cent values with 4 decimals", () => {
    expect(formatUsd(0)).toBe("~$0.0000");
    expect(formatUsd(0.0001)).toBe("~$0.0001");
    expect(formatUsd(0.00214)).toBe("~$0.0021");
    expect(formatUsd(0.0099)).toBe("~$0.0099");
  });

  it("renders cent-to-dollar values with 3 decimals", () => {
    expect(formatUsd(0.01)).toBe("~$0.010");
    expect(formatUsd(0.015)).toBe("~$0.015");
    expect(formatUsd(0.999)).toBe("~$0.999");
  });

  it("renders dollar+ values with 2 decimals", () => {
    expect(formatUsd(1)).toBe("~$1.00");
    expect(formatUsd(1.23)).toBe("~$1.23");
    expect(formatUsd(42.123)).toBe("~$42.12");
  });

  it("guards against NaN / negative inputs", () => {
    expect(formatUsd(Number.NaN)).toBe("~$0.0000");
    expect(formatUsd(-1)).toBe("~$0.0000");
  });
});

describe("formatTokens", () => {
  it("renders sub-thousand counts verbatim (truncated to int)", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(999.9)).toBe("999");
  });

  it("renders thousands with one decimal + `k` suffix", () => {
    expect(formatTokens(1_000)).toBe("1.0k");
    expect(formatTokens(1_532)).toBe("1.5k");
    expect(formatTokens(99_999)).toBe("100.0k");
  });

  it("renders millions with two decimals + `M` suffix", () => {
    expect(formatTokens(1_000_000)).toBe("1.00M");
    expect(formatTokens(1_240_000)).toBe("1.24M");
  });
});

describe("formatCost", () => {
  it("matches the ticket-quoted example format exactly", () => {
    // From the THI-67 ticket: "~$0.0021 · 2.4k tokens"
    expect(formatCost(0.00214, 2421)).toBe("~$0.0021 · 2.4k tokens");
  });

  it("uses the right precision tier per magnitude", () => {
    expect(formatCost(0.0001, 12)).toBe("~$0.0001 · 12 tokens");
    expect(formatCost(0.015, 18_234)).toBe("~$0.015 · 18.2k tokens");
    expect(formatCost(2.4, 1_240_000)).toBe("~$2.40 · 1.24M tokens");
  });
});
