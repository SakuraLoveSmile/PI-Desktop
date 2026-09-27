import type { SessionSummary } from "@pi-desktop/shared";


/// Display name for a session's project, applying the frozen precedence:
/// the Host-persisted `projectName` first, the directory basename otherwise.
/// Never used for identity, dedup, permissions or path decisions.
export function sessionProjectDisplayName(
  session: Pick<SessionSummary, "projectPath" | "projectName">,
): string {
  const persisted = session.projectName?.trim();
  if (persisted) return persisted;
  return projectName(session.projectPath ?? "");
}
export type SessionProject = {
  path: string;
  name: string;
  updatedAt: number;
};

function projectName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function normalizedProjectKey(projectPath?: string | null): string | null {
  const value = projectPath?.trim();
  if (!value) return null;
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

export function collectSessionProjects(sessions: SessionSummary[]): SessionProject[] {
  const projects = new Map<string, SessionProject>();

  for (const session of sessions) {
    const normalizedPath = normalizedProjectKey(session.projectPath);
    if (!normalizedPath || !session.projectPath) continue;

    const updatedAt = Date.parse(session.updatedAt);
    const existing = projects.get(normalizedPath);
    if (!existing) {
      projects.set(normalizedPath, {
        path: session.projectPath,
        // Frozen precedence (KaneoPilot protocol §5.23.10 T6): the Host
        // persisted `projectName` outranks the directory basename. Workspace
        // identity stays keyed by the canonical path, so two worktrees of the
        // same project keep separate entries that merely share a display name.
        name: sessionProjectDisplayName(session),
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      });
      continue;
    }
    if (Number.isFinite(updatedAt) && updatedAt > existing.updatedAt) {
      existing.updatedAt = updatedAt;
    }
  }

  return [...projects.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name),
  );
}
