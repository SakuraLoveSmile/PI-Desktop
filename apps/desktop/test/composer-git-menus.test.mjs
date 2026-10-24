import assert from "node:assert/strict";
import { createElement } from "react";
import { register } from "node:module";
import test from "node:test";
import { slotSsr } from "./helpers/slot-ssr.mjs";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  branchOccupiedElsewhere, canChangeBranch, canCreateWorktree,
  managedWorktrees, visibleLocalBranches, composerFooterMenuKeyDown, projectPathInCheckout,
} = await import("../src/features/chat/composer/composer-git-menu.ts");

const git = {
  projectPath: "/project/src",
  rootPath: "/project",
  mainPath: "/project",
  branch: "main",
  head: "commit-1",
  dirty: false,
  isWorktree: false,
  branches: [
    { name: "main", current: true, checkedOutPath: "/project/" },
    { name: "feature/UI", current: false },
    { name: "agent/busy", current: false, checkedOutPath: "/other-agent" },
  ],
  worktrees: [
    { path: "/project", branch: "main", isMain: true, managed: false },
    { path: "/agent-checkout", branch: "agent/busy", isMain: false, managed: false },
    { path: "/app-checkout", branch: "app/ui", isMain: false, managed: true },
  ],
};
const props = {
  git, loading: false, busy: false, error: null, disabled: false,
  onReload() {}, onSwitch: async () => {}, onCreate: async () => {},
  onLocal: async () => {}, onWorktree: async () => {}, onCreateWorktree: async () => {},
};

test("local-branch search preserves names and current flags without a fabricated fallback", () => {
  assert.deepEqual(visibleLocalBranches(git, " FEATURE/ui "), [git.branches[1]]);
  assert.deepEqual(visibleLocalBranches(git, "no match"), []);
  assert.deepEqual(visibleLocalBranches(null, ""), []);
  assert.deepEqual(visibleLocalBranches(git, ""), git.branches);
});

test("branch occupancy compares the Git checkout root, not a nested project folder", () => {
  assert.equal(branchOccupiedElsewhere(git.branches[0], git), false);
  assert.equal(branchOccupiedElsewhere(git.branches[1], git), false);
  assert.equal(branchOccupiedElsewhere(git.branches[2], git), true);
  assert.equal(branchOccupiedElsewhere({ name: "main", current: true, checkedOutPath: "C:\\project\\" }, { ...git, rootPath: "C:/project" }), false);
});

test("branch changes require a committed HEAD and clean, available workspace", () => {
  assert.equal(canChangeBranch(git, false), true);
  assert.equal(canChangeBranch({ ...git, dirty: true }, false), false);
  assert.equal(canChangeBranch({ ...git, head: null }, false), false);
  assert.equal(canChangeBranch(git, true), false);
  assert.equal(canChangeBranch(null, false), false);
});

test("worktree creation may preserve source dirt but still needs HEAD and availability", () => {
  assert.equal(canCreateWorktree({ ...git, dirty: true }, false), true);
  assert.equal(canCreateWorktree({ ...git, head: null }, false), false);
  assert.equal(canCreateWorktree(git, true), false);
  assert.equal(canCreateWorktree(null, false), false);
});

test("the Worktree picker only exposes non-primary app-managed checkouts", () => {
  assert.deepEqual(managedWorktrees(git), [git.worktrees[2]]);
  assert.deepEqual(managedWorktrees({ ...git, worktrees: [{ ...git.worktrees[0], managed: true }] }), []);
  assert.deepEqual(managedWorktrees(null), []);
});

