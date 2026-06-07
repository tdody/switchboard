import { memo } from "react";

import type { KindFilter, StatusFilter } from "../lib/filter";
import {
  COLUMN_SIZE_ORDER,
  type Layout,
  updateSettings,
  useSetting,
  useSettings,
} from "../lib/settings";
import { suggestLayout } from "../lib/suggestLayout";
import type { FilterPreset } from "../lib/usePresets";
import type { HeaderCounts } from "./Header";
import { Icon } from "./Icon";
import { StatusLegend } from "./StatusLegend";
import { Tooltip } from "./Tooltip";

interface Props {
  filter: StatusFilter;
  setFilter: (v: StatusFilter) => void;
  query: string;
  setQuery: (v: string) => void;
  counts: HeaderCounts;
  kindFilter: KindFilter;
  onChipClick: (next: KindFilter) => void;
  /** THI-98 saved-filter presets. Provided together as a block — when any of
   *  the three callbacks is omitted, the chip-bar and the Save button are
   *  hidden entirely so tests / older entry points keep rendering as before. */
  presets?: FilterPreset[];
  onApplyPreset?: (p: FilterPreset) => void;
  onSavePreset?: (p: FilterPreset) => void;
  onDeletePreset?: (name: string) => void;
  /** Number of currently-visible windows (post-filter). Drives the THI-61
   *  layout suggestion chip. Optional so tests/older callers don't need to
   *  thread it in. */
  visibleCount?: number;
}

function ColumnSizeControl() {
  const { columnSize } = useSettings();
  const idx = COLUMN_SIZE_ORDER.indexOf(columnSize);
  const atNarrow = idx <= 0;
  const atWide = idx >= COLUMN_SIZE_ORDER.length - 1;
  const step = (delta: -1 | 1) => {
    const next = COLUMN_SIZE_ORDER[idx + delta];
    if (next) updateSettings({ columnSize: next });
  };
  return (
    <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
      <Tooltip content={`Narrower columns (current: ${columnSize})`}>
        <button
          className="tab"
          onClick={() => step(-1)}
          disabled={atNarrow}
          aria-label="Narrower columns"
        >
          <Icon name="minus" size={13} />
        </button>
      </Tooltip>
      <Tooltip content={`Wider columns (current: ${columnSize})`}>
        <button
          className="tab"
          onClick={() => step(1)}
          disabled={atWide}
          aria-label="Wider columns"
        >
          <Icon name="plus" size={13} />
        </button>
      </Tooltip>
    </span>
  );
}

// Module-scope so the component identity is stable across Subhead renders.
// Previously declared inside Subhead's body, which allocated a fresh component
// type per render and remounted the four tab buttons on every keystroke (THI-217).
function Tab({
  id,
  label,
  n,
  tone,
  dataTour,
  activeFilter,
  onSelect,
}: {
  id: StatusFilter;
  label: string;
  n: number;
  tone?: string;
  /** Optional `data-tour="…"` selector hook for the first-run tour. */
  dataTour?: string;
  activeFilter: StatusFilter;
  onSelect: (id: StatusFilter) => void;
}) {
  return (
    <button
      className={`tab ${activeFilter === id ? "is-active" : ""}`}
      onClick={() => onSelect(id)}
      data-tour={dataTour}
    >
      {tone && <span className={`stat-dot tone-${tone}`} />}
      <span>{label}</span>
      <span className="count">{n}</span>
    </button>
  );
}

