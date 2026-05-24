import { useCallback, useEffect, useState } from "react";

import { autoRenameSession, renameWindow } from "../api/client";
import { formatCost } from "../lib/formatCost";
import type { RenameSuggestion, Usage } from "../types";
import { Icon } from "./Icon";

interface Props {
  session: string;
  onClose: () => void;
  /** Called after at least one rename was applied — parent should refresh
   *  /api/state so the new window names appear in the kanban immediately. */
  onApplied: () => void;
  /** Opens the Settings modal — used by the "configure key" CTA when the
   *  backend reports 503 (no Anthropic key set). */
  onOpenSettings: () => void;
}

interface Row {
  index: number;
  old: string;
  /** The model's original suggestion — preserved separately from `edited`
   *  so the user can revert their edit by typing back to the suggestion. */
  suggested: string;
  /** Currently-staged name. Either equals `suggested` (untouched) or the
   *  user's edit. Sent to /api/rename on apply (skip rows aren't sent). */
  edited: string;
  /** True by default; flipped off via the skip button. Rows where suggested
   *  == old also implicitly skip (no-op renames). */
  accepted: boolean;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; rows: Row[]; usage: Usage }
  | { kind: "no-key" }
  | { kind: "error"; message: string };

/**
 * Auto-rename modal (THI-67). Fetches per-window suggestions from
 * `/api/auto-rename-session`, lets the user accept / edit / skip each row,
 * then calls the existing `/api/rename` per accepted row to apply.
 *
 * Stacked-row layout: old and new each take a full row, so a long name on
 * either side never crowds out the other. Skip button on the right; cost +
 * accepted-count footer below.
 */
export function AutoRenameModal({ session, onClose, onApplied, onOpenSettings }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [applying, setApplying] = useState(false);
  const [perRowError, setPerRowError] = useState<Record<number, string>>({});

  // Fetch suggestions on mount. Re-runs only if the modal re-opens against
  // a different session (parent unmounts on close, so this is effectively
  // mount-only in practice).
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void autoRenameSession(session).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setState({
          kind: "ready",
          rows: res.data.suggestions.map((s: RenameSuggestion) => ({
            index: s.index,
            old: s.old,
            suggested: s.suggested,
            edited: s.suggested,
            // Auto-accept rows that actually changed; rows where the model
            // returned the same name are pre-skipped (renaming X to X would
            // be a no-op on the backend anyway).
            accepted: s.suggested.trim() !== "" && s.suggested !== s.old,
          })),
          usage: res.data.usage,
        });
      } else if (res.status === 503) {
        setState({ kind: "no-key" });
      } else {
        setState({ kind: "error", message: res.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  // Esc to close, ⌘⏎ to apply. Mounted only while the modal is open so we
  // don't compete with the global hotkeys when settings / etc. are up.
  const ready = state.kind === "ready";
  const acceptedCount = ready ? state.rows.filter((r) => r.accepted).length : 0;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && acceptedCount > 0) {
        e.preventDefault();
        void doApply();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedCount, onClose]);

  const toggleSkip = useCallback((idx: number) => {
    setState((cur) => {
      if (cur.kind !== "ready") return cur;
      return {
        ...cur,
        rows: cur.rows.map((r) => (r.index === idx ? { ...r, accepted: !r.accepted } : r)),
      };
    });
  }, []);

  const editName = useCallback((idx: number, value: string) => {
    setState((cur) => {
      if (cur.kind !== "ready") return cur;
      return {
        ...cur,
        rows: cur.rows.map((r) => (r.index === idx ? { ...r, edited: value } : r)),
      };
    });
  }, []);

  const doApply = useCallback(async () => {
    if (state.kind !== "ready" || applying) return;
    setApplying(true);
    setPerRowError({});
    const errors: Record<number, string> = {};
    let appliedAny = false;
    // Sequential apply — tmux renames are fast but concurrent rename-window
    // calls against the same session occasionally clobber each other. ~50 ms
    // each → 500 ms for a 10-window batch. Acceptable.
    for (const row of state.rows) {
      if (!row.accepted) continue;
      const newName = row.edited.trim();
      if (!newName || newName === row.old) continue;
      const ok = await renameWindow(session, row.index, newName);
      if (ok) {
        appliedAny = true;
      } else {
        errors[row.index] = "rename failed";
      }
    }
    setApplying(false);
    setPerRowError(errors);
    if (Object.keys(errors).length === 0) {
      // Full success → notify parent (which refreshes state + closes).
      if (appliedAny) onApplied();
      onClose();
    } else if (appliedAny) {
      // Partial success — keep the modal open so the user can see which
      // rows failed; still refresh so the successful renames show in the
      // kanban behind the modal.
      onApplied();
    }
  }, [state, applying, session, onApplied, onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="auto-rename-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="rename-title"
      >
        <div className="auto-rename-hd">
          <Icon name="sparkle" size={14} />
          <span id="rename-title">
            Auto-rename windows in <b>{session}</b>
          </span>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            title="Close (Esc)"
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="auto-rename-body">
          {state.kind === "loading" && (
            <div className="auto-rename-empty">
              <Icon name="spinner" />
              <span>Asking Claude Haiku for ideas…</span>
            </div>
          )}

          {state.kind === "no-key" && (
            <div className="auto-rename-empty">
              <p>
                Auto-rename needs an Anthropic API key. Add one in Settings, then
                try again.
              </p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
              >
                Open Settings
              </button>
            </div>
          )}

          {state.kind === "error" && (
            <div className="auto-rename-empty">
              <p>Couldn't get suggestions.</p>
              <div className="auto-rename-err">{state.message}</div>
            </div>
          )}

          {state.kind === "ready" && (
            <ul className="auto-rename-rows">
              {state.rows.map((r) => {
                const isNoOp = r.suggested === r.old;
                const err = perRowError[r.index];
                const rowClass =
                  `auto-rename-row${r.accepted ? "" : " skipped"}` +
                  (isNoOp ? " noop" : "") +
                  (err ? " errored" : "");
                return (
                  <li key={r.index} className={rowClass}>
                    <span className="idx">:{r.index}</span>
                    <div className="lines">
                      <div className="from">
                        <span className="tag">from</span>
                        <span className="name">{r.old}</span>
                      </div>
                      <div className="to">
                        <span className="tag">to</span>
                        {r.accepted && !isNoOp ? (
                          <input
                            type="text"
                            value={r.edited}
                            onChange={(e) => editName(r.index, e.target.value)}
                            aria-label={`New name for window ${r.index}`}
                          />
                        ) : (
                          <span className="name">{r.suggested}</span>
                        )}
                      </div>
                      {err && <div className="row-err">{err}</div>}
                    </div>
                    <button
                      className="skip"
                      onClick={() => toggleSkip(r.index)}
                      title={r.accepted ? "Skip this row" : "Include this row"}
                      disabled={isNoOp}
                    >
                      {r.accepted ? "skip" : "include"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {state.kind === "ready" && (
          <div className="auto-rename-foot">
            <span className="hint">
              {acceptedCount} of {state.rows.length} accepted
            </span>
            <span className="sep">·</span>
            <span className="cost">
              {formatCost(
                state.usage.estCostUsd,
                state.usage.inputTokens + state.usage.outputTokens,
              )}
            </span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={onClose} disabled={applying}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => void doApply()}
              disabled={acceptedCount === 0 || applying}
            >
              {applying ? "Applying…" : `Apply ${acceptedCount}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
