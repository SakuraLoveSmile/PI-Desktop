import type { ProjectGroupRecord, SessionSummary } from "@pi-desktop/shared";
import type { ProjectMeta } from "./sidebar-preferences.ts";
import { normalizeProjectPath } from "./sidebar-session-groups.ts";
import { sessionProjectDisplayName } from "./session-projects.ts";

export type MemoryProject = NonNullable<ProjectGroupRecord["memoryProject"]>;

type MemoryGroup = Pick<ProjectGroupRecord, "id" | "primaryPath" | "roots" | "name" | "memoryProject">;

/** Presentation only: a shared memory identity never adds filesystem roots. */
export function collapseMemoryProjectGroups<T extends MemoryGroup>(groups: readonly T[]): T[] {
  const grouped = new Map<string, T[]>();
  for (const group of groups) {
    const key = group.memoryProject ? `memory:${group.memoryProject.id}` : `group:${group.id}`;
    const members = grouped.get(key) ?? [];
    members.push(group);
    grouped.set(key, members);
  }
  return [...grouped.values()].map((members) => {
    const memory = members[0].memoryProject;
    if (!memory) return members[0];
    const representative = members.find((group) =>
      normalizeProjectPath(group.primaryPath) === normalizeProjectPath(memory.primaryPath)) ?? members[0];
    return { ...representative, memoryProject: { ...memory,
      paths: [...new Set(members.flatMap((group) => [
        ...(group.memoryProject?.paths ?? []), ...group.roots.map((root) => root.path),
      ]))],
    } };
  });
}

export function memoryProjectPaths(group: MemoryGroup): string[] {
  return [...new Set([group.primaryPath, ...group.roots.map((root) => root.path),
    ...(group.memoryProject?.paths ?? [])])];
}

export function memoryProjectForPath<T extends MemoryGroup>(groups: readonly T[], path: string): T | undefined {
  const key = normalizeProjectPath(path);
  return groups.find((group) => [group.primaryPath, ...group.roots.map((root) => root.path)]
    .some((candidate) => normalizeProjectPath(candidate) === key)) ??
    groups.find((group) => memoryProjectPaths(group).some((candidate) => normalizeProjectPath(candidate) === key));
}

export type SidebarMemoryProject = {
  path: string;
  actionPath: string;
  groupId?: string;
  roots?: ProjectGroupRecord["roots"];
  legacy?: boolean;
  key: string;
  name: string;
  sessions: SessionSummary[];
  open: boolean;
  active: boolean;
  meta: ProjectMeta;
  branch?: string;
  /** UI membership only; never passed to a file tool or project-group update. */
  paths: string[];
  memoryProject?: MemoryProject;
};

export function buildSidebarMemoryProjects(args: {
  groups: readonly ProjectGroupRecord[];
  openPaths: readonly string[];
  workspaces: readonly { path: string; name: string; branch?: string }[];
  workspace?: { path: string; name: string; branch?: string } | null;
  sessions: readonly SessionSummary[];
  projectMeta: Record<string, ProjectMeta>;
  activePath: string | null;
}): SidebarMemoryProject[] {
  const groups = collapseMemoryProjectGroups(args.groups);
  const entries = new Map<string, SidebarMemoryProject>();
  const add = (path: string, name?: string, branch?: string) => {
    const normalized = normalizeProjectPath(path);
    if (!normalized) return;
    const source = memoryProjectForPath(args.groups, path);
    const group = source?.memoryProject
      ? groups.find((item) => item.memoryProject?.id === source.memoryProject?.id) : source;
    const memory = group?.memoryProject;
    const target = memory?.primaryPath ?? path;
    const key = normalizeProjectPath(target)!;
    const existing = entries.get(key);
    if (existing) {
      if (normalized === args.activePath) {
        existing.actionPath = source?.primaryPath ?? path;
        existing.groupId = source?.id;
        existing.roots = source?.roots;
        existing.legacy = source?.legacy;
        existing.branch = branch;
      }
      existing.active ||= normalized === args.activePath;
      return;
    }
    const meta = args.projectMeta[key] ?? args.projectMeta[target] ?? {};
    const fallbackName = target.split(/[\\/]/).filter(Boolean).at(-1) ?? target;
    entries.set(key, { path: target, actionPath: source?.primaryPath ?? path,
      groupId: source?.id, roots: source?.roots, legacy: source?.legacy,
      key, name: meta.name ?? memory?.name ?? name ?? fallbackName,
      sessions: [], open: true, active: normalized === args.activePath, meta, branch,
      paths: memory && group ? memoryProjectPaths(group).filter((candidate) =>
        memoryProjectForPath(args.groups, candidate)?.memoryProject?.id === memory.id) : [path],
      memoryProject: memory });
  };
  for (const path of args.openPaths) {
    const workspace = args.workspaces.find((item) => normalizeProjectPath(item.path) === normalizeProjectPath(path));
    add(path, workspace?.name, workspace?.branch);
  }
  if (args.workspace) add(args.workspace.path, args.workspace.name, args.workspace.branch);
  for (const session of args.sessions) {
    const path = normalizeProjectPath(session.projectPath);
    if (!path) continue;
    const memoryId = session.memoryProjectId ?? memoryProjectForPath(args.groups, session.projectPath!)?.memoryProject?.id;
    const entry = [...entries.values()].find((item) => memoryId
      ? item.memoryProject?.id === memoryId
      : item.paths.some((candidate) => normalizeProjectPath(candidate) === path));
    if (!entry) continue;
    if (!entry.meta.name && !memoryProjectForPath(groups, session.projectPath!)?.memoryProject &&
        entry.name === entry.path.split(/[\\/]/).filter(Boolean).at(-1)) {
      entry.name = sessionProjectDisplayName(session);
    }
    entry.sessions.push(session);
  }
  return [...entries.values()];
}
