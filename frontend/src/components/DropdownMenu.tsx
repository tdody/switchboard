import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export interface MenuItem {
  label: string;
  /** Receives the click event so callers can read modifiers (e.g. shiftKey). */
  onClick: (e: React.MouseEvent) => void;
  icon?: IconName;
  danger?: boolean;
}

interface Props {
  items: MenuItem[];
  /** Accessible label + tooltip for the ⋯ trigger. */
  label?: string;
}

/**
 * Small overflow (⋯) menu. Renders its own trigger button and a popover list;
 * closes on outside-click or Esc. Positioned relative to its `.dropdown` root,
 * so the parent just needs room for the trigger.
 */
export function DropdownMenu({ items, label = "More actions" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        className="btn btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={14} />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={`dropdown-item ${it.danger ? "danger" : ""}`}
              onClick={(e) => {
                setOpen(false);
                it.onClick(e);
              }}
            >
              {it.icon && <Icon name={it.icon} size={12} />}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