function SubheadInner({
  filter,
  setFilter,
  query,
  setQuery,
  counts,
  kindFilter,
  onChipClick,
  presets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  visibleCount,
}: Props) {
  // Presets bar (THI-98) is rendered only when all three callbacks were wired —
  // partial setup would invite half-broken states. The hook in App always
  // supplies the full triplet, so this is just a tests/fallback guard.
  const presetsEnabled = !!(onApplyPreset && onSavePreset && onDeletePreset);
  const handleSavePreset = () => {
    if (!onSavePreset) return;
    const name = window.prompt(
      "Name this filter preset (e.g. 'Stuck agents'):",
    );
    if (name === null) return; // user cancelled
    const trimmed = name.trim();
    if (!trimmed) return;
    onSavePreset({ name: trimmed, filter, kind: kindFilter, query });
  };

  return (
    <div className="subhead">
      <div className="search">
        <Icon name="search" />
        <input
          id="search-input"
          placeholder="Filter… try kind:agent, status:waiting, session:main"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="kbd">/</span>
      </div>
      <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
        <Tab id="all" label="All" n={counts.all} activeFilter={filter} onSelect={setFilter} />
        <Tab
          id="waiting"
          label="Waiting"
          n={counts.waiting}
          tone="amber"
          dataTour="amber-waiting"
          activeFilter={filter}
          onSelect={setFilter}
        />
        <Tab id="running" label="Running" n={counts.running} tone="cyan" activeFilter={filter} onSelect={setFilter} />
        <Tab id="idle" label="Idle" n={counts.idle} tone="gray" activeFilter={filter} onSelect={setFilter} />
      </span>
      {/* Kind chips (THI-130). Radio-style: click toggles; only one can be
       *  active. The chip and the per-card kind glyph share icons from
       *  `kindIcon()` so they stay visually identical. */}
      <span className="kind-tabs" style={{ display: "inline-flex", gap: 2 }}>
        <button
          className={`tab ${kindFilter === "agent" ? "is-active" : ""}`}
          onClick={() => onChipClick("agent")}
        >
          <Icon name="agent" size={11} />
          <span>Agent</span>
        </button>
        <button
          className={`tab ${kindFilter === "shell" ? "is-active" : ""}`}
          onClick={() => onChipClick("shell")}
        >
          <Icon name="shell" size={11} />
          <span>Shell</span>
        </button>
      </span>
      {presetsEnabled && (
        <span className="preset-bar" style={{ display: "inline-flex", gap: 2 }}>
          {presets?.map((p) => (
            <span
              key={p.name}
              className="preset-chip"
              title={`Apply preset: ${p.name}`}
            >
              <button
                type="button"
                className="preset-chip-apply"
                onClick={() => onApplyPreset!(p)}
              >
                {p.name}
              </button>
              <button
                type="button"
                className="preset-chip-x"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeletePreset!(p.name);
                }}
                aria-label={`Delete preset ${p.name}`}
                title={`Delete preset "${p.name}"`}
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          <Tooltip content="Save the current filter as a preset">
            <button
              type="button"
              className="preset-save"
              onClick={handleSavePreset}
            >
              <Icon name="plus" size={11} />
              <span>Save filter</span>
            </button>
          </Tooltip>
        </span>
      )}
      <StatusLegend />
      <ColumnSizeControl />
      <span className="hdr-spacer" />
      <LayoutHint filter={filter} visibleCount={visibleCount} />
      <LayoutSwitcher />
    </div>
  );
}

// React.memo skips re-renders when props are shallow-equal (THI-217). Most
// callers in App.tsx already pass useCallback'd handlers + useMemo'd counts;
// the bare `setFilter` arrow at App.tsx:112 was wrapped in useCallback in the
// same PR so the shallow-compare actually short-circuits on every poll.
export const Subhead = memo(SubheadInner);

function LayoutHint({
  filter,
  visibleCount,
}: {
  filter: StatusFilter;
  visibleCount: number | undefined;
}) {
  // THI-61: nudge the user toward a denser/loosened layout based on the
  // current view's shape. No suggestion → render nothing. Click applies
  // the suggested layout.
  const layout = useSetting("layout");
  if (visibleCount == null) return null;
  const suggested: Layout | null = suggestLayout(layout, filter, visibleCount);
  if (!suggested) return null;
  const label = suggested === "list" ? "Try list view" : "Try grid view";
  return (
    <button
      type="button"
      className="layout-hint"
      onClick={() => updateSettings({ layout: suggested })}
      title={`Switch to ${suggested} layout`}
    >
      <Icon name={suggested === "list" ? "list" : "grid"} size={11} />
      <span>{label}</span>
    </button>
  );
}

function LayoutSwitcher() {
  // THI-59 wires the grid button to the layout setting. Kanban is the
  // default; grid swaps to <GridView/> in App.tsx. List remains disabled
  // — that's THI-60.
  const layout = useSetting("layout");
  return (
    <span className="layout-switcher">
      <Tooltip content="Kanban">
        <button
          className={layout === "kanban" ? "is-active" : ""}
          onClick={() => updateSettings({ layout: "kanban" })}
          aria-label="Kanban layout"
        >
          <Icon name="kanban" size={13} />
        </button>
      </Tooltip>
      <Tooltip content="Grid">
        <button
          className={layout === "grid" ? "is-active" : ""}
          onClick={() => updateSettings({ layout: "grid" })}
          aria-label="Grid layout"
        >
          <Icon name="grid" size={13} />
        </button>
      </Tooltip>
      <Tooltip content="List">
        <button
          className={layout === "list" ? "is-active" : ""}
          onClick={() => updateSettings({ layout: "list" })}
          aria-label="List layout"
        >
          <Icon name="list" size={13} />
        </button>
      </Tooltip>
    </span>
  );
}

