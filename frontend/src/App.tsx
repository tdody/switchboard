import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAiStatus,
  fetchState,
  fetchUsage,
  focusWindow,
  killSession,
  killWindow,
  sendKeys,
} from "./api/client";
import { usePolling } from "./api/usePolling";
import { useQuickCreate } from "./lib/useQuickCreate";
import { AutoRenameModal } from "./components/AutoRenameModal";
import { CleanupModal } from "./components/CleanupModal";
import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DocsModal } from "./components/DocsModal";
import { EmptyState } from "./components/EmptyState";
import { Header, type HeaderCounts } from "./components/Header";
import { GridView } from "./components/GridView";
import { Kanban } from "./components/Kanban";
import { ListView } from "./components/ListView";
import { NeedsStrip } from "./components/NeedsStrip";
import { NewSessionOverlay } from "./components/NewSessionOverlay";
import { NewWindowOverlay } from "./components/NewWindowOverlay";
import { RenameOverlay } from "./components/RenameOverlay";
import { RenameSessionOverlay } from "./components/RenameSessionOverlay";
import { SearchModal } from "./components/SearchModal";
import { SettingsModal } from "./components/SettingsModal";
import { TemplatesModal } from "./components/TemplatesModal";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { Subhead } from "./components/Subhead";
import { TerminalModal } from "./components/TerminalModal";
import { ToastStack } from "./components/ToastStack";
import { Tour } from "./components/Tour";
import type { ToastData } from "./components/Toast";
import {
  applyFilterWithPins,
  KIND_FILTERS,
  parseQuery,
  stripKindToken,
  type KindFilter,
  type StatusFilter,
} from "./lib/filter";
import { usePins } from "./lib/usePins";
import { usePresets, type FilterPreset } from "./lib/usePresets";
import { columnsForNav, navigateCard, type NavDirection } from "./lib/cardNav";
import {
  applySessionOrder,
  loadSessionOrder,
  reorderSessions,
  saveSessionOrder,
} from "./lib/sessionOrder";
import {
  loadWindowOrder,
  reorderWindow,
  saveWindowOrder,
  type WindowOrderMap,
} from "./lib/windowOrder";
import { faviconDataUrl } from "./lib/favicon";
import {
  detectPendingEdges,
  emptyNotifyState,
  hydrateNotifyState,
  markJustEnabled,
  type NotifyState,
} from "./lib/pendingNotify";
import { applyAccent, useSettings } from "./lib/settings";
import { pickPollInterval } from "./lib/pollTier";
import { useInputActive } from "./lib/useInputActive";
import { useNeedsStripDismiss } from "./lib/useNeedsStripDismiss";
import type { QuickAction } from "./lib/quickActions";
import { useURLParam } from "./lib/urlState";
import type { Window } from "./types";

