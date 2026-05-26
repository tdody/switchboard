import { useEffect, useState } from "react";

import { useScrimClose } from "../lib/useScrimClose";
import "../styles/docs.css";
import { AgentCardArt } from "./docs/AgentCardArt";
import { AgentTileCallouts } from "./docs/AgentTileCallouts";
import { DocsSecondary, type DocsSecondaryItem } from "./docs/DocsSecondary";
import { HeaderBarArt } from "./docs/HeaderBarArt";
import { HeaderBarCallouts } from "./docs/HeaderBarCallouts";
import { ShellCardArt } from "./docs/ShellCardArt";
import { ShellTileCallouts } from "./docs/ShellTileCallouts";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";

/**
 * In-app Documentation modal (THI-136 shell, THI-143 V1 callouts).
 *
 * Scrim with click-to-close, Esc-to-close, pinned header / tabs / footer
 * rows around a body that hosts one of three reference diagrams. Each
 * diagram now follows the V1 idiom (THI-143): centered card / bar in a
 * 1240×480 viewBox, all callouts L-with-leg routed through shared rails,
 * secondary annotations relegated to a footer strip below the SVG.
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

// "Also visible —" strip content per tab. Items mirror the parts that
// have no primary callout: conditional / duplicative / low-information
// affordances the user should know about but that don't warrant a leg
// on the diagram. Header's strip cross-references THI-141 since drag-
// reorder is a related affordance that lives outside the bar itself.
const AGENT_SECONDARY: ReadonlyArray<DocsSecondaryItem> = [
  { label: "Spinner", desc: "activity + elapsed" },
  { label: "Recap", desc: "last assistant line" },
  { label: "CPU / mem", desc: "when elevated" },
  { label: "Age", desc: "since last output" },
];
const SHELL_SECONDARY: ReadonlyArray<DocsSecondaryItem> = [
  { label: "CPU / mem", desc: "when elevated" },
  { label: "Age", desc: "since last output" },
];
const HEADER_SECONDARY: ReadonlyArray<DocsSecondaryItem> = [
  { label: "Tile drag", desc: "reorders panes within a column (THI-141)" },
];

// Card placement inside the 1240×480 SVG body. The Agent / Shell cards
// (300×400 and 300×330) and the Header bar (300×44) all use cx=470 so
// their left edges line up vertically. cy differs per shape so each
// sits visually centered in the viewBox.
const VIEWBOX_W = 1240;
const VIEWBOX_H = 480;
const CARD_CX = 470;
const AGENT_CY = 40; // 400-tall card; (480-400)/2 = 40
const SHELL_CY = 75; // 330-tall card; (480-330)/2 = 75
const HEADER_CY = 218; // 44-tall bar; (480-44)/2 = 218

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
          <svg
            className="docs-diagram"
            viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid meet"
            aria-label={`${TABS.find((t) => t.id === tab)?.label} diagram`}
          >
            {tab === "header" && (
              <>
                <HeaderBarArt cx={CARD_CX} cy={HEADER_CY} />
                <HeaderBarCallouts cx={CARD_CX} cy={HEADER_CY} />
              </>
            )}
            {tab === "agent" && (
              <>
                <AgentCardArt cx={CARD_CX} cy={AGENT_CY} />
                <AgentTileCallouts cx={CARD_CX} cy={AGENT_CY} />
              </>
            )}
            {tab === "shell" && (
              <>
                <ShellCardArt cx={CARD_CX} cy={SHELL_CY} />
                <ShellTileCallouts cx={CARD_CX} cy={SHELL_CY} />
              </>
            )}
          </svg>
          {tab === "header" && <DocsSecondary items={HEADER_SECONDARY} />}
          {tab === "agent" && <DocsSecondary items={AGENT_SECONDARY} />}
          {tab === "shell" && <DocsSecondary items={SHELL_SECONDARY} />}
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
