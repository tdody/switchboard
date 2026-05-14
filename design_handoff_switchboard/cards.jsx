// cards.jsx — window card + list row + grouping helpers

function kindIcon(kind) {
  switch (kind) {
    case "agent":  return "agent";
    case "editor": return "editor";
    case "server": return "server";
    case "logs":   return "logs";
    case "shell":  return "shell";
    default:       return "term";
  }
}

// CPU thresholds: >=60% amber, >=85% red.
// Mem thresholds: >=1024 MB amber, >=2048 MB red.
function cpuLevel(c) { if (c >= 85) return "danger"; if (c >= 60) return "warn"; return ""; }
function memLevel(m) { if (m >= 2048) return "danger"; if (m >= 1024) return "warn"; return ""; }

function StatusPill({ status }) {
  const meta = STATUS_META[status];
  if (!meta) return null;
  return (
    <span className={`card-status ${status} tone-${meta.tone}`}>
      <span className="glyph" aria-hidden="true"></span>
      <span>{meta.label}</span>
    </span>
  );
}

function Chip({ children, className = "", title }) {
  return <span className={`chip ${className}`} title={title}>{children}</span>;
}

function WindowCard({ w, isFocused, onOpen, onSendKeys, onRename, onFocus }) {
  const pending = !!w.pendingInput;
  const ago = formatAgo(w.lastActivity);
  const agent = w.agent;
  const cpu = cpuLevel(w.cpu);
  const mem = memLevel(w.mem);
  const showResources = !!cpu || !!mem;
  return (
    <div
      className={`card ${pending ? "card-pending" : ""} ${isFocused ? "card-focused" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
    >
      <div className="card-head">
        <span className={`card-kind kind-${w.kind}`} title={w.kind}>
          <Icon name={kindIcon(w.kind)} size={12} />
        </span>
        <span className="card-name" title={w.name}>{w.name}</span>
        <span className="card-idx">:{w.index}</span>
        <StatusPill status={w.status} />
      </div>

      {agent && (
        <div className="card-agent">
          <div className="chip-row">
            {(agent.branch || agent.pr) && (
              <Chip className={`branch-pr ${agent.ci ? `ci-${agent.ci}` : ""}`} title={agent.branch || `PR #${agent.pr}`}>
                {agent.ci && (
                  <span className={`ci-dot ci-${agent.ci}`} aria-hidden="true"></span>
                )}
                {agent.branch && <Icon name="git-branch" size={10} />}
                {agent.branch && <span>{agent.branch}</span>}
                {agent.branch && agent.pr && <span className="pr-sep">›</span>}
                {agent.pr && <span className="pr-num">#{agent.pr}</span>}
              </Chip>
            )}
            {agent.spinner && (
              <Chip className="spinner" title="agent activity">
                <span className="spin" />
                <span>{agent.spinner}</span>
                {agent.duration && <span className="dur">{agent.duration}</span>}
              </Chip>
            )}
          </div>
          {agent.recap && (
            <div className="recap">{agent.recap}</div>
          )}
          {pending && agent.action && (
            <div className="pending">
              <span className="glyph">›</span>
              <span>{agent.action}</span>
            </div>
          )}
        </div>
      )}

      <div className="preview">
        {w.preview.map((line, i) => (
          <div key={i} className="ln">{line}</div>
        ))}
      </div>

      {showResources && (
        <div className="card-meta">
          <span className={`resource ${cpu}`} title="cpu">
            <b>{w.cpu.toFixed(1)}%</b> cpu
          </span>
          <span className="sep">·</span>
          <span className={`resource ${mem}`} title="memory">
            <b>{formatMem(w.mem)}</b> mem
          </span>
        </div>
      )}

      <div className="card-foot" onClick={(e) => e.stopPropagation()}>
        <button className="act act-icon" onClick={onFocus} title="Jump to this window in your terminal (tmux switch-client)">
          <Icon name="focus" size={12} />
        </button>
        <button className="act act-icon" onClick={onRename} title="Rename window">
          <Icon name="rename" size={12} />
        </button>
        <button className="act act-icon" onClick={onSendKeys} title="Send keys">
          <Icon name="send" size={12} />
        </button>
        <span className="spacer"></span>
        <span className="ago" title="last activity">
          <Icon name="clock" size={11} style={{ opacity: .6 }} />
          <span>{ago}</span>
        </span>
      </div>
    </div>
  );
}

// ── List row layout ───────────────────────────────────────────────────
function ListRow({ w, onOpen, onSendKeys, onRename, onFocus }) {
  const meta = STATUS_META[w.status];
  const ago = formatAgo(w.lastActivity);
  const agent = w.agent;
  return (
    <div className={`row ${w.pendingInput ? "card-pending" : ""}`} onClick={onOpen}>
      <span className={`row-dot tone-${meta.tone}`} style={{ background: "currentColor" }}></span>
      <span className="row-name">
        <span className="sess">{w.session}/</span>
        <b>{w.name}</b>
      </span>
      <span className="row-recap" title={agent?.recap || w.cmd}>
        {agent?.recap || w.cmd}
      </span>
      <span className="row-num">
        <span className={cpuLevel(w.cpu) ? `tone-${cpuLevel(w.cpu) === "danger" ? "red" : "amber"}` : ""}>{w.cpu.toFixed(1)}%</span>
        {" · "}
        <span className={memLevel(w.mem) ? `tone-${memLevel(w.mem) === "danger" ? "red" : "amber"}` : ""}>{formatMem(w.mem)}</span>
      </span>
      <span className={`row-ago tone-${meta.tone}`}>{meta.label}</span>
      <span className="row-chips">
        {agent?.branch && <Chip className="branch"><Icon name="git-branch" size={10} /><span>{agent.branch.split('/').pop()}</span></Chip>}
        {agent?.pr && <Chip className="pr">#{agent.pr}</Chip>}
      </span>
      <span className="row-ago">{ago}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button className="act act-icon" onClick={onFocus} title="Focus"><Icon name="focus" size={12} /></button>
        <button className="act act-icon" onClick={onRename} title="Rename"><Icon name="rename" size={12} /></button>
        <button className="act act-icon" onClick={onSendKeys} title="Send"><Icon name="send" size={12} /></button>
      </span>
    </div>
  );
}

window.WindowCard = WindowCard;
window.ListRow = ListRow;
window.StatusPill = StatusPill;
window.kindIcon = kindIcon;
