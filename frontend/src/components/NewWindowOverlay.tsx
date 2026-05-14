import { useEffect, useRef, useState } from "react";
import { createWindow } from "../api/client";
import { Icon } from "./Icon";

interface Props {
  session: string;
  onClose: () => void;
  onApplied: () => void;
}

/**
 * Prompt for a new tmux window's name, then `new-window` in `session`.
 * Mirrors RenameOverlay's layout/keyboard model (⏎ apply, esc cancel).
 */
export function NewWindowOverlay({ session, onClose, onApplied }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const apply = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const created = await createWindow(session, trimmed);
    setBusy(false);
    if (created) {
      onApplied();
      onClose();
    } else {
      setError("Couldn't create window");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void apply();
    }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="rename-hd">
          <Icon name="plus" />
          <b>New window in {session}</b>
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
              placeholder="e.g. dev, tests, logs"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {error && <div className="rename-error">{error}</div>}
        </div>
        <div className="rename-foot">
          <span className="hint">⏎ create · esc cancel</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={busy}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
