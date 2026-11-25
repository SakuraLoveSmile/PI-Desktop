import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { slotSsr } from "./helpers/slot-ssr.mjs";

/*
 * The workspace strip's menus (project, location, branch) draw one row
 * language (PI-UI-1126, D652). The menus portal their contents to the body, so
 * what a row says, which rows are inert and why is tested on the exported body
 * components, which hold every row and reason; where the portal puts them is
 * covered by the Electron E2E.
 */

const noop = () => {};
const PARTS = "/src/features/chat/composer/strip-menu-parts.tsx";
const PROJECT = "/src/features/chat/composer/ComposerProjectMenu.tsx";
const LOCATION = "/src/features/chat/composer/ComposerLocationMenu.tsx";
const BRANCH = "/src/features/chat/composer/ComposerBranchMenu.tsx";

/** Every button of `html` with what a user reads, and what decides whether it can be used. */
function buttons(html) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, open, inner]) => ({
    role: open.match(/\srole="([^"]*)"/)?.[1] ?? null,
    checked: open.match(/\saria-checked="([^"]*)"/)?.[1] ?? null,
    name: open.match(/\saria-label="([^"]*)"/)?.[1] ?? null,
    type: open.match(/\stype="([^"]*)"/)?.[1] ?? null,
    disabled: / disabled=""/.test(open),
    className: open.match(/\sclass="([^"]*)"/)?.[1] ?? "",
    text: inner.replace(/<[^>]*>/g, ""),
    label: inner.match(/<span class="composer-footer-label">([^<]*)<\/span>/)?.[1] ?? null,
    sub: inner.match(/<span class="composer-footer-sub[^"]*">(?:<bdi>)?([^<]*)</)?.[1] ?? null,
    tag: inner.match(/<span class="composer-footer-tag">([^<]*)<\/span>/)?.[1] ?? null,
    current: /composer-footer-check/.test(inner),
  }));
}
const rowOf = (html, label) => buttons(html).find((row) => row.label === label);
const labelsOf = (html) => buttons(html).map((row) => row.label);
const bannerOf = (html) =>
  html.match(/<div class="composer-footer-banner" role="status">[\s\S]*?<span>([^<]*)<\/span>/)?.[1] ?? null;
const titleOf = (html) => html.match(/<span class="composer-footer-title">([^<]*)<\/span>/)?.[1] ?? null;
const countOf = (html, text) => html.split(text).length - 1;

const TEXT = {
  runLocked: "A task is running in this project, so switching is unavailable for now.",
  dirty: "Commit or move staged, unstaged and untracked changes before switching branches.",
  noGit: "This directory is not a Git repository.",
};

const checkout = {
  projectPath: "/work/app",
  rootPath: "/work/app",
  mainPath: "/work/app",
  branch: "main",
  head: "abc1234",
  dirty: false,
  isWorktree: false,
  branches: [
    { name: "main", current: true, checkedOutPath: "/work/app" },
    { name: "feature/ui", current: false },
    { name: "agent/busy", current: false, checkedOutPath: "/other-agent" },
  ],
  worktrees: [
    { path: "/work/app", branch: "main", isMain: true, managed: false },
    { path: "/work/wt/fix", branch: "fix/badge", isMain: false, managed: true },
    { path: "/work/wt/foreign", branch: "foreign", isMain: false, managed: false },
  ],
};

test("a project's parent folder is its second line, with the home folder written ~", async (t) => {
  const ssr = await slotSsr(t);
  const { projectParentLabel } = await ssr.load(PARTS);
  assert.equal(projectParentLabel("/Users/me/Code/app"), "~/Code");
  assert.equal(projectParentLabel("/home/me/app"), "~");
  assert.equal(projectParentLabel("/srv/work/app/"), "/srv/work", "a trailing slash does not hide the folder");
  assert.equal(projectParentLabel("C:\\Work\\app"), "C:\\Work");
  assert.equal(projectParentLabel("/app"), "", "a project at the filesystem root has no folder line");
  assert.equal(projectParentLabel(""), "");
});

const projectProps = {
  projects: [
    { key: "/users/me/code/app", name: "App", path: "/Users/me/Code/app" },
    { key: "/solo", name: "Solo", path: "/solo" },
  ],
  activeKey: "/users/me/code/app",
  highlight: 1,
  query: "",
  listId: "projects",
  disabled: false,
  rowRef: noop,
  onQuery: noop,
  onHighlight: noop,
  onSelect: noop,
  onNewWorkspace: noop,
  onConnectSsh: noop,
};

