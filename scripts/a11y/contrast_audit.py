"""Switchboard WCAG contrast audit.

Resolves the CSS tokens defined in `frontend/src/styles/styles.css`
(`:root` + per-`[data-theme]` overrides) into sRGB triples, then computes
WCAG 2.1 contrast ratios for the foreground/background pairs actually
used by components. Reports AA failures first, AA-only next, AAA last.

The token table is hand-mirrored from `styles.css`. When tokens move,
update `_THEMES` below. CI runs this script and fails on AA misses, so
the mirror staying in sync is load-bearing — there's a `--check-sync`
mode that diffs the tokens against `styles.css` and flags drift.

Rules
-----
- text      : foreground text on a panel; AA = 4.5 (normal) or 3.0 (large)
- ui        : hairline / border / icon on a panel; AA = 3.0
- focus     : :focus-visible outline color composited on each panel,
              checked vs that panel; AA = 3.0 (WCAG-UI)
- hover     : default-state bg vs hover-state bg; perceivability ≥ 3.0
              difference between the two surfaces (WCAG-UI floor)
- disabled  : `var(--text)` at `opacity: .4` composited over a panel,
              checked vs that panel; AA = 4.5 (the disabled tokens still
              need to read as text, just dimmer)
- selection : `::selection` band (--accent-soft over panel) vs panel;
              floor 1.5 — selection is allowed to be subtle but visible

WCAG bars (`bars_for`)
-------
- AA normal text:       4.5 : 1
- AA large text / UI:   3.0 : 1   (≥18pt regular OR ≥14pt bold)
- AAA normal text:      7.0 : 1
- AAA large text / UI:  4.5 : 1

Switchboard body is 13px regular ⇒ AA-normal applies to most text;
selectors flagged `large=True` (modal titles, header session names,
heading-weight ≥14pt-bold) use the UI bar.
"""

from __future__ import annotations

import argparse
import math
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


# ── color math ──────────────────────────────────────────────────────────────

RGB = tuple[float, float, float]
RGBA = tuple[float, float, float, float]


