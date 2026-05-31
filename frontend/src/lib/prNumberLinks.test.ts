import { describe, expect, it, vi } from "vitest";
import type { Terminal } from "xterm";
import { findPrRefs, prNumberLinkProvider } from "./prNumberLinks";

describe("findPrRefs", () => {
  it("captures `PR #N` with 1-based inclusive cols", () => {
    //                                "PR #55" starts at index 8 → col 9
    const matches = findPrRefs("hello — PR #55 today");
    expect(matches).toEqual([
      { startCol: 9, endCol: 14, pr: 55, text: "PR #55" },
    ]);
  });

  it("captures multiple PR refs on the same line", () => {
    const matches = findPrRefs("PR #1 vs PR #234");
    expect(matches.map((m) => m.pr)).toEqual([1, 234]);
    expect(matches.map((m) => m.text)).toEqual(["PR #1", "PR #234"]);
  });

  it("rejects PR refs without word boundaries (no false positives on `MYPR #5`)", () => {
    expect(findPrRefs("MYPR #5")).toEqual([]);
  });

  it("caps digit count so obvious garbage like `PR #9999999999` doesn't match", () => {
    expect(findPrRefs("PR #1234567")).toEqual([]);
  });

  it("returns [] for plain text with no PR refs", () => {
    expect(findPrRefs("nothing to see here")).toEqual([]);
  });
});

describe("prNumberLinkProvider", () => {
  // Minimal fake xterm with a buffer of preset lines. The provider only
  // touches `buffer.active.getLine(idx).translateToString(true)`.
  function makeFakeTerm(lines: string[]): Terminal {
    return {
      buffer: {
        active: {
          getLine(idx: number) {
            const text = lines[idx];
            if (text === undefined) return undefined;
            return {
              translateToString: (_trim: boolean) => text,
            };
          },
        },
      },
    } as unknown as Terminal;
  }

  it("returns undefined when repoUrl is null (no git/non-github cwd)", () => {
    const term = makeFakeTerm(["PR #55 is open"]);
    const provider = prNumberLinkProvider(term, () => null);
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it("returns undefined when the line has no PR refs", () => {
    const term = makeFakeTerm(["just a normal log line"]);
    const provider = prNumberLinkProvider(term, () => "https://github.com/o/r");
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    expect(cb).toHaveBeenCalledWith(undefined);
  });

  it("emits one ILink per match with correct range + activate URL", () => {
    const term = makeFakeTerm(["⏵⏵ auto mode on · PR #55 · 1 shell"]);
    const provider = prNumberLinkProvider(term, () => "https://github.com/o/r");
    const cb = vi.fn();
    provider.provideLinks(1, cb);
    const links = cb.mock.calls[0][0];
    expect(links).toHaveLength(1);
    expect(links[0].text).toBe("PR #55");
    expect(links[0].range.start.y).toBe(1);
    expect(links[0].range.end.y).toBe(1);
    // The unicode chevrons in the prefix make exact-column math fragile in
    // a unit test, so just sanity-check that the span has the right length.
    expect(links[0].range.end.x - links[0].range.start.x + 1).toBe("PR #55".length);

    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    links[0].activate(new MouseEvent("click"), "PR #55");
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/o/r/pull/55",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });

  it("re-reads repoUrl on every call so a remote change takes effect live", () => {
    const term = makeFakeTerm(["PR #1"]);
    let url: string | null = "https://github.com/o/r1";
    const provider = prNumberLinkProvider(term, () => url);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    const cb1 = vi.fn();
    provider.provideLinks(1, cb1);
    cb1.mock.calls[0][0]![0].activate(new MouseEvent("click"), "PR #1");
    expect(openSpy).toHaveBeenLastCalledWith(
      "https://github.com/o/r1/pull/1",
      "_blank",
      "noopener,noreferrer",
    );

    url = "https://github.com/o/r2";
    const cb2 = vi.fn();
    provider.provideLinks(1, cb2);
    cb2.mock.calls[0][0]![0].activate(new MouseEvent("click"), "PR #1");
    expect(openSpy).toHaveBeenLastCalledWith(
      "https://github.com/o/r2/pull/1",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
