import { useEffect, useState } from "react";

import { useScrimClose } from "../lib/useScrimClose";
import "../styles/docs.css";
import { AgentDiagram } from "./docs/AgentDiagram";
import { HeaderDiagram } from "./docs/HeaderDiagram";
import { ShellDiagram } from "./docs/ShellDiagram";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";

/**
 * In-app Documentation modal (THI-136).
 *
 * Modeled on `SettingsModal`: scrim with click-to-close, Esc-to-close,
 * pinned header / footer rows around a scrollable body. Each tab renders
 * a hand-authored SVG diagram annotated with callouts; geometry lives in
 * the diagram components, themed colors in styles/docs.css.
 */

type DocsTab = "header" | "agent" | "shell";

interface Props {
  onClose: () => void;
}

interface TabDef {
  id: DocsTab;
  label: string;
}

const TABS: TabDef[] = [
  { id: "header", label: "Session header" },
  { id: "agent", label: "Agent tile" },
  { id: "shell", label: "Shell tile" },
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
          {tab === "header" && <HeaderDiagram />}
          {tab === "agent" && <AgentDiagram />}
          {tab === "shell" && <ShellDiagram />}
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
