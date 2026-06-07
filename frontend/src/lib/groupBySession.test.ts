import { describe, expect, it } from "vitest";

import { groupBySession } from "./groupBySession";
import { mkWindow } from "../test/factories";

describe("groupBySession", () => {
  it("groups windows into per-session buckets", () => {
    const a = mkWindow({ paneId: "%1", session: "alpha" });
    const b = mkWindow({ paneId: "%2", session: "beta" });
    const c = mkWindow({ paneId: "%3", session: "alpha" });
    const result = groupBySession([a, b, c]);
    expect(result.size).toBe(2);
    expect(result.get("alpha")?.map((w) => w.paneId)).toEqual(["%1", "%3"]);
    expect(result.get("beta")?.map((w) => w.paneId)).toEqual(["%2"]);
  });

  it("preserves input order within each bucket", () => {
    const w1 = mkWindow({ paneId: "%1", session: "s", index: 2 });
    const w2 = mkWindow({ paneId: "%2", session: "s", index: 1 });
    const w3 = mkWindow({ paneId: "%3", session: "s", index: 3 });
    // Input order, not index order — the per-view sort runs later.
    expect(
      groupBySession([w1, w2, w3]).get("s")?.map((w) => w.paneId),
    ).toEqual(["%1", "%2", "%3"]);
  });

  it("returns an empty map for an empty input", () => {
    expect(groupBySession([]).size).toBe(0);
  });

  it("returns absent (undefined) for sessions with no visible windows", () => {
    const a = mkWindow({ paneId: "%1", session: "alpha" });
    const result = groupBySession([a]);
    expect(result.get("beta")).toBeUndefined();
  });
});
