import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchState, focusWindow, renameWindow, sendKeys } from "./api/client";
import { usePolling } from "./api/usePolling";
import { EmptyState } from "./components/EmptyState";
import { Header, type HeaderCounts } from "./components/Header";
import { Kanban } from "./components/Kanban";
import { NeedsStrip } from "./components/NeedsStrip";
import { Subhead } from "./components/Subhead";
import { TerminalModal } from "./components/TerminalModal";
import { ToastStack } from "./components/ToastStack";
import type { ToastData } from "./components/Toast";
import { applyFilter, parseQuery, type StatusFilter } from "./lib/filter";
import type { Window } from "./types";

const POLL_MS = 3000;
const FAIL_THRESHOLD = 3;

export function App() {
  const { data: state, consecutiveErrors, refresh } = usePolling(fetchState, POLL_MS);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [openWindow, setOpenWindow] = useState<Window | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [showNeedsStrip, setShowNeedsStrip] = useState(true);

  const sessions = state?.sessions ?? [];
  const windows = state?.windows ?? [];
  const serverRunning = state?.serverRunning ?? null;
  const inEmpty = serverRunning === false || (consecutiveErrors >= FAIL_THRESHOLD && !state);

  const counts: HeaderCounts = useMemo(
    () => ({
      all: windows.length,
      waiting: windows.filter((w) => w.status === "waiting").length,
      running: windows.filter((w) => w.status === "running").length,
      idle: windows.filter((w) => w.status === "idle").length,
    }),
    [windows],
  );

  const parsed = useMemo(() => parseQuery(query), [query]);
  const visible = useMemo(
    () => applyFilter(windows, filter, parsed),
    [windows, filter, parsed],
  );
  const pendingWindows = useMemo(
    () => windows.filter((w) => w.pendingInput),
    [windows],
  );

  const hostTerm = useMemo(() => {
    const s = sessions.find((s) => s.attached);
    return s?.clients?.[0]?.term || "your terminal";
  }, [sessions]);

  const pushToast = useCallback((t: ToastData) => {
    setToasts((ts) => [...ts, t]);
    window.setTimeout(
      () => setToasts((ts) => ts.filter((x) => x.id !== t.id)),
      2100,
    );
  }, []);

  const handleFocus = useCallback(
    (w: Window) => {
      setFocusedId(w.id);
      window.setTimeout(
        () => setFocusedId((id) => (id === w.id ? null : id)),
        900,
      );
      pushToast({
        id: Math.random().toString(36).slice(2),
        kind: "focus",
        session: w.session,
        index: w.index,
        name: w.name,
        term: hostTerm,
      });
      void focusWindow(w.session, w.index);
      window.setTimeout(() => setOpenWindow(w), 280);
    },
    [hostTerm, pushToast],
  );

  const handleRename = useCallback(
    async (w: Window) => {
      const name = window.prompt(`Rename ${w.session}:${w.index}`, w.name);
      if (!name || name === w.name) return;
      const ok = await renameWindow(w.session, w.index, name);
      if (ok) refresh();
    },
    [refresh],
  );

  const handleSend = useCallback(async (w: Window) => {
    const text = window.prompt(`Send keys to ${w.session}:${w.index}`);
    if (text === null || text === "") return;
    await sendKeys(w.session, w.index, { paste: text });
  }, []);

  // Apply theme + density to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-density", "comfy");
    document.documentElement.setAttribute("data-show-previews", "false");
    document.documentElement.setAttribute("data-reduced-motion", "false");
  }, []);

  // Global hotkeys: `/` focuses search, Esc closes modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement)?.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea";
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !inField) {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
      }
      if (e.key === "Escape" && openWindow) {
        setOpenWindow(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openWindow]);

  if (inEmpty) {
    return (
      <div className="app">
        <Header
          counts={counts}
          serverAddr="127.0.0.1:8765"
          inEmpty
          onHelp={() => {}}
          onSettings={() => {}}
          onRetry={refresh}
        />
        <main className="main">
          <EmptyState onRetry={refresh} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        counts={counts}
        serverAddr="127.0.0.1:8765"
        inEmpty={false}
        onHelp={() => {}}
        onSettings={() => {}}
      />
      {pendingWindows.length > 0 && showNeedsStrip && (
        <NeedsStrip
          windows={pendingWindows}
          onOpen={setOpenWindow}
          onDismiss={() => setShowNeedsStrip(false)}
        />
      )}
      <Subhead
        filter={filter}
        setFilter={setFilter}
        query={query}
        setQuery={setQuery}
        counts={counts}
      />
      <main className="main">
        <Kanban
          sessions={sessions}
          windows={visible}
          focusedId={focusedId}
          onOpen={setOpenWindow}
          onSend={handleSend}
          onRename={handleRename}
          onFocus={handleFocus}
        />
      </main>
      {openWindow && (
        <TerminalModal window={openWindow} onClose={() => setOpenWindow(null)} />
      )}
      <ToastStack toasts={toasts} />
    </div>
  );
}
