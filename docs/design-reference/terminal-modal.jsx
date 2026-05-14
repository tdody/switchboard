// terminal-modal.jsx — fullscreen takeover terminal modal

function TerminalModal({ window: w, onClose, onSendKeys }) {
  const [input, setInput] = React.useState("");
  const bodyRef = React.useRef(null);

  // build a richer "session" by repeating preview a few times + agent context
  const lines = React.useMemo(() => buildSession(w), [w.id]);

  React.useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, []);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    if (!input.trim()) return;
    onSendKeys?.(input);
    setInput("");
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="term-modal" onClick={(e) => e.stopPropagation()}>
        <div className="term-hd">
          <span className="tl-dots">
            <button onClick={onClose} title="Close" aria-label="Close modal"></button>
            <button title="Minimize (no-op)" aria-label="Minimize"></button>
            <button title="Maximize (no-op)" aria-label="Maximize"></button>
          </span>
          <span className="term-title">
            <b>{w.session}</b>
            <span className="crumb-sep">›</span>
            <span>{w.index}:</span>
            <b>{w.name}</b>
            {w.agent?.branch && (
              <>
                <span className="crumb-sep">·</span>
                <Chip className="branch"><Icon name="git-branch" size={10} /><span>{w.agent.branch}</span></Chip>
              </>
            )}
            {w.agent?.pr && (
              <Chip className="pr">#{w.agent.pr}</Chip>
            )}
            <StatusPill status={w.status} />
          </span>
          <span className="term-spacer"></span>
          <div className="term-actions">
            <button className="btn btn-ghost" title="Focus in tmux">
              <Icon name="focus" /> <span>Focus</span>
            </button>
            <button className="btn btn-ghost" title="Rename">
              <Icon name="rename" /> <span>Rename</span>
            </button>
            <button className="btn btn-ghost" title="Copy ID">
              <Icon name="copy" />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{w.session}:{w.index}</span>
            </button>
            <button className="btn btn-icon btn-ghost" onClick={onClose} title="Close (Esc)">
              <Icon name="x" />
            </button>
          </div>
        </div>

        <div className="term-body" ref={bodyRef}>
          {lines.map((line, i) => (
            <div className="ln" key={i} dangerouslySetInnerHTML={{ __html: line }}></div>
          ))}
          <div className="ln">
            <span className="prompt">›</span>{" "}
            <span>{input}</span>
            <span className="cursor"></span>
          </div>
        </div>

        <div className="term-foot">
          <span className="pill"><span className="dot"></span>WS · live · 18ms</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>{w.cwd}</span>
          <span className="term-spacer"></span>
          <div className="input">
            <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>›</span>
            <input
              autoFocus
              placeholder="Type to send keys to the pane…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <span className="kbd">⏎</span>
          </div>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="kbd">Esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}

