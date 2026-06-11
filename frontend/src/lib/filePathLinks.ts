import type { ILink, ILinkProvider, IBufferRange, Terminal } from "xterm";

/** Extensions that route to the IDE on click (THI-146 PR 3). Conservative
 *  list — text-editable code / config files only. `.html`, `.txt`, `.md`
 *  are intentionally absent here: those will route to a different surface
 *  in follow-up PRs (new tab for HTML, split panel for plain text). */
export const IDE_EXTS: ReadonlySet<string> = new Set([
  // Python
  "py",
  "pyi",
  // JS/TS
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  // Web
  "css",
  "scss",
  "less",
  "vue",
  "svelte",
  "astro",
  // Config / data
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "cfg",
  "env",
  "csv",
  // Systems
  "go",
  "rs",
  "rb",
  "java",
  "kt",
  "swift",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "m",
  // Shell / scripting
  "sh",
  "zsh",
  "bash",
  "fish",
  "lua",
  "php",
  "pl",
  "sql",
]);

/** Path regex (THI-253). A match is accepted when it has at least one `/`
 *  segment OR a `:N(:M)?` line anchor — `main.py:308` is path-like enough,
 *  while bare `pyproject.toml` in prose stays unlinked (findFilePaths
 *  enforces this; the regex alone matches both). Allows `./`, `../`, `~/`,
 *  and `/` prefixes. The anchor is captured so we can strip it before
 *  sending to the backend. The right boundary also accepts sentence-final
 *  `.`, `!`, `?` (followed by whitespace/EOL) so "edited src/App.tsx." still
 *  links — the punctuation stays outside the match. */
export const PATH_RE =
  // eslint-disable-next-line no-useless-escape
  /(?<![\w\/.])((?:\.\.?\/|~\/|\/)?(?:[\w.-]+\/)*[\w.-]+\.([A-Za-z][A-Za-z0-9]{0,5}))(:\d+(?::\d+)?)?(?=$|[\s)\],;:'"`]|[.!?](?:\s|$))/g;

export interface PathMatch {
  /** 1-based start column of the path body (excludes any leading whitespace). */
  startCol: number;
  /** 1-based inclusive end column of the path body (excludes trailing `:N`). */
  endCol: number;
  /** The cleaned path — what we'll send to the backend. Strips `:N(:M)?` and
   *  drops any leading `./` for consistency. The backend tolerates either. */
  path: string;
  /** Lowercased extension, e.g. `"py"`. */
  ext: string;
  /** The full matched substring INCLUDING any `:N(:M)?` suffix — used as
   *  `ILink.text` so xterm's hover decoration covers the whole "click
   *  target" the user sees. */
  text: string;
}

export function findFilePaths(line: string): PathMatch[] {
  const out: PathMatch[] = [];
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(line)) !== null) {
    const full = m[0];
    const pathBody = m[1];
    const ext = m[2].toLowerCase();
    const anchor = m[3];
    // Slash-less matches need a line anchor to count as a path (see PATH_RE).
    if (!pathBody.includes("/") && anchor === undefined) continue;
    // The non-look-ahead body is anchored at m.index; the full match (with
    // any :N:M suffix) might be longer. We surface the FULL match's range so
    // xterm's hover decoration covers the line:col tail, but we send only
    // the path body to the backend.
    const startCol = m.index + 1;
    const endCol = m.index + full.length;
    out.push({
      startCol,
      endCol,
      path: pathBody.replace(/^\.\//, ""),
      ext,
      text: full,
    });
  }
  return out;
}

/** Backstop for pathological content (e.g. minified JS): a soft-wrapped
 *  logical line spanning more rows than this is skipped outright rather
 *  than joined and regex-scanned on every mousemove. */
const MAX_LOGICAL_ROWS = 100;

/** The slice of xterm's IBuffer/IBufferLine/IBufferCell that logicalLineAt
 *  actually reads — structural so tests can fake it without the full API. */
export interface ReadableBuffer {
  getLine(y: number):
    | {
        isWrapped: boolean;
        length: number;
        getCell(x: number): { getChars(): string; getWidth(): number } | undefined;
      }
    | undefined;
}

export interface LogicalLine {
  /** 0-based buffer row where the logical line starts. */
  startRow: number;
  /** The full logical line, soft-wrap rows joined. */
  text: string;
  /** coords[i] is the 0-based buffer position of text[i]. Wide glyphs
   *  occupy two cells but one (or two, for surrogate pairs) string
   *  positions, so string index ≠ column — this map is the bridge. */
  coords: { row: number; col: number }[];
}

/** Read the logical line containing 0-based buffer row `row`: walk up while
 *  the row is a soft-wrap continuation (`isWrapped`), then join downward
 *  while the NEXT row continues it (THI-253 — paths that wrap across rows
 *  were unmatchable row-by-row, and continuation rows matched as bogus
 *  relative paths). Returns null when the row doesn't exist or the logical
 *  line exceeds MAX_LOGICAL_ROWS. */
export function logicalLineAt(buffer: ReadableBuffer, row: number): LogicalLine | null {
  if (!buffer.getLine(row)) return null;
  let startRow = row;
  while (startRow > 0 && buffer.getLine(startRow)?.isWrapped) startRow--;

  let text = "";
  const coords: { row: number; col: number }[] = [];
  for (let r = startRow; ; r++) {
    if (r - startRow >= MAX_LOGICAL_ROWS) return null;
    const line = buffer.getLine(r);
    if (!line) break;
    for (let col = 0; col < line.length; col++) {
      const cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue; // wide-char tail cell
      const chars = cell.getChars() || " "; // empty cell renders as space
      for (const ch of chars) {
        text += ch;
        coords.push({ row: r, col });
      }
    }
    if (!buffer.getLine(r + 1)?.isWrapped) break;
  }
  return { startRow, text, coords };
}

/** Build an xterm linkProvider for file paths whose extension is in the IDE
 *  set. `isEnabled` is read fresh on every call so toggling the IDE config
 *  (or arriving at the modal before the config fetch resolves) doesn't lock
 *  the provider into the wrong state. `onActivate` receives the cleaned
 *  path string; the caller routes it to the backend. */
export function filePathLinkProvider(
  term: Terminal,
  isEnabled: () => boolean,
  onActivate: (cleanedPath: string) => void,
): ILinkProvider {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: ILink[] | undefined) => void,
    ): void {
      if (!isEnabled()) {
        callback(undefined);
        return;
      }
      const logical = logicalLineAt(term.buffer.active, bufferLineNumber - 1);
      if (!logical) {
        callback(undefined);
        return;
      }
      const matches = findFilePaths(logical.text).filter((m) => IDE_EXTS.has(m.ext));
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map((mt) => {
        // startCol/endCol are 1-based positions in the LOGICAL line; map
        // them through coords to (possibly different) buffer rows/columns.
        const start = logical.coords[mt.startCol - 1];
        const end = logical.coords[mt.endCol - 1];
        const range: IBufferRange = {
          start: { x: start.col + 1, y: start.row + 1 },
          end: { x: end.col + 1, y: end.row + 1 },
        };
        return {
          range,
          text: mt.text,
          activate() {
            onActivate(mt.path);
          },
        };
      });
      callback(links);
    },
  };
}
