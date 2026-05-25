import { useEffect, useRef, useState } from "react";

import { STATUS_META } from "../lib/status";
import type { Status } from "../types";

// Display order: filter-tab statuses first (matches Subhead.tsx's strip), then
// done/error which never appear as filter chips but show up on cards — the
// legend's main job is explaining those rare states.
const ORDER: Status[] = ["idle", "running", "waiting", "done", "error"];

/**
 * Inline "i"-trigger + click-toggled popover explaining what each status color
 * means (THI-96). Lives in `Subhead.tsx` right after the status filter strip.
 *
 * Dismisses on outside-click, Esc, or trigger re-click. Focus returns to the
 * trigger on close so keyboard users don't lose their place.
 */
export function StatusLegend() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Outside-click & Esc: window-level handlers attached only while open so
    // the closed state has zero ambient listeners.
    const onMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="status-legend">
      <button
        ref={triggerRef}
        type="button"
        className="legend-trigger"
        aria-label="Status legend"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="legend-i" aria-hidden>
          i
        </span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Status legend"
          className="legend-popover"
        >
          <div className="legend-title">Status colors</div>
          <ul className="legend-list">
            {ORDER.map((key) => {
              const meta = STATUS_META[key];
              return (
                <li key={key} className="legend-row">
                  <span
                    className={`stat-dot tone-${meta.tone}`}
                    aria-hidden
                  />
                  <span className="legend-name">{meta.label}</span>
                  <span className="legend-desc">{meta.description}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </span>
  );
}
