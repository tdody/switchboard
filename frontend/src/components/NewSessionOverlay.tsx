import { useEffect, useRef, useState } from "react";
import { createSession } from "../api/client";
import { useSetting } from "../lib/settings";
import { useScrimClose } from "../lib/useScrimClose";
import { Icon } from "./Icon";

interface Props {
  /** Names of existing tmux sessions; used for client-side duplicate detection
   *  so we can disable the Create button instead of round-tripping for a 409. */
  existingNames: string[];
  onClose: () => void;
  onApplied: () => void;
}

/**
 * Prompt for a new tmux session name, then `new-session -d`. Mirrors
 * NewWindowOverlay's layout/keyboard model (⏎ apply, esc cancel). The server
 * starts a fresh tmux daemon if one isn't running, so this also works from
 * the empty state (THI-144).
 */
export function NewSessionOverlay({ existingNames, onClose, onApplied }: Props) {
  const scrimProps = useScrimClose(onClose);
  // THI-244: prefill with the configured Default directory; the user can
  // override per-modal without mutating the saved setting.
  const defaultDirectory = useSetting("defaultDirectory");
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState(defaultDirectory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const duplicate = trimmed !== "" && existingNames.includes(trimmed);
  const disabled = busy || trimmed === "" || duplicate;

  const apply = async () => {
    if (!trimmed) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createSession(trimmed, cwd.trim() || undefined);
    setBusy(false);
    if (result === "ok") {
      onApplied();
      onClose();
    } else if (result === "in-use") {
      setError("Name already in use");
    } else {
      setError("Couldn't create session");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!disabled) void apply();
    }
  };

  return (
    <div className="scrim" {...scrimProps}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="rename-hd">
          <Icon name="plus" />
          <b>New session</b>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn btn-icon btn-ghost" onClick={onClose} title="Cancel (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="rename-body">
          <div className="rename-row">
            <span className="lbl">name</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. main, feat, scratch"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {/* THI-244: one-shot cwd override. Prefilled with the configured
           *  Default directory; blank means "let the server pick". */}
          <div className="rename-row">
            <span className="lbl">cwd</span>
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder={
                defaultDirectory || "leave blank, or ~/dev or absolute path"
              }
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {duplicate && !error && (
            <div className="rename-error">Name already in use</div>
          )}
          {error && <div className="rename-error">{error}</div>}
        </div>
        <div className="rename-foot">
          <span className="hint">⏎ create · esc cancel</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={disabled}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