test("keyboard selection enters search results while preserving form editing and IME", (t) => {
  const previousInput = globalThis.HTMLInputElement;
  class MenuInput {
    constructor(search) { this.search = search; }
    hasAttribute() { return this.search; }
  }
  globalThis.HTMLInputElement = MenuInput;
  t.after(() => {
    if (previousInput) globalThis.HTMLInputElement = previousInput;
    else delete globalThis.HTMLInputElement;
  });
  let focused = null;
  let prevented = false;
  const actions = [0, 1].map((id) => ({ focus() { focused = id; } }));
  const event = (key, target, isComposing = false) => ({
    key, target, nativeEvent: { isComposing },
    currentTarget: { querySelectorAll: () => actions },
    preventDefault() { prevented = true; },
  });
  composerFooterMenuKeyDown(event("ArrowDown", new MenuInput(true)));
  assert.equal(focused, 0);
  assert.equal(prevented, true);
  composerFooterMenuKeyDown(event("ArrowUp", actions[0]));
  assert.equal(focused, 1);
  composerFooterMenuKeyDown(event("Home", actions[1]));
  assert.equal(focused, 0);
  focused = null;
  prevented = false;
  composerFooterMenuKeyDown(event("ArrowDown", new MenuInput(false)));
  composerFooterMenuKeyDown(event("Home", new MenuInput(true)));
  composerFooterMenuKeyDown(event("ArrowDown", actions[0], true));
  assert.equal(focused, null);
  assert.equal(prevented, false);
});

test("the public branch trigger displays authoritative branch and remains readable while blocked", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerBranchMenu } = await ssr.load("/src/features/chat/composer/ComposerBranchMenu.tsx");
  const html = ssr.render(createElement(ComposerBranchMenu, { ...props, disabled: true, busy: true }));
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<span>main<\/span>/);
  assert.doesNotMatch(html, / disabled(?:="")?/);
  const detached = ssr.render(createElement(ComposerBranchMenu, { ...props, git: { ...git, branch: null } }));
  assert.doesNotMatch(detached, /<span>main<\/span>/);
});

test("a detached HEAD names its short commit instead of reporting that no branch exists", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerBranchMenu } = await ssr.load("/src/features/chat/composer/ComposerBranchMenu.tsx");
  const html = ssr.render(createElement(ComposerBranchMenu, { ...props, git: { ...git, branch: null, head: "9f3c2ab4d1e0f7a8b6c5d4e3f2a1b0c9d8e7f6a5" } }));
  assert.match(html, /Detached HEAD · 9f3c2ab/);
  assert.doesNotMatch(html, /No branch/);
});

test("the public location trigger follows actual checkout metadata and remote ownership", async (t) => {
  const ssr = await slotSsr(t);
  const { ComposerLocationMenu } = await ssr.load("/src/features/chat/composer/ComposerLocationMenu.tsx");
  const local = ssr.render(createElement(ComposerLocationMenu, props));
  const worktree = ssr.render(createElement(ComposerLocationMenu, { ...props, git: { ...git, isWorktree: true } }));
  const remote = ssr.render(createElement(ComposerLocationMenu, { ...props, git: { ...git, isWorktree: true }, remote: true }));
  assert.match(local, /aria-haspopup="menu"/);
  assert.match(local, /composer-footer-trigger/);
  assert.notEqual(local, worktree);
  assert.notEqual(remote, worktree);
  assert.match(remote, /<span>Remote<\/span>/);
});


test("checkout navigation retains the subproject root and refuses path escape", () => {
  assert.equal(projectPathInCheckout(git, "/managed/tree"), "/managed/tree/src");
  assert.equal(projectPathInCheckout({ ...git, projectPath: "/project" }, "/managed/tree"), "/managed/tree");
  assert.equal(projectPathInCheckout({ ...git, rootPath: "/managed/tree", projectPath: "/managed/tree/src" }, "/project"), "/project/src");
  assert.equal(projectPathInCheckout({ ...git, projectPath: "/project-other/src" }, "/managed/tree"), null);
  assert.equal(projectPathInCheckout({ ...git, projectPath: "/project/../outside" }, "/managed/tree"), null);
  assert.equal(projectPathInCheckout({ ...git, rootPath: "C:\\Repo", projectPath: "c:\\repo\\apps\\frontend" }, "D:\\Managed\\Tree"), "D:/Managed/Tree/apps/frontend");
});
