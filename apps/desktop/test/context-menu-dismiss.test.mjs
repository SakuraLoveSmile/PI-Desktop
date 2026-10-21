import assert from "node:assert/strict";
import test from "node:test";
import { listenForContextMenuDismissal } from "../src/lib/context-menu-dismiss.ts";

/*
  Node has no DOM, so the window is a bare EventTarget. Each event's `target`
  and `key` are set by hand, the way the browser reports them: `menu` is the
  surface, `row` a transcript row or the conversation background behind it, and
  `field` a text input.
*/
function openMenu() {
  const windowLike = new EventTarget();
  const menu = { role: "menu" };
  const row = { role: "row", closest: () => null };
  const field = { role: "textbox", closest: () => field };
  let dismissals = 0;
  const stop = listenForContextMenuDismissal(windowLike, {
    contains: (node) => node === menu,
    onDismiss: () => {
      dismissals += 1;
    },
  });
  const fire = (type, { from = row, key } = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, "target", { value: from });
    if (key !== undefined) Object.defineProperty(event, "key", { value: key });
    windowLike.dispatchEvent(event);
    return event;
  };
  return { fire, menu, field, stop, dismissals: () => dismissals };
}

test("a programmatic scroll behind the menu does not dismiss it", () => {
  // The transcript re-pins with scrollTo while a turn streams: the scroll event
  // arrives with no reader input before it.
  const { fire, dismissals, stop } = openMenu();
  fire("scroll");
  fire("scroll");
  fire("scroll");
  assert.equal(dismissals(), 0);
  stop();
});

test("a wheel or touch move over the content behind the menu dismisses it", () => {
  const { fire, dismissals, stop } = openMenu();
  fire("wheel");
  assert.equal(dismissals(), 1);
  fire("touchmove");
  assert.equal(dismissals(), 2);
  stop();
});

test("wheel and touch input on the menu itself keeps it open", () => {
  const { fire, menu, dismissals, stop } = openMenu();
  fire("wheel", { from: menu });
  fire("touchmove", { from: menu });
  assert.equal(dismissals(), 0);
  stop();
});

test("a scroll key pressed outside the menu dismisses it", () => {
  const { fire, dismissals, stop } = openMenu();
  fire("keydown", { key: "PageDown" });
  assert.equal(dismissals(), 1);
  stop();
});

test("arrow, home and paging keys stay with the menu or a text field", () => {
  const { fire, menu, field, dismissals, stop } = openMenu();
  fire("keydown", { from: menu, key: "ArrowDown" });
  fire("keydown", { from: menu, key: "Home" });
  fire("keydown", { from: field, key: "ArrowDown" });
  fire("keydown", { key: "a" });
  assert.equal(dismissals(), 0);
  stop();
});

test("Escape dismisses from anywhere and does not reach the page", () => {
  const { fire, menu, dismissals, stop } = openMenu();
  const event = fire("keydown", { key: "Escape" });
  assert.equal(dismissals(), 1);
  assert.equal(event.defaultPrevented, true);
  fire("keydown", { from: menu, key: "Escape" });
  assert.equal(dismissals(), 2);
  stop();
});

test("Tab dismisses the menu", () => {
  const { fire, menu, dismissals, stop } = openMenu();
  fire("keydown", { from: menu, key: "Tab" });
  assert.equal(dismissals(), 1);
  stop();
});

test("a press outside dismisses the menu; a press on the menu does not", () => {
  const { fire, menu, dismissals, stop } = openMenu();
  fire("pointerdown", { from: menu });
  fire("contextmenu", { from: menu });
  assert.equal(dismissals(), 0);
  fire("pointerdown");
  assert.equal(dismissals(), 1);
  fire("contextmenu");
  assert.equal(dismissals(), 2);
  stop();
});

test("window blur and resize dismiss the menu", () => {
  const { fire, dismissals, stop } = openMenu();
  fire("blur");
  fire("resize");
  assert.equal(dismissals(), 2);
  stop();
});

test("the cleanup removes every listener", () => {
  const { fire, dismissals, stop } = openMenu();
  stop();
  for (const type of ["pointerdown", "contextmenu", "scroll", "wheel", "touchmove", "blur", "resize"]) {
    fire(type);
  }
  fire("keydown", { key: "Escape" });
  fire("keydown", { key: "PageDown" });
  fire("keydown", { key: "Tab" });
  assert.equal(dismissals(), 0);
});
