import type { GitBranch, GitWorkspaceSnapshot } from "@pi-desktop/shared";
import type { KeyboardEvent } from "react";
import { normalizeProjectPath } from "../../../lib/sidebar-session-groups";

export function branchOccupiedElsewhere(branch: GitBranch, git: GitWorkspaceSnapshot): boolean {
  return Boolean(branch.checkedOutPath &&
    normalizeProjectPath(branch.checkedOutPath) !== normalizeProjectPath(git.rootPath));
}

export function visibleLocalBranches(git: GitWorkspaceSnapshot | null, query: string): GitBranch[] {
  const needle = query.trim().toLocaleLowerCase();
  return git?.branches.filter((branch) => branch.name.toLocaleLowerCase().includes(needle)) ?? [];
}

export function canChangeBranch(git: GitWorkspaceSnapshot | null, blocked: boolean): boolean {
  return Boolean(git?.head && !git.dirty && !blocked);
}

export function canCreateWorktree(git: GitWorkspaceSnapshot | null, blocked: boolean): boolean {
  // A new checkout starts from committed HEAD and leaves the source worktree intact.
  return Boolean(git?.head && !blocked);
}

/** Short commit that names a detached HEAD; null while HEAD is on a branch or has no commit yet. */
export function detachedHeadShortSha(git: GitWorkspaceSnapshot | null): string | null {
  if (!git || git.branch || !git.head) return null;
  return git.head.slice(0, 7);
}

export function managedWorktrees(git: GitWorkspaceSnapshot | null) {
  return git?.worktrees.filter((worktree) => worktree.managed && !worktree.isMain) ?? [];
}

/** Arrow keys move through visible actions; text-field editing and IME stay native. */
export function composerFooterMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.nativeEvent.isComposing) return;
  const target = event.target;
  const inInput = target instanceof HTMLInputElement;
  if (inInput && !target.hasAttribute("data-menu-search")) return;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  if (inInput && ["Home", "End"].includes(event.key)) return;
  const actions = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
  if (!actions.length) return;
  event.preventDefault();
  const current = actions.findIndex((button) => button === target);
  const index = event.key === "Home" ? 0 : event.key === "End" ? actions.length - 1 :
    current < 0 ? (event.key === "ArrowUp" ? actions.length - 1 : 0) :
      (current + (event.key === "ArrowUp" ? -1 : 1) + actions.length) % actions.length;
  actions[index]?.focus();
}

/** Preserve a monorepo subproject's relative execution directory across checkouts. */
export function projectPathInCheckout(git: GitWorkspaceSnapshot, targetRoot: string): string | null {
  const project = normalizeProjectPath(git.projectPath);
  const root = normalizeProjectPath(git.rootPath);
  const target = normalizeProjectPath(targetRoot);
  if (!project || !root || !target) return null;
  const windows = /^[A-Za-z]:\//.test(root) || root.startsWith("//");
  const comparable = (value: string) => windows ? value.toLowerCase() : value;
  if (comparable(project) === comparable(root)) return target;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (!comparable(project).startsWith(comparable(prefix))) return null;
  const relative = project.slice(prefix.length);
  if (relative.split("/").some(segment => segment === "." || segment === "..")) return null;
  return `${target.replace(/\/$/, "")}/${relative}`;
}
