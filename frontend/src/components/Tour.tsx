import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isTourDismissed, markTourDismissed } from "../lib/tour";

interface Step {
  /** CSS selector for the element to highlight + anchor the popover to. */
  selector: string;
  title: string;
  body: string;
  /** Popover side relative to the anchor. Flips if it would overflow. */
  placement: "top" | "bottom" | "left" | "right";
}

// 4-step content. Anchors live as `data-tour="<id>"` on the target elements
// (see Header.tsx, Subhead.tsx, WindowCard.tsx via Kanban). Adding a 5th step
// is mechanical — write a new data-tour attr + append here.
const STEPS: Step[] = [
  {
    selector: '[data-tour="first-card"]',
    title: "This is a window card",
    body: "One card per tmux pane. Status colors at a glance — green idle, blue running, amber when an agent needs you.",
    placement: "bottom",
  },
  {
    selector: '[data-tour="first-card"]',
    title: "Click to see live output",
    body: "Click any card to pop a live terminal modal. Esc Esc to close. The pane's bytes stream over WebSocket — no reload.",
    placement: "bottom",
  },
  {
    selector: '[data-tour="amber-waiting"]',
    title: "Amber means waiting on you",
    body: "Any pane the Waiting filter counts is an agent prompt blocking on your answer. Click the chip to jump to just those.",
    placement: "bottom",
  },
  {
    selector: '[data-tour="kbar-hint"]',
    title: "⌘K sends commands anywhere",
    body: "Press ⌘K (or Ctrl+K) from any view to open the command palette and send keys to the focused pane.",
    placement: "bottom",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Props {
  /** When false, the tour stays hidden regardless of dismissed state — used
   *  by `App.tsx` to suppress the tour while a modal/overlay is open or when
   *  there are no windows to anchor steps to. */
  enabled: boolean;
}

/**
 * First-run 4-step tour (THI-96). Renders nothing once the user has
 * dismissed (or completed) it, or while `enabled` is false. When active:
 *
 *  - A full-page scrim dims the dashboard, with a "cutout" hole around the
 *    current step's anchor (4 dim divs framing the target rect — no SVG).
 *  - A popover positioned next to the cutout shows step content + Skip /
 *    Back / Next controls. On the last step `Next` becomes `Done`.
 *  - Keyboard: Enter / → / Space → next; ← → back; Esc → skip.
 *  - Position recomputes on `resize` and `scroll`, and after each step.
 *
 * The anchor lookup uses `querySelector` against `data-tour="…"` — if the
 * anchor isn't present (slow first poll, narrow viewport, etc.), the tour
 * advances past that step automatically rather than blocking on a missing
 * element.
 */
export function Tour({ enabled }: Props) {
  // Defer the visibility decision to mount so the dismissed-state read isn't
  // re-evaluated on every parent re-render — once you've seen it for the
  // session, it stays seen.
  const [visible, setVisible] = useState<boolean>(() => !isTourDismissed());
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // Remember what was focused before the tour grabbed focus, so we can
  // restore it on dismiss — same a11y contract as a modal.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const step = STEPS[stepIdx];

  // Measure the anchor rect (and re-measure on resize / scroll / step change).
  // useLayoutEffect runs before paint so the popover never shows up at stale
  // coords for even one frame.
  const measure = useCallback(() => {
    if (!visible || !enabled) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.selector);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [visible, enabled, step.selector]);

  useLayoutEffect(() => {
    measure();
    if (!visible || !enabled) return;
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure, visible, enabled]);

  // One-rAF retry: if the anchor wasn't in the DOM at mount (slow hydration,
  // first state poll still in flight), look again on the next animation frame.
  // Bails after a few attempts so a permanently-missing anchor doesn't loop.
  useEffect(() => {
    if (!visible || !enabled || rect) return;
    let attempts = 0;
    let raf = 0;
    const retry = () => {
      attempts += 1;
      measure();
      // Stop after ~10 frames; if the anchor still isn't there, give up
      // gracefully — the tour stays mounted but invisible until a parent
      // re-render kicks the next attempt.
      if (attempts < 10 && !document.querySelector(step.selector)) {
        raf = requestAnimationFrame(retry);
      }
    };
    raf = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(raf);
  }, [visible, enabled, rect, measure, step.selector]);

  // Capture the previously-focused element on first show; restore on dismiss.
  useEffect(() => {
    if (!visible || !enabled) return;
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    // Focus the popover so keyboard nav works immediately.
    popoverRef.current?.focus();
  }, [visible, enabled]);

  const dismiss = useCallback(
    (markDone: boolean) => {
      if (markDone) markTourDismissed();
      setVisible(false);
      // Return focus to wherever it was before we grabbed it.
      try {
        returnFocusRef.current?.focus?.();
      } catch {
        /* element may have unmounted while the tour was open */
      }
    },
    [],
  );

  const next = useCallback(() => {
    if (stepIdx >= STEPS.length - 1) {
      dismiss(true);
    } else {
      setStepIdx((i) => i + 1);
    }
  }, [stepIdx, dismiss]);

  const back = useCallback(() => {
    setStepIdx((i) => Math.max(0, i - 1));
  }, []);

  // Keyboard nav — attached to document so the user can drive the tour from
  // anywhere, not just when the popover happens to have focus.
  useEffect(() => {
    if (!visible || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss(true);
      } else if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, enabled, next, back, dismiss]);

  if (!visible || !enabled) return null;

  // If we couldn't find an anchor for this step, render only the popover at
  // a safe centered fallback position — better than crashing or going blank.
  const fallbackRect: Rect = {
    top: window.innerHeight / 2 - 40,
    left: window.innerWidth / 2 - 100,
    width: 200,
    height: 80,
  };
  const r = rect ?? fallbackRect;
  const popPos = popoverPosition(r, step.placement);

  return createPortal(
    <div className="tour-root" aria-hidden={false}>
      {/* Four scrim panes around the cutout — top, bottom, left, right.
          Using divs (not SVG mask) keeps it simple and themable. */}
      <div
        className="tour-scrim tour-scrim-top"
        style={{ top: 0, left: 0, right: 0, height: Math.max(0, r.top) }}
      />
      <div
        className="tour-scrim tour-scrim-bottom"
        style={{ top: r.top + r.height, left: 0, right: 0, bottom: 0 }}
      />
      <div
        className="tour-scrim tour-scrim-left"
        style={{ top: r.top, left: 0, width: Math.max(0, r.left), height: r.height }}
      />
      <div
        className="tour-scrim tour-scrim-right"
        style={{ top: r.top, left: r.left + r.width, right: 0, height: r.height }}
      />
      {/* A subtle outline on the cutout itself — purely decorative. */}
      <div
        className="tour-cutout"
        style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
        aria-hidden
      />
      <div
        ref={popoverRef}
        className="tour-popover"
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        style={{ top: popPos.top, left: popPos.left }}
      >
        <div className="tour-step-n">
          Step {stepIdx + 1} of {STEPS.length}
        </div>
        <h3 id="tour-title" className="tour-title">
          {step.title}
        </h3>
        <p id="tour-body" className="tour-body">
          {step.body}
        </p>
        <div className="tour-actions">
          <button
            type="button"
            className="btn btn-ghost tour-skip"
            onClick={() => dismiss(true)}
          >
            Skip tour
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="btn"
            onClick={back}
            disabled={stepIdx === 0}
          >
            Back
          </button>
          <button type="button" className="btn btn-primary" onClick={next}>
            {stepIdx === STEPS.length - 1 ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const POPOVER_W = 320;
const POPOVER_H_EST = 180; // ~rendered height; used to flip if overflowing
const GAP = 12;
const PAD = 8;

function popoverPosition(
  rect: Rect,
  placement: Step["placement"],
): { top: number; left: number } {
  // Try the preferred placement; flip to the opposite if it would overflow.
  let { top, left } = byPlacement(rect, placement);
  if (top < PAD && placement === "top") {
    ({ top, left } = byPlacement(rect, "bottom"));
  } else if (top + POPOVER_H_EST > window.innerHeight - PAD && placement === "bottom") {
    ({ top, left } = byPlacement(rect, "top"));
  }
  // Clamp to viewport horizontally regardless of placement.
  left = Math.max(PAD, Math.min(window.innerWidth - POPOVER_W - PAD, left));
  return { top, left };
}

function byPlacement(
  rect: Rect,
  placement: Step["placement"],
): { top: number; left: number } {
  switch (placement) {
    case "top":
      return {
        top: rect.top - POPOVER_H_EST - GAP,
        left: rect.left + rect.width / 2 - POPOVER_W / 2,
      };
    case "bottom":
      return {
        top: rect.top + rect.height + GAP,
        left: rect.left + rect.width / 2 - POPOVER_W / 2,
      };
    case "left":
      return {
        top: rect.top + rect.height / 2 - POPOVER_H_EST / 2,
        left: rect.left - POPOVER_W - GAP,
      };
    case "right":
      return {
        top: rect.top + rect.height / 2 - POPOVER_H_EST / 2,
        left: rect.left + rect.width + GAP,
      };
  }
}