test("a project row is its name over the folder that holds it, and the current one is checked", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerProjectMenuBody } = await ssr.load(PROJECT);
  const html = ssr.render(createElement(ComposerProjectMenuBody, projectProps), { sessionId: null });
  const [current, other] = buttons(html);

  assert.equal(current.role, "menuitemradio");
  assert.equal(current.checked, "true");
  assert.equal(current.name, "App", "the accessible name is the project, not its folder");
  assert.equal(current.label, "App");
  assert.equal(current.sub, "~/Code");
  assert.ok(current.current, "a check marks the current project");
  assert.match(current.className, /is-two-line/);
  assert.match(current.className, /is-current/);

  assert.equal(other.checked, "false");
  assert.equal(other.label, "Solo");
  assert.equal(other.sub, null, "a project at the root has no folder line");
  assert.ok(!other.current);
  assert.doesNotMatch(other.className, /is-two-line/);
  assert.match(other.className, /is-active/, "the highlighted row is the one Enter picks");

  assert.match(html, /<input[^>]*aria-label="Search projects or paths"[^>]*aria-controls="projects"/);
});

test("the workspace actions follow the projects and are inert while a switch runs", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerProjectMenuBody } = await ssr.load(PROJECT);
  const idle = buttons(ssr.render(createElement(ComposerProjectMenuBody, projectProps), { sessionId: null }));
  assert.deepEqual(idle.slice(2).map((row) => [row.role, row.label]), [
    ["menuitem", "New workspace"],
    ["menuitem", "Connect SSH"],
    ["menuitem", "No workspace"],
  ]);
  assert.ok(idle.every((row) => !row.disabled));

  const busy = buttons(
    ssr.render(createElement(ComposerProjectMenuBody, { ...projectProps, disabled: true }), { sessionId: null }),
  );
  assert.equal(busy.length, 5);
  assert.ok(busy.every((row) => row.disabled), "rows and actions wait for the switch");
});

test("a search with no match says so and keeps the workspace actions", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerProjectMenuBody } = await ssr.load(PROJECT);
  const html = ssr.render(
    createElement(ComposerProjectMenuBody, { ...projectProps, projects: [], query: "zzz" }),
    { sessionId: null },
  );
  assert.match(html, /role="status"[^>]*>No matching projects</);
  assert.deepEqual(labelsOf(html), ["New workspace", "Connect SSH", "No workspace"]);
});

const locationProps = {
  view: "root",
  git: checkout,
  isWorktree: false,
  remote: false,
  blocked: false,
  locked: false,
  canCreate: true,
  pending: false,
  loading: false,
  busy: false,
  name: "",
  diagnostic: null,
  onName: noop,
  onBack: noop,
  onChooseLocal: noop,
  onOpenWorktrees: noop,
  onPickWorktree: noop,
  onNewWorktree: noop,
  onSubmit: noop,
};
const renderLocation = (ssr, ComposerLocationMenuBody, props = {}) =>
  ssr.render(createElement(ComposerLocationMenuBody, { ...locationProps, ...props }), { sessionId: null });

test("the location menu names each mode and says what it does", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenuBody } = await ssr.load(LOCATION);
  const html = renderLocation(ssr, ComposerLocationMenuBody);
  const [local, worktree] = buttons(html);

  assert.deepEqual([local.role, local.label, local.sub], ["menuitemradio", "Local", "Work directly in the project folder"]);
  assert.deepEqual([worktree.role, worktree.label, worktree.sub], ["menuitemradio", "Worktree", "Separate folder and branch"]);
  assert.match(local.className, /is-two-line/);
  assert.equal(local.checked, "true");
  assert.ok(local.current);
  assert.equal(worktree.checked, "false");
  assert.ok(!worktree.current);
  assert.ok(!local.disabled && !worktree.disabled);
  assert.equal(bannerOf(html), null, "an idle menu has nothing to explain");

  const inWorktree = buttons(renderLocation(ssr, ComposerLocationMenuBody, { isWorktree: true }));
  assert.deepEqual(inWorktree.map((row) => [row.checked, row.current]), [["false", false], ["true", true]]);
});

