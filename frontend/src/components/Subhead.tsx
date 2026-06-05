import type { KindFilter, StatusFilter } from "../lib/filter";
import {
  COLUMN_SIZE_ORDER,
  updateSettings,
  useSetting,
  useSettings,
} from "../lib/settings";
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

export function Subhead({
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
  const Tab = ({
    id,
    label,
    n,
    tone,
    dataTour,
  }: {
    id: StatusFilter;
    label: string;
    n: number;
    tone?: string;
    /** Optional `data-tour="…"` selector hook for the first-run tour. */
    dataTour?: string;
  }) => (
    <button
      className={`tab ${filter === id ? "is-active" : ""}`}
      onClick={() => setFilter(id)}
      data-tour={dataTour}
    >
      {tone && <span className={`stat-dot tone-${tone}`} />}
      <span>{label}</span>
      <span className="count">{n}</span>
    </button>
  );

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
        <Tab id="all" label="All" n={counts.all} />
        <Tab
          id="waiting"
          label="Waiting"
          n={counts.waiting}
          tone="amber"
          dataTour="amber-waiting"
        />
        <Tab id="running" label="Running" n={counts.running} tone="cyan" />
        <Tab id="idle" label="Idle" n={counts.idle} tone="gray" />
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
      <LayoutSwitcher />
    </div>
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

