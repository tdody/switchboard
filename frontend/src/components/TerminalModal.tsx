import { useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

import { fetchPane, openPaneWS } from "../api/client";
import { useSettings } from "../lib/settings";
import type { Window } from "../types";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";

interface Props {
  window: Window;
  onClose: () => void;
}

type Connection = "connecting" | "live" | "closed" | "snapshot";

const CONN_LABEL: Record<Connection, string> = {
  connecting: "connecting",
  live: "WS · live",
  closed: "closed",
  snapshot: "snapshot",
};

export function TerminalModal({ window: win, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [conn, setConn] = useState<Connection>("connecting");
  const wsEnabled = useSettings().wsStreamEnabled;

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      // Ghostty's default font is JetBrains Mono — matches the user's terminal.
      fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace",
      fontSize: 13,
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

    let ws: WebSocket | null = null;
    let dataSub: { dispose: () => void } | null = null;
    let cancelled = false;

    if (wsEnabled) {
      ws = openPaneWS(win.session, win.index);
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
      dataSub?.dispose();
      if (ws) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
      term.dispose();
    };
  }, [win.paneId, win.session, win.index, wsEnabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          <span className="hint">Esc to close</span>
        </div>
      </div>
    </div>
  );
}
