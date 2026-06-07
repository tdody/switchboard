import { Fragment, useEffect } from "react";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";

interface Props {
  onClose: () => void;
}

interface Shortcut {
  label: string;
  keys: string[];
}

interface Section {
  title: string;
  rows: Shortcut[];
}

// Kept in sync with App.tsx's global keydown effect and WindowCard's
// shift-click kill — surface only what is actually wired today.
const SECTIONS: Section[] = [
  {
    title: "Navigation",
    rows: [
      { label: "Move card highlight", keys: ["↑", "↓", "←", "→"] },
      { label: "Move card highlight (vim)", keys: ["k", "j", "h", "l"] },
      { label: "Open highlighted card", keys: ["⏎"] },
      { label: "Focus search", keys: ["/"] },
    ],
  },
  {
    title: "Palette",
    rows: [
      { label: "Open command palette", keys: ["⌘", "K"] },
      { label: "Open command palette (Linux/Windows)", keys: ["Ctrl", "K"] },
    ],
  },
  // THI-225: ⌘⇧F was wired in THI-100 (pane history search modal) but the
  // sheet wasn't refreshed. Listed as its own section so the Linux/Windows
  // variant has a clean home.
  {
    title: "Search",
    rows: [
      { label: "Search every pane's history", keys: ["⌘", "⇧", "F"] },
      {
        label: "Search every pane's history (Linux/Windows)",
        keys: ["Ctrl", "Shift", "F"],
      },
    ],
  },
  {
    title: "Modal",
    rows: [
      { label: "Close overlay", keys: ["Esc"] },
      {
        label: "Skip confirm (window or session)",
        keys: ["Shift", "click Kill"],
      },
    ],
  },
  {
    title: "Help",
    rows: [{ label: "Open this sheet", keys: ["?"] }],
  },
];

function Row({ label, keys }: Shortcut) {
  return (
    <div className="shortcut-row">
      <span className="label">{label}</span>
      <span className="keys">
        {keys.map((k, i) => (
          <span key={i} className="kbd">
            {k}
          </span>
        ))}
      </span>
    </div>
  );
}

export function ShortcutsSheet({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="shortcuts"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div className="shortcuts-hd">
          <SwitchboardMark size={22} />
          <b>Keyboard shortcuts</b>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            title="Close (Esc)"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="shortcuts-body">
          {SECTIONS.map((section) => (
            <Fragment key={section.title}>
              <div className="shortcuts-section">{section.title}</div>
              {section.rows.map((r) => (
                <Row key={r.label} label={r.label} keys={r.keys} />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
