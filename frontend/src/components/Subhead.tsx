import type { StatusFilter } from "../lib/filter";
import type { HeaderCounts } from "./Header";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

interface Props {
  filter: StatusFilter;
  setFilter: (v: StatusFilter) => void;
  query: string;
  setQuery: (v: string) => void;
  counts: HeaderCounts;
}

export function Subhead({ filter, setFilter, query, setQuery, counts }: Props) {
  const Tab = ({
    id,
    label,
    n,
    tone,
  }: {
    id: StatusFilter;
    label: string;
    n: number;
    tone?: string;
  }) => (
    <button
      className={`tab ${filter === id ? "is-active" : ""}`}
      onClick={() => setFilter(id)}
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
        <Tab id="waiting" label="Waiting" n={counts.waiting} tone="amber" />
        <Tab id="running" label="Running" n={counts.running} tone="cyan" />
        <Tab id="idle" label="Idle" n={counts.idle} tone="gray" />
      </span>
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
