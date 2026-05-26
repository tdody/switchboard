import type { StatusFilter } from "../lib/filter";
import { type ColumnSize, updateSettings, useSettings } from "../lib/settings";
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
}

// Ordered narrow → normal → wide so + / − can step linearly (THI-128).
const COLUMN_SIZE_ORDER: ColumnSize[] = ["narrow", "normal", "wide"];

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

export function Subhead({ filter, setFilter, query, setQuery, counts }: Props) {
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
      <StatusLegend />
      <ColumnSizeControl />
      <span className="hdr-spacer" />
      <span className="layout-switcher">
        <Tooltip content="Kanban">
          <button className="is-active">
            <Icon name="kanban" size={13} />
          </button>
        </Tooltip>
        <Tooltip content="Grid (coming soon)">
          <button disabled>
            <Icon name="grid" size={13} />
          </button>
        </Tooltip>
        <Tooltip content="List (coming soon)">
          <button disabled>
            <Icon name="list" size={13} />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}
