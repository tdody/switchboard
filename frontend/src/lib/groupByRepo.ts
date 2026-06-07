import type { Window } from "../types";

/** Synthetic key for the catch-all bucket of sessions that don't resolve to a
 *  git repo. Pinned to the bottom of every render. */
export const OTHER_REPO_KEY = "__other__";

/** Display label for the "Other" bucket. Kept here so consumers don't
 *  individually hard-code the string. */
export const OTHER_REPO_LABEL = "Other";

/** One row of the discovery view: a repo plus its sessions' panes, in render
 *  order. `label` is the basename of `key` (or "Other" for the catch-all);
 *  the full `key` is the tooltip on basename collisions. */
export interface RepoGroup {
  key: string;
  label: string;
  windows: Window[];
}

/** Group a flat list of windows into the THI-243 discovery view shape:
 *  Repo → Session → Pane.
 *
 *  Rules (from the spec):
 *
 *  - **Sessions are atomic.** Each session is assigned to exactly one repo
 *    via FIRST-SEEN-WINS across its windows iterated in `(session, index)`
 *    order. A session whose windows span multiple repos lands under the
 *    repo of its first git-backed window. A session with zero git-backed
 *    windows lands in "Other".
 *  - **"Other" pinned to bottom.** Always rendered last, never reorderable.
 *  - **Membership from live state only.** Repos with zero live windows are
 *    absent from the result.
 *
 *  Within a repo bucket, windows render in `(session, index)` order — same
 *  natural order the per-view sort uses as its tie-breaker. */
export function groupByRepo(windows: readonly Window[]): RepoGroup[] {
  // First pass: pin every session to its first-seen repo. Iterating in the
  // input order means the caller's pre-sort (typically tmux index ascending)
  // determines which window is "first" for each session — predictable and
  // stable across polls.
  const sessionToRepo = new Map<string, string>();
  const sessionToLabel = new Map<string, string>();
  for (const w of windows) {
    if (sessionToRepo.has(w.session)) continue;
    if (w.repoKey) {
      sessionToRepo.set(w.session, w.repoKey);
      sessionToLabel.set(w.session, w.repoLabel ?? basename(w.repoKey));
    }
  }

  // Second pass: bucket every window by its session's pinned repo (or Other).
  // Preserves input order within each bucket.
  const buckets = new Map<string, Window[]>();
  const labels = new Map<string, string>();
  labels.set(OTHER_REPO_KEY, OTHER_REPO_LABEL);
  for (const w of windows) {
    const repo = sessionToRepo.get(w.session) ?? OTHER_REPO_KEY;
    const bucket = buckets.get(repo);
    if (bucket) bucket.push(w);
    else buckets.set(repo, [w]);
    if (repo !== OTHER_REPO_KEY && !labels.has(repo)) {
      labels.set(repo, sessionToLabel.get(w.session) ?? basename(repo));
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
