import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The single anchoring element. The tooltip clones it to inject hover /
   *  focus handlers + `aria-describedby` without changing its markup. */
  children: ReactElement;
  /** Tooltip body text. */
  content: ReactNode;
  /** Optional keyboard shortcut rendered as a `.kbd` chip after the content. */
  shortcut?: string;
  /** Preferred placement; flips to the opposite side if it would overflow. */
  placement?: "top" | "bottom";
  /** Delay before the tooltip appears, in ms. Defaults to 400. Hide is
   *  immediate so rapid hovering doesn't leave stale tooltips behind. */
  delayMs?: number;
  /** When true, render the child untouched — no handlers, no tooltip. Useful
   *  for conditional disable without restructuring the JSX. */
  disabled?: boolean;
}

interface ChildEventProps {
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
}

const GAP_PX = 6;
const VIEWPORT_PAD = 4;

/**
 * Hover / focus tooltip, portal-rendered to escape any `overflow:hidden`
 * ancestor and dark-themed via `.tooltip` CSS.
 *
 * Replaces the browser-default `title=` attribute on icon-only buttons so the
 * label (and optional keyboard shortcut) is consistently styled across the
 * dashboard and stays attached on touch / focus (THI-96). Behavior:
 *
 *   - Shows after `delayMs` of hover / focus; hides immediately on mouseleave
 *     / blur (no fade-fight on rapid hover).
 *   - `aria-describedby` is wired only while the tooltip is visible; the id
 *     points at a portaled element with `role="tooltip"`.
 *   - On first paint we measure the rendered tooltip to position it precisely
 *     (centered over the anchor, flipped if it would overflow vertically).
 *     One off-screen frame is invisible to the eye.
 *   - Existing child handlers (onMouseEnter / onFocus / etc.) are preserved —
 *     the tooltip's wrappers call through to whatever was already there.
 */
export function Tooltip({
  children,
  content,
  shortcut,
  placement = "top",
  delayMs = 400,
  disabled = false,
}: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flipped: "top" | "bottom" } | null>(
    null,
  );
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  const scheduleShow = useCallback(
    (anchor: HTMLElement) => {
      if (disabled) return;
      clearTimer();
      anchorRef.current = anchor;
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        setVisible(true);
      }, delayMs);
    },
    [clearTimer, delayMs, disabled],
  );

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
    // Reset measured position so the next show starts fresh — otherwise a
    // re-show would paint at the prior anchor's coords for one frame.
    setPos(null);
  }, [clearTimer]);

  // Cleanup on unmount: ensure no straggler timer fires after we're gone.
  useEffect(() => () => clearTimer(), [clearTimer]);

  // Measure + position after the visibility flip. useLayoutEffect runs after
  // the DOM mutation but before the browser paints, so the off-screen frame
  // never reaches the screen.
  useLayoutEffect(() => {
    if (!visible) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();

    let flipped: "top" | "bottom" = placement;
    let top =
      placement === "top" ? a.top - t.height - GAP_PX : a.bottom + GAP_PX;
    if (placement === "top" && top < VIEWPORT_PAD) {
      flipped = "bottom";
      top = a.bottom + GAP_PX;
    } else if (placement === "bottom" && top + t.height > window.innerHeight - VIEWPORT_PAD) {
      flipped = "top";
      top = a.top - t.height - GAP_PX;
    }

    // Center horizontally, clamped to the viewport.
    let left = a.left + a.width / 2 - t.width / 2;
    left = Math.max(
      VIEWPORT_PAD,
      Math.min(window.innerWidth - t.width - VIEWPORT_PAD, left),
    );

    setPos({ top, left, flipped });
  }, [visible, placement]);

  if (!isValidElement(children) || disabled) {
    // Bail out: nothing to enhance, render the child verbatim. Keeps the
    // `disabled` prop a pure pass-through (handy for conditional wrapping).
    return children;
  }

  // The cast lets us call through to any existing handlers without losing
  // their types. `children.props` is `unknown` in React 19's stricter typing.
  const childProps = (children.props ?? {}) as ChildEventProps;

  const enhanced = cloneElement(children, {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseEnter?.(e);
      scheduleShow(e.currentTarget);
    },
    onMouseLeave: (e: MouseEvent<HTMLElement>) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e);
      scheduleShow(e.currentTarget);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e);
      hide();
    },
    "aria-describedby": visible ? id : childProps["aria-describedby"],
  } as ChildEventProps);

  return (
    <>
      {enhanced}
      {visible &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={`tooltip tooltip-${pos?.flipped ?? placement}`}
            style={
              pos
                ? { position: "fixed", top: pos.top, left: pos.left }
                : // First paint before useLayoutEffect runs — render off-screen
                  // so the measurement can happen invisibly. The next layout
                  // pass replaces these coords.
                  { position: "fixed", top: -9999, left: -9999, visibility: "hidden" }
            }
          >
            <span className="tooltip-content">{content}</span>
            {shortcut && <span className="tooltip-kbd kbd">{shortcut}</span>}
          </div>,
          document.body,
        )}
    </>
  );
}
