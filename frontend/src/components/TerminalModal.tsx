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
import { comboBytes, escAction } from "../lib/termKeys";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";

interface Props {
  window: Window;
  onClose: () => void;
  onToast: (message: string) => void;
}

type Connection = "connecting" | "live" | "closed" | "snapshot";

const CONN_LABEL: Record<Connection, string> = {
  connecting: "connecting",
  live: "WS · live",
  closed: "closed",
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
  const [conn, setConn] = useState<Connection>("connecting");
  const { wsStreamEnabled: wsEnabled, terminalFontSize } = useSettings();

  // The construction effect below seeds the terminal's initial fontSize from
  // this ref rather than depending on `terminalFontSize` directly — otherwise
  // every zoom step would tear down and rebuild the terminal, dropping the
  // scrollback and WS connection. A separate effect handles live changes.
  const fontSizeRef = useRef(terminalFontSize);
  fontSizeRef.current = terminalFontSize;

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      // Ghostty's default font is JetBrains Mono — matches the user's terminal.
      fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace",
      fontSize: fontSizeRef.current,
      lineHeight: 1.2,
      convertEol: true,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
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
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* layout not ready yet */
    }
    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* layout transient */
      }
    };
    globalThis.addEventListener("resize", onResize);

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

    if (wsEnabled) {
      ws = openPaneWS(win.session, win.index);
      wsRef.current = ws;
      ws.onopen = () => setConn("live");
      ws.onmessage = (ev) => {
        const data = ev.data;
        if (typeof data === "string") term.write(data);
        else if (data instanceof ArrayBuffer) term.write(new Uint8Array(data));
      };
      ws.onclose = () => setConn("closed");
      ws.onerror = () => setConn("closed");
      const sock = ws;
      dataSub = term.onData((d) => {
        if (sock.readyState === WebSocket.OPEN) sock.send(d);
      });
    } else {
      // Live streaming disabled in settings — show a one-shot snapshot (read-only).
      setConn("snapshot");
      void fetchPane(win.session, win.index).then((lines) => {
        if (!cancelled) term.write(lines.join("\r\n") + (lines.length ? "\r\n" : ""));
      });
    }

    return () => {
      cancelled = true;
      globalThis.removeEventListener("resize", onResize);
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
        /* layout transient */
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
  }, [win.kind, win.session, win.index, onToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ws = wsRef.current;
      const live = ws !== null && ws.readyState === WebSocket.OPEN;

      if (e.key === "Escape") {
        // Double-Esc closes the modal; a single Esc is forwarded to the pane.
        // With no live socket (snapshot mode) there's nothing to interrupt — Esc
        // just closes.
        if (live && ws && escAction(Date.now(), lastEscRef.current) === "send") {
          e.preventDefault();
          ws.send("\x1b");
          lastEscRef.current = Date.now();
        } else {
          onClose();
        }
        return;
      }

      // ⌘=/⌘-/⌘0 zoom. The browser binds these to page zoom, so preventDefault.
      // ⌘+ is physically ⌘⇧= on most layouts — match the unshifted "=".
      if (e.metaKey && (e.key === "=" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        if (e.key === "0") {
          updateSettings({ terminalFontSize: TERM_FONT_DEFAULT });
        } else {
          const delta = e.key === "=" ? ZOOM_STEP : -ZOOM_STEP;
          updateSettings({ terminalFontSize: clampFont(fontSizeRef.current + delta) });
        }
        return;
      }

      // ⌘-combo line editing → control bytes forwarded to the pane.
      if (live && ws) {
        const bytes = comboBytes(e);
        if (bytes !== null) {
          e.preventDefault();
          ws.send(bytes);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          <button className="btn btn-icon btn-ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div
          className="term-body"
          ref={hostRef}
          style={{ padding: 6, background: "#282c34" }}
        />
        <div className="term-foot">
          <span className={`connect-pill ${conn}`}>
            <span className="dot" /> {CONN_LABEL[conn]}
          </span>
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
          <span className="hint">Esc to close</span>
        </div>
      </div>
    </div>
  );
}
