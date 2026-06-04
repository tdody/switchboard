import { useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

import { fetchPane, openInIde, openPaneWS, pasteImage } from "../api/client";
import { filePathLinkProvider } from "../lib/filePathLinks";
import { prNumberLinkProvider } from "../lib/prNumberLinks";
import { useIdeConfig } from "../lib/useIdeConfig";
import {
  COLUMN_SIZE_ORDER,
  TERM_FONT_DEFAULT,
  TERM_FONT_MAX,
  TERM_FONT_MIN,
  updateSettings,
  useSetting,
} from "../lib/settings";
import type { Window } from "../types";
import { comboBytes, escAction, newlineBytes } from "../lib/termKeys";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import { PromptOverlay } from "./PromptOverlay";
import { parsePromptMessage } from "../lib/prompt";
import type { Prompt } from "../lib/prompt";
import { useScrimClose } from "../lib/useScrimClose";
import { decideCloseAction } from "../lib/wsReconnect";
import { apply256ColorOverrides, xtermThemeFor } from "../lib/xtermThemes";
import { XtermStreamRewriter } from "../lib/xtermStreamRewriter";

interface Props {
  window: Window;
  onClose: () => void;
  onToast: (message: string) => void;
  /** Optional — when present, renders a Kill button in the foot that delegates
   *  to the parent's handler (same shift-skip-confirm contract as WindowCard). */
  onKill?: (w: Window, skipConfirm: boolean) => void;
}

type Connection =
  | "connecting"
  | "live"
  | "reconnecting"
  | "disconnected"
  | "gone"
  | "snapshot";

const CONN_LABEL: Record<Connection, string> = {
  connecting: "connecting",
  live: "WS · live",
  reconnecting: "reconnecting",
  disconnected: "disconnected",
  gone: "pane gone",
  snapshot: "snapshot",
};

/** Px the +/- buttons and ⌘=/⌘- shift the terminal font by per press. */
const ZOOM_STEP = 2;

function clampFont(n: number): number {
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, n));
}

