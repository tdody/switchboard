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

/** Path regex: requires at least one `/` segment so we don't false-positive
 *  on prose like "I love pyproject.toml". Allows `./`, `../`, `~/`, and `/`
 *  prefixes. Trailing `:N` or `:N:M` (Python/JS error line:col anchors) is
 *  captured separately so we can strip it before sending to the backend. */
export const PATH_RE =
  // eslint-disable-next-line no-useless-escape
  /(?<![\w\/.])((?:\.\.?\/|~\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.([A-Za-z][A-Za-z0-9]{0,5}))(?::\d+(?::\d+)?)?(?=$|[\s)\],;:'"`])/g;

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
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const matches = findFilePaths(text).filter((m) => IDE_EXTS.has(m.ext));
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
            onActivate(mt.path);
          },
        };
      });
      callback(links);
    },
  };
}
