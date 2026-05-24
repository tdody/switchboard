/** Periscope's backoff curve: 250, 500, 1000, 2000ms, then steady 4000ms.
 *  Eight entries means eight retry attempts after the initial failure
 *  (~19.75s of total trying) before transitioning to `disconnected`. */
export const BACKOFF_MS = [250, 500, 1000, 2000, 4000, 4000, 4000, 4000] as const;

/** Decision a `ws.onclose` handler should take. Discriminated union so
 *  the caller is forced to handle every kind explicitly. */
export type CloseAction =
  | { kind: "ignore" }
  | { kind: "gone" }
  | { kind: "retry"; delayMs: number; attempt: number }
  | { kind: "exhausted" };

/** Pure policy decision: given a close event's code, the current attempt
 *  count, and whether this close was internal (intentional teardown) or
 *  stale (a socket already replaced by a newer one), decide what to do.
 *
 *  - `isIntentional` or `isStale` → ignore (teardown owns the lifecycle)
 *  - close codes 4404 / 4408 / 4410 → gone (server says pane / tmux is gone)
 *  - close code 1000 → ignore (clean shutdown initiated locally)
 *  - any other code, attempt < cap → retry with BACKOFF_MS[attempt]
 *  - any other code, attempt >= cap → exhausted (user gets a Reconnect button)
 */
export function decideCloseAction(
  closeCode: number,
  attempt: number,
  isIntentional: boolean,
  isStale: boolean,
): CloseAction {
  // Intentional teardown and stale sockets always win — even over permanent codes.
  if (isIntentional || isStale) return { kind: "ignore" };
  if (closeCode === 4404 || closeCode === 4408 || closeCode === 4410) return { kind: "gone" };
  if (closeCode === 1000) return { kind: "ignore" };
  if (attempt >= BACKOFF_MS.length) return { kind: "exhausted" };
  return { kind: "retry", delayMs: BACKOFF_MS[attempt], attempt };
}
