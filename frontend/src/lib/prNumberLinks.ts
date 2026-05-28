import type { ILink, ILinkProvider, IBufferRange, Terminal } from "xterm";

/** Matches `PR #N` mentions in pane text — used by the xterm linkProvider in
 *  TerminalModal to make Claude's "PR #55" footer mention clickable (THI-146
 *  PR 2). The `\b` boundaries keep us from chewing into `#PR #55` or random
 *  hash strings, and the digit cap (1..6) keeps us from matching obvious
 *  garbage like `PR #1234567890`. Exported for test access. */
export const PR_REF_RE = /\bPR #(\d{1,6})\b/g;

/** Pure: scan one line of pane text and emit a `{ start, end, pr }` per match.
 *  Coordinates are 1-based and inclusive on both ends, matching xterm's
 *  IBufferCellPosition convention. Exported so the unit test can verify
 *  the regex + range arithmetic without booting a real xterm.
 */
export interface PrMatch {
  /** 1-based start column (the `P` of "PR"). */
  startCol: number;
  /** 1-based end column (the last digit of N), inclusive. */
  endCol: number;
  /** Captured PR number — the value we'll suffix onto `${repoUrl}/pull/`. */
  pr: number;
  /** The exact matched substring; xterm needs it as `ILink.text`. */
  text: string;
}

export function findPrRefs(line: string): PrMatch[] {
  const out: PrMatch[] = [];
  // Each provideLinks call rescans, so a fresh regex per call is fine —
  // but reset lastIndex defensively in case the regex is reused.
  PR_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PR_REF_RE.exec(line)) !== null) {
    const startCol = m.index + 1;
    const endCol = m.index + m[0].length;
    out.push({
      startCol,
      endCol,
      pr: Number(m[1]),
      text: m[0],
    });
  }
  return out;
}

/** Build an ILinkProvider for `PR #N` mentions. The repo URL is read fresh on
 *  every `provideLinks` call via the supplied getter so a remote change is
 *  picked up without rebuilding the terminal. Returns `undefined` (no links)
 *  when no repoUrl is available — the pane is either not in a git checkout
 *  or its origin is a non-github host. */
export function prNumberLinkProvider(
  term: Terminal,
  getRepoUrl: () => string | null,
): ILinkProvider {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: ILink[] | undefined) => void,
    ): void {
      const repoUrl = getRepoUrl();
      if (!repoUrl) {
        callback(undefined);
        return;
      }
      // bufferLineNumber is 1-based in the public API; getLine takes 0-based.
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const matches = findPrRefs(text);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map((mt) => {
        const range: IBufferRange = {
          start: { x: mt.startCol, y: bufferLineNumber },
          end: { x: mt.endCol, y: bufferLineNumber },
        };
        return {
          range,
          text: mt.text,
          activate() {
            window.open(`${repoUrl}/pull/${mt.pr}`, "_blank", "noopener,noreferrer");
          },
        };
      });
      callback(links);
    },
  };
}
