// app.jsx — main shell. Header, subhead, kanban/grid/list, overlays, tweaks.

const { useState, useEffect, useMemo, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "accent": "aurora",
  "layout": "kanban",
  "density": "comfy",
  "showPreviews": true,
  "groupBy": "session",
  "reducedMotion": false
}/*EDITMODE-END*/;

const ACCENT_TOKENS = {
  aurora:  { l: 0.78, c: 0.13, h: 145 },
  amber:   { l: 0.80, c: 0.14, h:  80 },
  sky:     { l: 0.74, c: 0.13, h: 240 },
  magenta: { l: 0.72, c: 0.16, h: 330 },
  lilac:   { l: 0.74, c: 0.12, h: 295 },
};

const ACCENT_PALETTES = {
  aurora:  ["oklch(0.78 0.13 145)", "#15181e", "#0b0c0f"],
  amber:   ["oklch(0.80 0.14 80)",  "#15181e", "#0b0c0f"],
  sky:     ["oklch(0.74 0.13 240)", "#15181e", "#0b0c0f"],
  magenta: ["oklch(0.72 0.16 330)", "#15181e", "#0b0c0f"],
  lilac:   ["oklch(0.74 0.12 295)", "#15181e", "#0b0c0f"],
};

function applyAccent(name) {
  const a = ACCENT_TOKENS[name] || ACCENT_TOKENS.aurora;
  const root = document.documentElement;
  root.style.setProperty("--accent",      `oklch(${a.l} ${a.c} ${a.h})`);
  root.style.setProperty("--accent-soft", `oklch(${a.l} ${a.c} ${a.h} / 0.16)`);
  root.style.setProperty("--accent-edge", `oklch(${a.l} ${a.c} ${a.h} / 0.55)`);
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const [filter, setFilter]       = useState("all");
  const [query, setQuery]         = useState("");
  const [openWindow, setOpenWindow] = useState(null);
  const [paletteTarget, setPaletteTarget] = useState(null);
  const [renameSession, setRenameSession] = useState(null);
  const [showSettings, setShowSettings]   = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showNeedsStrip, setShowNeedsStrip] = useState(true);
  const [emptyState, setEmptyState]       = useState(false);
  const [focusedId, setFocusedId]         = useState(null);
  const [toasts, setToasts]               = useState([]);

  // Detect the host terminal client (faked from the attached session)
  const hostTerm = useMemo(() => {
    const s = SESSIONS.find(s => s.attached);
    return s?.clients?.[0]?.term || "your terminal";
  }, []);

  // Push a toast that auto-removes after ~2.1s (matches the CSS toastOut delay+anim).
  const pushToast = React.useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(ts => [...ts, { id, ...t }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 2100);
  }, []);

  const handleFocus = React.useCallback((w) => {
    setFocusedId(w.id);
    setTimeout(() => setFocusedId(id => id === w.id ? null : id), 900);
    pushToast({
      kind: "focus",
      session: w.session,
      index: w.index,
      name: w.name,
      term: hostTerm,
    });
    // Focus also brings you to the window — in this prototype, that means
    // opening the live terminal modal after a beat (so the flash is visible).
    setTimeout(() => setOpenWindow(w), 280);
  }, [hostTerm, pushToast]);

  // Apply theme + accent + reduced motion to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
    document.documentElement.setAttribute("data-density", t.density);
    document.documentElement.setAttribute("data-show-previews", String(t.showPreviews));
    document.documentElement.setAttribute("data-reduced-motion", String(t.reducedMotion));
    applyAccent(t.accent);
  }, [t.theme, t.density, t.showPreviews, t.reducedMotion, t.accent]);

  // Global hotkeys: ⌘K command palette, ? to focus search, ? for help
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const target = WINDOWS.find(w => w.pendingInput) || WINDOWS[0];
        setPaletteTarget(target);
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !inField) {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !inField) {
        e.preventDefault();
        setShowShortcuts(s => !s);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => ({
    all:      WINDOWS.length,
    waiting:  WINDOWS.filter(w => w.status === "waiting").length,
    running:  WINDOWS.filter(w => w.status === "running").length,
    idle:     WINDOWS.filter(w => w.status === "idle").length,
    done:     WINDOWS.filter(w => w.status === "done").length,
    error:    WINDOWS.filter(w => w.status === "error").length,
    agents:   WINDOWS.filter(w => w.kind === "agent").length,
    shells:   WINDOWS.filter(w => w.kind === "shell").length,
    editors:  WINDOWS.filter(w => w.kind === "editor").length,
    servers:  WINDOWS.filter(w => w.kind === "server").length,
    logs:     WINDOWS.filter(w => w.kind === "logs").length,
  }), []);

  const { tokens, freeText } = useMemo(() => parseQuery(query), [query]);

  const visible = useMemo(() => {
    const tokenKind   = tokens.kind;
    const tokenStatus = tokens.status;
    const tokenSess   = tokens.session;
    return WINDOWS.filter(w => {
      if (filter !== "all" && w.status !== filter) return false;
      if (tokenKind   && w.kind    !== tokenKind)    return false;
      if (tokenStatus && w.status  !== tokenStatus)  return false;
      if (tokenSess   && w.session !== tokenSess)    return false;
      if (!freeText) return true;
      const q = freeText.toLowerCase();
      return (
        w.name.toLowerCase().includes(q) ||
        w.session.toLowerCase().includes(q) ||
        (w.agent?.branch || "").toLowerCase().includes(q) ||
        (w.agent?.recap || "").toLowerCase().includes(q) ||
        (w.cmd || "").toLowerCase().includes(q)
      );
    });
  }, [filter, tokens, freeText]);

  const pendingWindows = useMemo(
    () => WINDOWS.filter(w => w.pendingInput),
    []
  );

  if (emptyState) {
    return (
      <div className="app">
        <Header
          counts={counts}
          onSettings={() => setShowSettings(true)}
          onRetry={() => setEmptyState(false)}
          onHelp={() => setShowShortcuts(true)}
          inEmpty={true}
        />
        <main className="main">
          <EmptyState onRetry={() => setEmptyState(false)} />
        </main>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        {showShortcuts && <ShortcutsSheet onClose={() => setShowShortcuts(false)} />}
        <TweaksPanelUI t={t} setTweak={setTweak} onSimEmpty={() => setEmptyState(!emptyState)} />
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        counts={counts}
        onSettings={() => setShowSettings(true)}
        onHelp={() => setShowShortcuts(true)}
        inEmpty={false}
      />

      {pendingWindows.length > 0 && showNeedsStrip && (
        <NeedsStrip
          windows={pendingWindows}
          onOpen={setOpenWindow}
          onSend={setPaletteTarget}
          onBroadcast={() => setPaletteTarget({ broadcast: true, targets: pendingWindows })}
          onDismiss={() => setShowNeedsStrip(false)}
        />
      )}

      <Subhead
        filter={filter} setFilter={setFilter}
        query={query} setQuery={setQuery}
        counts={counts}
        layout={t.layout}
        setLayout={(v) => setTweak("layout", v)}
        visibleCount={visible.length}
      />

      <main className="main">
        {t.groupBy === "session" && t.layout === "kanban" ? (
          <Kanban
            sessions={SESSIONS}
            windows={visible}
            focusedId={focusedId}
            onOpen={setOpenWindow}
            onPalette={setPaletteTarget}
            onRenameSession={setRenameSession}
            onFocus={handleFocus}
          />
        ) : t.layout === "list" ? (
          <ListView
            windows={sortPendingFirst(visible)}
            focusedId={focusedId}
            onOpen={setOpenWindow}
            onPalette={setPaletteTarget}
            onFocus={handleFocus}
          />
        ) : (
          <GridView
            sessions={SESSIONS}
            windows={sortPendingFirst(visible)}
            groupBy={t.groupBy}
            focusedId={focusedId}
            onOpen={setOpenWindow}
            onPalette={setPaletteTarget}
            onFocus={handleFocus}
          />
        )}
      </main>

      {openWindow && (
        <TerminalModal
          window={openWindow}
          onClose={() => setOpenWindow(null)}
          onSendKeys={(keys) => console.log("send keys", keys)}
        />
      )}
      {paletteTarget && (
        <CommandPalette
          context={paletteTarget}
          onClose={() => setPaletteTarget(null)}
          onSubmit={(it) => console.log("palette submit", it)}
        />
      )}
      {renameSession && (
        <AutoRenameModal
          session={renameSession}
          windows={WINDOWS.filter(w => w.session === renameSession)}
          onClose={() => setRenameSession(null)}
          onApply={(rows) => console.log("apply renames", rows)}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showShortcuts && <ShortcutsSheet onClose={() => setShowShortcuts(false)} />}

      <ToastStack toasts={toasts} />
      <TweaksPanelUI t={t} setTweak={setTweak} onSimEmpty={() => setEmptyState(true)} />
    </div>
  );
}

// Sort pending-input windows to the top; otherwise stable by index.
function sortPendingFirst(ws) {
  const rank = (w) => {
    if (w.pendingInput)          return 0;
    if (w.status === "error")    return 1;
    if (w.status === "running")  return 2;
    if (w.status === "done")     return 3;
    return 4;
  };
  return [...ws].sort((a, b) => rank(a) - rank(b));
}

// ── Header ───────────────────────────────────────────────────────────
function Header({ counts, onSettings, onHelp, onRetry, inEmpty }) {
  return (
    <header className="hdr">
      <div className="hdr-brand">
        <SwitchboardMark size={26} />
        <div>
          <div className="hdr-title">Switchboard</div>
        </div>
        <div className="hdr-sub">127.0.0.1:8765</div>
      </div>

      {!inEmpty && (
        <div className="stats" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-mute)", whiteSpace: "nowrap", gap: 8 }}>
          <span><span className="stat-n">{counts.all}</span> windows</span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          <span className="tone-amber"><span className="stat-n">{counts.waiting}</span> waiting</span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          <span className="tone-cyan"><span className="stat-n">{counts.running}</span> running</span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          <span className="tone-gray"><span className="stat-n">{counts.idle}</span> idle</span>
        </div>
      )}

      <div className="hdr-spacer"></div>

      <div className="hdr-cta">
        {inEmpty && <button className="btn btn-primary" onClick={onRetry}><Icon name="spinner" /> Retry</button>}
        <button className="btn btn-icon btn-ghost" onClick={onHelp} title="Keyboard shortcuts (?)">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, lineHeight: 1 }}>?</span>
        </button>
        <button className="btn btn-icon btn-ghost" onClick={onSettings} title="Settings">
          <Icon name="settings" />
        </button>
      </div>
    </header>
  );
}

