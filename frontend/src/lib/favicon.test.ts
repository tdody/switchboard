import { describe, expect, it } from "vitest";
import { badgeLabel, buildFaviconSvg, faviconDataUrl } from "./favicon";

describe("badgeLabel", () => {
  it("returns empty string when count <= 0", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(-1)).toBe("");
  });

  it("returns the digit for 1..9", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
  });

  it("caps at '9+' for counts beyond single digit", () => {
    // The badge is rendered at ~14px font — two characters is the max that
    // stays legible at the 16×16 tab favicon size. Anything bigger would
    // overflow or shrink the digits past readability.
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(99)).toBe("9+");
  });
});

describe("buildFaviconSvg", () => {
  it("contains the base mark and NO badge group when count is 0", () => {
    const svg = buildFaviconSvg(0);
    expect(svg).toContain('<svg ');
    // Base mark hallmarks:
    expect(svg).toContain('rx="14"'); // rounded tile
    expect(svg).toContain("#54c98a"); // brand green
    // No badge ⇒ no red fill, no <text>.
    expect(svg).not.toContain("#e06c75");
    expect(svg).not.toContain("<text");
  });

  it("includes the red badge + numeric label when count > 0", () => {
    const svg = buildFaviconSvg(3);
    expect(svg).toContain("#e06c75"); // badge red
    expect(svg).toContain("<text"); // count digit element
    expect(svg).toContain(">3</text>"); // exact label
  });

  it("renders '9+' for overflow", () => {
    const svg = buildFaviconSvg(42);
    expect(svg).toContain(">9+</text>");
  });
});

describe("faviconDataUrl", () => {
  it("returns a data:image/svg+xml URL with the SVG percent-encoded", () => {
    const url = faviconDataUrl(2);
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    // The encoded payload, when decoded, must match the SVG string verbatim.
    const encoded = url.slice("data:image/svg+xml;charset=utf-8,".length);
    expect(decodeURIComponent(encoded)).toBe(buildFaviconSvg(2));
  });

  it("changes when the count changes (cache-busting via different payload)", () => {
    expect(faviconDataUrl(0)).not.toBe(faviconDataUrl(1));
    expect(faviconDataUrl(1)).not.toBe(faviconDataUrl(2));
    // 10 and 11 both cap to "9+", so they're the same URL — that's correct.
    expect(faviconDataUrl(10)).toBe(faviconDataUrl(11));
  });
});
