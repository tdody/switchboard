import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "xterm";
import {
  findFilePaths,
  filePathLinkProvider,
  logicalLineAt,
  IDE_EXTS,
} from "./filePathLinks";

/** Build a fake IBufferLine from a string. Wide chars (declared via `wide`)
 *  occupy two cells: the glyph cell (width 2) plus a zero-width tail cell,
 *  mirroring xterm's buffer layout. */
function fakeLine(text: string, isWrapped: boolean, wide: string[] = []) {
  const cells: { getChars: () => string; getWidth: () => number }[] = [];
  for (const ch of text) {
    if (wide.includes(ch)) {
      cells.push({ getChars: () => ch, getWidth: () => 2 });
      cells.push({ getChars: () => "", getWidth: () => 0 });
    } else {
      cells.push({ getChars: () => ch, getWidth: () => 1 });
    }
  }
  return {
    isWrapped,
    length: cells.length,
    getCell: (x: number) => cells[x],
  };
}

function fakeBuffer(lines: ReturnType<typeof fakeLine>[]) {
  return {
    getLine: (idx: number) => lines[idx],
  };
}

describe("findFilePaths", () => {
  it("matches multi-segment relative paths with a code extension", () => {
    const ms = findFilePaths("see frontend/src/components/Header.tsx for the chip");
    expect(ms).toHaveLength(1);
    expect(ms[0].path).toBe("frontend/src/components/Header.tsx");
    expect(ms[0].ext).toBe("tsx");
  });

  it("requires at least one slash so prose words don't false-positive", () => {
    // `pyproject.toml` with no path prefix → would be ambiguous against
    // sentences like "edit pyproject.toml" and is far too easy to
    // false-positive. We require the path to look path-shaped.
    expect(findFilePaths("see pyproject.toml")).toEqual([]);
  });

  it("matches `./relative.py`, `../sibling.py`, and `~/home.py`", () => {
    const text = "./a/b.py and ../c/d.py and ~/notes/e.py";
    const ms = findFilePaths(text);
    expect(ms.map((m) => m.path)).toEqual([
      "a/b.py", // leading `./` stripped
      "../c/d.py",
      "~/notes/e.py",
    ]);
  });

  it("matches absolute paths", () => {
    const ms = findFilePaths("error in /usr/local/share/x.py");
    expect(ms[0].path).toBe("/usr/local/share/x.py");
  });

  it("strips :line:col suffix from the path but keeps it in the highlight range", () => {
    const ms = findFilePaths("traceback: src/foo.py:42:10 - syntax error");
    expect(ms).toHaveLength(1);
    expect(ms[0].path).toBe("src/foo.py");
    expect(ms[0].text).toBe("src/foo.py:42:10");
    expect(ms[0].endCol - ms[0].startCol + 1).toBe("src/foo.py:42:10".length);
  });

  it("respects right-boundary characters (closing parens, commas, quotes)", () => {
    expect(findFilePaths('imported from "frontend/types.ts" today')[0].path).toBe(
      "frontend/types.ts",
    );
    expect(findFilePaths("(see src/foo.py) for context")[0].path).toBe("src/foo.py");
  });

  it("matches multiple paths on the same line", () => {
    const ms = findFilePaths("src/a.py and src/b.py and src/c.py");
    expect(ms.map((m) => m.path)).toEqual(["src/a.py", "src/b.py", "src/c.py"]);
  });

  // THI-253: Claude prose constantly ends sentences with a path — the
  // trailing punctuation must not kill the link, but must stay out of it.
  describe("sentence-final punctuation", () => {
    it("matches a path followed by a period at end of line", () => {
      const ms = findFilePaths("Wrapper created at scripts/modernize/regen.py.");
      expect(ms).toHaveLength(1);
      expect(ms[0].path).toBe("scripts/modernize/regen.py");
      expect(ms[0].text).toBe("scripts/modernize/regen.py");
    });

    it("matches a path followed by a period mid-sentence", () => {
      const ms = findFilePaths("I edited frontend/src/App.tsx. Then I ran tests.");
      expect(ms.map((m) => m.path)).toEqual(["frontend/src/App.tsx"]);
    });

    it("matches paths before ? and !", () => {
      expect(findFilePaths("did you mean src/foo.py?")[0].path).toBe("src/foo.py");
      expect(findFilePaths("fix src/bar.ts!")[0].path).toBe("src/bar.ts");
    });

    it("keeps the :line anchor in the highlight but not the punctuation", () => {
      const ms = findFilePaths("crashed at src/foo.py:42.");
      expect(ms).toHaveLength(1);
      expect(ms[0].path).toBe("src/foo.py");
      expect(ms[0].text).toBe("src/foo.py:42");
    });

    it("does not treat an inner dot followed by a word as punctuation", () => {
      // `src/foo.py.bak` is one token with ext `bak`, not `foo.py` + ".b…"
      const ms = findFilePaths("backup at src/foo.py.bak");
      expect(ms).toHaveLength(1);
      expect(ms[0].ext).toBe("bak");
    });
  });

  // THI-253: bare filenames with a `:line` anchor (`main.py:308`) are
  // path-like enough — the anchor makes prose false-positives unlikely.
  describe("bare filename with line anchor", () => {
    it("matches `file.ext:line` without any slash", () => {
      const ms = findFilePaths("_upload_report_to_s3 (in main.py:308) —");
      expect(ms).toHaveLength(1);
      expect(ms[0].path).toBe("main.py");
      expect(ms[0].text).toBe("main.py:308");
    });

    it("matches `file.ext:line:col` without any slash", () => {
      const ms = findFilePaths("at parser.ts:12:5");
      expect(ms[0].path).toBe("parser.ts");
      expect(ms[0].text).toBe("parser.ts:12:5");
    });

    it("still rejects bare filenames without an anchor", () => {
      expect(findFilePaths("edit settings.py please")).toEqual([]);
      expect(findFilePaths("I love pyproject.toml")).toEqual([]);
    });

    it("rejects a bare filename followed by a non-numeric colon suffix", () => {
      // `main.py: description` is a label, not an anchor.
      expect(findFilePaths("main.py: the entrypoint")).toEqual([]);
    });
  });
});

