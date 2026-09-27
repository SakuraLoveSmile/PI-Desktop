import type { PlanProposal } from "@pi-desktop/shared";
import { api } from "./api";

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

export type PlanArtifactResolutionErrorCode =
  | "session-unavailable"
  | "scratch-unavailable";

export class PlanArtifactResolutionError extends Error {
  readonly code: PlanArtifactResolutionErrorCode;

  constructor(code: PlanArtifactResolutionErrorCode) {
    super(code);
    this.name = "PlanArtifactResolutionError";
    this.code = code;
  }
}

export type ResolvedPlanArtifact = {
  path: string;
  temporary: boolean;
};

/**
 * Resolve an artifact in the directory that owns its proposal. Temporary
 * sessions have no project workspace, so their host-relative artifact must be
 * read from that session's scratch root rather than the currently selected
 * project. The persisted workspaceKind discriminator is authoritative even if
 * the session is later associated with a project.
 */
export async function resolvePlanArtifactPath(
  proposal: Pick<PlanProposal, "sessionId" | "artifact">,
): Promise<ResolvedPlanArtifact | null> {
  const relativePath = proposal.artifact?.relativePath?.trim();
  if (!relativePath) return null;
  if (isAbsolutePath(relativePath)) return { path: relativePath, temporary: false };

  if (proposal.artifact?.workspaceKind !== "scratch") {
    return { path: relativePath, temporary: false };
  }

  const { session } = await api.getSession(proposal.sessionId);
  if (!session) {
    throw new PlanArtifactResolutionError("session-unavailable");
  }

  const { path: scratchPath } = await api.getSessionScratchPath(proposal.sessionId);
  const root = scratchPath ? scratchPath.trim().replace(/[\\/]+$/, "") : "";
  if (!root) throw new PlanArtifactResolutionError("scratch-unavailable");
  return {
    path: `${root}/${relativePath.replace(/^[\\/]+/, "").replace(/\\/g, "/")}`,
    temporary: true,
  };
}
