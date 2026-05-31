/**
 * "Also visible —" footer strip (THI-143).
 *
 * One-line mono-font annotation that lives below the diagram in each
 * Documentation modal tab. Lists short notes for affordances that
 * didn't earn a primary callout — either because they're conditional
 * (CPU / memory only shows when elevated), low-information (age),
 * or duplicative (spinner activity / recap line).
 *
 * Absolutely positioned at the bottom of the `.docs-body` so it pins
 * to the modal's lower edge regardless of SVG height.
 */

import { Fragment } from "react";

export interface DocsSecondaryItem {
  /** Bolded leading term (e.g. "Spinner", "CPU / mem"). */
  label: string;
  /** Continuation in the muted tone, joined to the label by a single space. */
  desc: string;
}

interface Props {
  items: ReadonlyArray<DocsSecondaryItem>;
}

export function DocsSecondary({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="docs-secondary">
      <span className="docs-secondary-hd">Also visible —</span>
      {items.map((item, i) => (
        <Fragment key={item.label}>
          {i > 0 && <span className="docs-secondary-dot">·</span>}
          <span>
            <b>{item.label}</b> {item.desc}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
