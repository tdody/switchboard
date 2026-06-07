import { useEffect, useRef, useState } from "react";

import { searchPanes } from "../api/client";
import { useScrimClose } from "../lib/useScrimClose";
import type { SearchMatch } from "../types";
import { Icon } from "./Icon";

interface Props {
  onClose: () => void;
  /** Called with a match's `paneId` when the user clicks a result.
   *  The parent looks up the matching `Window` and opens its terminal modal. */
  onOpenMatch: (paneId: string) => void;
}

const DEBOUNCE_MS = 200;

/**
 * THI-100: full-text pane history search. Live, debounced search across
 * every pane's capture buffer; click a result to open that pane's terminal
 * modal. (Scrolling-to-line is a follow-up; the initial drop just opens the
 * pane at its default position.)
 */
export function SearchModal({ onClose, onOpenMatch }: Props) {
  const scrimProps = useScrimClose(onClose);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced fetch. Aborts the in-flight request when the user keeps typing
  // so a slow response doesn't overwrite the latest one.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setMatches([]);
      setTruncated(false);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchPanes(trimmed, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setMatches(result.matches);
          setTruncated(result.truncated === true);
          setLoading(false);
        }
      } catch {
        if (!ctrl.signal.aborted) {
          setMatches([]);
          setTruncated(false);
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="scrim" {...scrimProps}>
      <div
        className="search-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="search-hd">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search every pane's history…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="search-count">
            {loading ? "…" : matches.length > 0 ? matches.length : ""}
          </span>
          <button
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            title="Close (Esc)"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="search-body">
          {truncated && (
            <div className="search-truncated" role="status">
              Showing the first {matches.length} matches — narrow your query to see more.
            </div>
          )}
          {matches.length === 0 && query.trim() && !loading ? (
            <div className="search-empty">No matches.</div>
          ) : (
            matches.map((m) => (
              <button
                key={`${m.paneId}:${m.lineNumber}`}
                className="search-result"
                onClick={() => onOpenMatch(m.paneId)}
              >
                <span className="search-result-where">
                  <span className="sess">{m.session}</span>
                  <span className="sep">/</span>
                  <span className="win">{m.windowName}</span>
                  <span className="sep">·</span>
                  <span className="line">line {m.lineNumber}</span>
                </span>
                <span className="search-result-match">{m.context[1]}</span>
                {(m.context[0] || m.context[2]) && (
                  <span className="search-result-ctx">
                    {m.context[0] && <span className="above">{m.context[0]}</span>}
                    {m.context[2] && <span className="below">{m.context[2]}</span>}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
        <div className="search-foot">
          <span className="hint">⏎ open · esc close</span>
        </div>
      </div>
    </div>
  );
}