// ── Needs-you strip ──────────────────────────────────────────────────
function NeedsStrip({ windows, onOpen, onSend, onBroadcast, onDismiss }) {
  return (
    <div className="needs-strip">
      <span className="label">
        <span className="pulse" aria-hidden="true"></span>
        <span>Needs you</span>
        <span style={{ color: "var(--text-dim)", marginLeft: 4 }}>({windows.length})</span>
      </span>
      <div className="needs-strip-row">
        {windows.map(w => (
          <button
            key={w.id}
            className="needs-pill"
            onClick={() => onOpen(w)}
            title={w.agent?.action || w.name}
          >
            <span className="sess">{w.session}/</span>
            <span style={{ color: "var(--text)" }}>{w.name}</span>
            <span className="arrow">›</span>
            <span className="action">{w.agent?.action || "waiting on input"}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-ghost" onClick={onBroadcast} title="Send keys to all">
        <Icon name="send" /> <span>Broadcast</span>
      </button>
      <button className="dismiss btn-ghost btn btn-icon" onClick={onDismiss} title="Dismiss strip">
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

// Parse a search string with `key:value` tokens. Honors kind:, status:, session:.
// Remainder is free-text search.
function parseQuery(q) {
  const tokens = {};
  const KEYS = new Set(["kind", "status", "session"]);
  const rest = [];
  for (const part of (q || "").split(/\s+/).filter(Boolean)) {
    const m = part.match(/^(\w+):(.+)$/);
    if (m && KEYS.has(m[1].toLowerCase())) {
      tokens[m[1].toLowerCase()] = m[2].toLowerCase();
    } else {
      rest.push(part);
    }
  }
  return { tokens, freeText: rest.join(" ") };
}

// ── Subhead ──────────────────────────────────────────────────────────
function Subhead({ filter, setFilter, query, setQuery, counts, layout, setLayout, visibleCount }) {
  const Tab = ({ id, label, n, tone }) => (
    <button className={`tab ${filter === id ? "is-active" : ""}`} onClick={() => setFilter(id)}>
      {tone && <span className={`stat-dot tone-${tone}`}></span>}
      <span>{label}</span>
      <span className="count">{n}</span>
    </button>
  );
  const LayoutBtn = ({ id, ico, title }) => (
    <button
      className={layout === id ? "is-active" : ""}
      onClick={() => setLayout(id)}
      title={title}
    >
      <Icon name={ico} size={13} />
    </button>
  );
  const suggestion = suggestLayout({ filter, layout, visibleCount });
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
        <Tab id="all"     label="All"     n={counts.all} />
        <Tab id="waiting" label="Waiting" n={counts.waiting} tone="amber" />
        <Tab id="running" label="Running" n={counts.running} tone="cyan" />
        <Tab id="idle"    label="Idle"    n={counts.idle}    tone="gray" />
      </span>
      <span className="hdr-spacer"></span>
      {suggestion && (
        <button
          className="layout-hint"
          onClick={() => setLayout(suggestion.id)}
          title={suggestion.reason}
        >
          <Icon name={suggestion.id} size={11} />
          <span>{suggestion.label}</span>
          <span style={{ opacity: .65 }}>→</span>
        </button>
      )}
      <span className="layout-switcher">
        <LayoutBtn id="kanban" ico="kanban" title="Kanban" />
        <LayoutBtn id="grid"   ico="grid"   title="Grid" />
        <LayoutBtn id="list"   ico="list"   title="List" />
      </span>
    </div>
  );
}

// Decide whether to suggest a different layout to the user.
// Returns { id, label, reason } or null.
function suggestLayout({ filter, layout, visibleCount }) {
  if (layout === "kanban" && filter !== "all" && visibleCount > 0 && visibleCount <= 6) {
    return { id: "grid", label: "Grid fits this filter better", reason: "Filtering by status leaves most columns empty; grid view groups your matches without the gaps." };
  }
  if (layout === "kanban" && visibleCount >= 18) {
    return { id: "list", label: "Try list at this scale", reason: "Lots of windows are easier to scan as a sortable list." };
  }
  if (layout === "list" && visibleCount > 0 && visibleCount <= 4) {
    return { id: "grid", label: "Switch back to grid", reason: "Just a handful of windows — grid gives them more breathing room." };
  }
  return null;
}

// ── Shortcuts sheet ──────────────────────────────────────────────────
function ShortcutsSheet({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const Row = ({ label, keys }) => (
    <div className="shortcut-row">
      <span className="label">{label}</span>
      <span className="keys">
        {keys.map((k, i) => <span key={i} className="kbd">{k}</span>)}
      </span>
    </div>
  );
  return (
    <div className="scrim" onClick={onClose}>
      <div className="shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-hd">
          <SwitchboardMark size={22} />
          <b>Keyboard shortcuts</b>
          <span className="term-spacer" style={{ flex: 1 }}></span>
          <button className="btn btn-icon btn-ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="shortcuts-body">
          <div className="shortcuts-section">Navigation</div>
          <Row label="Focus search"                keys={["/"]} />
          <Row label="Open command palette"        keys={["⌘", "K"]} />
          <Row label="Toggle this sheet"           keys={["?"]} />
          <Row label="Close modal"                 keys={["Esc"]} />
          <div className="shortcuts-section">In a window card</div>
          <Row label="Open live terminal"          keys={["⏎"]} />
          <Row label="Send keys to pane"           keys={["s"]} />
          <Row label="Focus window in tmux"        keys={["f"]} />
          <Row label="Rename"                      keys={["r"]} />
          <div className="shortcuts-section">In the terminal modal</div>
          <Row label="Send line"                   keys={["⏎"]} />
          <Row label="Interrupt"                   keys={["⌃", "C"]} />
          <Row label="Paste"                       keys={["⌘", "V"]} />
        </div>
      </div>
    </div>
  );
}

// ── Kanban ───────────────────────────────────────────────────────────
function Kanban({ sessions, windows, focusedId, onOpen, onPalette, onRenameSession, onFocus }) {
  return (
    <div className="kanban">
      {sessions.map(s => {
        const ws = sortPendingFirst(windows.filter(w => w.session === s.id));
        const pending = ws.filter(w => w.pendingInput).length;
        const client = (s.clients || [])[0];
        return (
          <section className="col" key={s.id}>
            <header className="col-hd">
              <span className="col-name" tabIndex={0}>
                <span className={`col-name-dot ${s.attached ? "attached" : ""}`}></span>
                <span>{s.name}</span>
              </span>
              <span className="col-meta">
                <span
                  className={`col-count ${pending > 0 ? "has-pending" : ""}`}
                  title={pending > 0 ? `${pending} waiting on input` : `${ws.length} windows`}
                >
                  {ws.length}
                </span>
                <div className="col-actions">
                  <button className="btn-icon" title="Auto-rename" onClick={() => onRenameSession(s.id)}>
                    <Icon name="sparkle" />
                  </button>
                  <button className="btn-icon" title="New window">
                    <Icon name="plus" />
                  </button>
                </div>
              </span>

              {/* Attached-client hover-card */}
              <div className="col-hover">
                <div className="row"><span className="k">session</span><span className="v">{s.name}</span></div>
                <div className="row"><span className="k">windows</span><span className="v">{ws.length}</span></div>
                <div className="row">
                  <span className="k">attached</span>
                  <span className="v" style={{ color: s.attached ? "var(--accent)" : "var(--text-dim)" }}>
                    {s.attached ? "yes" : "detached"}
                  </span>
                </div>
                {client && (
                  <>
                    <div className="row"><span className="k">client</span><span className="v">{client.term}</span></div>
                    <div className="row"><span className="k">tty</span><span className="v">{client.tty}</span></div>
                    <div className="row"><span className="k">since</span><span className="v">{formatAgo(client.since)} ago</span></div>
                  </>
                )}
                <div className="row"><span className="k">created</span><span className="v">{formatAgo(s.created)} ago</span></div>
              </div>
            </header>
            <div className="col-body">
              {ws.length === 0 ? (
                <div style={{
                  color: "var(--text-dim)", fontFamily: "var(--font-mono)",
                  fontSize: 11, padding: "20px 6px", textAlign: "center"
                }}>
                  no matching windows
                </div>
              ) : ws.map(w => (
                <WindowCard
                  key={w.id}
                  w={w}
                  isFocused={focusedId === w.id}
                  onOpen={() => onOpen(w)}
                  onSendKeys={() => onPalette(w)}
                  onRename={() => onRenameSession(w.session)}
                  onFocus={() => onFocus(w)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Grid (flat or grouped, not kanban) ───────────────────────────────
function GridView({ sessions, windows, groupBy, focusedId, onOpen, onPalette, onFocus }) {
  if (groupBy === "session") {
    return (
      <div style={{ overflowY: "auto", height: "100%" }}>
        {sessions.map(s => {
          const ws = windows.filter(w => w.session === s.id);
          if (!ws.length) return null;
          return (
            <section key={s.id} style={{ padding: "16px 18px 6px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span className={`col-name-dot ${s.attached ? "attached" : ""}`} style={{ width: 8, height: 8, borderRadius: "50%", background: s.attached ? "var(--accent)" : "var(--tone-gray)" }}></span>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{ws.length}</span>
              </div>
              <div className="flat-grid" style={{ padding: 0, overflow: "visible", height: "auto" }}>
                {ws.map(w => (
                  <WindowCard
                    key={w.id}
                    w={w}
                    isFocused={focusedId === w.id}
                    onOpen={() => onOpen(w)}
                    onSendKeys={() => onPalette(w)}
                    onRename={() => {}}
                    onFocus={() => onFocus(w)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <div className="flat-grid">
      {windows.map(w => (
        <WindowCard
          key={w.id}
          w={w}
          isFocused={focusedId === w.id}
          onOpen={() => onOpen(w)}
          onSendKeys={() => onPalette(w)}
          onRename={() => {}}
          onFocus={() => onFocus(w)}
        />
      ))}
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────
function ListView({ windows, focusedId, onOpen, onPalette, onFocus }) {
  return (
    <div className="flat-list">
      <div className="row header">
        <span></span>
        <span>WINDOW</span>
        <span>RECAP / CMD</span>
        <span>RESOURCES</span>
        <span>STATUS</span>
        <span>BRANCH / PR</span>
        <span>ACTIVITY</span>
        <span style={{ textAlign: "right" }}>ACTIONS</span>
      </div>
      {windows.map(w => (
        <ListRow
          key={w.id}
          w={w}
          isFocused={focusedId === w.id}
          onOpen={() => onOpen(w)}
          onSendKeys={() => onPalette(w)}
          onRename={() => {}}
          onFocus={() => onFocus(w)}
        />
      ))}
    </div>
  );
}

// ── Tweaks Panel UI ──────────────────────────────────────────────────
function TweaksPanelUI({ t, setTweak, onSimEmpty }) {
  return (
    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio
        label="Mode"
        value={t.theme}
        options={["dark", "light", "contrast", "phosphor"]}
        onChange={(v) => setTweak("theme", v)}
      />
      <TweakColor
        label="Accent"
        value={ACCENT_PALETTES[t.accent]}
        options={Object.values(ACCENT_PALETTES)}
        onChange={(v) => {
          // map back from palette → name
          const name = Object.keys(ACCENT_PALETTES).find(k => ACCENT_PALETTES[k][0] === v[0]) || "aurora";
          setTweak("accent", name);
        }}
      />

      <TweakSection label="Layout" />
      <TweakRadio
        label="View"
        value={t.layout}
        options={["kanban", "grid", "list"]}
        onChange={(v) => setTweak("layout", v)}
      />
      <TweakRadio
        label="Group"
        value={t.groupBy}
        options={["session", "flat"]}
        onChange={(v) => setTweak("groupBy", v)}
      />
      <TweakRadio
        label="Density"
        value={t.density}
        options={["compact", "comfy", "preview"]}
        onChange={(v) => setTweak("density", v)}
      />
      <TweakToggle
        label="Show terminal previews"
        value={t.showPreviews}
        onChange={(v) => setTweak("showPreviews", v)}
      />

      <TweakSection label="Motion" />
      <TweakToggle
        label="Reduced motion"
        value={t.reducedMotion}
        onChange={(v) => setTweak("reducedMotion", v)}
      />

      <TweakSection label="States" />
      <TweakButton label="Simulate empty state →" onClick={onSimEmpty} />
    </TweaksPanel>
  );
}

// ── Toast stack ──────────────────────────────────────────────────────
function ToastStack({ toasts }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map(t => <Toast key={t.id} t={t} />)}
    </div>
  );
}

function Toast({ t }) {
  if (t.kind === "focus") {
    return (
      <div className="toast">
        <Icon name="focus" />
        <span className="what">
          <span className="who">{t.session}:{t.index}</span> {t.name}
        </span>
        <span className="arrow">→</span>
        <span className="who">{t.term}</span>
      </div>
    );
  }
  return (
    <div className="toast">
      <Icon name="send" />
      <span>{t.message}</span>
    </div>
  );
}

// ── Mount ────────────────────────────────────────────────────────────
const root = ReactDOM.createRoot(document.getElementById("app"));
root.render(<App />);