test("a remote conversation checks neither mode, and a directory without Git cannot open the worktree list", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenuBody } = await ssr.load(LOCATION);
  const remote = buttons(renderLocation(ssr, ComposerLocationMenuBody, { remote: true, blocked: true }));
  assert.deepEqual(remote.map((row) => [row.checked, row.current, row.disabled]), [
    ["false", false, true],
    ["false", false, true],
  ]);

  const html = renderLocation(ssr, ComposerLocationMenuBody, { git: null });
  const [local, worktree] = buttons(html);
  assert.ok(!local.disabled);
  assert.ok(worktree.disabled);
  assert.match(html, new RegExp(`class="composer-footer-hint">${TEXT.noGit}<`));
});

test("a running task locks the location menu and the menu says why", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenuBody } = await ssr.load(LOCATION);
  const html = renderLocation(ssr, ComposerLocationMenuBody, { blocked: true, locked: true });
  assert.equal(bannerOf(html), TEXT.runLocked);
  assert.ok(buttons(html).every((row) => row.disabled), "no row can be used while the task runs");
  assert.ok(html.indexOf("composer-footer-banner") < html.indexOf("composer-footer-list"), "the reason comes first");
});

test("the worktree list shows only app-managed checkouts and checks the one in use", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenuBody } = await ssr.load(LOCATION);
  const html = renderLocation(ssr, ComposerLocationMenuBody, {
    view: "worktrees",
    git: { ...checkout, rootPath: "/work/wt/fix", isWorktree: true },
    isWorktree: true,
  });
  assert.equal(titleOf(html), "Worktree");
  const [back, row, create] = buttons(html);
  assert.equal(back.name, "Back", "the back arrow is named even though it draws no text");
  assert.equal(back.text, "");
  assert.deepEqual([row.role, row.label, row.checked, row.current], ["menuitemradio", "fix/badge", "true", true]);
  assert.equal(buttons(html).length, 3, "the main checkout and a foreign worktree are not offered");
  assert.equal(create.label, "New worktree");
  assert.ok(!create.disabled);
  assert.match(html, /class="composer-footer-hint">Starts from committed HEAD;/);

  const locked = buttons(renderLocation(ssr, ComposerLocationMenuBody, { view: "worktrees", blocked: true, canCreate: false }));
  assert.ok(locked[1].disabled, "a worktree cannot be picked while blocked");
  assert.ok(locked[2].disabled, "and a new one cannot be started");
});

