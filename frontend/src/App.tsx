import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchState, focusWindow } from "./api/client";
import { usePolling } from "./api/usePolling";
import { CommandPalette } from "./components/CommandPalette";
import { EmptyState } from "./components/EmptyState";
import { Header, type HeaderCounts } from "./components/Header";
import { Kanban } from "./components/Kanban";
import { NeedsStrip } from "./components/NeedsStrip";
import { RenameOverlay } from "./components/RenameOverlay";
import { Subhead } from "./components/Subhead";
import { TerminalModal } from "./components/TerminalModal";
import { ToastStack } from "./components/ToastStack";
import type { ToastData } from "./components/Toast";
import { applyFilter, parseQuery, type StatusFilter } from "./lib/filter";
import { columnsForNav, navigateCard, type NavDirection } from "./lib/cardNav";
import { useURLParam } from "./lib/urlState";
import type { Window } from "./types";

const POLL_MS = 3000;
const FAIL_THRESHOLD = 3;
const STATUS_FILTERS: StatusFilter[] = ["all", "waiting", "running", "idle"];

export function App() {
  const { data: state, consecutiveErrors, refresh } = usePolling(fetchState, POLL_MS);

  // URL-synced state — survives reload + supports back/forward.
  const [filterParam, setFilterParam] = useURLParam("filter", "all");
  const filter: StatusFilter = (
    STATUS_FILTERS.includes(filterParam as StatusFilter) ? filterParam : "all"
  ) as StatusFilter;
  const setFilter = (v: StatusFilter) => setFilterParam(v);

  const [query, setQuery] = useURLParam("q", "");
  const [openId, setOpenId] = useURLParam("open", "");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [showNeedsStrip, setShowNeedsStrip] = useState(true);
  const [paletteTargetId, setPaletteTargetId] = useState<string | null>(null);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);

  const sessions = state?.sessions ?? [];
  const windows = state?.windows ?? [];
  const serverRunning = state?.serverRunning ?? null;
  const inEmpty = serverRunning === false || (consecutiveErrors >= FAIL_THRESHOLD && !state);

  // Selection state (openId / highlightedId / focusedId / palette / rename) is
  // keyed by the stable paneId, not the session:index `id`, so a tmux rename or
  // window-move doesn't drop the selection or remount the card.
  const openWindow = useMemo(
    () => (openId ? windows.find((w) => w.paneId === openId) || null : null),
    [openId, windows],
  );
  const paletteTarget = useMemo(
    () => (paletteTargetId ? windows.find((w) => w.paneId === paletteTargetId) || null : null),
    [paletteTargetId, windows],
  );
  const renameTarget = useMemo(
    () => (renameTargetId ? windows.find((w) => w.paneId === renameTargetId) || null : null),
    [renameTargetId, windows],
  );

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
  const navCols = useMemo(
    () => columnsForNav(sessions, visible),
    [sessions, visible],
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

  const openCard = useCallback(
    (w: Window) => {
      setOpenId(w.paneId);
      setHighlightedId(w.paneId);
    },
    [setOpenId],
  );

  const closeModal = useCallback(() => setOpenId(""), [setOpenId]);

  const handleFocus = useCallback(
    (w: Window) => {
      setFocusedId(w.paneId);
      window.setTimeout(
        () => setFocusedId((id) => (id === w.paneId ? null : id)),
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
      window.setTimeout(() => setOpenId(w.paneId), 280);
    },
    [hostTerm, pushToast, setOpenId],
  );

  const handleRename = useCallback((w: Window) => setRenameTargetId(w.paneId), []);
  const handleSend = useCallback((w: Window) => setPaletteTargetId(w.paneId), []);

  // Apply theme + density to <html>
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-density", "comfy");
    document.documentElement.setAttribute("data-show-previews", "false");
    document.documentElement.setAttribute("data-reduced-motion", "false");
  }, []);

  // Global hotkeys: ⌘K palette, arrows + j/k/h/l for card nav, / for search,
  // Esc closes modal, Enter opens highlighted card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement)?.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea";
      const anyOverlay = openId || paletteTargetId || renameTargetId;

      // ⌘K / Ctrl+K — open palette pre-targeted to first pending, then highlighted,
      // then first window. Always available, even from inside inputs.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const target =
          windows.find((w) => w.pendingInput) ||
          (highlightedId ? windows.find((w) => w.paneId === highlightedId) : null) ||
          windows[0];
        if (target) setPaletteTargetId(target.paneId);
        return;
      }

      if (anyOverlay) {
        // Esc handling lives inside each overlay; nothing else here.
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !inField) {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
        return;
      }
      if (inField) return;

      const dirMap: Record<string, NavDirection> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        k: "up",
        j: "down",
        h: "left",
        l: "right",
      };
      const dir = dirMap[e.key];
      if (dir) {
        e.preventDefault();
        const next = navigateCard(navCols, highlightedId, dir);
        if (next) {
          setHighlightedId(next.paneId);
          requestAnimationFrame(() => {
            document
              .querySelector(`[data-card-id="${CSS.escape(next.paneId)}"]`)
              ?.scrollIntoView({ block: "nearest", inline: "nearest" });
          });
        }
        return;
      }
      if (e.key === "Enter") {
        const w = highlightedId
          ? windows.find((x) => x.paneId === highlightedId)
          : null;
        if (w) {
          e.preventDefault();
          openCard(w);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId, paletteTargetId, renameTargetId, navCols, highlightedId, windows, openCard]);

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
          onOpen={openCard}
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
          highlightedId={highlightedId}
          onOpen={openCard}
          onSend={handleSend}
          onRename={handleRename}
          onFocus={handleFocus}
        />
      </main>
      {openWindow && <TerminalModal window={openWindow} onClose={closeModal} />}
      {paletteTarget && (
        <CommandPalette
          target={paletteTarget}
          onClose={() => setPaletteTargetId(null)}
        />
      )}
      {renameTarget && (
        <RenameOverlay
          target={renameTarget}
          onClose={() => setRenameTargetId(null)}
          onApplied={refresh}
        />
      )}
      <ToastStack toasts={toasts} />
    </div>
  );
}
