import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchState, focusWindow, killSession, killWindow } from "./api/client";
import { usePolling } from "./api/usePolling";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { EmptyState } from "./components/EmptyState";
import { Header, type HeaderCounts } from "./components/Header";
import { Kanban } from "./components/Kanban";
import { NeedsStrip } from "./components/NeedsStrip";
import { NewWindowOverlay } from "./components/NewWindowOverlay";
import { RenameOverlay } from "./components/RenameOverlay";
import { RenameSessionOverlay } from "./components/RenameSessionOverlay";
import { SettingsModal } from "./components/SettingsModal";
import { Subhead } from "./components/Subhead";
import { TerminalModal } from "./components/TerminalModal";
import { ToastStack } from "./components/ToastStack";
import type { ToastData } from "./components/Toast";
import { applyFilter, parseQuery, type StatusFilter } from "./lib/filter";
import { columnsForNav, navigateCard, type NavDirection } from "./lib/cardNav";
import { applyAccent, useSettings } from "./lib/settings";
import { useURLParam } from "./lib/urlState";
import type { Window } from "./types";

const FAIL_THRESHOLD = 3;
const SERVER_ADDR = "127.0.0.1:8765";
const STATUS_FILTERS: StatusFilter[] = ["all", "waiting", "running", "idle"];
// While the terminal modal is open we want the header / status pill / pending
// flag to reflect the open pane within ~one xterm frame, not the user-chosen
// dashboard cadence. Pane bytes already stream over the WS; this only affects
// the metadata sourced from /api/state (THI-105).
const MODAL_OPEN_POLL_MS = 100;

/** A pending destructive action awaiting confirmation in the ConfirmDialog. */
interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

