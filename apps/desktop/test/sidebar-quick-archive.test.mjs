import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { nextVisibleSessionId } from "../src/lib/sidebar-session-groups.ts";
import { loadStyles } from "./helpers/styles.mjs";

const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);
const styles = await loadStyles();

function block(source, selector) {
  const index = source.indexOf(selector);
  assert.notEqual(index, -1, `missing rule: ${selector}`);
  return source.slice(index, source.indexOf("}", index));
}

test("the focus fallback walks rendered order and never names the acted-on row", () => {
  const rendered = ["a", "b", "c", "d"];

  assert.equal(nextVisibleSessionId(rendered, "b", 1), "c");
  assert.equal(nextVisibleSessionId(rendered, "b", -1), "a");
  // The acted-on row is skipped even when it is the neighbour asked for.
  assert.equal(nextVisibleSessionId(rendered, "d", -1), "c");
  // Both ends answer nothing, so the caller can fall back to a stable anchor.
  assert.equal(nextVisibleSessionId(rendered, "d", 1), null);
  assert.equal(nextVisibleSessionId(rendered, "a", -1), null);
  // A row that is no longer rendered yields nothing to focus.
  assert.equal(nextVisibleSessionId(rendered, "gone", 1), null);
  assert.equal(nextVisibleSessionId([], "a", 1), null);
});

test("hidden rows are removed from the rendered order before the walk", () => {
  assert.match(
    sidebarSource,
    /renderedSessionRowIds[\s\S]*?querySelectorAll<HTMLElement>\("\[data-sidebar-session-row\]"\)[\s\S]*?closest\('\[aria-hidden="true"\]'\)/,
  );
});

test("a session row exposes the quick archive control next to the row menu", () => {
  const actions = sidebarSource.slice(
    sidebarSource.indexOf('<div className="sidebar-row-actions">'),
    sidebarSource.indexOf('<div className="sidebar-row-actions">') + 1200,
  );

  assert.match(actions, /data-action="quick-session-archive"/);
  // Reusing the row-control class is what inherits the reveal and hover rules.
  assert.match(actions, /className="thread-item-more thread-item-quick-archive"/);
  assert.match(actions, /t\("nav\.archiveTask"\)/);
  assert.match(actions, /t\("nav\.restoreTask"\)/);
  assert.match(actions, /<IconArchive size=\{14\} \/>/);
  assert.match(actions, /<IconArchiveRestore size=\{14\} \/>/);
  assert.match(actions, /disabled=\{quickArchivePending\.has\(session\.id\)\}/);
  assert.match(actions, /event\.stopPropagation\(\)/);
  assert.match(actions, /void quickToggleSessionArchive\(session\)/);
  // The menu button owns aria-expanded; the quick control must not, or the
  // "menu is open" reveal rule would keep it visible.
  assert.doesNotMatch(actions, /thread-item-quick-archive"[\s\S]{0,400}?aria-expanded/);
  // The existing row menu is untouched.
  assert.match(actions, /data-action="session-menu"/);
});

test("the quick control reuses the one archive path and guards repeat clicks", () => {
  const handler = sidebarSource.slice(
    sidebarSource.indexOf("const quickToggleSessionArchive = async"),
    sidebarSource.indexOf("requestAnimationFrame(() => {", sidebarSource.indexOf("const quickToggleSessionArchive = async")),
  );

  // Pending guard runs before anything else touches state.
  assert.match(handler, /if \(quickArchivePendingRef\.current\.has\(session\.id\) \|\| quickArchivePending\.has\(session\.id\)\) return;/);
  assert.ok(
    handler.indexOf("quickArchivePendingRef.current.has(session.id)") < handler.indexOf("setQuickArchivePending"),
    "the pending guard must run before the marker is set",
  );
  // Archive goes through the existing local orchestration, not the store slice.
  assert.match(handler, /await archiveSession\(session\)/);
  assert.doesNotMatch(handler, /archiveSessionAction\(/);
  // Restore is the store action that keeps the transcript and pin metadata.
  assert.match(handler, /restoreSession\(session\.id\)/);
  // The marker is always cleared, including on failure.
  assert.match(handler, /finally \{[\s\S]*?next\.delete\(session\.id\)/);
  // Archiving is presentation metadata only: nothing destructive may run here.
  assert.doesNotMatch(handler, /api\.(sessionDelete|deleteSession)|host\.call/);
});

test("focus is recovered only for the acted-on row and never points at a removed one", () => {
  const start = sidebarSource.indexOf("const quickToggleSessionArchive = async");
  const handler = sidebarSource.slice(start, start + 4000);

  // Resolved before the mutation, because archiving removes the row.
  assert.ok(
    handler.indexOf("nextVisibleSessionId(renderedIds") <
      handler.indexOf("setQuickArchivePending((prev) => new Set(prev).add(session.id))"),
    "the fallback must be resolved before the operation starts",
  );
  assert.match(handler, /if \(archived\) \{\n        if \(focusSessionRowMain\(session\.id\)\) return;/);
  assert.match(handler, /if \(wasActive\) \{/);
  assert.match(handler, /'\[data-sidebar-session-row\] \.thread-item-main\[aria-current="page"\]'/);
  assert.match(handler, /focusSidebarAnchor\(\);/);
  // A newer user focus is never stolen.
  assert.match(handler, /if \(focused !== null && focused !== document\.body && !actedRow\?\.contains\(focused\)\) return;/);
  assert.match(
    sidebarSource,
    /const focusSidebarAnchor = \(\) => \{\n    document\.querySelector<HTMLElement>\('\[data-action="session-sort"\]'\)\?\.focus\(\);/,
  );
});

test("the second row control keeps the existing reveal contract", () => {
  // Hidden with opacity, not removed from layout, so revealing it cannot shift
  // the session title.
  const control = block(styles, ".thread-item-more {");
  assert.match(control, /opacity: 0/);
  assert.doesNotMatch(control, /display: none|width: 0/);
  assert.match(control, /width: 24px/);
  assert.match(control, /height: 24px/);

  // Hover and keyboard reveal both controls in the row.
  assert.match(styles, /\.thread-item:hover \.thread-item-more,/);
  assert.match(styles, /\.thread-item:focus-within \.thread-item-more,/);
  assert.match(styles, /\.thread-item-more:focus-visible \{/);
  // Opening the row menu reveals only the button that owns aria-expanded.
  assert.match(styles, /\.thread-item-more\[aria-expanded="true"\] \{/);
  // A pointer without hover gets both controls without a reveal gesture.
  const touch = styles.slice(styles.indexOf("@media (hover: none)"));
  assert.match(touch, /\.sidebar-row-actions \.thread-item-more,/);

  // The two squares are separated, and the title keeps its ellipsis budget.
  assert.match(block(styles, ".sidebar-row-actions {"), /gap: 2px/);
});
