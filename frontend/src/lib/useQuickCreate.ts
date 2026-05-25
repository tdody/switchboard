import { useCallback, useRef, useState } from "react";
import { createWindowWithBoot } from "../api/client";

/** Minimum time the +claude / +shell buttons stay locked after a click, even
 *  if the create round-trip resolves faster. On localhost the fetch is
 *  ~20–50 ms, which is well under the OS double-click interval (~300 ms on
 *  macOS / Windows), so without this floor the button re-enables in time to
 *  catch the second click of a double-click gesture and spawn a duplicate
 *  window. 500 ms gives a comfortable margin without feeling sluggish. */
const MIN_LOCK_MS = 500;

export interface UseQuickCreateResult {
  /** Sessions with an in-flight create. Drives the +claude / +shell buttons'
   *  visual disabled state in the kanban header (THI-115). */
  quickCreating: Set<string>;
  /** Async one-click new-window. `mode="claude"` autotypes `claude\n` to boot
   *  Claude Code; `mode="shell"` leaves a bare prompt. */
  handleQuickCreate: (session: string, mode: "claude" | "shell") => Promise<void>;
}

/** One-click new-window handler for the kanban header (THI-115).
 *
 *  Two guards stacked: `inFlightRef` (synchronous) catches the case where two
 *  click handlers run before React can commit the disabled state — the
 *  second invocation bails before `createWindowWithBoot` fires. The
 *  MIN_LOCK_MS cooldown holds the lock for ~one double-click window even if
 *  the fetch completed in single-digit ms — without it, the localhost
 *  round-trip releases the lock before the user's second click of a
 *  double-click arrives, and the duplicate slips through. `quickCreating`
 *  state shadows the ref so the button renders `disabled` while locked. */
export function useQuickCreate(refresh: () => void): UseQuickCreateResult {
  const [quickCreating, setQuickCreating] = useState<Set<string>>(() => new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  const handleQuickCreate = useCallback(
    async (session: string, mode: "claude" | "shell") => {
      if (inFlightRef.current.has(session)) return;
      inFlightRef.current.add(session);
      setQuickCreating((prev) => {
        const next = new Set(prev);
        next.add(session);
        return next;
      });
      const start = Date.now();
      try {
        await createWindowWithBoot(session, mode);
        refresh();
      } finally {
        const elapsed = Date.now() - start;
        if (elapsed < MIN_LOCK_MS) {
          await new Promise<void>((r) => setTimeout(r, MIN_LOCK_MS - elapsed));
        }
        inFlightRef.current.delete(session);
        setQuickCreating((prev) => {
          if (!prev.has(session)) return prev;
          const next = new Set(prev);
          next.delete(session);
          return next;
        });
      }
    },
    [refresh],
  );

  return { quickCreating, handleQuickCreate };
}
