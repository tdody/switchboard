import type { Window } from "../types";

/** Synthetic key for the catch-all bucket of windows that don't resolve to a
 *  git repo. Pinned to the bottom of every render. */
export const OTHER_REPO_KEY = "__other__";

/** Display label for the "Other" bucket. Kept here so consumers don't
 *  individually hard-code the string. */
export const OTHER_REPO_LABEL = "Other";

/** One row of the discovery view: a repo plus the windows whose own cwd
 *  resolves to it, in render order. `label` is the basename of `key` (or
 *  "Other" for the catch-all); the full `key` is the tooltip on basename
 *  collisions. */
export interface RepoGroup {
  key: string;
  label: string;
  windows: Window[];
}

/** Group a flat list of windows into the discovery view's repo buckets.
 *
 *  Rules:
 *
 *  - **Per-window bucketing.** Every window is placed in the bucket of its
 *    own `repoKey` — the git toplevel of that window's cwd. A tmux session
 *    that spans multiple repos shows up under each repo it has a window in;
 *    sessions are NOT atomic. This means a daily-driver session that mixes
 *    projects is fragmented across groups, which is the point of the
 *    discovery view (the user opted into seeing repo as the primary unit).
 *  - **Non-git windows land in "Other".** Windows whose cwd doesn't resolve
 *    to a git repo all go to a single synthetic "Other" bucket.
 *  - **"Other" pinned to bottom.** Always rendered last, never reorderable.
 *  - **Membership from live state only.** Repos with zero live windows are
 *    absent from the result.
 *
 *  Within a repo bucket, windows render in input order — the caller's
 *  pre-sort (typically pending-first, then `(session, index)`) is preserved. */
export function groupByRepo(windows: readonly Window[]): RepoGroup[] {
  const buckets = new Map<string, Window[]>();
  const labels = new Map<string, string>();
  labels.set(OTHER_REPO_KEY, OTHER_REPO_LABEL);
  for (const w of windows) {
    const repo = w.repoKey ?? OTHER_REPO_KEY;
    const bucket = buckets.get(repo);
    if (bucket) bucket.push(w);
    else buckets.set(repo, [w]);
    if (repo !== OTHER_REPO_KEY && !labels.has(repo)) {
      labels.set(repo, w.repoLabel ?? basename(repo));
    }
  }

  // Build the ordered result: real repos in first-seen order, then Other.
  const result: RepoGroup[] = [];
  for (const [key, ws] of buckets) {
    if (key === OTHER_REPO_KEY) continue;
    result.push({ key, label: labels.get(key) ?? basename(key), windows: ws });
  }
  const other = buckets.get(OTHER_REPO_KEY);
  if (other && other.length > 0) {
    result.push({ key: OTHER_REPO_KEY, label: OTHER_REPO_LABEL, windows: other });
  }
  return result;
}

function basename(path: string): string {
  // Match the backend's `os.path.basename(repo_key.rstrip("/"))` derivation.
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}
