/**
 * Favicon badge (THI-78 PR 2).
 *
 * Builds a data-URL SVG favicon at runtime: the base Switchboard mark with
 * an optional red dot at the top-right when `pendingWindows.length > 0`.
 *
 * Implementation choice: inline-SVG (rather than canvas-paint of the existing
 * /favicon.svg). This keeps the function pure — no image load, no async race
 * with the first paint — and the resulting string is unit-testable.
 *
 * The base mark below is a verbatim copy of `public/favicon.svg`. If that
 * file ever changes, mirror the change here too; the duplication is the
 * price of keeping the favicon-with-badge a pure function.
 */

const BASE_FAVICON = `\
<rect width="64" height="64" rx="14" fill="#15181e"/>\
<g fill="#54c98a">\
<circle cx="20" cy="22" r="3" opacity=".35"/>\
<circle cx="32" cy="22" r="3" opacity=".35"/>\
<circle cx="44" cy="22" r="3" opacity=".35"/>\
<circle cx="20" cy="34" r="3" opacity=".22"/>\
<circle cx="32" cy="34" r="3" opacity=".22"/>\
<circle cx="44" cy="34" r="3" opacity=".22"/>\
</g>\
<path d="M20 22 C20 44, 44 34, 44 50" stroke="#54c98a" stroke-width="4.5" fill="none" stroke-linecap="round"/>\
<circle cx="20" cy="22" r="4.4" fill="#54c98a"/>\
<circle cx="44" cy="50" r="4.4" fill="#54c98a"/>`;

/** Cap at "9+" so the badge digit stays legible in a 16×16 tab icon. */
export function badgeLabel(count: number): string {
  if (count <= 0) return "";
  if (count > 9) return "9+";
  return String(count);
}

/** Build a complete favicon SVG. Returns the *string*; callers wrap in a
 *  data URL via `faviconDataUrl`. Exported separately so tests can pin the
 *  SVG shape without parsing a base64 / encoded URL. */
export function buildFaviconSvg(count: number): string {
  const label = badgeLabel(count);
  const badge = label
    ? // Top-right red badge. The dark outline (var(--bg) tone) cuts a notch
      // out of the mark so the dot reads cleanly against the green wire at
      // the top of the icon. Font is system mono — Safari rasterizes SVG
      // text reliably at 16×16 for single-digit weights.
      `<circle cx="50" cy="14" r="16" fill="#15181e"/>` +
        `<circle cx="50" cy="14" r="13" fill="#e06c75"/>` +
        `<text x="50" y="14" text-anchor="middle" dominant-baseline="central"` +
        ` font-family="ui-monospace, Menlo, monospace" font-weight="700"` +
        ` font-size="${label.length > 1 ? 14 : 18}" fill="#ffffff">${label}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${BASE_FAVICON}${badge}</svg>`;
}

/** SVG string wrapped as a `data:` URL ready for `<link rel="icon" href>`.
 *  Uses `encodeURIComponent` (not base64) so the URL stays human-readable in
 *  devtools and parser errors point at the right offset. */
export function faviconDataUrl(count: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildFaviconSvg(count))}`;
}