test("the create view labels its field, shows the hint, and submits only a named worktree", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenuBody } = await ssr.load(LOCATION);
  const empty = renderLocation(ssr, ComposerLocationMenuBody, { view: "create" });
  assert.equal(titleOf(empty), "New worktree");
  const labelFor = empty.match(/<label class="composer-footer-field-label" for="([^"]+)">New worktree branch<\/label>/)?.[1];
  assert.ok(labelFor, "the field has a visible label");
  assert.match(empty, new RegExp(`<input[^>]*id="${labelFor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), "the label points at the input");
  assert.match(empty, /class="composer-footer-field-hint">Starts from committed HEAD;/);

  const submit = (props) => buttons(renderLocation(ssr, ComposerLocationMenuBody, { view: "create", ...props })).at(-1);
  assert.deepEqual([submit({}).type, submit({}).text], ["submit", "Create worktree"]);
  assert.ok(submit({ name: "" }).disabled, "an empty name cannot be submitted");
  assert.ok(submit({ name: "   " }).disabled, "neither can whitespace");
  assert.ok(!submit({ name: "feat/menus" }).disabled);
  assert.ok(submit({ name: "feat/menus", canCreate: false }).disabled, "or a name when the checkout cannot host a worktree");
  assert.match(submit({}).className, /composer-footer-submit/);

  const pending = renderLocation(ssr, ComposerLocationMenuBody, { view: "create", name: "x", pending: true, blocked: true });
  assert.match(pending, /<input[^>]*disabled=""/, "the field waits while the worktree is created");
  assert.ok(buttons(pending)[0].disabled, "so does the back arrow");
  assert.match(pending, /role="status"[^>]*>A checkout operation is in progress\./);
});

test("a failed action is announced in the menu", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenuBody } = await ssr.load(LOCATION);
  const { ComposerBranchMenuBody } = await ssr.load(BRANCH);
  const location = renderLocation(ssr, ComposerLocationMenuBody, { diagnostic: "Checkout became dirty" });
  assert.match(location, /<p role="alert" class="composer-footer-error">Checkout became dirty<\/p>/);
  const branch = ssr.render(
    createElement(ComposerBranchMenuBody, { ...branchProps, diagnostic: "Checkout became dirty" }),
    { sessionId: null },
  );
  assert.match(branch, /<p role="alert" class="composer-footer-error">Checkout became dirty<\/p>/);
});

const branchProps = {
  git: checkout,
  creating: false,
  query: "",
  name: "",
  loading: false,
  busy: false,
  pending: false,
  blocked: false,
  canMutate: true,
  locked: false,
  diagnostic: null,
  onQuery: noop,
  onName: noop,
  onBack: noop,
  onPickBranch: noop,
  onNewBranch: noop,
  onSubmit: noop,
};
const renderBranch = (ssr, ComposerBranchMenuBody, props = {}) =>
  ssr.render(createElement(ComposerBranchMenuBody, { ...branchProps, ...props }), { sessionId: null });

test("the branch list checks the current branch and marks one held by another checkout", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerBranchMenuBody } = await ssr.load(BRANCH);
  const html = renderBranch(ssr, ComposerBranchMenuBody);
  const [main, feature, busy, create] = buttons(html);

  assert.deepEqual([main.role, main.label, main.checked, main.current, main.disabled], ["menuitemradio", "main", "true", true, false]);
  assert.deepEqual([feature.label, feature.checked, feature.disabled, feature.tag], ["feature/ui", "false", false, null]);
  assert.deepEqual([busy.label, busy.disabled, busy.tag], ["agent/busy", true, "In use"], "the row says why it cannot be picked");
  assert.equal(create.label, "New branch");
  assert.ok(!create.disabled);
  assert.equal(bannerOf(html), null);
  assert.match(html, /<input[^>]*data-menu-search="true"[^>]*aria-label="Search branches"/, "arrow keys leave the search for the rows");
  assert.match(html, /<div class="composer-footer-heading">Local branches<\/div>/);
});

test("a dirty checkout says so once and drops the per-row reasons", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerBranchMenuBody } = await ssr.load(BRANCH);
  const html = renderBranch(ssr, ComposerBranchMenuBody, { git: { ...checkout, dirty: true }, canMutate: false });
  assert.equal(bannerOf(html), TEXT.dirty);
  const [main, feature, busy, create] = buttons(html);
  assert.ok(!main.disabled, "the current branch stays reachable");
  assert.ok(feature.disabled && busy.disabled && create.disabled, "every change waits for a clean checkout");
  assert.equal(busy.tag, null, "no row needs its own reason when none can change");
});

test("a running task outranks a dirty checkout, and nothing in the menu can be used", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerBranchMenuBody } = await ssr.load(BRANCH);
  const html = renderBranch(ssr, ComposerBranchMenuBody, {
    git: { ...checkout, dirty: true },
    blocked: true,
    canMutate: false,
    locked: true,
  });
  assert.equal(bannerOf(html), TEXT.runLocked);
  assert.doesNotMatch(html, /Commit or move staged/, "one reason at a time");
  assert.ok(buttons(html).every((row) => row.disabled));
  assert.ok(buttons(html).every((row) => row.tag === null));
});

test("branch search filters the rows, and an empty result or a missing repository is explained", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerBranchMenuBody } = await ssr.load(BRANCH);
  assert.deepEqual(labelsOf(renderBranch(ssr, ComposerBranchMenuBody, { query: "FEAT" })), ["feature/ui", "New branch"]);

  const none = renderBranch(ssr, ComposerBranchMenuBody, { query: "zzz" });
  assert.deepEqual(labelsOf(none), ["New branch"]);
  assert.match(none, /class="composer-footer-hint">No matching branches</);

  const noGit = renderBranch(ssr, ComposerBranchMenuBody, { git: null, canMutate: false });
  assert.match(noGit, new RegExp(`class="composer-footer-hint">${TEXT.noGit}<`));
});

test("the new-branch form names its field and submits only a named branch", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerBranchMenuBody } = await ssr.load(BRANCH);
  const form = (props = {}) => renderBranch(ssr, ComposerBranchMenuBody, { creating: true, ...props });
  const empty = form();
  assert.equal(titleOf(empty), "New branch");
  assert.match(empty, /<label class="composer-footer-field-label" for="[^"]+">Branch name<\/label>/);
  assert.doesNotMatch(empty, /menuitemradio|data-menu-search/, "the list gives way to the form");
  assert.equal(buttons(empty)[0].name, "Back");

  const submit = (props) => buttons(form(props)).at(-1);
  assert.deepEqual([submit().type, submit().text], ["submit", "Create and switch"]);
  assert.ok(submit({ name: " " }).disabled);
  assert.ok(!submit({ name: "feat/menus" }).disabled);
  assert.ok(submit({ name: "feat/menus", canMutate: false }).disabled, "a dirty or busy checkout cannot take a new branch");
  assert.match(form({ name: "x", blocked: true }), /<input[^>]*disabled=""/);
});

test("a trigger ends in a chevron, or in a lock while a running task holds the menu", async (t) => {
  const ssr = await slotSsr(t);
  const { StripTriggerTail } = await ssr.load(PARTS);
  const open = ssr.render(createElement(StripTriggerTail, {}), { sessionId: null });
  assert.match(open, /composer-footer-chevron/);
  assert.doesNotMatch(open, /composer-footer-lock/);
  const locked = ssr.render(createElement(StripTriggerTail, { locked: true }), { sessionId: null });
  assert.match(locked, /composer-footer-lock/);
  assert.doesNotMatch(locked, /composer-footer-chevron/);
  for (const html of [open, locked]) assert.match(html, /aria-hidden="true"/, "the glyph adds nothing to the trigger's name");
});

test("the location and branch triggers lock together, and keep their names", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenu } = await ssr.load(LOCATION);
  const { ComposerBranchMenu } = await ssr.load(BRANCH);
  const props = {
    git: checkout, loading: false, busy: false, error: null, disabled: false,
    onReload: noop, onSwitch: async () => {}, onCreate: async () => {},
    onLocal: async () => {}, onWorktree: async () => {}, onCreateWorktree: async () => {},
  };
  for (const Menu of [ComposerLocationMenu, ComposerBranchMenu]) {
    const idle = ssr.render(createElement(Menu, props), { sessionId: null });
    assert.match(idle, /composer-footer-chevron/);
    assert.doesNotMatch(idle, /composer-footer-lock/);
    const locked = ssr.render(createElement(Menu, { ...props, locked: true }), { sessionId: null });
    assert.match(locked, /composer-footer-lock/);
    assert.doesNotMatch(locked, /composer-footer-chevron/);
    assert.ok(!buttons(locked)[0].disabled, "a locked menu still opens, to say why");
  }
  const branch = ssr.render(createElement(ComposerBranchMenu, { ...props, locked: true }), { sessionId: null });
  assert.equal(buttons(branch)[0].name, "main", "the name is the branch, not the reason");
});

test("the strip locks the location and branch menus while any session in the project runs", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerWorkspaceContext } = await ssr.load("/src/features/chat/composer/ComposerWorkspaceContext.tsx");
  const { useAppStore } = await ssr.load("/src/stores/app-store.ts");
  // Server renders read zustand's initial state, so the fixture is patched there
  // and restored after the render (see composer-top-strip.test.mjs).
  const initial = { ...useAppStore.getInitialState() };
  const sessions = [
    { id: "local", source: "desktop", projectPath: "/isolated/project-a", projectName: "Project A" },
    { id: "sibling", source: "desktop", projectPath: "/isolated/project-a", projectName: "Project A" },
    { id: "elsewhere", source: "desktop", projectPath: "/isolated/project-b", projectName: "Project B" },
  ];
  const strings = (key) => key;
  const render = (runningSessions) => {
    Object.assign(useAppStore.getInitialState(), { activeSessionId: "local", sessions, runningSessions });
    return ssr.render(createElement(ComposerWorkspaceContext, { t: strings, running: false }), { sessionId: null });
  };
  try {
    const idle = render({});
    assert.equal(countOf(idle, "composer-footer-chevron"), 3, "project, location and branch are all open");
    assert.equal(countOf(idle, "composer-footer-lock"), 0);

    const sibling = render({ sibling: true });
    assert.equal(countOf(sibling, "composer-footer-lock"), 2, "a sibling session's run locks this one's checkout menus");
    assert.equal(countOf(sibling, "composer-footer-chevron"), 1, "the project menu stays a menu");

    const elsewhere = render({ elsewhere: true });
    assert.equal(countOf(elsewhere, "composer-footer-lock"), 0, "another project's run does not");
  } finally {
    Object.assign(useAppStore.getInitialState(), initial);
  }
});
