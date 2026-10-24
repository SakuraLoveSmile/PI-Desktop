import { SCROLL_GESTURE_KEYS } from "./transcript-scroll.ts";

/**
 * Window input that dismisses an open pointer-anchored context menu.
 *
 * The menu is viewport-fixed where the pointer asked for it, so a scroll cannot
 * move it, but the content behind it can move. A scroll the app or the layout
 * makes is not the reader's, so it never dismisses: the transcript re-pins with
 * `scrollTo` while a turn streams, and that scroll closed a menu the reader was
 * still using. Reader input does dismiss: a wheel or touch movement, or a scroll
 * key outside the menu and any text field. Input that lands on the menu itself
 * never dismisses it, so an overflowing menu can scroll its own items.
 *
 * Callers own the state a menu was opened against. Its items are built at open
 * time, so a caller closes the menu itself when that state changes, such as a
 * turn starting or a pane leaving the screen.
 *
 * React-free, so the policy runs under `node --test`.
 */

export type ContextMenuDismissal = {
  /** Whether `node` is the menu surface or one of its descendants. */
  contains: (node: unknown) => boolean;
  onDismiss: () => void;
};

/*
  Options objects on both add and remove. Node's removeEventListener does not
  read a boolean `capture`, so a boolean removal would leave the capture
  listeners attached under `node --test`. The DOM accepts both forms.
*/
const CAPTURE = { capture: true };
const PASSIVE_CAPTURE = { capture: true, passive: true };

const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true']";

/** Duck-typed: Node has no `Element`, and the DOM's `closest` is all this needs. */
function isInEditableField(target: EventTarget | null): boolean {
  const closest = (target as Partial<Element> | null)?.closest;
  return (
    typeof closest === "function" &&
    closest.call(target, EDITABLE_SELECTOR) !== null
  );
}

export function listenForContextMenuDismissal(
  target: EventTarget,
  { contains, onDismiss }: ContextMenuDismissal,
): () => void {
  // A press, a right-click, or reader wheel and touch input closes the menu
  // only when it lands outside it.
  const onOutside = (event: Event) => {
    if (contains(event.target)) return;
    onDismiss();
  };
  const onKeyDown = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Escape") {
      // Stop so a surrounding overlay does not also close on this Escape.
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (key === "Tab") {
      onDismiss();
      return;
    }
    /*
      Capture runs before the menu's own key handler, so arrows, Home and End
      pressed inside the menu are left to it. In a text field the keys type.
    */
    if (
      !SCROLL_GESTURE_KEYS.has(key) ||
      contains(event.target) ||
      isInEditableField(event.target)
    ) {
      return;
    }
    onDismiss();
  };
  target.addEventListener("pointerdown", onOutside, CAPTURE);
  target.addEventListener("contextmenu", onOutside, CAPTURE);
  target.addEventListener("wheel", onOutside, PASSIVE_CAPTURE);
  target.addEventListener("touchmove", onOutside, PASSIVE_CAPTURE);
  target.addEventListener("keydown", onKeyDown, CAPTURE);
  target.addEventListener("resize", onDismiss);
  target.addEventListener("blur", onDismiss);
  return () => {
    target.removeEventListener("pointerdown", onOutside, CAPTURE);
    target.removeEventListener("contextmenu", onOutside, CAPTURE);
    target.removeEventListener("wheel", onOutside, CAPTURE);
    target.removeEventListener("touchmove", onOutside, CAPTURE);
    target.removeEventListener("keydown", onKeyDown, CAPTURE);
    target.removeEventListener("resize", onDismiss);
    target.removeEventListener("blur", onDismiss);
  };
}
