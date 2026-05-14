import { useEffect, useRef, useState } from "react";
import { FitAddon } from "xterm-addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

import { openPaneWS } from "../api/client";
import type { Window } from "../types";
import { Icon } from "./Icon";
import { StatusPill } from "./StatusPill";

interface Props {
  window: Window;
  onClose: () => void;
}

type Connection = "connecting" | "live" | "closed";

export function TerminalModal({ window: win, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [conn, setConn] = useState<Connection>("connecting");

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      convertEol: true,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#050608",
        foreground: "#d6d9e0",
        cursor: "#9aff9a",
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

    const ws = openPaneWS(win.session, win.index);
    wsRef.current = ws;
    ws.onopen = () => setConn("live");
    ws.onmessage = (ev) => {
      const data = ev.data;
      if (typeof data === "string") term.write(data);
      else if (data instanceof ArrayBuffer) term.write(new Uint8Array(data));
    };
    ws.onclose = () => setConn("closed");
    ws.onerror = () => setConn("closed");

    const dataSub = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(d);
    });

    return () => {
      globalThis.removeEventListener("resize", onResize);
      dataSub.dispose();
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      term.dispose();
    };
  }, [win.paneId, win.session, win.index]);

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
        <div className="term-body" ref={hostRef} style={{ padding: 6 }} />
        <div className="term-foot">
          <span className={`connect-pill ${conn}`}>
            <span className="dot" /> {conn === "live" ? "WS · live" : conn}
          </span>
          <span className="term-cwd">{win.cwd || "—"}</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <span className="hint">Esc to close</span>
        </div>
      </div>
    </div>
  );
}