def hex_to_srgb(h: str) -> RGB:
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def oklch_to_srgb(L: float, C: float, H_deg: float) -> RGB:
    H = math.radians(H_deg)
    a = C * math.cos(H)
    b = C * math.sin(H)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l = l_**3
    m = m_**3
    s = s_**3
    r_lin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g_lin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b_lin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

    def lin_to_srgb(x: float) -> float:
        x = max(0.0, min(1.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * (x ** (1 / 2.4)) - 0.055

    return (lin_to_srgb(r_lin), lin_to_srgb(g_lin), lin_to_srgb(b_lin))


def rgba_over(fg: RGBA, bg: RGB) -> RGB:
    r, g, b, a = fg
    br, bg_, bb = bg
    return (a * r + (1 - a) * br, a * g + (1 - a) * bg_, a * b + (1 - a) * bb)


def color_mix(a: RGB, pct: float, b: RGB) -> RGB:
    """`color-mix(in oklch, A pct%, B)` — approximated in sRGB.

    sRGB mixing diverges from real OKLCH for high-chroma hue blends, but
    Switchboard's recipes are `tone X% over panel`, which is a desaturation
    along the same hue; the sRGB approximation is within 0.5% on contrast.
    """
    t = pct / 100
    return (t * a[0] + (1 - t) * b[0], t * a[1] + (1 - t) * b[1], t * a[2] + (1 - t) * b[2])


def relative_luminance(rgb: RGB) -> float:
    def chan(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg: RGB, bg: RGB) -> float:
    l1 = relative_luminance(fg)
    l2 = relative_luminance(bg)
    light, dark = max(l1, l2), min(l1, l2)
    return (light + 0.05) / (dark + 0.05)


def hex_str(rgb: RGB) -> str:
    return "#" + "".join(f"{int(round(c * 255)):02x}" for c in rgb)


# ── theme registry (mirrored from frontend/src/styles/styles.css) ───────────

# Tones live on :root and aren't theme-overridden (the audit treats them as
# global). If a theme later overrides one, lift it into the per-theme dict.
_TONES_OKLCH: dict[str, tuple[float, float, float]] = {
    "--accent":       (0.78, 0.13, 145),  # green
    "--tone-cyan":    (0.78, 0.13, 220),
    "--tone-amber":   (0.80, 0.14, 80),
    "--tone-green":   (0.78, 0.13, 145),
    "--tone-gray":    (0.65, 0.01, 250),
    "--tone-magenta": (0.72, 0.16, 330),
    "--tone-lilac":   (0.74, 0.12, 295),
    "--tone-sky":     (0.78, 0.13, 240),
}
_TONE_HEX: dict[str, str] = {"--tone-red": "#CC6666"}

# `--accent-edge` is `oklch(0.78 0.13 145 / 0.55)` on dark; light overrides
# it (see _THEMES). Stored as rgba so we can composite per-bg.
_ACCENT_EDGE_DARK_RGBA: RGBA = (*oklch_to_srgb(0.78, 0.13, 145), 0.55)
_ACCENT_SOFT_DARK_RGBA: RGBA = (*oklch_to_srgb(0.78, 0.13, 145), 0.16)


def _resolve_tones() -> dict[str, RGB]:
    out: dict[str, RGB] = {}
    for name, (L, C, H) in _TONES_OKLCH.items():
        out[name] = oklch_to_srgb(L, C, H)
    for name, h in _TONE_HEX.items():
        out[name] = hex_to_srgb(h)
    # --tone-orange = color-mix(in oklch, --tone-amber 60%, --tone-red)
    out["--tone-orange"] = color_mix(out["--tone-amber"], 60, out["--tone-red"])
    return out


# Hairline alphas as (r, g, b, a) so we can re-composite per surface.
HairlineAlpha = tuple[float, float, float, float]


@dataclass(frozen=True)
class Theme:
    """One theme's resolved token table.

    Hairlines are stored as `(r,g,b,a)` rgba so each `Pair` can composite
    them against the surface the pair actually sits on (different panels
    yield different opaque colors). Same trick for `--accent-edge` and
    `--accent-soft` so the focus-ring rule can compute composites per
    surface without re-resolving.
    """

    name: str
    bg: RGB
    bg_elev: RGB
    panel: RGB
    panel_2: RGB
    panel_3: RGB
    text: RGB
    text_mute: RGB
    text_dim: RGB
    text_disabled: RGB
    hairline_rgba: HairlineAlpha
    hairline_strong_rgba: HairlineAlpha
    accent_edge_rgba: RGBA
    accent_soft_rgba: RGBA
    tones: dict[str, RGB]

    def panel_for(self, token: str) -> RGB:
        return {
            "--bg": self.bg,
            "--bg-elev": self.bg_elev,
            "--panel": self.panel,
            "--panel-2": self.panel_2,
            "--panel-3": self.panel_3,
        }[token]

    def text_for(self, token: str) -> RGB:
        return {
            "--text": self.text,
            "--text-mute": self.text_mute,
            "--text-dim": self.text_dim,
            "--text-disabled": self.text_disabled,
        }[token]


def _theme_dark() -> Theme:
    bg = hex_to_srgb("#0b0c0f")
    return Theme(
        name="dark",
        bg=bg,
        bg_elev=hex_to_srgb("#111317"),  # matches styles.css :root --bg-elev
        panel=hex_to_srgb("#15181e"),
        panel_2=hex_to_srgb("#1a1e25"),
        panel_3=hex_to_srgb("#23272f"),
        text=hex_to_srgb("#e7e9ee"),
        text_mute=hex_to_srgb("#9aa0ad"),
        text_dim=hex_to_srgb("#6b7180"),
        text_disabled=hex_to_srgb("#888c97"),
        hairline_rgba=(1.0, 1.0, 1.0, 0.08),
        hairline_strong_rgba=(1.0, 1.0, 1.0, 0.14),
        accent_edge_rgba=_ACCENT_EDGE_DARK_RGBA,
        accent_soft_rgba=_ACCENT_SOFT_DARK_RGBA,
        tones=_resolve_tones(),
    )


def _theme_light() -> Theme:
    bg = hex_to_srgb("#f7f6f3")
    # styles.css overrides --accent-edge per-theme in [data-theme="light"].
    # Pre-THI-151 the alpha was 0.55 and composited to ~2.58:1 (failed UI AA);
    # bumped to 0.70 → composite lands at 3.52:1 with breathing room. Higher
    # alphas pass too but make the ring feel like a solid border.
    edge = (*oklch_to_srgb(0.455, 0.13, 145), 0.70)
    soft = (*oklch_to_srgb(0.455, 0.13, 145), 0.16)
    return Theme(
        name="light",
        bg=bg,
        bg_elev=hex_to_srgb("#fbfaf8"),
        panel=hex_to_srgb("#ffffff"),
        panel_2=hex_to_srgb("#faf9f6"),
        panel_3=hex_to_srgb("#f0ede5"),
        text=hex_to_srgb("#1a1c1f"),
        text_mute=hex_to_srgb("#5a606b"),
        text_dim=hex_to_srgb("#8a8f99"),
        text_disabled=hex_to_srgb("#6c707b"),
        hairline_rgba=(0.0, 0.0, 0.0, 0.07),  # matches styles.css :root light
        hairline_strong_rgba=(0.0, 0.0, 0.0, 0.13),
        accent_edge_rgba=edge,
        accent_soft_rgba=soft,
        tones=_resolve_tones(),
    )


def _theme_contrast() -> Theme:
    bg = hex_to_srgb("#000000")
    return Theme(
        name="contrast",
        bg=bg,
        bg_elev=hex_to_srgb("#000000"),
        panel=hex_to_srgb("#0a0a0a"),
        panel_2=hex_to_srgb("#111111"),
        panel_3=hex_to_srgb("#1c1c1c"),
        text=hex_to_srgb("#ffffff"),
        text_mute=hex_to_srgb("#c8c8c8"),
        text_dim=hex_to_srgb("#999999"),
        text_disabled=hex_to_srgb("#888888"),
        hairline_rgba=(1.0, 1.0, 1.0, 0.28),
        hairline_strong_rgba=(1.0, 1.0, 1.0, 0.50),
        accent_edge_rgba=_ACCENT_EDGE_DARK_RGBA,
        accent_soft_rgba=_ACCENT_SOFT_DARK_RGBA,
        tones=_resolve_tones(),
    )


def _theme_phosphor() -> Theme:
    bg = hex_to_srgb("#06120c")  # matches styles.css [data-theme="phosphor"]
    return Theme(
        name="phosphor",
        bg=bg,
        bg_elev=hex_to_srgb("#07150e"),
        panel=hex_to_srgb("#0a1d14"),
        panel_2=hex_to_srgb("#0d2419"),
        panel_3=hex_to_srgb("#11321f"),
        text=hex_to_srgb("#b5ffdc"),
        text_mute=hex_to_srgb("#6cc59b"),
        text_dim=hex_to_srgb("#4a9070"),
        text_disabled=hex_to_srgb("#519871"),
        hairline_rgba=(0x5F / 255, 1.0, 0xAF / 255, 0.12),
        hairline_strong_rgba=(0x5F / 255, 1.0, 0xAF / 255, 0.28),
        accent_edge_rgba=_ACCENT_EDGE_DARK_RGBA,
        accent_soft_rgba=_ACCENT_SOFT_DARK_RGBA,
        tones=_resolve_tones(),
    )


_THEMES: dict[str, Theme] = {
    "dark": _theme_dark(),
    "light": _theme_light(),
    "contrast": _theme_contrast(),
    "phosphor": _theme_phosphor(),
}


# ── pairs + rules ───────────────────────────────────────────────────────────

RuleKind = Literal["text", "ui", "focus", "hover", "disabled", "selection"]


@dataclass(frozen=True)
class Pair:
    """One foreground/background comparison.

    For `text`/`ui`: `fg` is a token; `bg` is a token or a tinted recipe.
    For `focus`/`disabled`/`selection`: `fg` is implied by the rule kind;
    `bg` is the panel.
    For `hover`: `fg` is the hover bg token; `bg` is the default bg token
    (we treat the pair as "perceivable change between two surfaces").
    """

    kind: RuleKind
    fg: str | None
    bg: str
    where: str
    large: bool = False                            # large-text bar (THI-156)
    bg_mix: tuple[str, int, str] | None = None     # ("--tone-x", pct, "--panel")


_PAIRS: list[Pair] = [
    # ── text on every surface ──
    Pair("text", "--text", "--bg",      "body / page text"),
    Pair("text", "--text", "--bg-elev", "elevated surfaces (top bar, dropdown)"),
    Pair("text", "--text", "--panel",   "cards, modals, dropdown items"),
    Pair("text", "--text", "--panel-2", "buttons, alt panels, chips"),

    Pair("text", "--text-mute", "--bg",      "secondary text on page"),
    Pair("text", "--text-mute", "--bg-elev", "secondary text on elevated"),
    Pair("text", "--text-mute", "--panel",   "secondary text on cards/modals"),
    Pair("text", "--text-mute", "--panel-2", "secondary text on buttons/alt panels"),

    Pair("text", "--text-dim", "--bg",      "tertiary text on page"),
    Pair("text", "--text-dim", "--bg-elev", "tertiary text on elevated"),
    Pair("text", "--text-dim", "--panel",   "tertiary on cards (sep, ago)"),
    Pair("text", "--text-dim", "--panel-2", "tertiary on alt panels"),

    # ── tones used as TEXT color ──
    Pair("text", "--accent",       "--panel",   "accent-colored text on cards"),
    Pair("text", "--accent",       "--bg",      "accent text on page bg"),
    Pair("text", "--tone-cyan",    "--panel",   ".chip.ci-running text"),
    Pair("text", "--tone-cyan",    "--bg-elev", ".chip on elevated header"),
    Pair("text", "--tone-green",   "--panel",   ".chip.ci-passing text"),
    Pair("text", "--tone-green",   "--bg-elev", ".chip.ci-passing on header"),
    Pair("text", "--tone-amber",   "--panel",   "warning text on cards"),
    Pair("text", "--tone-amber",   "--bg-elev", "warning text on elevated"),
    Pair("text", "--tone-red",     "--panel",   ".chip.ci-failing / dropdown.danger"),
    Pair("text", "--tone-red",     "--bg-elev", ".chip.ci-failing on header"),
    Pair("text", "--tone-red",     "--bg",      "tone-red text on page bg"),
    Pair("text", "--tone-lilac",   "--panel",   ".chip.pr / .kind-editor text"),
    Pair("text", "--tone-lilac",   "--bg-elev", ".chip.pr on header"),
    Pair("text", "--tone-magenta", "--panel",   "magenta accents on cards"),
    Pair("text", "--tone-sky",     "--panel",   "sky accents on cards"),
    Pair("text", "--tone-orange",  "--panel",   "orange accents on cards"),
    Pair("text", "--tone-gray",    "--panel",   "muted gray accent"),

    # ── tone on tinted chip backgrounds ──
    Pair("text", "--tone-cyan",  "", ".kind-server (tone on 14% tint)",
         bg_mix=("--tone-cyan", 14, "--panel")),
    Pair("text", "--tone-lilac", "", ".kind-editor (tone on 14% tint)",
         bg_mix=("--tone-lilac", 14, "--panel")),
    Pair("text", "--tone-amber", "", ".kind-logs / warning chip (tone on 14% tint)",
         bg_mix=("--tone-amber", 14, "--panel")),
    Pair("text", "--tone-amber", "", "warning callout (tone on 22% tint)",
         bg_mix=("--tone-amber", 22, "--panel")),
    Pair("text", "--tone-red",   "", ".btn-danger / dropdown.danger:hover (16% tint)",
         bg_mix=("--tone-red", 16, "--panel")),
    Pair("text", "--tone-red",   "", ".btn-danger:hover (26% tint)",
         bg_mix=("--tone-red", 26, "--panel")),

    # ── hairlines / borders / separators (UI bar) ──
    Pair("ui", "--hairline",        "--bg",    "subtle border on page"),
    Pair("ui", "--hairline-strong", "--bg",    "stronger border on page"),
    Pair("ui", "--hairline",        "--panel", "border on cards"),
    Pair("ui", "--hairline-strong", "--panel", "stronger border on cards"),

    # ── THI-151: focus rings on every panel ──
    Pair("focus", None, "--bg",      ":focus-visible on page bg (.btn)"),
    Pair("focus", None, "--bg-elev", ":focus-visible on elevated (header buttons)"),
    Pair("focus", None, "--panel",   ":focus-visible on cards/modals"),
    Pair("focus", None, "--panel-2", ":focus-visible on alt panels"),

    # ── THI-151: hover-state deltas (default→hover bg perceivability) ──
    Pair("hover", "--panel-3", "--panel",   ".btn:hover bg vs .btn bg"),
    # .btn-ghost:hover composites --hairline-strong over its surface
    # (the header / --bg-elev); handled inline in resolve_fg via the
    # synthetic `--hairline-strong-over-bg-elev` fg token.
    Pair("hover", "--hairline-strong-over-bg-elev", "--bg-elev",
         ".btn-ghost:hover bg vs default header"),

    # ── THI-152: disabled-button text composite ──
    Pair("disabled", "--text", "--panel",   "button:disabled on .btn"),
    Pair("disabled", "--text", "--panel-2", "button:disabled on .btn-ghost variant"),
    Pair("disabled", "--text", "--bg-elev", "button:disabled in header"),

    # ── THI-155: selection band visibility ──
    Pair("selection", None, "--panel",   "::selection over .panel"),
    Pair("selection", None, "--bg-elev", "::selection over .bg-elev"),
]


@dataclass(frozen=True)
class Bars:
    aa: float
    aaa: float
    label: str


def bars_for(p: Pair) -> Bars:
    if p.kind in ("ui", "focus"):
        # WCAG-UI 3:1 applies to component identity vs adjacent surface
        # (the focus ring is a real "thing" that must be distinguishable
        # from the background it sits on; hairlines are component edges).
        return Bars(aa=3.0, aaa=4.5, label="UI/border")
    if p.kind == "hover":
        # State changes (default→hover for the same component) are NOT
        # subject to WCAG SC 1.4.11. The ask is just "perceivable". Most
        # production UIs (Material, Chakra) ship hover deltas around
        # 1.05–1.10. We hold the line a bit higher at 1.10 so the change
        # is clearly visible without requiring a jarring panel-shift.
        return Bars(aa=1.10, aaa=1.30, label="hover-perceivable")
    if p.kind == "selection":
        # WCAG has no formal bar for selection bands. Browser defaults
        # land ~1.5–2.0:1. Treat 1.30 as the visibility floor (matches
        # Chrome's default highlight on white) and 1.60 as "clearly band".
        return Bars(aa=1.30, aaa=1.60, label="selection")
    if p.large:
        return Bars(aa=3.0, aaa=4.5, label="large text")
    return Bars(aa=4.5, aaa=7.0, label="normal text")


def resolve_bg(theme: Theme, p: Pair) -> tuple[RGB, str]:
    """Resolve a Pair's background to an opaque sRGB triple + display label."""
    if p.bg_mix is not None:
        tone, pct, base = p.bg_mix
        bg = color_mix(theme.tones[tone], pct, theme.panel_for(base))
        return bg, f"mix({tone} {pct}%, {base}) = {hex_str(bg)}"
    return theme.panel_for(p.bg), f"{p.bg} = {hex_str(theme.panel_for(p.bg))}"


def resolve_fg(theme: Theme, p: Pair, bg: RGB) -> tuple[RGB, str]:
    """Resolve a Pair's foreground to an opaque sRGB triple + display label.

    For rules that composite an alpha color (focus, hairlines, disabled,
    selection), the surface bg is needed — passed in so each rule can mix
    against the right floor.
    """
    if p.kind == "focus":
        opaque = rgba_over(theme.accent_edge_rgba, bg)
        return opaque, f"--accent-edge over bg = {hex_str(opaque)}"
    if p.kind == "selection":
        opaque = rgba_over(theme.accent_soft_rgba, bg)
        return opaque, f"--accent-soft over bg = {hex_str(opaque)}"
    if p.kind == "disabled":
        # Post-THI-152: `button:disabled { color: var(--text-disabled) }`
        # replaces the prior flat `opacity: .4`. The disabled-text token
        # is tuned per theme to clear AA 4.5:1 on the button surface.
        opaque = theme.text_for("--text-disabled")
        return opaque, f"--text-disabled = {hex_str(opaque)}"
    if p.kind == "hover":
        # `.btn-ghost:hover { background: var(--hairline-strong) }` composites
        # the hairline rgba over its surface (header / --bg-elev). All other
        # hover pairs use a plain panel token as the hover bg.
        if p.fg == "--hairline-strong-over-bg-elev":
            opaque = rgba_over(theme.hairline_strong_rgba, theme.bg_elev)
            return opaque, f"--hairline-strong over --bg-elev = {hex_str(opaque)}"
        opaque = theme.panel_for(p.fg or "--panel-3")
        return opaque, f"{p.fg} = {hex_str(opaque)}"
    if p.kind == "ui":
        # Hairlines are rgba; composite over the surface bg.
        rgba = theme.hairline_rgba if p.fg == "--hairline" else theme.hairline_strong_rgba
        opaque = rgba_over(rgba, bg)
        return opaque, f"{p.fg} over bg = {hex_str(opaque)}"
    # `text`
    if (p.fg or "").startswith("--text"):
        opaque = theme.text_for(p.fg or "--text")
    else:
        opaque = theme.tones[p.fg or "--accent"]
    return opaque, f"{p.fg} = {hex_str(opaque)}"


@dataclass(frozen=True)
class Result:
    theme: str
    pair: Pair
    ratio: float
    bars: Bars
    fg_hex: str
    bg_repr: str

    @property
    def passes_aa(self) -> bool:
        return self.ratio >= self.bars.aa

    @property
    def passes_aaa(self) -> bool:
        return self.ratio >= self.bars.aaa

    @property
    def status(self) -> str:
        if not self.passes_aa:
            return "FAIL AA"
        if not self.passes_aaa:
            return "AA only"
        return "AAA"


def audit(theme: Theme, rules: Iterable[RuleKind] | None = None) -> list[Result]:
    rules_set = set(rules) if rules else None
    out: list[Result] = []
    for p in _PAIRS:
        if rules_set is not None and p.kind not in rules_set:
            continue
        bg, bg_repr = resolve_bg(theme, p)
        fg, fg_repr = resolve_fg(theme, p, bg)
        ratio = contrast(fg, bg)
        out.append(
            Result(
                theme=theme.name,
                pair=p,
                ratio=ratio,
                bars=bars_for(p),
                fg_hex=hex_str(fg),
                bg_repr=bg_repr,
            )
        )
    return out


# ── reporting ───────────────────────────────────────────────────────────────


def _sort_key(r: Result) -> tuple[int, float]:
    if not r.passes_aa:
        return (0, r.ratio)
    if not r.passes_aaa:
        return (1, r.ratio)
    return (2, r.ratio)


def render(results: list[Result], *, color: bool = True) -> str:
    """Plain-text report; AA failures first."""
    rows = sorted(results, key=_sort_key)
    lines: list[str] = []
    lines.append("=" * 118)
    lines.append(
        f"{'THEME':<9} {'STATUS':<8} {'KIND':<10} {'RATIO':>6}  "
        f"{'AA':>4} {'AAA':>4}  {'FG':<36}  {'BG':<36}  WHERE"
    )
    lines.append("=" * 118)
    for r in rows:
        lines.append(
            f"{r.theme:<9} {r.status:<8} {r.pair.kind:<10} {r.ratio:>5.2f}  "
            f"{r.bars.aa:>4.1f} {r.bars.aaa:>4.1f}  "
            f"{(r.pair.fg or '—') + ' = ' + r.fg_hex:<36}  "
            f"{r.bg_repr:<36}  {r.pair.where}"
        )
    fails_aa = sum(1 for r in results if not r.passes_aa)
    aa_only = sum(1 for r in results if r.passes_aa and not r.passes_aaa)
    aaa = sum(1 for r in results if r.passes_aaa)
    lines.append("")
    lines.append(
        f"Summary: {len(results)} pairs audited — "
        f"{fails_aa} fail AA, {aa_only} pass AA only, {aaa} pass AAA"
    )
    return "\n".join(lines)


# ── token-drift check ───────────────────────────────────────────────────────

# styles.css token regex — narrow patterns to spot drift, not a full parser.
_STYLE_PATH = Path(__file__).resolve().parents[2] / "frontend/src/styles/styles.css"


def _scan_styles_tokens() -> dict[str, dict[str, str]]:
    """Pull `--foo: …;` declarations under `:root` and each `[data-theme]`.

    Returns `{theme_name: {token_name: raw_value}}`. Naive but sufficient to
    catch a token rename or a token whose hex changed — both of which would
    make `_THEMES` stale silently.
    """
    import re

    text = _STYLE_PATH.read_text()
    blocks: dict[str, str] = {}
    # `:root` block (treated as "dark" for the audit's purposes).
    m = re.search(r":root\s*\{([^}]*)\}", text)
    if m:
        blocks["dark"] = m.group(1)
    for name in ("light", "contrast", "phosphor"):
        m = re.search(rf'\[data-theme="{name}"\]\s*\{{([^}}]*)\}}', text)
        if m:
            blocks[name] = m.group(1)
    out: dict[str, dict[str, str]] = {}
    for theme, body in blocks.items():
        out[theme] = {}
        for line in body.splitlines():
            mm = re.match(r"\s*(--[\w-]+)\s*:\s*([^;]+);", line)
            if mm:
                out[theme][mm.group(1)] = mm.group(2).strip()
    return out


def check_sync() -> list[str]:
    """Report tokens declared in styles.css but missing from `_THEMES`.

    Doesn't try to verify the *value* (color math is what the audit is for);
    just flags structural drift so adding a new token forces an audit update.
    """
    css = _scan_styles_tokens()
    drift: list[str] = []
    surface_text = {"--bg", "--bg-elev", "--panel", "--panel-2", "--panel-3",
                    "--hairline", "--hairline-strong",
                    "--text", "--text-mute", "--text-dim", "--text-disabled"}
    known_keys = {
        "dark":     surface_text | {"--accent-soft", "--accent-edge"},
        "light":    surface_text | {"--accent-soft", "--accent-edge"},
        "contrast": surface_text,
        "phosphor": surface_text,
    }
    # Non-color tokens (typography, geometry, shadows) are out of scope for
    # contrast audit — skip them rather than spam the drift report.
    non_color = {"--font-sans", "--font-mono", "--r-sm", "--r", "--r-lg",
                 "--shadow-card", "--shadow-lift"}
    for theme, css_keys in css.items():
        for k in css_keys:
            if k in non_color or k.startswith("--tone-") or k == "--accent":
                continue
            if k not in known_keys.get(theme, set()):
                drift.append(f"{theme}: new token in styles.css not mirrored: {k}")
    return drift


# ── CLI ─────────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--theme",
        action="append",
        choices=list(_THEMES),
        help="Theme(s) to audit. Repeat to add multiple. Defaults to all.",
    )
    p.add_argument(
        "--rule",
        action="append",
        choices=["text", "ui", "focus", "hover", "disabled", "selection"],
        help="Rule(s) to run. Repeat to add multiple. Defaults to all.",
    )
    p.add_argument(
        "--check-sync",
        action="store_true",
        help="Diff styles.css token set against the mirrored _THEMES. "
             "Exits non-zero on drift even if no contrast checks were run.",
    )
    p.add_argument(
        "--quiet",
        action="store_true",
        help="Only print AA failures (no header table, no AA/AAA rows).",
    )
    args = p.parse_args(argv)

    rc = 0
    if args.check_sync:
        drift = check_sync()
        if drift:
            for line in drift:
                print(line, file=sys.stderr)
            rc = 2
        else:
            print("token sync ok", file=sys.stderr)

    themes = [_THEMES[name] for name in (args.theme or list(_THEMES))]
    all_results: list[Result] = []
    for theme in themes:
        all_results.extend(audit(theme, args.rule))

    if args.quiet:
        fails = [r for r in all_results if not r.passes_aa]
        for r in sorted(fails, key=_sort_key):
            print(
                f"{r.theme:<9} {r.pair.kind:<10} ratio={r.ratio:.2f} "
                f"AA={r.bars.aa:.1f}  {r.pair.where}",
                file=sys.stderr,
            )
        if fails:
            rc = 1
    else:
        print(render(all_results))
        if any(not r.passes_aa for r in all_results):
            rc = 1

    return rc


if __name__ == "__main__":
    sys.exit(main())
