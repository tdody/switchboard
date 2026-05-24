import { useEffect, useRef, useState } from "react";
import { useScrimClose } from "../lib/useScrimClose";
import { Icon } from "./Icon";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** May be async — the dialog shows a busy state until it settles. */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Reusable confirm gate for destructive actions (kill window / kill session).
 * The confirm button is focused on mount so Enter confirms and Esc cancels.
 */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const scrimProps = useScrimClose(onCancel);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void confirm();
    }
  };

  return (
    <div className="scrim" {...scrimProps}>
      <div
        className="confirm-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="alertdialog"
        aria-label={title}
      >
        <div className="confirm-hd">
          <span className="confirm-glyph">
            <Icon name="alert" />
          </span>
          <b>{title}</b>
        </div>
        <div className="confirm-body">{message}</div>
        <div className="confirm-foot">
          <span className="hint">⏎ confirm · esc cancel</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            className="btn btn-danger"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