// Build a synthetic session backlog for the modal — richer than the card preview.
function buildSession(w) {
  const time = (offset) => new Date(Date.now() - offset * 1000).toTimeString().slice(0, 8);
  const out = [];

  if (w.kind === "agent") {
    out.push(`<span class="dim">─── ${time(900)} ─ ${w.cmd} ─ ${w.cwd} ───</span>`);
    out.push(`<span class="dim">  cwd: ${w.cwd}</span>`);
    if (w.agent?.branch) out.push(`<span class="dim">  branch: </span><span class="branch">${w.agent.branch}</span>`);
    out.push("");
    out.push(`<span class="info">  ✻ </span><span>started agent — model claude-sonnet-4.5</span>`);
    out.push(`<span class="info">  ✻ </span><span>tools: bash, edit, glob, grep, read, write</span>`);
    out.push("");
    out.push(`<span class="prompt">› </span>continue from where we left off; the kanban view should support per-session collapse`);
    out.push("");
    out.push(`<span class="info">  ✻ </span><span>Reading <span class="branch">src/dashboard.tsx</span></span>`);
    out.push(`<span class="info">  ✻ </span><span>Found <span class="info">Kanban</span> component, 142 lines</span>`);
    out.push(`<span class="info">  ✻ </span><span>Adding collapse state to session column header</span>`);
    out.push(`<span class="ok">  ✓ </span><span>wrote src/kanban.tsx (+34 -8)</span>`);
    out.push(`<span class="ok">  ✓ </span><span>wrote src/dashboard.tsx (+12 -4)</span>`);
    out.push("");
    out.push(`<span class="info">  ✻ </span><span>Running tests…</span>`);
    out.push(`<span class="ok">  ✓ </span><span>23 tests passed</span>`);
    out.push("");
    if (w.agent?.recap) {
      out.push(`<span>  ${w.agent.recap}</span>`);
      out.push("");
    }
    w.preview.forEach((p) => out.push(escapeAndColor(p)));
  } else if (w.kind === "server") {
    out.push(`<span class="dim">─── ${time(180)} ─ ${w.cmd} ─ ${w.cwd} ───</span>`);
    out.push("");
    out.push(`<span class="ok">  VITE v5.4.10</span>  <span class="dim">ready in 312 ms</span>`);
    out.push("");
    out.push(`  <span class="prompt">➜</span>  <b>Local:</b>   <span class="info">http://localhost:5173/</span>`);
    out.push(`  <span class="prompt">➜</span>  <b>Network:</b> use <span class="dim">--host</span> to expose`);
    out.push(`  <span class="prompt">➜</span>  press <span class="kbd">h + ⏎</span> to show help`);
    out.push("");
    for (let i = 14; i >= 0; i--) {
      out.push(`<span class="dim">  ${time(i * 7)}</span>  <span class="info">HMR update</span>  /src/${["dashboard.tsx", "cards.tsx", "kanban.tsx", "styles.css"][i % 4]}`);
    }
  } else if (w.kind === "shell") {
    out.push(`<span class="dim">~/work/${w.session.replace(/:.*/, '')}</span>`);
    out.push(`<span class="prompt">$</span> git status`);
    out.push(`On branch <span class="branch">feat/kanban-cols</span>`);
    out.push(`Your branch is ahead of 'origin/feat/kanban-cols' by 2 commits.`);
    out.push("");
    out.push("nothing to commit, working tree clean");
    out.push(`<span class="prompt">$</span> git log --oneline -5`);
    out.push(`<span class="info">a3f2e9d</span> kanban: collapse per-session column`);
    out.push(`<span class="info">7b1c042</span> cards: pending-input pulse animation`);
    out.push(`<span class="info">e890aa1</span> data: more realistic recap copy`);
    out.push(`<span class="info">2cd31b8</span> theme: phosphor variant`);
    out.push(`<span class="info">88f0a14</span> initial scaffold`);
    out.push(`<span class="prompt">$</span> `);
  } else if (w.kind === "logs") {
    for (let i = 30; i >= 0; i--) {
      const ms = (Math.random() * 200).toFixed(0);
      out.push(`<span class="dim">  2026-05-13T17:42:${(i + 10).toString().padStart(2, "0")}Z</span>  <span class="info">http</span> GET /v1/${["accounts/me", "invoices", "billing/usage", "products", "webhooks"][i % 5]} <span class="ok">200</span> in ${ms}ms`);
    }
  } else if (w.kind === "editor") {
    w.preview.forEach(p => out.push(escapeAndColor(p)));
  } else {
    w.preview.forEach(p => out.push(escapeAndColor(p)));
  }

  return out;
}

function escapeAndColor(s) {
  // very light coloring of agent glyphs / prefix
  let esc = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  esc = esc.replace(/^(\s*)(✓)/, '$1<span class="ok">$2</span>');
  esc = esc.replace(/^(\s*)(✻)/, '$1<span class="info">$2</span>');
  esc = esc.replace(/^(\s*)(✗)/, '$1<span class="err">$2</span>');
  esc = esc.replace(/^(\s*)(●)/, '$1<span class="warn">$2</span>');
  esc = esc.replace(/^(\s*)(⠹|⠼|⠧|⠇|⠏)/, '$1<span class="info">$2</span>');
  esc = esc.replace(/^(\s*)(\$|&gt;|›|#)(\s)/, '$1<span class="prompt">$2</span>$3');
  return esc;
}

window.TerminalModal = TerminalModal;