describe("IDE_EXTS gating", () => {
  it("matches common code extensions", () => {
    for (const ext of ["py", "ts", "tsx", "css", "json", "yaml", "go", "rs"]) {
      expect(IDE_EXTS.has(ext)).toBe(true);
    }
  });

  it("excludes html / txt / md (those route elsewhere in later PRs)", () => {
    expect(IDE_EXTS.has("html")).toBe(false);
    expect(IDE_EXTS.has("txt")).toBe(false);
    expect(IDE_EXTS.has("md")).toBe(false);
  });
});

// THI-253: the provider must see the LOGICAL line (soft-wrap rows joined),
// not a single buffer row — long absolute paths almost always wrap.
describe("logicalLineAt", () => {
  it("returns the single row's text when nothing is wrapped", () => {
    const buf = fakeBuffer([fakeLine("edit src/foo.py", false)]);
    const logical = logicalLineAt(buf, 0);
    expect(logical?.text).toBe("edit src/foo.py");
    expect(logical?.startRow).toBe(0);
  });

  it("joins wrapped rows and walks up to the logical start", () => {
    const buf = fakeBuffer([
      fakeLine("see /Users/thibaultd", false),
      fakeLine("ody/sw/foo.py now", true),
    ]);
    // asking for either row yields the same joined line
    for (const row of [0, 1]) {
      const logical = logicalLineAt(buf, row);
      expect(logical?.text).toBe("see /Users/thibaultdody/sw/foo.py now");
      expect(logical?.startRow).toBe(0);
    }
  });

  it("maps string indices to buffer coords across rows and wide chars", () => {
    const buf = fakeBuffer([
      // '世' is one JS char but two buffer cells — columns shift right by 1.
      fakeLine("世 src/foo.py", false, ["世"]),
    ]);
    const logical = logicalLineAt(buf, 0)!;
    expect(logical.text).toBe("世 src/foo.py");
    // 's' of src is string index 2 but buffer column 3 (0-based).
    expect(logical.coords[2]).toEqual({ row: 0, col: 3 });
  });

  it("returns null for a missing row", () => {
    expect(logicalLineAt(fakeBuffer([]), 5)).toBeNull();
  });
});