export function App() {
  const settings = useSettings();

  // URL-synced state — survives reload + supports back/forward.
  const [filterParam, setFilterParam] = useURLParam("filter", "all");
  const filter: StatusFilter = (
    STATUS_FILTERS.includes(filterParam as StatusFilter) ? filterParam : "all"
  ) as StatusFilter;
  const setFilter = (v: StatusFilter) => setFilterParam(v);

  const [query, setQuery] = useURLParam("q", "");
  const [openId, setOpenId] = useURLParam("open", "");

  const pollIntervalMs = openId ? MODAL_OPEN_POLL_MS : settings.pollIntervalMs;
  const { data: state, consecutiveErrors, refresh } = usePolling(fetchState, pollIntervalMs);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [showNeedsStrip, setShowNeedsStrip] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [paletteTargetId, setPaletteTargetId] = useState<string | null>(null);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [newWindowSession, setNewWindowSession] = useState<string | null>(null);
  const [renameSessionTarget, setRenameSessionTarget] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

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
  const handleNewWindow = useCallback((session: string) => setNewWindowSession(session), []);
  const handleRenameSession = useCallback(
    (session: string) => setRenameSessionTarget(session),
    [],
  );

  // `refresh` and `windows` are replaced on every poll. Read them through refs
  // so the kill handlers stay referentially stable — otherwise every poll would
  // bust WindowCard's memo (it compares `onKill` by identity).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  // Track openId in a ref too so the kill handler can decide whether to dismiss
  // the modal on success without baking openId into its dep list (THI-111).
  const openIdRef = useRef(openId);
  openIdRef.current = openId;

  const messageToast = useCallback(
    (message: string) =>
      pushToast({ id: Math.random().toString(36).slice(2), kind: "message", message }),
    [pushToast],
  );

  const handleKill = useCallback(
    (w: Window, skipConfirm: boolean) => {
      const onlyWindow =
        windowsRef.current.filter((x) => x.session === w.session).length === 1;
      const doKill = async () => {
        if (await killWindow(w.session, w.index)) {
          refreshRef.current();
          // If the killed pane is the one currently open in the terminal modal,
          // dismiss the modal immediately — don't wait for the next state poll
          // to drop the window from `windows` and unmount it via `openWindow`
          // (THI-111). Covers kill-from-modal and kill-from-card-while-modal-
          // open-on-same-pane.
          if (openIdRef.current === w.paneId) setOpenId("");
        } else messageToast(`Couldn't kill ${w.session}:${w.index}`);
      };
      if (skipConfirm) {
        void doKill();
        return;
      }
      setConfirm({
        title: "Kill window",
        message: onlyWindow
          ? `"${w.name}" is the only window in ${w.session} — killing it ends the session. This can't be undone.`
          : `Kill ${w.session}:${w.index} "${w.name}"? This can't be undone.`,
        confirmLabel: "Kill window",
        onConfirm: async () => {
          await doKill();
          setConfirm(null);
        },
      });
    },
    [messageToast, setOpenId],
  );

  const handleKillSession = useCallback(
    (session: string, skipConfirm: boolean) => {
      const doKill = async () => {
        if (await killSession(session)) {
          refreshRef.current();
          // If the modal is open on any pane that belongs to the killed
          // session, dismiss it for the same reason as handleKill (THI-111).
          const openPane = windowsRef.current.find((x) => x.paneId === openIdRef.current);
          if (openPane && openPane.session === session) setOpenId("");
        } else messageToast(`Couldn't kill session ${session}`);
      };
      if (skipConfirm) {
        void doKill();
        return;
      }
      setConfirm({
        title: "Kill session",
        message: `Kill session "${session}" and all its windows? This can't be undone.`,
        confirmLabel: "Kill session",
        onConfirm: async () => {
          await doKill();
          setConfirm(null);
        },
      });
    },
    [messageToast, setOpenId],
  );

  // Apply persisted appearance settings to <html>. The theme/density/
  // reduced-motion CSS ships in styles.css; accent is written as CSS vars.
  // Previews show only at `preview` density.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", settings.theme);
    el.setAttribute("data-density", settings.density);
    el.setAttribute("data-show-previews", String(settings.density === "preview"));
    el.setAttribute("data-reduced-motion", String(settings.reducedMotion));
    applyAccent(settings.accent);
  }, [settings.theme, settings.density, settings.reducedMotion, settings.accent]);

  // Pending-input badge in the browser tab title.
  useEffect(() => {
    const n = pendingWindows.length;
    document.title = settings.notifyBadge && n > 0 ? `(${n}) Switchboard` : "Switchboard";
  }, [settings.notifyBadge, pendingWindows.length]);

  // Auto-dismiss the terminal modal when its pane disappears from /api/state —
  // the pane was killed externally (someone ran `tmux kill-pane` from a
  // terminal, or tmux itself died). The ref tracks the last-known open window
  // so we can still toast its name after `openWindow` flips to null. The
  // `openId` guard suppresses the toast on the user's own close path (where
  // openId is "" by the time openWindow goes null). The `state` guard avoids
  // false positives on first hydration when a stale `?open=` URL points at a
  // pane that never existed (THI-94).
  const lastOpenWindowRef = useRef<Window | null>(null);
  useEffect(() => {
    if (!state) return;
    if (openWindow) {
      lastOpenWindowRef.current = openWindow;
      return;
    }
    if (lastOpenWindowRef.current && openId) {
      const name = lastOpenWindowRef.current.name;
      lastOpenWindowRef.current = null;
      setOpenId("");
      const reason = serverRunning === false ? "tmux server stopped" : `Window "${name}" closed`;
      messageToast(reason);
    }
  }, [state, openWindow, openId, serverRunning, setOpenId, messageToast]);

  // Global hotkeys: ⌘K palette, arrows + j/k/h/l for card nav, / for search,
  // Esc closes modal, Enter opens highlighted card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement)?.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea";
      const anyOverlay =
        openId ||
        paletteTargetId ||
        renameTargetId ||
        showSettings ||
        newWindowSession ||
        renameSessionTarget ||
        confirm;

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
  }, [
    openId,
    paletteTargetId,
    renameTargetId,
    showSettings,
    newWindowSession,
    renameSessionTarget,
    confirm,
    navCols,
    highlightedId,
    windows,
    openCard,
  ]);

  const settingsModal = showSettings ? (
    <SettingsModal
      serverAddr={SERVER_ADDR}
      sessionCount={sessions.length}
      windowCount={windows.length}
      onClose={() => setShowSettings(false)}
    />
  ) : null;

  if (inEmpty) {
    return (
      <div className="app">
        <Header
          counts={counts}
          serverAddr={SERVER_ADDR}
          inEmpty
          onHelp={() => {}}
          onSettings={() => setShowSettings(true)}
          onRetry={refresh}
        />
        <main className="main">
          <EmptyState onRetry={refresh} />
        </main>
        {settingsModal}
        <ToastStack toasts={toasts} />
      </div>
    );
  }

  return (
    <div className="app">
      <Header
        counts={counts}
        serverAddr={SERVER_ADDR}
        inEmpty={false}
        onHelp={() => {}}
        onSettings={() => setShowSettings(true)}
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
          onKill={handleKill}
          onNewWindow={handleNewWindow}
          onKillSession={handleKillSession}
          onRenameSession={handleRenameSession}
        />
      </main>
      {openWindow && (
        <TerminalModal
          window={openWindow}
          onClose={closeModal}
          onToast={messageToast}
          onKill={handleKill}
        />
      )}
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
      {newWindowSession && (
        <NewWindowOverlay
          session={newWindowSession}
          onClose={() => setNewWindowSession(null)}
          onApplied={refresh}
        />
      )}
      {renameSessionTarget && (
        <RenameSessionOverlay
          session={renameSessionTarget}
          onClose={() => setRenameSessionTarget(null)}
          onApplied={refresh}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {settingsModal}
      <ToastStack toasts={toasts} />
    </div>
  );
}
