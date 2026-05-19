import { useEffect, useMemo, useRef, useState } from "react";
import { sendKeys } from "../api/client";
import type { Window } from "../types";
import { Icon, type IconName } from "./Icon";

interface Props {
  target: Window;
  onClose: () => void;
}

interface Item {
  label: string;
  hint?: string;
  icon: IconName;
  // Either a literal payload to paste (followed by Enter) or a tmux key/signal.
  paste?: string;
  enter?: boolean;
  key?: string;
}

const RECENT_COMMANDS: Item[] = [
  { label: "ls -la", hint: "list files", icon: "arrow-r", paste: "ls -la", enter: true },
  { label: "git status", hint: "git", icon: "git-branch", paste: "git status", enter: true },
  { label: "pnpm test --watch", hint: "test", icon: "play", paste: "pnpm test --watch", enter: true },
  { label: "clear", hint: "clear screen", icon: "x", paste: "clear", enter: true },
  { label: "Send Ctrl+C", hint: "interrupt", icon: "alert", key: "C-c" },
];

const AGENT_PROMPTS: Item[] = [
  { label: "y", hint: "accept", icon: "check", paste: "y", enter: true },
  { label: "n", hint: "decline", icon: "x", paste: "n", enter: true },
  { label: "continue", hint: "next step", icon: "arrow-r", paste: "continue", enter: true },
  {
    label: "look more carefully and try again",
    hint: "nudge",
    icon: "sparkle",
    paste: "look more carefully and try again",
    enter: true,
  },
];

export function CommandPalette({ target, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const items = useMemo<Item[]>(() => {
    const all = [...RECENT_COMMANDS, ...AGENT_PROMPTS];
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter(
      (it) => it.label.toLowerCase().includes(q) || it.hint?.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-clamp cursor when item list shrinks.
  useEffect(() => {
    if (cursor >= items.length) setCursor(Math.max(0, items.length - 1));
  }, [items.length, cursor]);

  const submit = async (it: Item | null) => {
    let body: { keys?: string[]; paste?: string };
    if (it) {
      if (it.key) body = { keys: [it.key] };
      else body = { paste: it.paste ?? "", keys: it.enter ? ["Enter"] : undefined };
    } else {
      // Custom: send the literal query string + Enter.
      if (!query) return;
      body = { paste: query, keys: ["Enter"] };
    }
    await sendKeys(target.session, target.index, body);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // Shift+Enter falls through to the textarea's default and inserts a
      // newline — matches Claude Code's input box and lets the backend's
      // bracket-paste path actually be exercised for multi-line blocks.
      e.preventDefault();
      void submit(items[cursor] || null);
    }
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    // Reset to single-line so shrinking on backspace works, then expand to
    // fit. Capped at ~8 lines to keep the palette compact.
    el.style.height = "auto";
    const max = 8 * 22; // ~lineHeight * 8
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  };

  // Split items back into the two sections for display
  const recentSlice = items.filter((it) => RECENT_COMMANDS.includes(it));
  const promptSlice = items.filter((it) => AGENT_PROMPTS.includes(it));

  const renderItem = (it: Item) => {
    const i = items.indexOf(it);
    return (
      <button
        key={it.label}
        className={`palette-item ${i === cursor ? "is-active" : ""}`}
        onMouseEnter={() => setCursor(i)}
        onClick={() => void submit(it)}
      >
        <Icon name={it.icon} size={13} />
        <span className="label">{it.label}</span>
        {it.hint && <span className="hint">{it.hint}</span>}
      </button>
    );
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-hd">
          <Icon name="send" />
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={`Send to ${target.session}:${target.index} ${target.name}…`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
              autoGrow(e.target);
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-body">
          {recentSlice.length > 0 && (
            <>
              <div className="palette-section">Recent commands</div>
              {recentSlice.map(renderItem)}
            </>
          )}
          {promptSlice.length > 0 && (
            <>
              <div className="palette-section">Agent prompts</div>
              {promptSlice.map(renderItem)}
            </>
          )}
          {items.length === 0 && query && (
            <div
              className="palette-section"
              style={{ padding: "12px 14px", color: "var(--text-mute)" }}
            >
              No match — press Enter to send "<b style={{ color: "var(--text)" }}>{query}</b>" verbatim.
            </div>
          )}
        </div>
        <div className="palette-foot">
          <span className="hint">↑↓ navigate · ⏎ send · esc cancel</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <span className="hint">
            target: {target.session}:{target.index}
          </span>
        </div>
      </div>
    </div>
  );
}
