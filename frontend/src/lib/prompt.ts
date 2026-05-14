export type PromptKind = "menu" | "yn" | "enter";

export interface PromptChoice {
  index: number; // 1-based, as Claude Code numbers the menu
  label: string;
  selected: boolean; // the choice currently bearing the ❯ cursor
}

export interface Prompt {
  kind: PromptKind;
  question: string | null;
  choices: PromptChoice[]; // empty for "enter"
}

/**
 * Parse a server→client WebSocket text frame.
 *  - `undefined` → not a prompt control message (i.e. plain terminal output)
 *  - `null`      → a prompt control message that clears the prompt
 *  - `Prompt`    → a prompt control message with an active prompt
 */
export function parsePromptMessage(raw: string): Prompt | null | undefined {
  if (!raw.startsWith("{")) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { type?: unknown }).type !== "prompt"
  ) {
    return undefined;
  }
  const prompt = (parsed as { prompt?: unknown }).prompt;
  if (prompt === null || prompt === undefined) return null;
  return prompt as Prompt;
}

/**
 * The sequence of "Up"/"Down" tmux signals to move the menu cursor from
 * `fromIndex` to `toIndex` (0-based positions in the choices array). Returns
 * [] for a no-op move or when the source position is unknown (-1).
 */
export function arrowSteps(fromIndex: number, toIndex: number): ("Up" | "Down")[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];
  const delta = toIndex - fromIndex;
  const dir: "Up" | "Down" = delta > 0 ? "Down" : "Up";
  return Array.from({ length: Math.abs(delta) }, () => dir);
}
