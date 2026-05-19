import { useEffect, useRef } from "react";
import type { Prompt } from "../lib/prompt";
import { arrowSteps } from "../lib/prompt";

interface Props {
  prompt: Prompt;
  /** Send a raw frame to the pane WS: a `{"signal":...}` JSON string, or literal text. */
  send: (data: string) => void;
  /** Modal's Esc handler — same single-to-pane / double-to-close semantics as
   *  xterm focus. Routed through the modal so a tap on the overlay can be the
   *  second tap of a pair that started on the terminal (and vice versa). */
  onEscape: () => void;
}

const signal = (s: string): string => JSON.stringify({ signal: s });

/** ms within which a second Enter is ignored, so mashing can't skip prompts. */
const COMMIT_DEBOUNCE = 300;

export function PromptOverlay({ prompt, send, onEscape }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastCommit = useRef(0);

  // Take focus so ↑/↓/Enter hit this handler, not xterm underneath.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => {
    const now = Date.now();
    if (now - lastCommit.current < COMMIT_DEBOUNCE) return;
    lastCommit.current = now;
    send(signal("Enter"));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      send(signal("Up"));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      send(signal("Down"));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (prompt.kind === "yn" && (e.key === "y" || e.key === "Y")) {
      e.preventDefault();
      e.stopPropagation();
      send("y");
    } else if (prompt.kind === "yn" && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      e.stopPropagation();
      send("n");
    }
  };

  const selectedPos = prompt.choices.findIndex((c) => c.selected);

  return (
    <div
      className={`prompt-overlay prompt-${prompt.kind}`}
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="group"
      aria-label="Claude Code prompt"
    >
      {prompt.question && <div className="prompt-q">{prompt.question}</div>}

      {prompt.kind === "menu" && (
        <ul className="prompt-choices" role="listbox" aria-label="Choices">
          {prompt.choices.map((c, pos) => (
            <li
              key={c.index}
              role="option"
              aria-selected={c.selected}
              className={`prompt-choice${c.selected ? " selected" : ""}`}
              onClick={() => {
                for (const s of arrowSteps(selectedPos, pos)) send(signal(s));
              }}
            >
              <span className="prompt-cursor">{c.selected ? "❯" : " "}</span>
              <span className="prompt-num">{c.index}.</span>
              <span className="prompt-label">{c.label}</span>
            </li>
          ))}
        </ul>
      )}

      {prompt.kind === "yn" && (
        <div className="prompt-buttons">
          <button className="btn" onClick={() => send("y")}>
            Yes
          </button>
          <button className="btn" onClick={() => send("n")}>
            No
          </button>
        </div>
      )}

      {prompt.kind === "enter" && (
        <div className="prompt-buttons">
          <button className="btn" onClick={() => send(signal("Enter"))}>
            Continue
          </button>
        </div>
      )}

      <div className="prompt-hint">
        {prompt.kind === "menu"
          ? "↑↓ move · Enter confirm · click to jump"
          : prompt.kind === "yn"
            ? "Press Y or N"
            : "Press Enter"}
      </div>
    </div>
  );
}
