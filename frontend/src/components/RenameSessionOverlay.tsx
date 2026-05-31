import { useEffect, useRef, useState } from "react";
import { renameSession } from "../api/client";
import { useScrimClose } from "../lib/useScrimClose";
import { Icon } from "./Icon";

interface Props {
  session: string;
  onClose: () => void;
  onApplied: () => void;
}

/**
 * Prompt for a new session name, then `rename-session`. Mirrors RenameOverlay's
 * layout/keyboard model (⏎ apply, esc cancel).
 */
export function RenameSessionOverlay({ session, onClose, onApplied }: Props) {
  const scrimProps = useScrimClose(onClose);
  const [name, setName] = useState(session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === session) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await renameSession(session, trimmed);
    setBusy(false);
    if (ok) {
      onApplied();
      onClose();
    } else {
      setError("Rename failed — name in use?");
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
    <div className="scrim" {...scrimProps}>
      <div className="rename-modal" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="rename-hd">
          <Icon name="rename" />
          <b>Rename session {session}</b>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn btn-icon btn-ghost" onClick={onClose} title="Cancel (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="rename-body">
          <div className="rename-row">
            <span className="lbl">from</span>
            <span className="old">{session}</span>
          </div>
          <div className="rename-row">
            <span className="lbl">to</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {error && <div className="rename-error">{error}</div>}
        </div>
        <div className="rename-foot">
          <span className="hint">⏎ apply · esc cancel</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={busy}>
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