export function TerminalModal({ window: win, onClose, onToast, onKill }: Props) {
  const scrimProps = useScrimClose(onClose);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastEscRef = useRef(0);
  const attemptRef = useRef(0);
  const intentionalRef = useRef(false);
  const backoffTimerRef = useRef<number | null>(null);
  const noticeWrittenRef = useRef(false);
  const manualReconnectRef = useRef<() => void>(() => {});
  // attachCustomKeyEventHandler captures its closure once when the terminal
  // is constructed; deferring onClose through a ref lets parent re-renders
  // update the callback without tearing down the terminal + WS.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Same trick for repoUrl — the registerLinkProvider callback closes over
  // a single value at terminal-construction time, but we want a `git remote
  // set-url` (very rare) to take effect without rebuilding the terminal.
  const repoUrlRef = useRef(win.repoUrl);
  repoUrlRef.current = win.repoUrl;
  // Same trick for `onToast` — the select-to-copy mouseup listener fires
  // long after the construction effect runs, and the parent often hands us
  // a new function identity each render (App's pushToast).
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const [conn, setConn] = useState<Connection>("connecting");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // THI-186: subscribe per-field instead of taking the whole Settings object.
  // Object.is comparison inside useSyncExternalStore now short-circuits the
  // re-render when an unrelated field (theme, density, layout, …) changes.
  const wsEnabled = useSetting("wsStreamEnabled");
  const terminalFontSize = useSetting("terminalFontSize");
  const columnSize = useSetting("columnSize");
  const selectedIde = useSetting("selectedIde");
  const theme = useSetting("theme");

  // THI-146 PR 3: IDE-launch config + click handler refs. Reading config
  // through a ref lets the linkProvider toggle live on the first /api/ide-
  // config response without rebuilding the terminal. PR 4 adds the user's
  // dropdown pick: empty `selectedIde` ⇒ defer to the server default.
  const ideConfig = useIdeConfig();
  const ideEnabledRef = useRef(false);
  ideEnabledRef.current = ideConfig?.enabled === true;
  const onPathClickRef = useRef<(p: string) => void>(() => {});
  onPathClickRef.current = (path: string) => {
    void openInIde(win.session, win.index, path, selectedIde || undefined).then((status) => {
      if (status === "ok") return;
      if (status === "disabled") {
        onToast("Open-in-IDE disabled — set SWITCHBOARD_IDE_CMD");
      } else if (status === "not-found") {
        onToast(`File not found: ${path}`);
      } else if (status === "escaped") {
        onToast("Path resolved outside the pane's cwd");
      } else {
        onToast(`Couldn't open ${path}`);
      }
    });
  };

  // Shared Esc handler — used both by xterm's customKeyEventHandler (when the
  // terminal has focus) and by PromptOverlay (when it grabs focus). Same
  // single-tap-to-pane / double-tap-to-close semantics either way; sharing
  // `lastEscRef` means a tap on the overlay can be the second tap of a pair
  // started on the terminal (and vice versa).
  const handleEscRef = useRef(() => {});
  handleEscRef.current = () => {
    const sock = wsRef.current;
    const live = sock !== null && sock.readyState === WebSocket.OPEN;
    if (live && sock && escAction(Date.now(), lastEscRef.current) === "send") {
      sock.send("\x1b");
      lastEscRef.current = Date.now();
    } else {
      onCloseRef.current();
    }
  };

  // The construction effect below seeds the terminal's initial fontSize from
  // this ref rather than depending on `terminalFontSize` directly — otherwise
  // every zoom step would tear down and rebuild the terminal, dropping the
  // scrollback and WS connection. A separate effect handles live changes.
  const fontSizeRef = useRef(terminalFontSize);
  fontSizeRef.current = terminalFontSize;
  // Same trick for theme (THI-153) — the construction effect reads from
  // the ref; a dedicated effect below swaps `term.options.theme` when the
  // user toggles theme while the modal is open.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // THI-150 follow-up: rewriter that catches truecolor bg escapes
  // (`\e[48;2;R;G;Bm`) before they reach xterm and rewrites the
  // dark-fill ones to light pastels in light/contrast themes. One
  // instance per modal — stateful for cross-chunk escape buffering.
  const rewriterRef = useRef<XtermStreamRewriter | null>(null);
  if (rewriterRef.current === null) rewriterRef.current = new XtermStreamRewriter(theme);

  useEffect(() => {
    if (!hostRef.current) return;
    // Refs persist across effect re-runs; reset the reconnect flag so a
    // remount (e.g. wsEnabled toggle, pane swap) starts in a clean state.
    // attemptRef and noticeWrittenRef get reset on onopen/manualReconnect
    // already; intentionalRef is the only one without a natural reset.
    intentionalRef.current = false;
    const term = new Terminal({
      // Ghostty's default font is JetBrains Mono — matches the user's terminal.
      fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.2,
      // pipe-pane already emits raw PTY bytes (CRLF intact); converting LF→CRLF
      // a second time would double-CR after each newline.
      convertEol: false,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      // Option key → Meta escape prefix. Lets Option+Backspace become readline
      // word-delete (ESC + DEL), Option+Left become word-back (ESC + b), etc.
      // — sequences Claude Code's input box honors.
      macOptionIsMeta: true,
      // Nudge low-contrast source colors to stay readable against the bg
      // (Ghostty does the same minimum-contrast adjustment). The
      // theme-aware palettes already clear WCAG AA, but this stays as a
      // safety net for unusual escape-code combinations.
      minimumContrastRatio: 4.5,
      // THI-153: theme follows Switchboard's current Theme setting. A
      // separate effect below re-applies the palette when the user
      // toggles theme while the modal is open.
      theme: xtermThemeFor(themeRef.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // THI-146 PR 3: linkify file paths in pane content (e.g. `src/foo.py:42`
    // in a stack trace). Routes the click to POST /api/open which spawns the
    // configured IDE. The provider gates on `ideEnabledRef` so paths render
    // as plain text when the launcher is unconfigured / off-allowlist.
    term.registerLinkProvider(
      filePathLinkProvider(
        term,
        () => ideEnabledRef.current,
        (path) => onPathClickRef.current(path),
      ),
    );
    // Linkify `PR #N` mentions in pane content (THI-146 PR 2). The provider
    // reads `repoUrlRef.current` each call, so the link target follows a live
    // remote change without rebuilding the terminal. Skipped silently when
    // the pane has no repoUrl (non-github cwd, or no git at all).
    term.registerLinkProvider(prNumberLinkProvider(term, () => repoUrlRef.current));
    // Clickable http(s) URLs (THI-146). Open in a new tab; `noopener` keeps
    // the popup from gaining a `window.opener` handle back to the dashboard.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        // The addon's default handler also opens in a new tab, but it doesn't
        // pass `noopener` — and our pane content is untrusted (anyone with a
        // shell can echo a hostile URL). Take the click ourselves.
        event.preventDefault();
        window.open(uri, "_blank", "noopener,noreferrer");
      }),
    );
    // xterm's keydown handler calls stopPropagation on keys it owns, so
    // document-level listeners never see Cmd-combos or Esc. Anything that
    // needs to override xterm's default byte emission has to live here.
    // Returning false makes xterm skip its own processing; we still need to
    // preventDefault to suppress browser defaults (history-back for
    // Cmd+Backspace, etc.). ⌘=/⌘-/⌘0 zoom stays at the document level —
    // it has to work whether xterm is focused or not.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const sock = wsRef.current;
      const live = sock !== null && sock.readyState === WebSocket.OPEN;

      // Shift+Enter → ESC + CR (Claude Code's in-prompt newline).
      const newline = newlineBytes(e);
      if (newline !== null) {
        e.preventDefault();
        if (live && sock) sock.send(newline);
        return false;
      }

      // Esc: single → forward to pane (interrupt); double within 400 ms →
      // close modal. In snapshot mode (no live socket) Esc just closes.
      if (e.key === "Escape") {
        e.preventDefault();
        handleEscRef.current();
        return false;
      }

      // Cmd-combo line editing → control bytes forwarded to the pane.
      const combo = comboBytes(e);
      if (combo !== null) {
        e.preventDefault();
        if (live && sock) sock.send(combo);
        return false;
      }

      return true;
    });
    term.open(hostRef.current);
    // THI-150 follow-up: override the 256-color slots that modern dev
    // TUIs (Claude Code, delta, lazygit) paint as block backgrounds.
    // Must be applied AFTER `term.open` so the renderer is attached and
    // re-paints when the OSC 4 packet is parsed.
    apply256ColorOverrides(term, themeRef.current);
    // THI-183: paint the cached 8-line `preview` (already in win) as a
    // placeholder so the modal isn't blank during the WS-connect + server-
    // side capture-pane round-trip. The real scrollback replaces this when
    // it arrives — see the snapshot-clearing block inside sock.onmessage
    // (WS path) and in the fetchPane.then() (snapshot-only path).
    const previewPainted = win.preview && win.preview.length > 0;
    if (previewPainted) {
      term.write(win.preview.join("\r\n") + "\r\n");
    }
    // Tracks whether we've already swapped the preview for the real scrollback,
    // so a second text message (e.g. a prompt re-emit) doesn't trigger another
    // term.clear() and wipe live content.
    let snapshotReceived = false;
    // Focus immediately so the user can start typing without first clicking
    // inside the modal.
    term.focus();
    termRef.current = term;
    fitRef.current = fit;

    // Resize lifecycle: fit xterm to the modal's actual pixel box, then ask
    // tmux to match. Without sending the size to the backend, the pane stays
    // at whatever geometry it had under the user's real client — typically
    // taller/wider than the modal — so xterm's viewport clips or pads tmux's
    // output. ResizeObserver catches modal-driven changes the `window.resize`
    // listener misses (zoom, sidebar toggles, devtools).
    let lastCols = 0;
    let lastRows = 0;
    const sendSize = () => {
      const sock = wsRef.current;
      if (!sock || sock.readyState !== WebSocket.OPEN) return;
      if (term.cols === lastCols && term.rows === lastRows) return;
      lastCols = term.cols;
      lastRows = term.rows;
      try {
        sock.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      } catch {
        /* socket racing with cleanup */
      }
    };
    // THI-195: debounce via rAF instead of an 80 ms setTimeout. ResizeObserver
    // bursts (sidebar animation, column-size step) collapse into a single
    // pre-paint fit() so the modal tracks the layout in lockstep with the
    // frame the user sees, instead of trailing by up to ~80 ms.
    let fitRafId: number | undefined;
    const scheduleFit = () => {
      if (fitRafId !== undefined) window.cancelAnimationFrame(fitRafId);
      fitRafId = window.requestAnimationFrame(() => {
        fitRafId = undefined;
        try {
          fit.fit();
        } catch {
          return;
        }
        sendSize();
      });
    };
    try {
      fit.fit();
    } catch {
      /* layout not ready yet */
    }
    const resizeObs = new ResizeObserver(scheduleFit);
    resizeObs.observe(hostRef.current);

    // Auto-hide the scrollbar: reveal it only while actively scrolling, then
    // fade it back out ~800ms after the last scroll event. `.scrolling` on the
    // host is the CSS hook (see styles.css). xterm's viewport exists once
    // `term.open()` has run.
    const host = hostRef.current;
    const viewport = host.querySelector<HTMLElement>(".xterm-viewport");
    let scrollbarTimer: number | undefined;
    const onScroll = () => {
      host.classList.add("scrolling");
      window.clearTimeout(scrollbarTimer);
      scrollbarTimer = window.setTimeout(() => host.classList.remove("scrolling"), 800);
    };
    viewport?.addEventListener("scroll", onScroll, { passive: true });

    // Select-to-copy (THI-146 extension). On mouseup inside the terminal,
    // if xterm reports a non-empty selection, copy it to the clipboard and
    // toast — matches the "select kills mark, mouseup yanks" muscle memory
    // from terminals like iTerm. We listen on the modal `host` (capture
    // phase) rather than on `window` so the listener is naturally scoped to
    // this modal's terminal and doesn't fire for selections elsewhere on
    // the page (e.g. the modal header text). Clipboard write is
    // fire-and-forget; the surrounding try/catch handles browsers / iframes
    // where `navigator.clipboard` is unavailable or rejected.
    const onSelectMouseUp = () => {
      const t = termRef.current;
      if (!t) return;
      const sel = t.getSelection();
      if (!sel) return;
      try {
        void navigator.clipboard.writeText(sel).then(
          () => onToastRef.current(`Copied ${sel.length} chars`),
          () => {
            /* clipboard denied / unavailable — stay silent */
          },
        );
      } catch {
        /* navigator.clipboard not available (file://, etc.) */
      }
    };
    host.addEventListener("mouseup", onSelectMouseUp);

    let ws: WebSocket | null = null;
    let dataSub: { dispose: () => void } | null = null;
    let cancelled = false;

    /** Opens a new WebSocket and wires its handlers. Called once at mount
     *  and again from setTimeout for automatic reconnects, or from the
     *  manual Reconnect button via manualReconnectRef. */
    function connect(isReconnect: boolean) {
      if (isReconnect) term.clear();
      setConn(isReconnect ? "reconnecting" : "connecting");
      const sock = openPaneWS(win.session, win.index);
      ws = sock;
      wsRef.current = sock;

      sock.onopen = () => {
        if (isReconnect) {
          term.writeln("\r\n\x1b[32m[reconnected]\x1b[0m");
        }
        attemptRef.current = 0;
        noticeWrittenRef.current = false;
        setConn("live");
        sendSize();
      };
      sock.onmessage = (ev) => {
        const data = ev.data;
        const rewriter = rewriterRef.current;
        if (typeof data === "string") {
          const parsed = parsePromptMessage(data);
          if (parsed !== undefined) {
            setPrompt(parsed);
            return;
          }
          // THI-183: first non-prompt text frame is the server's initial
          // capture-pane snapshot. Wipe the preview placeholder we painted
          // at mount so its lines don't double up with the snapshot's
          // tail. Guarded so subsequent text frames (e.g. defensive re-
          // emits) don't keep clearing live content.
          if (previewPainted && !snapshotReceived) {
            snapshotReceived = true;
            term.clear();
          }
          term.write(rewriter ? rewriter.rewriteString(data) : data);
        } else if (data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(data);
          term.write(rewriter ? rewriter.rewriteBytes(bytes) : bytes);
        }
      };
      sock.onerror = () => {
        /* onclose follows; no-op */
      };
      sock.onclose = (e) => {
        const action = decideCloseAction(
          e.code,
          attemptRef.current,
          intentionalRef.current,
          sock !== wsRef.current,
        );
        switch (action.kind) {
          case "ignore":
            return;
          case "gone":
            term.writeln("\r\n\x1b[31m[pane no longer exists]\x1b[0m");
            setConn("gone");
            return;
          case "exhausted":
            setConn("disconnected");
            return;
          case "retry":
            if (!noticeWrittenRef.current) {
              term.writeln("\r\n\x1b[33m[reconnecting…]\x1b[0m");
              noticeWrittenRef.current = true;
            }
            setConn("reconnecting");
            attemptRef.current = action.attempt + 1;
            backoffTimerRef.current = window.setTimeout(() => {
              backoffTimerRef.current = null;
              // Guard against the timer firing after cleanup raced ahead:
              // intentionalRef is set in the cleanup function below.
              if (intentionalRef.current) return;
              connect(true);
            }, action.delayMs);
            return;
        }
      };
    }

    if (wsEnabled) {
      // Publish a stable handle to the manual reconnect path so the
      // Reconnect button (in the JSX, outside this effect) can invoke it
      // without us having to re-create the closure on every render.
      manualReconnectRef.current = () => {
        // Defensive: in today's state machine the Reconnect button is only
        // reachable from `disconnected` (which arrives via `exhausted`, which
        // doesn't schedule a timer). If future code lets the button get
        // clicked with a pending timer, this prevents two concurrent sockets.
        if (backoffTimerRef.current) {
          window.clearTimeout(backoffTimerRef.current);
          backoffTimerRef.current = null;
        }
        attemptRef.current = 0;
        noticeWrittenRef.current = false;
        connect(true);
      };

      // term.onData lives outside connect() so it reads wsRef.current per
      // call — this lets it survive a future socket replacement (reconnect).
      dataSub = term.onData((d) => {
        const sock = wsRef.current;
        if (sock && sock.readyState === WebSocket.OPEN) sock.send(d);
      });
      connect(false);
    } else {
      // Live streaming disabled in settings — show a one-shot snapshot (read-only).
      setConn("snapshot");
      void fetchPane(win.session, win.index).then((lines) => {
        if (cancelled) return;
        // THI-183: same swap as the WS path — clear the preview placeholder
        // before writing the real scrollback so the preview lines don't
        // double up with the snapshot's tail.
        if (previewPainted) term.clear();
        term.write(lines.join("\r\n") + (lines.length ? "\r\n" : ""));
      });
    }

    return () => {
      // Set intentionalRef + clear backoff timer FIRST so any pending close
      // event or fired timer is suppressed before we tear down the socket.
      intentionalRef.current = true;
      if (backoffTimerRef.current) {
        window.clearTimeout(backoffTimerRef.current);
        backoffTimerRef.current = null;
      }
      cancelled = true;
      resizeObs.disconnect();
      if (fitRafId !== undefined) window.cancelAnimationFrame(fitRafId);
      viewport?.removeEventListener("scroll", onScroll);
      host.removeEventListener("mouseup", onSelectMouseUp);
      window.clearTimeout(scrollbarTimer);
      dataSub?.dispose();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
      wsRef.current = null;
      setPrompt(null);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [win.paneId, win.session, win.index, wsEnabled]);

  // Live zoom: mutate the existing terminal's fontSize and reflow the grid,
  // without rebuilding it. rAF lets the font metrics settle before `fit()`.
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = terminalFontSize;
    const id = requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      // Zoom changed cell metrics → the cols/rows the modal can hold changed
      // too; forward the new size so tmux reshapes the pane to match.
      const sock = wsRef.current;
      if (sock && sock.readyState === WebSocket.OPEN) {
        try {
          sock.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        } catch {
          /* socket racing with cleanup */
        }
      }
    });
    return () => cancelAnimationFrame(id);
  }, [terminalFontSize]);

  // THI-153: live theme swap. Toggling Switchboard's theme re-themes the
  // open terminal in place — no rebuild, scrollback and WS connection
  // preserved. xterm honors `term.options.theme = …` by re-rendering the
  // existing buffer with the new palette on the next frame.
  // THI-150 follow-up: also re-emit the 256-color overrides so diff bgs
  // and Claude Code's user-prompt blocks re-color in place; tell the
  // stream rewriter to switch policies so truecolor escapes in NEW
  // chunks get the new theme's rewrites (already-rendered cells in
  // the scrollback keep their original colors — xterm doesn't expose
  // a "rewrite cells" path for truecolor).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = xtermThemeFor(theme);
    apply256ColorOverrides(term, theme);
    rewriterRef.current?.setTheme(theme);
  }, [theme]);

  // Image paste → upload to the pane. Capture phase so we intercept before
  // xterm's own paste handling. Agent panes only — the `@path` reference is
  // Claude Code's file-attach syntax and is meaningless in a plain shell.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) =>
        it.type.startsWith("image/"),
      );
      if (!item) return; // not an image — let xterm handle the text paste
      if (!wsEnabled) return; // snapshot mode — no live pane to deliver to
      e.preventDefault();
      e.stopPropagation();
      if (win.kind !== "agent") {
        onToast("Image paste works only in Claude Code panes");
        return;
      }
      const blob = item.getAsFile();
      if (!blob) return;
      void pasteImage(win.session, win.index, blob).then((ok) => {
        if (!ok) onToast("Image paste failed — too large or unsupported type");
      });
    };
    host.addEventListener("paste", onPaste, true);
    return () => host.removeEventListener("paste", onPaste, true);
  }, [win.kind, win.session, win.index, onToast, wsEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘=/⌘-/⌘0 zoom. The browser binds these to page zoom, so preventDefault.
      // ⌘+ is physically ⌘⇧= on most layouts — match the unshifted "=".
      // Lives at the document level so it works whether or not xterm has focus
      // (xterm's customKeyEventHandler only fires for keys on the textarea).
      if (e.metaKey && (e.key === "=" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        if (e.key === "0") {
          updateSettings({ terminalFontSize: TERM_FONT_DEFAULT });
        } else {
          const delta = e.key === "=" ? ZOOM_STEP : -ZOOM_STEP;
          updateSettings({ terminalFontSize: clampFont(fontSizeRef.current + delta) });
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Return focus to the terminal when a prompt clears; the overlay grabs focus
  // itself while it is mounted.
  useEffect(() => {
    if (prompt === null) termRef.current?.focus();
  }, [prompt]);

  const sendToPane = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  const zoomBy = (delta: number) =>
    updateSettings({ terminalFontSize: clampFont(terminalFontSize + delta) });
  const zoomReset = () => updateSettings({ terminalFontSize: TERM_FONT_DEFAULT });
  const zoomPct = Math.round((terminalFontSize / TERM_FONT_DEFAULT) * 100);

  // Modal pane size — shares the `columnSize` setting with the kanban subhead
  // ColumnSizeControl. The CSS width change is picked up by the existing
  // ResizeObserver on the xterm host (see effect above), which refits xterm
  // and forwards the new cols/rows to tmux — no extra wiring needed here.
  const sizeIdx = COLUMN_SIZE_ORDER.indexOf(columnSize);
  const atNarrow = sizeIdx <= 0;
  const atWide = sizeIdx >= COLUMN_SIZE_ORDER.length - 1;
  const sizeStep = (delta: -1 | 1) => {
    const next = COLUMN_SIZE_ORDER[sizeIdx + delta];
    if (next) updateSettings({ columnSize: next });
  };
  const sizeReset = () => updateSettings({ columnSize: "normal" });

  return (
    <div className="scrim" {...scrimProps}>
      <div className="term-modal" onClick={(e) => e.stopPropagation()}>
        <div className="term-hd">
          <span className="traffic">
            <button className="t-red" onClick={onClose} title="Close" />
            <span className="t-yellow" />
            <span className="t-green" />
          </span>
          <div className="term-title">
            <span className="sess">
              {win.session} › :{win.index}
            </span>
            <b>{win.name}</b>
            {/* Branch / PR / CI / spinner chips mirror the WindowCard layout
                so the modal header carries the same at-a-glance signal as the
                kanban card. Data flows through `win.branch` (top-level field
                so shell panes get the chip too, per THI-126) and `win.agent`
                on every `/api/state` poll (100ms while modal-open per
                THI-105 — see MODAL_OPEN_POLL_MS in App.tsx), so React
                re-renders the chips live without any extra poller. */}
            {(win.branch || win.pr) && (
              <Chip
                className={`branch-pr ${win.ci ? `ci-${win.ci}` : ""}`}
                title={win.branch || `PR #${win.pr}`}
              >
                {win.ci && (
                  <span className={`ci-dot ci-${win.ci}`} aria-hidden="true" />
                )}
                {win.branch && <Icon name="git-branch" size={10} />}
                {win.branch && <span>{win.branch}</span>}
                {win.branch && win.pr && <span className="pr-sep">›</span>}
                {win.pr && win.prUrl ? (
                  <a
                    className="pr-num pr-link"
                    href={win.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open PR #${win.pr} on GitHub`}
                  >
                    #{win.pr}
                  </a>
                ) : (
                  win.pr && <span className="pr-num">#{win.pr}</span>
                )}
              </Chip>
            )}
            {win.agent?.spinner && (
              <Chip className="spinner" title="agent activity">
                <span className="spin" />
                <span>{win.agent.spinner}</span>
                {win.agent.duration && <span className="dur">{win.agent.duration}</span>}
              </Chip>
            )}
            <StatusPill status={win.status} />
            {/* When the pane is waiting on the user, surface the prompt
                question as an ellipsized hint after the StatusPill so a
                glance at the modal header tells you what to answer without
                scrolling the terminal. */}
            {win.pendingInput && win.agent?.action && (
              <span className="term-action" title={win.agent.action}>
                {win.agent.action}
              </span>
            )}
          </div>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            title={conn === "live" ? "Close (Esc Esc)" : "Close (Esc)"}
          >
            <Icon name="x" />
          </button>
        </div>
        <div
          className="term-body"
          ref={hostRef}
          style={{ padding: 6, background: "#282c34" }}
        />
        {prompt && (
          <PromptOverlay
            prompt={prompt}
            send={sendToPane}
            onEscape={() => handleEscRef.current()}
          />
        )}
        <div className="term-foot">
          <span className={`connect-pill ${conn}`}>
            <span className="dot" /> {CONN_LABEL[conn]}
          </span>
          {conn === "disconnected" && (
            <button
              className="btn btn-ghost btn-reconnect"
              onClick={() => manualReconnectRef.current()}
              title="Open a fresh WebSocket"
            >
              Reconnect
            </button>
          )}
          <span className="term-cwd">{win.cwd || "—"}</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          {onKill && (
            <button
              className="btn btn-danger"
              onClick={(e) => onKill(win, e.shiftKey)}
              title="Kill this window (shift-click to skip confirm)"
            >
              <Icon name="trash" size={12} />
              <span>Kill window</span>
            </button>
          )}
          <span className="term-zoom" aria-label="Font zoom">
            <span className="term-cluster-label">Zoom</span>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={terminalFontSize <= TERM_FONT_MIN}
              title="Zoom out (⌘-)"
            >
              <Icon name="minus" size={12} />
            </button>
            <button
              className="zoom-level"
              onClick={zoomReset}
              title="Reset zoom (⌘0)"
            >
              {zoomPct}%
            </button>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={terminalFontSize >= TERM_FONT_MAX}
              title="Zoom in (⌘=)"
            >
              <Icon name="plus" size={12} />
            </button>
          </span>
          <span className="term-zoom" aria-label="Pane size">
            <span className="term-cluster-label">Size</span>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => sizeStep(-1)}
              disabled={atNarrow}
              title={`Narrower pane (current: ${columnSize})`}
              aria-label="Narrower pane"
            >
              <Icon name="minus" size={12} />
            </button>
            <button
              className="zoom-level"
              onClick={sizeReset}
              title="Reset to normal"
            >
              {columnSize}
            </button>
            <button
              className="btn btn-icon btn-ghost"
              onClick={() => sizeStep(1)}
              disabled={atWide}
              title={`Wider pane (current: ${columnSize})`}
              aria-label="Wider pane"
            >
              <Icon name="plus" size={12} />
            </button>
          </span>
          <span className="hint">
            {conn === "live" ? "Esc to pane · Esc Esc to close" : "Esc to close"}
          </span>
        </div>
      </div>
    </div>
  );
}
