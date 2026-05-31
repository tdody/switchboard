import { useRef } from "react";

/**
 * Scrim handlers that only close on a *deliberate* outside click.
 *
 * Plain `onClick={onClose}` on the scrim closes the modal whenever a drag
 * (e.g. text selection inside the terminal) releases over the scrim — the
 * mouseup lands on the scrim and the synthesized click fires (THI-125).
 *
 * Track which element the mousedown started on and only invoke `onClose` if
 * BOTH mousedown and mouseup landed on the scrim itself. `e.currentTarget`
 * is the scrim element the handlers are attached to; `e.target` is wherever
 * the press/release actually originated.
 */
export function useScrimClose(onClose: () => void) {
  const pressedOnScrim = useRef(false);

  const onMouseDown = (e: React.MouseEvent) => {
    pressedOnScrim.current = e.target === e.currentTarget;
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const wasOnScrim = pressedOnScrim.current;
    pressedOnScrim.current = false;
    if (wasOnScrim && e.target === e.currentTarget) onClose();
  };

  return { onMouseDown, onMouseUp };
}
