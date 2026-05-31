import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "xterm";
import { findFilePaths, filePathLinkProvider, IDE_EXTS } from "./filePathLinks";

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

describe("filePathLinkProvider", () => {
  function makeFakeTerm(lines: string[]): Terminal {
    return {
      buffer: {
        active: {
          getLine(idx: number) {
            const text = lines[idx];
            if (text === undefined) return undefined;
            return { translateToString: (_trim: boolean) => text };
          },
        },
      },
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
