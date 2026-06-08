import { useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { WebLinksAddon } from "xterm-addon-web-links";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

import { fetchPane, openInIde, openPaneWS, pasteImage } from "../api/client";
import { filePathLinkProvider } from "../lib/filePathLinks";
import { prNumberLinkProvider } from "../lib/prNumberLinks";
import {
  TERM_FONT_DEFAULT,
  TERM_FONT_MAX,
  TERM_FONT_MIN,
  updateSettings,
  useSetting,
} from "../lib/settings";
import type { Window } from "../types";
import { comboBytes, escAction, newlineBytes } from "../lib/termKeys";
import { PromptOverlay } from "./PromptOverlay";
import { parsePromptMessage } from "../lib/prompt";
import type { Prompt } from "../lib/prompt";
import { useIdeConfig } from "../lib/useIdeConfig";
import { decideCloseAction } from "../lib/wsReconnect";
import { apply256ColorOverrides, xtermThemeFor } from "../lib/xtermThemes";
import { XtermStreamRewriter } from "../lib/xtermStreamRewriter";

export type Connection =
  | "connecting"
  | "live"
  | "reconnecting"
  | "disconnected"
  | "gone"
  | "snapshot";

/** Px the document-level ⌘=/⌘- hotkeys shift the terminal font by per press.
 *  Reused by the modal's zoom buttons too (TerminalModal imports this). */
export const ZOOM_STEP = 2;

export function clampFont(n: number): number {
  return Math.min(TERM_FONT_MAX, Math.max(TERM_FONT_MIN, n));
}

interface Props {
  window: Window;
  /** Triggered when Esc is pressed and we want to surface a parent-level
   *  close/blur. PaneTerminal owns the double-tap timing: a single Esc on a
   *  live WS forwards `\x1b` to the pane; a second Esc within the window (or
   *  any Esc in snapshot/disconnected/gone mode) invokes this callback. The
   *  modal closes; an inline detail pane could blur its terminal. */
  onEscape: () => void;
  /** Surface toast-worthy events (image-paste failures, copy notifications,
   *  IDE errors). Parent threads to its toaster. */
  onToast: (msg: string) => void;
  /** Optional: receive WS state changes so the parent can render chrome
   *  (connection pill, Reconnect button). The second arg is the
   *  manual-reconnect callback — meaningful in `disconnected`. */
  onConnectionChange?: (state: Connection, manualReconnect: () => void) => void;
}

/** The xterm.js terminal + WebSocket lifecycle for one tmux pane, lifted out
 *  of TerminalModal so it can also be embedded inline (Split view detail).
 *
 *  Responsibilities:
 *  - Construct the Terminal on mount; dispose on unmount.
 *  - Open the WebSocket and forward keystrokes; reconnect on abnormal close.
 *  - Paint the cached `preview` as a placeholder until the first snapshot.
 *  - Resize via ResizeObserver + rAF-debounced FitAddon; forward cols/rows to
 *    tmux on change.
 *  - Live zoom / live theme without rebuilding the terminal.
 *  - Render the PromptOverlay when an agent surfaces a prompt message.
 *  - Select-to-copy and image-paste-to-pane.
 *
 *  Modal-specific chrome (header chips, footer pill, zoom buttons, Kill
 *  button) stays in TerminalModal. Inline-specific chrome (Split detail
 *  header + sidebar) stays in SplitView. PaneTerminal only renders the
 *  terminal host div + PromptOverlay. */
export function PaneTerminal({ window: win, onEscape, onToast, onConnectionChange }: Props) {
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
  // is constructed; deferring callbacks through refs lets parent re-renders
  // update without tearing down the terminal + WS.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;
  // Same trick for repoUrl — the registerLinkProvider callback closes over
  // a single value at terminal-construction time, but we want a `git remote
  // set-url` (very rare) to take effect without rebuilding the terminal.
  const repoUrlRef = useRef(win.repoUrl);
  repoUrlRef.current = win.repoUrl;

  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // THI-186: subscribe per-field so unrelated settings changes don't re-render.
  const wsEnabled = useSetting("wsStreamEnabled");
  const terminalFontSize = useSetting("terminalFontSize");
  const selectedIde = useSetting("selectedIde");
  const theme = useSetting("theme");

  // IDE-launch config + click handler refs. Reading config through a ref lets
  // the linkProvider toggle live on the first /api/ide-config response without
  // rebuilding the terminal.
  const ideConfig = useIdeConfig();
  const ideEnabledRef = useRef(false);
  ideEnabledRef.current = ideConfig?.enabled === true;
  const onPathClickRef = useRef<(p: string) => void>(() => {});
  onPathClickRef.current = (path: string) => {
    void openInIde(win.session, win.index, path, selectedIde || undefined).then((status) => {
      if (status === "ok") return;
      const t = onToastRef.current;
      if (status === "disabled") {
        t("Open-in-IDE disabled — set SWITCHBOARD_IDE_CMD");
      } else if (status === "not-found") {
        t(`File not found: ${path}`);
      } else if (status === "escaped") {
        t("Path resolved outside the pane's cwd");
      } else {
        t(`Couldn't open ${path}`);
      }
    });
  };

  // Shared Esc handler — single tap on a live WS forwards `\x1b`; a quick
  // second tap (or any tap on a non-live WS) calls onEscape. The lastEscRef
  // value is shared with PromptOverlay so a tap on the overlay can be the
  // second tap of a pair started on the terminal.
  const handleEscRef = useRef(() => {});
  handleEscRef.current = () => {
    const sock = wsRef.current;
    const live = sock !== null && sock.readyState === WebSocket.OPEN;
    if (live && sock && escAction(Date.now(), lastEscRef.current) === "send") {
      sock.send("\x1b");
      lastEscRef.current = Date.now();
    } else {
      onEscapeRef.current();
    }
  };

  // The construction effect below seeds the terminal's initial fontSize from
  // these refs rather than depending on them directly — otherwise every zoom
  // step / theme swap would tear down and rebuild the terminal.
  const fontSizeRef = useRef(terminalFontSize);
  fontSizeRef.current = terminalFontSize;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  // Rewriter that catches truecolor bg escapes before they reach xterm and
  // rewrites the dark-fill ones to light pastels in light/contrast themes.
  // One instance per mount — stateful for cross-chunk escape buffering.
  const rewriterRef = useRef<XtermStreamRewriter | null>(null);
  if (rewriterRef.current === null) rewriterRef.current = new XtermStreamRewriter(theme);

  useEffect(() => {
    if (!hostRef.current) return;
    intentionalRef.current = false;
    const term = new Terminal({
      fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.2,
      convertEol: false,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      macOptionIsMeta: true,
      minimumContrastRatio: 4.5,
      theme: xtermThemeFor(themeRef.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.registerLinkProvider(
      filePathLinkProvider(
        term,
        () => ideEnabledRef.current,
        (path) => onPathClickRef.current(path),
      ),
    );
    term.registerLinkProvider(prNumberLinkProvider(term, () => repoUrlRef.current));
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        window.open(uri, "_blank", "noopener,noreferrer");
      }),
    );
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
      // surface to parent (modal closes; inline could blur). In snapshot
      // mode (no live socket) any Esc surfaces to parent immediately.
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
    apply256ColorOverrides(term, themeRef.current);
    const previewPainted = win.preview && win.preview.length > 0;
    if (previewPainted) {
      term.write(win.preview.join("\r\n") + "\r\n");
    }
    let snapshotReceived = false;
    term.focus();
    termRef.current = term;
    fitRef.current = fit;

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

    // Auto-hide scrollbar: reveal while scrolling, then fade ~800ms later.
    const host = hostRef.current;
    const viewport = host.querySelector<HTMLElement>(".xterm-viewport");
    let scrollbarTimer: number | undefined;
    const onScroll = () => {
      host.classList.add("scrolling");
      window.clearTimeout(scrollbarTimer);
      scrollbarTimer = window.setTimeout(() => host.classList.remove("scrolling"), 800);
    };
    viewport?.addEventListener("scroll", onScroll, { passive: true });

    // Select-to-copy: on mouseup with a non-empty xterm selection, copy +
    // toast. Listener is scoped to the host so it doesn't fire for
    // selections in surrounding chrome.
    const onSelectMouseUp = () => {
      const t = termRef.current;
      if (!t) return;
      const sel = t.getSelection();
      if (!sel) return;
      try {
        void navigator.clipboard.writeText(sel).then(
          () => onToastRef.current(`Copied ${sel.length} chars`),
          () => {
            /* clipboard denied / unavailable */
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

    const reportConn = (state: Connection) => {
      onConnectionChangeRef.current?.(state, manualReconnectRef.current);
    };

    function connect(isReconnect: boolean) {
      if (isReconnect) term.clear();
      reportConn(isReconnect ? "reconnecting" : "connecting");
      const sock = openPaneWS(win.session, win.index);
      ws = sock;
      wsRef.current = sock;

      sock.onopen = () => {
        if (isReconnect) {
          term.writeln("\r\n\x1b[32m[reconnected]\x1b[0m");
        }
        attemptRef.current = 0;
        noticeWrittenRef.current = false;
        reportConn("live");
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
            reportConn("gone");
            return;
          case "exhausted":
            reportConn("disconnected");
            return;
          case "retry":
            if (!noticeWrittenRef.current) {
              term.writeln("\r\n\x1b[33m[reconnecting…]\x1b[0m");
              noticeWrittenRef.current = true;
            }
            reportConn("reconnecting");
            attemptRef.current = action.attempt + 1;
            backoffTimerRef.current = window.setTimeout(() => {
              backoffTimerRef.current = null;
              if (intentionalRef.current) return;
              connect(true);
            }, action.delayMs);
            return;
        }
      };
    }

    if (wsEnabled) {
      manualReconnectRef.current = () => {
        if (backoffTimerRef.current) {
          window.clearTimeout(backoffTimerRef.current);
          backoffTimerRef.current = null;
        }
        attemptRef.current = 0;
        noticeWrittenRef.current = false;
        connect(true);
      };
      dataSub = term.onData((d) => {
        const sock = wsRef.current;
        if (sock && sock.readyState === WebSocket.OPEN) sock.send(d);
      });
      connect(false);
    } else {
      reportConn("snapshot");
      void fetchPane(win.session, win.index).then((lines) => {
        if (cancelled) return;
        if (previewPainted) term.clear();
        term.write(lines.join("\r\n") + (lines.length ? "\r\n" : ""));
      });
    }

    return () => {
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

  // Live zoom: mutate fontSize and reflow without rebuilding.
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

  // Live theme swap: re-theme the open terminal in place, no rebuild.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = xtermThemeFor(theme);
    apply256ColorOverrides(term, theme);
    rewriterRef.current?.setTheme(theme);
  }, [theme]);

  // Image paste → upload to the pane. Capture phase so we intercept before
  // xterm's own paste handling. Agent panes only.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((it) =>
        it.type.startsWith("image/"),
      );
      if (!item) return;
      if (!wsEnabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (win.kind !== "agent") {
        onToastRef.current("Image paste works only in Claude Code panes");
        return;
      }
      const blob = item.getAsFile();
      if (!blob) return;
      void pasteImage(win.session, win.index, blob).then((ok) => {
        if (!ok) onToastRef.current("Image paste failed — too large or unsupported type");
      });
    };
    host.addEventListener("paste", onPaste, true);
    return () => host.removeEventListener("paste", onPaste, true);
  }, [win.kind, win.session, win.index, wsEnabled]);

  // Document-level ⌘ zoom hotkeys. The browser binds these to page zoom, so
  // preventDefault. Works regardless of whether xterm has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

  // Return focus to the terminal when a prompt clears; the overlay grabs
  // focus itself while it is mounted.
  useEffect(() => {
    if (prompt === null) termRef.current?.focus();
  }, [prompt]);

  const sendToPane = (data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  };

  return (
    <>
      <div className="term-body" ref={hostRef} style={{ padding: 6 }} />
      {prompt && (
        <PromptOverlay
          prompt={prompt}
          send={sendToPane}
          onEscape={() => handleEscRef.current()}
        />
      )}
    </>
  );
}
