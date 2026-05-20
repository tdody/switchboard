import { useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

import { fetchPane, openPaneWS, pasteImage } from "../api/client";
import {
  TERM_FONT_DEFAULT,
  TERM_FONT_MAX,
  TERM_FONT_MIN,
  updateSettings,
  useSettings,
} from "../lib/settings";
import type { Window } from "../types";
import { comboBytes, escAction, newlineBytes } from "../lib/termKeys";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";
import { PromptOverlay } from "./PromptOverlay";
import { parsePromptMessage } from "../lib/prompt";
import type { Prompt } from "../lib/prompt";
import { decideCloseAction } from "../lib/wsReconnect";

interface Props {
  window: Window;
  onClose: () => void;
  onToast: (message: string) => void;
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

export function TerminalModal({ window: win, onClose, onToast }: Props) {
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
  const [conn, setConn] = useState<Connection>("connecting");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const { wsStreamEnabled: wsEnabled, terminalFontSize } = useSettings();

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
      // (Ghostty does the same minimum-contrast adjustment).
      minimumContrastRatio: 4.5,
      // Ghostty's default palette (Tomorrow Night) — a pane rendered here
      // looks the same as in the user's Ghostty window.
      theme: {
        background: "#282c34",
        foreground: "#ffffff",
        cursor: "#ffffff",
        cursorAccent: "#282c34",
        selectionBackground: "#373b41",
        black: "#1d1f21",
        red: "#cc6666",
        green: "#b5bd68",
        yellow: "#f0c674",
        blue: "#81a2be",
        magenta: "#b294bb",
        cyan: "#8abeb7",
        white: "#c5c8c6",
        brightBlack: "#666666",
        brightRed: "#d54e53",
        brightGreen: "#b9ca4a",
        brightYellow: "#e7c547",
        brightBlue: "#7aa6da",
        brightMagenta: "#c397d8",
        brightCyan: "#70c0b1",
        brightWhite: "#eaeaea",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
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
    let fitTimer: number | undefined;
    const scheduleFit = () => {
      window.clearTimeout(fitTimer);
      fitTimer = window.setTimeout(() => {
        try {
          fit.fit();
        } catch {
          return;
        }
        sendSize();
      }, 80);
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
        if (typeof data === "string") {
          const parsed = parsePromptMessage(data);
          if (parsed !== undefined) {
            setPrompt(parsed);
            return;
          }
          term.write(data);
        } else if (data instanceof ArrayBuffer) {
          term.write(new Uint8Array(data));
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
        if (!cancelled) term.write(lines.join("\r\n") + (lines.length ? "\r\n" : ""));
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
      window.clearTimeout(fitTimer);
      viewport?.removeEventListener("scroll", onScroll);
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

  return (
    <div className="scrim" onClick={onClose}>
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
            {win.agent?.branch && (
              <span className="chip branch-pr">
                <Icon name="git-branch" size={10} />
                <span>{win.agent.branch}</span>
              </span>
            )}
            <StatusPill status={win.status} />
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
          <span className="term-zoom">
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
          <span className="hint">
            {conn === "live" ? "Esc to pane · Esc Esc to close" : "Esc to close"}
          </span>
        </div>
      </div>
    </div>
  );
}
