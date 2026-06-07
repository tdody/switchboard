import { describe, expect, it } from "vitest";

import { OTHER_REPO_KEY, OTHER_REPO_LABEL, groupByRepo } from "./groupByRepo";
import { mkWindow } from "../test/factories";

describe("groupByRepo", () => {
  it("buckets windows by their session's first-seen repo", () => {
    const a1 = mkWindow({
      paneId: "%a1",
      session: "alpha",
      repoKey: "/r/alpha",
      repoLabel: "alpha",
    });
    const a2 = mkWindow({
      paneId: "%a2",
      session: "alpha",
      repoKey: "/r/alpha",
      repoLabel: "alpha",
    });
    const b1 = mkWindow({
      paneId: "%b1",
      session: "beta",
      repoKey: "/r/beta",
      repoLabel: "beta",
    });
    const groups = groupByRepo([a1, a2, b1]);
    expect(groups.map((g) => g.key)).toEqual(["/r/alpha", "/r/beta"]);
    expect(groups[0]!.windows.map((w) => w.paneId)).toEqual(["%a1", "%a2"]);
    expect(groups[1]!.windows.map((w) => w.paneId)).toEqual(["%b1"]);
  });

  it("pins a session to the first git-backed window's repo (sessions atomic)", () => {
    // Same session, two windows: first is non-git, second is in /r/alpha.
    // The session must land under /r/alpha — first GIT-BACKED window wins —
    // and BOTH windows render under that bucket.
    const noGit = mkWindow({
      paneId: "%n1",
      session: "mixed",
      repoKey: null,
      repoLabel: null,
    });
    const inAlpha = mkWindow({
      paneId: "%n2",
      session: "mixed",
      repoKey: "/r/alpha",
      repoLabel: "alpha",
    });
    const groups = groupByRepo([noGit, inAlpha]);
    expect(groups.map((g) => g.key)).toEqual(["/r/alpha"]);
    expect(groups[0]!.windows.map((w) => w.paneId)).toEqual(["%n1", "%n2"]);
  });

  it("a session whose windows span repos lands under the first-seen repo", () => {
    const a = mkWindow({
      paneId: "%a",
      session: "x",
      repoKey: "/r/alpha",
      repoLabel: "alpha",
    });
    const b = mkWindow({
      paneId: "%b",
      session: "x",
      repoKey: "/r/beta",
      repoLabel: "beta",
    });
    const groups = groupByRepo([a, b]);
    // /r/alpha was seen first → session "x" lives entirely there.
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("/r/alpha");
    expect(groups[0]!.windows.map((w) => w.paneId)).toEqual(["%a", "%b"]);
  });

  it("sessions with no git-backed window land in Other (pinned to bottom)", () => {
    const a = mkWindow({
      paneId: "%a",
      session: "alpha",
      repoKey: "/r/alpha",
      repoLabel: "alpha",
    });
    const o1 = mkWindow({
      paneId: "%o1",
      session: "lonely",
      repoKey: null,
    });
    const o2 = mkWindow({
      paneId: "%o2",
      session: "wandering",
      repoKey: null,
    });
    const groups = groupByRepo([o1, a, o2]);
    expect(groups.map((g) => g.key)).toEqual(["/r/alpha", OTHER_REPO_KEY]);
    expect(groups[1]!.label).toBe(OTHER_REPO_LABEL);
    expect(groups[1]!.windows.map((w) => w.paneId)).toEqual(["%o1", "%o2"]);
  });

  it("preserves input order within each bucket", () => {
    const w1 = mkWindow({
      paneId: "%w1",
      session: "s",
      index: 3,
      repoKey: "/r/x",
      repoLabel: "x",
    });
    const w2 = mkWindow({
      paneId: "%w2",
      session: "s",
      index: 1,
      repoKey: "/r/x",
      repoLabel: "x",
    });
    // Input order matters; tie-breaks are the caller's job.
    expect(
      groupByRepo([w1, w2])[0]!.windows.map((w) => w.paneId),
    ).toEqual(["%w1", "%w2"]);
  });

  it("returns empty when the input is empty", () => {
    expect(groupByRepo([])).toEqual([]);
  });

  it("Other is absent when every session resolves to a repo", () => {
    const a = mkWindow({
      paneId: "%a",
      session: "alpha",
      repoKey: "/r/alpha",
      repoLabel: "alpha",
    });
    const groups = groupByRepo([a]);
    expect(groups.map((g) => g.key)).toEqual(["/r/alpha"]);
  });

  it("falls back to basename when repoLabel is missing", () => {
    // Mimics a window where the backend resolved a repoKey but somehow lacks
    // a label (defensive: the live API populates both, but the helper should
    // not crash if a fixture omits one).
    const a = mkWindow({
      paneId: "%a",
      session: "alpha",
      repoKey: "/r/with-trailing/",
      repoLabel: null,
    });
    expect(groupByRepo([a])[0]!.label).toBe("with-trailing");
  });
});
