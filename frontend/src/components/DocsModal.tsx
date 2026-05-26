import { useEffect, useState } from "react";

import { useScrimClose } from "../lib/useScrimClose";
import "../styles/docs.css";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";

/**
 * In-app Documentation modal (THI-136).
 *
 * Phase 1 (this PR) ships the modal shell only: header, three tab buttons,
 * a body region, and a placeholder card per tab. The annotated SVG diagrams
 * land in follow-up PRs once the surfaces they describe stop moving
 * (THI-128/129/131/135 — see the spec's "Sequencing" section).
 *
 * Modeled on `SettingsModal`: scrim with click-to-close, Esc-to-close,
 * pinned header / footer rows around a scrollable body.
 */

type DocsTab = "header" | "agent" | "shell";

interface Props {
  onClose: () => void;
}

interface TabDef {
  id: DocsTab;
  label: string;
  /** Placeholder body title; phase-2 replaces with the real diagram. */
  title: string;
}

const TABS: TabDef[] = [
  { id: "header", label: "Session header", title: "Session header diagram" },
  { id: "agent", label: "Agent tile", title: "Agent tile diagram" },
  { id: "shell", label: "Shell tile", title: "Shell / SSH tile diagram" },
];

export function DocsModal({ onClose }: Props) {
  const scrimProps = useScrimClose(onClose);
  const [tab, setTab] = useState<DocsTab>("header");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="scrim" {...scrimProps}>
      <div className="docs-modal" onClick={(e) => e.stopPropagation()}>
        <div className="docs-hd">
          <SwitchboardMark size={22} />
          <span>Documentation</span>
          <span style={{ flex: 1 }} />
          <button
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close documentation"
          >
            <Icon name="x" />
          </button>
        </div>

        <nav className="docs-tabs" role="tablist" aria-label="Documentation sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "is-active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="docs-body" role="tabpanel">
          <div className="docs-placeholder">
            <h3>{active.title}</h3>
            <p>
              Diagram coming in a follow-up PR — see{" "}
              <code>THI-136</code>.
            </p>
          </div>
        </div>

        <div className="docs-foot">
          <span className="hint">Reference · {TABS.length} sections</span>
          <button className="btn btn-primary" onClick={onClose}>
            <Icon name="check" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
