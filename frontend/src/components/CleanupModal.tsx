import { useCallback, useEffect, useMemo, useState } from "react";

import { killWindow } from "../api/client";
import {
  computeCandidates,
  defaultChecked,
  isMidTurn,
  lastWindowSessions,
} from "../lib/cleanupCandidates";
import { useScrimClose } from "../lib/useScrimClose";
import type { Window } from "../types";
import { AgoSpan } from "./AgoSpan";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";

interface Props {
  windows: Window[];
  pinnedIds: Set<string>;
  thresholdDays: number;
  onClose: () => void;
  onLowerThreshold?: () => void;
  onAfterCleanup?: (summary: { ok: number; failed: number }) => void;
}

type Step = "review" | "confirm";

export function CleanupModal({
  windows,
  pinnedIds,
  thresholdDays,
  onClose,
  onLowerThreshold,
  onAfterCleanup,
}: Props) {
  // Capture pollNow ONCE at mount so the candidate list doesn't churn while
  // the user is reading it. A background /api/state poll arriving later
  // won't re-filter the rows.
  const [pollNow] = useState<number>(() => Date.now());

  const candidates = useMemo(
    () => computeCandidates(windows, pollNow, thresholdDays),
    // `windows` is intentionally not in deps after the first computation —
    // see snapshot stability invariant. We re-compute only if pollNow or
    // thresholdDays changes (neither does during the modal's lifetime).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pollNow, thresholdDays],
  );

  const [checked, setChecked] = useState<Set<string>>(
    () =>
      new Set(candidates.filter((w) => defaultChecked(w, pinnedIds)).map((w) => w.paneId)),
  );

  const [step, setStep] = useState<Step>("review");

  // Scrim click must match the Esc + × button contract:
  // Step 1 closes the modal; Step 2 returns to Step 1.
  const handleScrimClose = useCallback(() => {
    if (step === "confirm") setStep("review");
    else onClose();
  }, [step, onClose]);
  const scrimProps = useScrimClose(handleScrimClose);
  const [snapshot, setSnapshot] = useState<Window[]>([]);
  const [snapshotAllWindows, setSnapshotAllWindows] = useState<Window[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (step === "confirm") setStep("review");
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  function toggle(paneId: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(paneId)) next.delete(paneId);
      else next.add(paneId);
      return next;
    });
  }

  function goToConfirm() {
    // Defense-in-depth: the UI hides the trigger when no candidates exist,
    // but a future caller / programmatic invocation must not advance to a
    // "Close 0 panes?" confirm screen.
    if (candidates.length === 0) return;
    const sel = candidates.filter((w) => checked.has(w.paneId));
    setSnapshot(sel);
    setSnapshotAllWindows(windows);
    setStep("confirm");
  }

  async function executeKills() {
    const results = await Promise.allSettled(
      snapshot.map((w) => killWindow(w.session, w.index)),
    );
    let ok = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value === true) ok++;
      else failed++;
    }
    onAfterCleanup?.({ ok, failed });
    onClose();
  }

  const selectedCount = checked.size;
  const reviewSession = lastWindowSessions(snapshot, snapshotAllWindows);

  return (
    <div className="scrim" {...scrimProps}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-hd">
          <SwitchboardMark size={22} />
          <span>{step === "review" ? "Clean up idle panes" : `Close ${snapshot.length} panes?`}</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-icon btn-ghost"
            onClick={step === "confirm" ? () => setStep("review") : onClose}
            title={step === "confirm" ? "Back (Esc)" : "Close (Esc)"}
          >
            <Icon name="x" />
          </button>
        </div>

        {step === "review" && (
          <ReviewStep
            candidates={candidates}
            checked={checked}
            pinnedIds={pinnedIds}
            thresholdDays={thresholdDays}
            onToggle={toggle}
            onLowerThreshold={onLowerThreshold}
          />
        )}

        {step === "confirm" && (
          <ConfirmStep snapshot={snapshot} lastWindowSessions={reviewSession} />
        )}

        <div className="rename-foot" style={{ borderTop: "1px solid var(--hairline)" }}>
          {step === "review" ? (
            <>
              <span className="term-spacer" style={{ flex: 1 }} />
              <button className="btn" onClick={onClose}>Cancel</button>
              {candidates.length > 0 && (
                <button
                  className="btn btn-primary"
                  disabled={selectedCount === 0}
                  onClick={goToConfirm}
                >
                  Review {selectedCount} selected →
                </button>
              )}
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setStep("review")}>← Back</button>
              <span className="term-spacer" style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={() => void executeKills()}>
                Confirm close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewStep({
  candidates,
  checked,
  pinnedIds,
  thresholdDays,
  onToggle,
  onLowerThreshold,
}: {
  candidates: Window[];
  checked: Set<string>;
  pinnedIds: Set<string>;
  thresholdDays: number;
  onToggle: (paneId: string) => void;
  onLowerThreshold?: () => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="settings-body">
        <div className="settings-group cleanup-empty">
          <p className="desc">
            No panes idle for more than {thresholdDays} days.
          </p>
          {onLowerThreshold && (
            <button className="btn btn-ghost" onClick={onLowerThreshold}>
              ↓ Lower threshold
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="settings-body">
      <div className="settings-group">
        <p className="desc">
          Threshold: {thresholdDays} days · {candidates.length} candidates
        </p>
        <ul className="cleanup-list">
          {candidates.map((w) => {
            const reason = pinnedIds.has(w.paneId)
              ? "pinned"
              : isMidTurn(w)
                ? "agent active"
                : null;
            return (
              <li key={w.paneId} className="cleanup-row">
                <label>
                  <input
                    type="checkbox"
                    checked={checked.has(w.paneId)}
                    onChange={() => onToggle(w.paneId)}
                  />
                  <span className="cleanup-session">{w.session}</span>
                  <span className="cleanup-sep">·</span>
                  <span className="cleanup-name">{w.name}</span>
                  <Icon name={w.kind} />
                  <AgoSpan ts={w.lastActivity} />
                  {reason && <span className="cleanup-reason">ⓘ {reason}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ConfirmStep({
  snapshot,
  lastWindowSessions: lastSessions,
}: {
  snapshot: Window[];
  lastWindowSessions: string[];
}) {
  return (
    <div className="settings-body">
      <div className="settings-group">
        <p className="desc">These {snapshot.length} panes will be closed:</p>
        <ul className="cleanup-list">
          {snapshot.map((w) => (
            <li key={w.paneId} className="cleanup-row">
              <span className="cleanup-session">{w.session}</span>
              <span className="cleanup-sep">·</span>
              <span className="cleanup-name">{w.name}</span>
              <Icon name={w.kind} />
              <AgoSpan ts={w.lastActivity} />
            </li>
          ))}
        </ul>
        {lastSessions.length > 0 && (
          <p className="desc cleanup-warn">
            ⓘ Closing the last window in a session also closes the session. This applies to:{" "}
            {lastSessions.join(", ")}.
          </p>
        )}
      </div>
    </div>
  );
}