describe("filePathLinkProvider", () => {
  function makeFakeTerm(lines: string[] | ReturnType<typeof fakeLine>[]): Terminal {
    const built = lines.map((l) => (typeof l === "string" ? fakeLine(l, false) : l));
    return {
      buffer: { active: fakeBuffer(built) },
    } as unknown as Terminal;
  }

  it("returns undefined when isEnabled() is false", () => {
    const term = makeFakeTerm(["edit src/foo.py please"]);
    const provider = filePathLinkProvider(term, () => false, () => {});
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined when no path-like substring matches", () => {
    const term = makeFakeTerm(["just a normal log line"]);
    const provider = filePathLinkProvider(term, () => true, () => {});
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it("skips paths with non-IDE extensions (html/txt/md route elsewhere)", () => {
    const term = makeFakeTerm(["see docs/intro.md or report.html"]);
    const provider = filePathLinkProvider(term, () => true, () => {});
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it("emits one ILink per code-path match and routes activate() to the callback", () => {
    const term = makeFakeTerm(["edit src/foo.py:42 and lib/bar.ts please"]);
    const seen: string[] = [];
    const provider = filePathLinkProvider(
      term,
      () => true,
      (p) => seen.push(p),
    );
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    const links = cb.mock.calls[0][0];
    expect(links).toHaveLength(2);
    // line:col stripped before reaching the callback.
    links[0].activate(new MouseEvent("click"), links[0].text);
    links[1].activate(new MouseEvent("click"), links[1].text);
    expect(seen).toEqual(["src/foo.py", "lib/bar.ts"]);
  });

  it("links a path that soft-wraps across rows, with a range spanning both", () => {
    const term = makeFakeTerm([
      fakeLine("see /Users/me/sw/front/Pane", false),
      fakeLine("Terminal.tsx for the modal", true),
    ]);
    const seen: string[] = [];
    const provider = filePathLinkProvider(term, () => true, (p) => seen.push(p));
    // hovering either row must yield the same full-path link
    for (const lineNo of [1, 2]) {
      const cb = vi.fn();
      provider.provideLinks(lineNo, cb);
      const links = cb.mock.calls[0][0];
      expect(links).toHaveLength(1);
      expect(links[0].text).toBe("/Users/me/sw/front/PaneTerminal.tsx");
      // starts on row 1 at "(see " offset 4 → x=5; ends on row 2.
      expect(links[0].range.start).toEqual({ x: 5, y: 1 });
      expect(links[0].range.end.y).toBe(2);
      expect(links[0].range.end.x).toBe("Terminal.tsx".length);
      links[0].activate(new MouseEvent("click"), links[0].text);
    }
    expect(seen).toEqual([
      "/Users/me/sw/front/PaneTerminal.tsx",
      "/Users/me/sw/front/PaneTerminal.tsx",
    ]);
  });

  it("does not link the truncated continuation row as its own path", () => {
    const term = makeFakeTerm([
      fakeLine("see /Users/me/sw/front/Pane", false),
      fakeLine("Terminal.tsx for the modal", true),
    ]);
    const provider = filePathLinkProvider(term, () => true, () => {});
    const cb = vi.fn();
    provider.provideLinks(2, cb);
    const links = cb.mock.calls[0][0];
    // exactly the one (full) link — not a bogus "Terminal.tsx"-anchored one
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("/Users/me/sw/front/PaneTerminal.tsx");
  });

  it("offsets link columns when wide glyphs precede the path", () => {
    const term = makeFakeTerm([fakeLine("世 src/foo.py", false, ["世"])]);
    const provider = filePathLinkProvider(term, () => true, () => {});
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    const links = cb.mock.calls[0][0];
    // '世' occupies cols 1-2, space col 3, path starts col 4 (1-based).
    expect(links[0].range.start).toEqual({ x: 4, y: 1 });
  });

  it("bails out on absurdly long wrapped lines instead of scanning them", () => {
    const rows = [fakeLine("x".repeat(20), false)];
    for (let i = 0; i < 120; i++) rows.push(fakeLine("x".repeat(20), true));
    rows.push(fakeLine("end src/foo.py", true));
    const term = makeFakeTerm(rows);
    const provider = filePathLinkProvider(term, () => true, () => {});
    const cb = vi.fn();
    provider.provideLinks(rows.length, cb);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it("re-reads isEnabled on every call (toggling IDE config takes effect live)", () => {
    const term = makeFakeTerm(["edit src/foo.py"]);
    let enabled = false;
    const provider = filePathLinkProvider(term, () => enabled, () => {});
    const cb1 = vi.fn();
    provider.provideLinks(1, cb1);
    expect(cb1).toHaveBeenCalledWith(undefined);

    enabled = true;
    const cb2 = vi.fn();
    provider.provideLinks(1, cb2);
    expect(cb2.mock.calls[0][0]).toHaveLength(1);
  });
});
