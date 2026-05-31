import { useEffect, useRef, useState } from "react";
import { renameWindow } from "../api/client";
import { useScrimClose } from "../lib/useScrimClose";
import type { Window } from "../types";
import { Icon } from "./Icon";

interface Props {
  target: Window;
  onClose: () => void;
  onApplied: () => void;
}

export function RenameOverlay({ target, onClose, onApplied }: Props) {
  const scrimProps = useScrimClose(onClose);
  const [name, setName] = useState(target.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === target.name) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await renameWindow(target.session, target.index, trimmed);
    setBusy(false);
    if (ok) {
      onApplied();
      onClose();
    } else {
      setError("Rename failed");
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
      <div
        className="rename-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="rename-hd">
          <Icon name="rename" />
          <b>
            Rename {target.session}:{target.index}
          </b>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn btn-icon btn-ghost" onClick={onClose} title="Cancel (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <div className="rename-body">
          <div className="rename-row">
            <span className="lbl">from</span>
            <span className="old">{target.name}</span>
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
