import type { Window } from "../types";

/**
 * THI-97: per-kind quick actions surfaced on `WindowCard`. The whole point
 * is single-click for the things people do every day:
 *
 *   - Agent pending → `y` / `n` answers (paste letter, then Enter to submit).
 *   - Agent any state → `Ctrl-C` to interrupt a runaway or break out.
 *   - Shell → `Ctrl-L` to clear the screen.
 *
 * Deferred to follow-ups (need design beyond a single /api/send):
 *   - Server `Restart` — multi-step (Ctrl-C, wait for prompt, ↑, Enter).
 *   - Logs `Pause` / `Resume` — stateful UI toggle.
 *
 * Editor panes intentionally surface nothing — send-keys doesn't compose
 * cleanly with modal editors.
 */

interface SendPayload {
  keys?: string[];
  paste?: string;
}

export interface QuickAction {
  /** Stable id for tests, telemetry, React keys. */
  id: string;
  /** Short button label (1-3 chars; rendered inside `.act` style). */
  label: string;
  /** Tooltip text. */
  title: string;
  /** Body forwarded to `sendKeys(session, index, payload)`. */
  payload: SendPayload;
}

export function quickActionsFor(w: Window): QuickAction[] {
  switch (w.kind) {
    case "agent":
      return agentActions(w);
    case "shell":
      return [
        {
          id: "shell.clear",
          label: "⌫",
          title: "Clear screen (Ctrl-L)",
          payload: { keys: ["C-l"] },
        },
      ];
    default:
      return [];
  }
}

function agentActions(w: Window): QuickAction[] {
  const interrupt: QuickAction = {
    id: "agent.interrupt",
    label: "⎋",
    title: "Interrupt (Ctrl-C)",
    payload: { keys: ["C-c"] },
  };
  if (!w.pendingInput) return [interrupt];
  return [
    {
      id: "agent.yes",
      label: "y",
      title: "Answer y + Enter",
      payload: { paste: "y", keys: ["Enter"] },
    },
    {
      id: "agent.no",
      label: "n",
      title: "Answer n + Enter",
      payload: { paste: "n", keys: ["Enter"] },
    },
    interrupt,
  ];
}