const FAIL_THRESHOLD = 3;
const SERVER_ADDR = "127.0.0.1:8765";
const STATUS_FILTERS: StatusFilter[] = ["all", "waiting", "running", "idle"];
// While the terminal modal is open we still want the header / status pill /
// pending flag to update promptly, but the original 100 ms cadence (THI-105)
// caused two distinct problems: it burned enough React render budget on a
// busy dashboard to make typing in *other* modals lag (THI-138), and it
// stacked `/api/state` handlers on the backend faster than they could
// complete, exhausting the FD budget (THI-142, fixed by single-flight on
// the backend). 500 ms = 2 Hz, which still reads as live for single-chip
// changes (humans don't notice sub-200 ms updates on a status pill), frees
// 5× of the main thread for input handling, and gives the backend's FD
// budget another 5× headroom on top of the single-flight wrapper. Pane
// bytes still stream over WebSocket; this only affects /api/state metadata.
const MODAL_OPEN_POLL_MS = 500;
// Claude usage is server-side-cached for 30 s; polling more often would just
// hand the cached value back. Decoupled from the /api/state cadence so a busy
// modal-open dashboard doesn't pile up jsonl walks (THI-110).
const USAGE_POLL_MS = 30_000;

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

  // Kind chip filter (THI-130). URL-synced for back/forward + shareable links;
  // not localStorage-backed, matching the status filter convention. Unknown
  // values fall back to "" (no chip selected).
  const [kindParam, setKindParam] = useURLParam("kind", "");
  const kindFilter: KindFilter = (
    KIND_FILTERS.includes(kindParam as KindFilter) ? kindParam : ""
  ) as KindFilter;
  const setKindFilter = (v: KindFilter) => setKindParam(v);

  const [query, setQuery] = useURLParam("q", "");
  const [openId, setOpenId] = useURLParam("open", "");

  // Activity-aware /api/state cadence (THI-127). `pickPollInterval` is pure and
  // lives in lib/pollTier.ts; we forward the *previous* tick's windows here so
  // the helper can classify activity. The first tick has no state yet — the
  // helper defaults to `configured` (normal tier) in that case. Subsequent
  // renders update `pollIntervalMs` via the effect below, which re-arms the
  // interval inside `usePolling` via its `[ms]` dep.
  const [pollIntervalMs, setPollIntervalMs] = useState(settings.pollIntervalMs);
  // Notifications-on: keep polling /api/state while the tab is backgrounded —
  // otherwise no pendingInput edge is ever detected and no OS banner fires
  // exactly when the user has switched away and needs to be told (THI-78).
  // Browser throttles background timers (~1Hz, dropping to ~1/min after a few
  // minutes hidden), which bounds the bandwidth cost.
  const { data: state, consecutiveErrors, refresh } = usePolling(
    fetchState,
    pollIntervalMs,
    settings.notifyBrowser,
  );
  const { data: usage } = usePolling(fetchUsage, USAGE_POLL_MS);
  // Input-active backoff (THI-138). True while the user is typing into a
  // non-xterm text input within the last 800 ms. Threaded through the
  // pollTier effect below so a typing burst widens the /api/state cadence
  // and keystrokes don't compete with polling-driven renders.
  const inputActive = useInputActive();
  const { quickCreating, handleQuickCreate } = useQuickCreate(refresh);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // THI-100: pane history search modal (`⌘⇧F` / `Ctrl+Shift+F`).
  const [showSearch, setShowSearch] = useState(false);
  // THI-99: session templates modal.
  const [showTemplates, setShowTemplates] = useState(false);
  // In-app Documentation modal (THI-136). Opened from the Header docs button
  // and from the final step of the first-run tour.
  const [showDocs, setShowDocs] = useState(false);
  const [paletteTargetId, setPaletteTargetId] = useState<string | null>(null);
  // THI-66 broadcast palette state. When non-null, the palette opens with
  // these as targets; `paletteTargetId` still holds the "anchor" pane (used
  // for the recents seed and the placeholder fallback if the user prunes
  // every other target).
  const [broadcastTargetIds, setBroadcastTargetIds] = useState<string[] | null>(
    null,
  );
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [newWindowSession, setNewWindowSession] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [renameSessionTarget, setRenameSessionTarget] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // Auto-rename modal target (THI-67). Session id when open, null when closed.
  const [autoRenameSession, setAutoRenameSession] = useState<string | null>(null);
  // Whether the backend has an Anthropic key configured — drives whether the
  // ✨ button shows in the Kanban column headers. Fetched once on mount
  // (the key doesn't change at runtime); refetched after Settings closes in
  // case the user pasted a key while there.
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  // Re-fetch on mount AND every time Settings closes — that's the window in
  // which the user might have set a key in their shell + restarted the
  // backend (and so the ✨ button should newly appear without a page reload).
  useEffect(() => {
    let cancelled = false;
    void fetchAiStatus().then(
      (s) => {
        if (!cancelled) setAiEnabled(s.enabled);
      },
      () => {
        /* status endpoint unreachable — keep button hidden, no toast */
      },
    );
    return () => {
      cancelled = true;
    };
    // Refetch when the Settings modal closes — the user may have pasted an
    // Anthropic key in the meantime, in which case the ✨ button should
    // appear without a page reload.
  }, [showSettings]);
  // User-pinned session order (drag-to-reorder, THI-115). Treated as a
  // top-floating pin list — see `applySessionOrder` — so newly-spawned
  // sessions still appear automatically without manual reordering.
  const [sessionOrder, setSessionOrder] = useState<string[]>(() => loadSessionOrder());
  // Per-session pin lists for tile drag-reorder (THI-141). Same shape as
  // sessionOrder but keyed by sessionId. Kept lean: stale entries (killed
  // panes) drop silently on next render; we don't proactively prune.
  const [windowOrder, setWindowOrder] = useState<WindowOrderMap>(() => loadWindowOrder());

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
  // Resolve broadcast pane ids back into Window objects each render so the
  // chips show fresh names/cwd if the backend renamed something between
  // open and submit. Filter out gone panes (kill mid-broadcast → drop).
  const broadcastTargets = useMemo(() => {
    if (!broadcastTargetIds) return undefined;
    const live = broadcastTargetIds
      .map((id) => windows.find((w) => w.paneId === id))
      .filter((w): w is Window => !!w);
    return live.length > 0 ? live : undefined;
  }, [broadcastTargetIds, windows]);
  const closePalette = useCallback(() => {
    setPaletteTargetId(null);
    setBroadcastTargetIds(null);
  }, []);
  const openBroadcast = useCallback((ws: Window[]) => {
    if (ws.length === 0) return;
    setPaletteTargetId(ws[0].paneId);
    setBroadcastTargetIds(ws.map((w) => w.paneId));
  }, []);
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

  // Sum of per-pane Claude session costs scraped from each agent's TUI `💰`
  // line (THI-139). Drives the cost figure in the header usage pill — exactly
  // the same dollar total the user gets if they read `💰` across every
  // visible claude pane and add them up.
  const activeSessionCostUsd = useMemo(
    () =>
      windows.reduce((sum, w) => sum + (w.agent?.sessionCostUsd ?? 0), 0),
    [windows],
  );

  const parsed = useMemo(() => parseQuery(query), [query]);
  // THI-98: persistent pin set + filter overlay. Pinned panes stay visible
  // when the active filter would otherwise hide them, and sort to the top
  // of their column inside Kanban.
  const { pinnedIds, togglePin } = usePins();
  const onTogglePinWindow = useCallback(
    (w: Window) => togglePin(w.paneId),
    [togglePin],
  );
  // THI-98 saved filter presets: persistent named bundles of
  // (status, kind, query) so the user can swap between curated views with
  // one click.
  const { presets, savePreset, deletePreset } = usePresets();
  const applyPreset = useCallback(
    (p: FilterPreset) => {
      setFilterParam(p.filter);
      setKindParam(p.kind);
      setQuery(p.query);
    },
    [setFilterParam, setKindParam, setQuery],
  );
  const visible = useMemo(
    () => applyFilterWithPins(windows, filter, kindFilter, parsed, pinnedIds),
    [windows, filter, kindFilter, parsed, pinnedIds],
  );

  // Chip-click handler (THI-130). Toggle semantics: click the active chip to
  // clear it; click the inactive chip to switch. Clears any conflicting
  // `kind:` token from the search box so the chip and the search input never
  // show competing kind filters.
  const onChipClick = useCallback(
    (next: KindFilter) => {
      if (parsed.tokens.kind && parsed.tokens.kind !== next) {
        setQuery(stripKindToken(query));
      }
      setKindFilter(kindFilter === next ? "" : next);
    },
    [parsed.tokens.kind, query, kindFilter, setQuery, setKindFilter],
  );
  const pendingWindows = useMemo(
    () => windows.filter((w) => w.pendingInput),
    [windows],
  );
  // THI-89: per-pane dismissal state for the NeedsStrip, persisted via
  // sessionStorage. Strip re-shows when a previously-undismissed pending
  // pane appears; previously-dismissed panes that resolve and then re-pend
  // are also treated as new.
  const { visibleWindows: visiblePending, dismiss: dismissNeedsStrip } =
    useNeedsStripDismiss(pendingWindows);
  // User pin-list applied on top of the natural order from /api/state. Saved
  // sessions float to the front; new/unsaved sessions keep their server order
  // (THI-115). `applySessionOrder` returns the input ref when the order is a
  // no-op, so this useMemo doesn't churn for users who never reorder.
  const orderedSessions = useMemo(
    () => applySessionOrder(sessions, sessionOrder),
    [sessions, sessionOrder],
  );
  const navCols = useMemo(
    () => columnsForNav(orderedSessions, visible),
    [orderedSessions, visible],
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

  const messageToast = useCallback(
    (message: string) =>
      pushToast({ id: Math.random().toString(36).slice(2), kind: "message", message }),
    [pushToast],
  );

  const handleFocus = useCallback(
    (w: Window) => {
      setFocusedId(w.paneId);
      window.setTimeout(
        () => setFocusedId((id) => (id === w.paneId ? null : id)),
        900,
      );
      // Fork the toast on the backend's response, but on rejection fall back
      // to the focus toast — the click still registered the user's intent.
      void focusWindow(w.session, w.index).then(
        (focused) => {
          if (focused) {
            pushToast({
              id: Math.random().toString(36).slice(2),
              kind: "focus",
              session: w.session,
              index: w.index,
              name: w.name,
              term: hostTerm,
            });
          } else {
            messageToast(`No attached client for ${w.session} — opening modal instead`);
          }
        },
        () => {
          pushToast({
            id: Math.random().toString(36).slice(2),
            kind: "focus",
            session: w.session,
            index: w.index,
            name: w.name,
            term: hostTerm,
          });
        },
      );
      // Modal-open is unconditional and synchronous-scheduled — keeps the
      // pre-PR 280 ms contract and avoids a stale setOpenId if the user moves
      // on during the focus-API RTT, or a silent click on backend error.
      window.setTimeout(() => setOpenId(w.paneId), 280);
    },
    [hostTerm, pushToast, messageToast, setOpenId],
  );

  const handleRename = useCallback((w: Window) => setRenameTargetId(w.paneId), []);
  const handleSend = useCallback((w: Window) => setPaletteTargetId(w.paneId), []);
  const handleNewWindow = useCallback((session: string) => setNewWindowSession(session), []);
  const handleRenameSession = useCallback(
    (session: string) => setRenameSessionTarget(session),
    [],
  );
  // Open the auto-rename modal for a session (THI-67). The modal is
  // self-contained: it fetches its own suggestions via /api/auto-rename-session
  // and calls /api/rename per accepted row, so App only needs to track which
  // session (if any) is currently open.
  const handleAutoRename = useCallback(
    (session: string) => setAutoRenameSession(session),
    [],
  );

  // Drag-drop reorder of session columns (THI-115). Persisted to localStorage
  // so the order survives reloads. `reorderSessions` is pure and short-
  // circuits when src === dst or either is missing — safe to call eagerly
  // from the drop handler.
  const handleReorderSession = useCallback(
    (src: string, dst: string, before: boolean) => {
      setSessionOrder((prev) => {
        // Seed the pin list from the *currently-displayed* order, not just
        // `prev`. Otherwise dropping a never-pinned session next to another
        // never-pinned one would leave both unpinned and the move would have
        // no effect.
        const base = orderedSessions.map((s) => s.id);
        const seed = prev.length > 0 ? prev : base;
        // Fold any currently-rendered sessions that aren't already pinned to
        // the end of the seed so reorderSessions can find both src and dst.
        const merged = [...seed];
        for (const id of base) if (!merged.includes(id)) merged.push(id);
        const next = reorderSessions(merged, src, dst, before);
        saveSessionOrder(next);
        return next;
      });
    },
    [orderedSessions],
  );

  // Drag-drop reorder of tiles within a column (THI-141). Same shape as the
  // session handler but keyed per session; `reorderWindow` is pure and
  // handles unpinned src/dst gracefully (creates a fresh pin list).
  const handleReorderWindow = useCallback(
    (sessionId: string, src: string, dst: string, before: boolean) => {
      setWindowOrder((prev) => {
        const next = reorderWindow(prev, sessionId, src, dst, before);
        saveWindowOrder(next);
        return next;
      });
    },
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

  // THI-97: route a card's quick-action click straight to /api/send.
  // `messageToast` is itself memoized, so this handler keeps a stable
  // identity across renders and WindowCard's memo comparator stays
  // effective when this prop threads through.
  const handleQuickAction = useCallback(
    async (w: Window, action: QuickAction) => {
      const ok = await sendKeys(w.session, w.index, action.payload);
      if (!ok) {
        messageToast(`Couldn't send ${action.label} to ${w.session}:${w.index}`);
      }
    },
    [messageToast],
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

  // THI-127 tier picker. Recomputes the /api/state poll cadence whenever the
  // modal-open state, the windows list, the user-configured cadence, or
  // the input-active flag (THI-138) changes. `pickPollInterval` is pure —
  // see lib/pollTier.ts and the spec tier table for the exact decision
  // rules. The setState short-circuits on identical values so we don't
  // churn `usePolling`'s [ms] dep.
  useEffect(() => {
    const next = pickPollInterval(
      Boolean(openId),
      windows,
      settings.pollIntervalMs,
      MODAL_OPEN_POLL_MS,
      inputActive,
    );
    setPollIntervalMs((prev) => (prev === next ? prev : next));
  }, [openId, windows, settings.pollIntervalMs, inputActive]);

  // Apply persisted appearance settings to <html>. The theme/density/
  // reduced-motion CSS ships in styles.css; accent is written as CSS vars.
  // Previews show only at `preview` density.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", settings.theme);
    el.setAttribute("data-density", settings.density);
    el.setAttribute("data-column-size", settings.columnSize);
    el.setAttribute("data-show-previews", String(settings.density === "preview"));
    el.setAttribute("data-reduced-motion", String(settings.reducedMotion));
    // Theme-aware accent application — applyAccent reads `theme` so light
    // mode gets the bumped focus-ring alpha (THI-151) and selection band
    // alpha (THI-155). The previous signature wrote dark-theme alphas
    // unconditionally as inline styles, shadowing the per-theme CSS
    // overrides. Toggling theme re-runs this effect via the dep array.
    applyAccent(settings.accent, settings.theme);
  }, [
    settings.theme,
    settings.density,
    settings.columnSize,
    settings.reducedMotion,
    settings.accent,
  ]);

  // Pending-input badge in the browser tab title + favicon red-dot count
  // (THI-78 PR 2). Both gate on `notifyBadge` and react to `pendingWindows`,
  // so merge into one effect (THI-193) — saves a redundant effect
  // schedule per tick and keeps the two pieces of glanceable feedback
  // applied together. Favicon update swaps `href` on the existing
  // <link rel="icon"> in index.html so Chrome / Firefox / Safari all
  // honor it without re-creating the element.
  useEffect(() => {
    const n = pendingWindows.length;
    const badgeOn = settings.notifyBadge;
    document.title = badgeOn && n > 0 ? `(${n}) Switchboard` : "Switchboard";
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (link) link.href = faviconDataUrl(badgeOn ? n : 0);
  }, [settings.notifyBadge, pendingWindows.length]);

  // Native browser notifications on pendingInput edge (THI-78). Edge detection
  // is a pure module (lib/pendingNotify); we keep the per-tick NotifyState in
  // a ref so it survives re-renders. State is hydrated on every poll *even
  // when notifications are off* — that way (a) reload-protection still works
  // and (b) the off→on toggle has real state to diff against, so currently-
  // pending panes can be surfaced as edges via markJustEnabled.
  const notifyStateRef = useRef<NotifyState>(emptyNotifyState());
  const notifyEnabledRef = useRef<boolean>(false);
  useEffect(() => {
    // No state yet → first poll hasn't returned. Nothing to hydrate against.
    if (!state) return;

    const enabled =
      settings.notifyBrowser &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted";

    if (!enabled) {
      // Keep hydrating silently. Bumps `hydrated` to true on the first state
      // response and keeps `lastPendingIds` in sync with whatever's pending
      // now, so a later toggle-on can correctly fire only for panes that
      // were pending at the moment of opting in. Uses hydrateNotifyState
      // (not detectPendingEdges) so panes going pending while disabled don't
      // poison lastNotifiedAt — otherwise dedup would silently block the
      // user's first real notification after they enable.
      notifyStateRef.current = hydrateNotifyState(windows, notifyStateRef.current);
      notifyEnabledRef.current = false;
      return;
    }

    // Off → on transition mid-session: explicitly opt in to seeing currently-
    // pending panes. Skipped when !hydrated (initial page load with the
    // toggle already on) — that case stays under reload protection so a
    // refresh doesn't barrage the user with everything that was pending
    // before they could care.
    if (!notifyEnabledRef.current && notifyStateRef.current.hydrated) {
      notifyStateRef.current = markJustEnabled(notifyStateRef.current);
    }
    notifyEnabledRef.current = true;

    const { edges, state: next } = detectPendingEdges(
      windows,
      notifyStateRef.current,
      Date.now(),
    );
    notifyStateRef.current = next;
    for (const e of edges) {
      // `tag` collapses repeated notifications for the same pane on most
      // platforms — belt-and-braces with the in-module dedup window.
      const n = new Notification(`${e.session}/${e.windowName}`, {
        body: e.action ?? "waiting on input",
        tag: e.paneId,
      });
      n.onclick = () => {
        // Bring the tab to the front (Chrome / Safari honor this on a
        // notification click since the click is a user gesture). Then drive
        // tmux's `select-window` and open the modal — same pair as a card
        // click in the kanban.
        window.focus();
        void focusWindow(e.session, e.index);
        setOpenId(e.paneId);
        setHighlightedId(e.paneId);
        n.close();
      };
    }
  }, [windows, state, settings.notifyBrowser, setOpenId]);

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

  // Pre-highlight the first visible card on the first non-null state so arrow
  // nav is discoverable (THI-87). The ref guard ensures subsequent polls never
  // re-pick — after first hydration the user owns highlightedId.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!state) return;
    if (highlightedId !== null) return;
    const first = openId || navCols[0]?.windows[0]?.paneId || visible[0]?.paneId || null;
    if (first) {
      hydratedRef.current = true;
      setHighlightedId(first);
    }
  }, [state, navCols, visible, highlightedId, openId]);

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
        cleanupOpen ||
        showSettings ||
        showShortcuts ||
        showSearch ||
        showTemplates ||
        showDocs ||
        newWindowSession ||
        showNewSession ||
        renameSessionTarget ||
        autoRenameSession ||
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

      // ⌘⇧F / Ctrl+Shift+F — open pane history search. Always available,
      // even from inside inputs. (THI-100)
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        setShowSearch(true);
        return;
      }

      if (anyOverlay) {
        // Esc handling lives inside each overlay; nothing else here.
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !inField) {
        e.preventDefault();
        document.getElementById("search-input")?.focus();
        return;
      }
      // `?` opens the shortcuts sheet. Most browsers report `?` directly on
      // Shift+/ via `e.key`; we also honor the explicit Shift+/ form for safety
      // on layouts/browsers that don't (THI-69).
      if (
        !e.metaKey &&
        !e.ctrlKey &&
        !inField &&
        (e.key === "?" || (e.shiftKey && e.key === "/"))
      ) {
        e.preventDefault();
        setShowShortcuts(true);
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
        // Don't preempt the native Enter→click activation on focused
        // <button>s (StatusLegend trigger, header help/settings, filter
        // tabs, card action icons, etc.). Without this guard our
        // `preventDefault()` below suppresses the button's click and the
        // user's Tab+Enter just opens the highlighted card instead. Cards
        // themselves use `<div role="button">` (tagName "div"), so this
        // guard doesn't affect card-open from keyboard nav.
        if (tag === "button") return;
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
    showShortcuts,
    showDocs,
    newWindowSession,
    showNewSession,
    renameSessionTarget,
    autoRenameSession,
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
      onOpenCleanup={() => setCleanupOpen(true)}
    />
  ) : null;

  const cleanupModal = cleanupOpen ? (
    <CleanupModal
      windows={windows}
      pinnedIds={pinnedIds}
      thresholdDays={settings.idleCleanupDays}
      onClose={() => setCleanupOpen(false)}
      onLowerThreshold={() => {
        setCleanupOpen(false);
        setShowSettings(true);
        // After Settings re-mounts, focus the threshold input.
        requestAnimationFrame(() => {
          document.getElementById("idle-cleanup-days")?.focus();
        });
      }}
      onAfterCleanup={({ ok, failed }) => {
        const msg =
          failed === 0
            ? `Closed ${ok} pane${ok === 1 ? "" : "s"}.`
            : `Closed ${ok} pane${ok === 1 ? "" : "s"} (${failed} failed).`;
        pushToast({
          id: Math.random().toString(36).slice(2),
          kind: "message",
          message: msg,
        });
        refreshRef.current();
      }}
    />
  ) : null;

  const shortcutsSheet = showShortcuts ? (
    <ShortcutsSheet onClose={() => setShowShortcuts(false)} />
  ) : null;

  // THI-100: Click a search result → open the matching pane's terminal
  // modal AND dismiss the search modal so the open pane is fully visible.
  // (Scroll-to-line in the modal is a follow-up.)
  const searchModal = showSearch ? (
    <SearchModal
      onClose={() => setShowSearch(false)}
      onOpenMatch={(paneId) => {
        const target = windows.find((w) => w.paneId === paneId);
        if (target) openCard(target);
        setShowSearch(false);
      }}
    />
  ) : null;

  // THI-99: templates modal — on success, kick a state refresh so the new
  // session's column appears immediately and toast the name.
  const templatesModal = showTemplates ? (
    <TemplatesModal
      onClose={() => setShowTemplates(false)}
      onApplied={(session) => {
        refresh();
        messageToast(`Created session ${session}`);
      }}
    />
  ) : null;

  const docsModal = showDocs ? (
    <DocsModal onClose={() => setShowDocs(false)} />
  ) : null;

  const newSessionOverlay = showNewSession ? (
    <NewSessionOverlay
      existingNames={sessions.map((s) => s.name)}
      onClose={() => setShowNewSession(false)}
      onApplied={refresh}
    />
  ) : null;

  if (inEmpty) {
    return (
      <div className="app">
        <Header
          counts={counts}
          serverAddr={SERVER_ADDR}
          inEmpty
          onHelp={() => setShowShortcuts(true)}
          onSettings={() => setShowSettings(true)}
          onOpenDocs={() => setShowDocs(true)}
          onNewSession={() => setShowNewSession(true)}
          onOpenTemplates={() => setShowTemplates(true)}
          onRetry={refresh}
        />
        <main className="main">
          <EmptyState onRetry={refresh} />
        </main>
        {settingsModal}
        {cleanupModal}
        {shortcutsSheet}
        {searchModal}
        {templatesModal}
        {docsModal}
        {newSessionOverlay}
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
        usage={usage}
        activeSessionCostUsd={activeSessionCostUsd}
        onHelp={() => setShowShortcuts(true)}
        onSettings={() => setShowSettings(true)}
        onOpenDocs={() => setShowDocs(true)}
        onNewSession={() => setShowNewSession(true)}
        onOpenTemplates={() => setShowTemplates(true)}
      />
      {visiblePending.length > 0 && (
        <NeedsStrip
          windows={visiblePending}
          onOpen={openCard}
          onDismiss={dismissNeedsStrip}
          onBroadcast={openBroadcast}
        />
      )}
      <Subhead
        filter={filter}
        setFilter={setFilter}
        query={query}
        setQuery={setQuery}
        counts={counts}
        kindFilter={kindFilter}
        onChipClick={onChipClick}
        presets={presets}
        onApplyPreset={applyPreset}
        onSavePreset={savePreset}
        onDeletePreset={deletePreset}
        visibleCount={visible.length}
      />
      <main className="main">
        {settings.layout === "list" ? (
          <ListView
            windows={visible}
            focusedId={focusedId}
            highlightedId={highlightedId}
            onOpen={openCard}
            onSend={handleSend}
            onRename={handleRename}
            onFocus={handleFocus}
            onKill={handleKill}
            onQuickAction={handleQuickAction}
            pinnedPaneIds={pinnedIds}
            onTogglePin={onTogglePinWindow}
          />
        ) : settings.layout === "grid" ? (
          <GridView
            sessions={orderedSessions}
            windows={visible}
            focusedId={focusedId}
            highlightedId={highlightedId}
            onOpen={openCard}
            onSend={handleSend}
            onRename={handleRename}
            onFocus={handleFocus}
            onKill={handleKill}
            onQuickAction={handleQuickAction}
            onNewWindow={handleNewWindow}
            onKillSession={handleKillSession}
            onRenameSession={handleRenameSession}
            onAutoRename={aiEnabled ? handleAutoRename : undefined}
            pinnedPaneIds={pinnedIds}
            onTogglePin={onTogglePinWindow}
          />
        ) : (
        <Kanban
          sessions={orderedSessions}
          windows={visible}
          focusedId={focusedId}
          highlightedId={highlightedId}
          onOpen={openCard}
          onSend={handleSend}
          onRename={handleRename}
          onFocus={handleFocus}
          onKill={handleKill}
          onQuickAction={handleQuickAction}
          onNewWindow={handleNewWindow}
          onKillSession={handleKillSession}
          onRenameSession={handleRenameSession}
          onAutoRename={aiEnabled ? handleAutoRename : undefined}
          onReorderSession={handleReorderSession}
          onReorderWindow={handleReorderWindow}
          windowOrder={windowOrder}
          pinnedPaneIds={pinnedIds}
          onTogglePin={onTogglePinWindow}
          onQuickCreate={handleQuickCreate}
          quickCreating={quickCreating}
        />
        )}
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
          broadcastTargets={broadcastTargets}
          onClose={closePalette}
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
      {autoRenameSession && (
        <AutoRenameModal
          session={autoRenameSession}
          onClose={() => setAutoRenameSession(null)}
          onApplied={refresh}
          onOpenSettings={() => setShowSettings(true)}
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
      {cleanupModal}
      {shortcutsSheet}
      {searchModal}
      {templatesModal}
      {docsModal}
      {newSessionOverlay}
      {/* First-run tour (THI-96). Suppressed while any overlay is up — the
       *  tour's data-tour anchors get covered when a modal is open, and the
       *  user is mid-interaction anyway. Also requires at least one visible
       *  card so the `[data-tour="first-card"]` anchor exists.
       *  Final step renders a "More in Docs →" link via `onOpenDocs`
       *  (THI-136). */}
      <Tour
        enabled={
          !!state &&
          !inEmpty &&
          visible.length > 0 &&
          !openId &&
          !paletteTargetId &&
          !renameTargetId &&
          !newWindowSession &&
          !showNewSession &&
          !renameSessionTarget &&
          !cleanupOpen &&
          !showSettings &&
          !showShortcuts &&
          !showDocs &&
          !confirm
        }
        onOpenDocs={() => setShowDocs(true)}
      />
      <ToastStack toasts={toasts} />
    </div>
  );
}
