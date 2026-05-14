// overlays.jsx — command palette, auto-rename, settings, empty state

// ── Command Palette ──────────────────────────────────────────────────
function CommandPalette({ context, onClose, onSubmit }) {
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const broadcast = !!context?.broadcast;

  const recent = [
    { id: "cmd-ls",      label: "ls -la",                          hint: "send command",      keys: "ls -la\n" },
    { id: "cmd-status",  label: "git status",                      hint: "send command",      keys: "git status\n" },
    { id: "cmd-tests",   label: "pnpm test --watch",               hint: "send command",      keys: "pnpm test --watch\n" },
    { id: "cmd-ctrlc",   label: "Send Ctrl+C",                     hint: "interrupt",         keys: "<C-c>" },
    { id: "cmd-up",      label: "Re-run last command",             hint: "↑ ⏎",               keys: "<Up>\n" },
  ];
  const agents = [
    { id: "agent-yes",   label: "Yes (y)",                         hint: "approve prompt",    keys: "y\n" },
    { id: "agent-no",    label: "No (n)",                          hint: "decline prompt",    keys: "n\n" },
    { id: "agent-cont",  label: "continue",                        hint: "agent prompt",      keys: "continue\n" },
    { id: "agent-look",  label: "look more carefully and try again", hint: "agent nudge",     keys: "look more carefully and try again\n" },
  ];

  const filtered = (items) => items.filter(i => i.label.toLowerCase().includes(q.toLowerCase()));
  const allItems = [...filtered(recent), ...filtered(agents)];

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, allItems.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
      if (e.key === "Enter")     { e.preventDefault(); onSubmit?.(allItems[active]); onClose(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, allItems.length, onClose]);

  const sec = (title, items) => {
    if (!items.length) return null;
    return (
      <React.Fragment>
        <div className="palette-section">{title}</div>
        {items.map((it) => {
          const i = allItems.indexOf(it);
          return (
            <div
              key={it.id}
              className={`palette-item ${i === active ? "is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => { onSubmit?.(it); onClose(); }}
            >
              <span className="ico"><Icon name="send" /></span>
              <span className="label">{it.label}</span>
              <span className="hint">{it.hint}</span>
            </div>
          );
        })}
      </React.Fragment>
    );
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-hd">
          {broadcast
            ? <span className="connect-pill" style={{ background: "color-mix(in oklch, var(--tone-amber) 16%, transparent)", color: "var(--tone-amber)", flexShrink: 0 }}>
                <span className="dot"></span>broadcast
              </span>
            : <Icon name="send" />
          }
          <input
            autoFocus
            placeholder={
              broadcast
                ? `Send to ${context.targets.length} waiting agents…`
                : `Send keys to ${context?.session}:${context?.index} ${context?.name}…`
            }
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-body">
          {broadcast && (
            <>
              <div className="palette-section">Targets</div>
              <div style={{ padding: "6px 16px 8px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                {context.targets.map(w => (
                  <span key={w.id} className="chip pr" style={{ color: "var(--tone-amber)" }}>
                    <span>{w.session}:{w.index} {w.name}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          {sec("Recent commands", filtered(recent))}
          {sec("Agent prompts", filtered(agents))}
          {!allItems.length && (
            <div className="palette-item">
              <span className="ico"><Icon name="enter" /></span>
              <span className="label">Send <code style={{ fontFamily: "var(--font-mono)" }}>"{q}"</code> as keystrokes</span>
              <span className="hint">⏎ to send</span>
            </div>
          )}
        </div>
        <div className="palette-foot">
          <span className="hint"><span className="kbd">↑↓</span> navigate</span>
          <span className="hint"><span className="kbd">⏎</span> send</span>
          <span className="hint"><span className="kbd">⌃⇧P</span> paste</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>
            target: <b style={{ color: "var(--text)" }}>
              {broadcast ? `${context.targets.length} panes` : `${context?.session}:${context?.index}`}
            </b>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Auto-rename ──────────────────────────────────────────────────────
function AutoRenameModal({ session, windows, onClose, onApply }) {
  const suggestions = React.useMemo(() => generateRenameSuggestions(windows), [windows.map(w => w.id).join(",")]);
  const [rows, setRows] = React.useState(() =>
    suggestions.map((s, i) => ({ ...s, accepted: true, edited: s.suggested }))
  );

  const accepted = rows.filter(r => r.accepted).length;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rename-hd">
          <h3>
            <span className="sparkle"><Icon name="sparkle" /></span>
            Auto-rename windows in <span style={{ fontFamily: "var(--font-mono)" }}>{session}</span>
          </h3>
          <p>Suggestions from claude-haiku-4-5 based on what each pane is doing right now.</p>
        </div>
        <div className="rename-body">
          {rows.map((r, idx) => (
            <div key={r.id} className={`rename-row ${!r.accepted ? "skipped" : ""}`}>
              <span className="idx">:{r.index}</span>
              <div className="lines">
                <span className="old" title={r.old}>
                  <span className="tag">from</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.old}</span>
                </span>
                {r.accepted ? (
                  <span className="new">
                    <span className="tag">to</span>
                    <input
                      className="new-input"
                      value={r.edited}
                      onChange={(e) => setRows(rows.map((x, i) => i === idx ? { ...x, edited: e.target.value } : x))}
                    />
                  </span>
                ) : (
                  <span className="new" title={r.suggested}>
                    <span className="tag">to</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.suggested}</span>
                  </span>
                )}
              </div>
              <button
                className="skip"
                title={r.accepted ? "Skip this rename" : "Restore"}
                onClick={() => setRows(rows.map((x, i) => i === idx ? { ...x, accepted: !x.accepted } : x))}
              >
                <Icon name={r.accepted ? "x" : "plus"} size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="rename-foot">
          <span className="left">
            <span style={{ color: "var(--text)" }}>{accepted}</span> of {rows.length} accepted
            <span className="sep" style={{ padding: "0 8px", color: "var(--text-dim)" }}>·</span>
            <span style={{ color: "var(--text-dim)" }}>~$0.0021 · 2.4k tokens</span>
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              onApply?.(rows.filter(r => r.accepted).map(r => ({ id: r.id, name: r.edited })));
              onClose();
            }}
          >
            <Icon name="check" /> Apply {accepted}
          </button>
        </div>
      </div>
    </div>
  );
}

function generateRenameSuggestions(windows) {
  // Curated, plausible suggestions based on what the pane is doing.
  const map = {
    "nvim": "edit/dashboard",
    "dev":  "vite/5173",
    "shell": "git/log",
    "claude/dashboard-kanban": "✻ kanban-collapse",
    "claude/migrate-orm": "✻ prisma→drizzle",
    "claude/flaky-tests": "✻ flaky-billing",
    "claude/landing-copy": "✓ landing-v3",
    "claude/perf-investigation": "✻ perf/timeline",
    "claude/docs-cleanup": "✗ docs (rate-limit)",
    "claude/scratch": "✻ ready",
    "PR #184":  "review/#184 kanban",
    "PR #412":  "review/#412 drizzle",
    "notes":    "notes/review",
    "deploy":   "logs/api-prod",
    "k9s":      "k8s/prod",
    "alerts":   "alerts/quiet",
    "psql":     "psql/dev",
    "htop":     "htop/64g",
  };
  return windows.map(w => ({
    id: w.id,
    index: w.index,
    old: w.name,
    suggested: map[w.name] || w.name,
  }));
}

// ── Settings ─────────────────────────────────────────────────────────
function SettingsModal({ onClose }) {
  const [hasKey, setHasKey] = React.useState(true);
  const [poll, setPoll] = React.useState(3);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-hd">
          <SwitchboardMark size={22} />
          <span>Settings</span>
          <span className="term-spacer" style={{ flex: 1 }}></span>
          <span className="connect-pill"><span className="dot"></span>connected · 127.0.0.1:8765</span>
          <button className="btn btn-icon btn-ghost" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="settings-body">
          <div className="settings-group">
            <h4>Connection</h4>
            <div className="settings-row">
              <span>
                <div className="name">Server URL</div>
                <div className="desc">The local switchboard server.</div>
              </span>
              <input type="text" defaultValue="http://127.0.0.1:8765" />
              <span></span>
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Poll interval</div>
                <div className="desc">How often the dashboard fetches /api/state.</div>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range" min="1" max="30" step="1"
                  value={poll}
                  onChange={(e) => setPoll(+e.target.value)}
                  style={{ flex: 1 }}
                />
                <span className="val">{poll}s</span>
              </span>
              <span></span>
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Live terminal stream</div>
                <div className="desc">Use WebSocket /ws/pane when a window is open.</div>
              </span>
              <span className="val">ws://127.0.0.1:8765/ws/pane</span>
              <Toggle on={true} />
            </div>
          </div>

          <div className="settings-group">
            <h4>Auto-rename</h4>
            <div className="settings-row">
              <span>
                <div className="name">Anthropic API key</div>
                <div className="desc">Powers the ✨ batch rename. Read from <code style={{ fontFamily: "var(--font-mono)" }}>.env</code>.</div>
              </span>
              <input type="text" defaultValue={hasKey ? "sk-ant-•••••••••••••••••••••••••MDE2" : "(not set)"} onChange={() => {}}/>
              <Toggle on={hasKey} onChange={() => setHasKey(!hasKey)} />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Model</div>
                <div className="desc">Used for window-name suggestions.</div>
              </span>
              <span className="val">claude-haiku-4-5</span>
              <span></span>
            </div>
          </div>

          <div className="settings-group">
            <h4>Notifications</h4>
            <div className="settings-row">
              <span>
                <div className="name">Pending-input badge</div>
                <div className="desc">Pulse a card when an agent is waiting on you.</div>
              </span>
              <span className="val">enabled</span>
              <Toggle on={true} />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Browser notifications</div>
                <div className="desc">Native OS notification when an agent goes idle.</div>
              </span>
              <span className="val">off</span>
              <Toggle on={false} />
            </div>
          </div>
        </div>
        <div className="rename-foot" style={{ borderTop: "1px solid var(--hairline)" }}>
          <span className="left">tmux 3.4 · python 3.12.7 · 22 windows · 5 sessions</span>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary"><Icon name="check" /> Save</button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <span
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange?.(!on)}
      role="switch"
      aria-checked={on}
    />
  );
}

// ── Empty state ──────────────────────────────────────────────────────
function EmptyState({ onRetry }) {
  return (
    <div className="empty">
      <div className="empty-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <SwitchboardMark size={26} />
          <span className="connect-pill" style={{ background: "color-mix(in oklch, var(--tone-amber) 16%, transparent)", color: "var(--tone-amber)" }}>
            <span className="dot"></span>no tmux server
          </span>
        </div>
        <h2>No tmux server is running.</h2>
        <p>
          Switchboard couldn't find a live tmux socket on this host. Spin one up,
          then refresh — the dashboard will pick it up automatically.
        </p>
        <pre>{`# create a session and attach
$ tmux new -s main

# or attach to an existing one
$ tmux attach -t main`}</pre>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={onRetry}><Icon name="spinner" /> Retry</button>
          <button className="btn">View setup docs</button>
        </div>
        <div className="hint">polling /api/state · last attempt 2s ago · 0 sessions · 0 windows</div>
      </div>
    </div>
  );
}

Object.assign(window, { CommandPalette, AutoRenameModal, SettingsModal, EmptyState, Toggle });
