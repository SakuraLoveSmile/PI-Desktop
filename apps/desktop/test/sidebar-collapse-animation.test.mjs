import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const globalStyles = await loadStyles();

test("the sidebar forwards collapse-animation props to the aside element", () => {
  // The aside must accept a className (the exit flag) and an animation-end
  // callback so App can keep it mounted through the exit keyframe, then unmount.
  assert.match(sidebarSource, /cx\("sidebar", className\)/);
  assert.match(sidebarSource, /onAnimationEnd=\{onAnimationEnd\}/);
  assert.match(sidebarSource, /className\?:\s*string;/);
  assert.match(
    sidebarSource,
    /onAnimationEnd\?:\s*ReactAnimationEventHandler<HTMLElement>;/,
  );
});

test("collapsing keeps the sidebar mounted until its exit animation ends", () => {
  // Mirror the work-panel mount-then-animate-then-unmount state machine: the
  // sidebar stays in the tree while `sidebarExiting` is true, gets the
  // `is-exiting` class, and fires `handleSidebarAnimationEnd` on animation end.
  assert.match(appSource, /!sidebarCollapsed \|\| sidebarExiting \?/);
  assert.match(
    appSource,
    /className=\{sidebarExiting \? "is-exiting" : undefined\}/,
  );
  assert.match(appSource, /onAnimationEnd=\{handleSidebarAnimationEnd\}/);
  assert.match(
    appSource,
    /if \(!event\.animationName\.startsWith\("sidebar-out"\)\) return;/,
  );
  // Expanding from the collapsed titlebar must route through the same machine
  // so the entrance animation plays too.
  assert.match(
    appSource,
    /CollapsedTitlebarActions[\s\S]*?onToggleSidebar/,
  );
});

test("the sidebar entrance/exit keyframes and exit rule exist", () => {
  // Entrance animation applied to every mount (matches the work-panel dock).
  const sidebarBlock = globalStyles.match(/\.sidebar\s*\{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(
    sidebarBlock,
    /animation:\s*sidebar-in var\(--motion-duration-normal\) var\(--motion-ease-out\) both/,
  );
  // Exit rule swaps to the sidebar-out keyframe and blocks interaction.
  const exitingBlock =
    globalStyles.match(/\.sidebar\.is-exiting\s*\{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(exitingBlock, /pointer-events:\s*none/);
  assert.match(
    exitingBlock,
    /animation:\s*sidebar-out var\(--motion-duration-fast\) var\(--motion-ease-in\) both/,
  );
  // Both keyframes are declared, and the win32 variant keeps the dock opaque.
  assert.match(globalStyles, /@keyframes sidebar-in\s*\{/);
  assert.match(globalStyles, /@keyframes sidebar-out\s*\{/);
  assert.match(globalStyles, /@keyframes sidebar-out-windows\s*\{/);
  assert.match(
    globalStyles,
    /:root\[data-platform="win32"\] \.sidebar\.is-exiting\s*\{[\s\S]*?animation-name:\s*sidebar-out-windows/,
  );
});
