/** Shared public types grouped by the owning application domain. */
import type { Mode } from "./common.js";
import type { GlobalPermissionMode } from "./permissions.js";
import type { SessionThinkingLevel } from "./models.js";

/** Approval-proposal discriminator (D198). Plan and Goal share one host
 * approval pipeline; `kind` selects prompts, artifact directory and copy. */
export type ProposalKind = "plan" | "goal";

export const PROPOSAL_KINDS = ["plan", "goal"] as const;

export function normalizeProposalKind(
  value: unknown,
  fallback: ProposalKind = "plan",
): ProposalKind {
  return value === "goal" || value === "plan" ? value : fallback;
}

/** The proposal kind a mode submits, or `null` for freely executing modes. */
export function proposalKindForMode(mode: Mode): ProposalKind | null {
  return mode === "plan" || mode === "goal" ? mode : null;
}

/** The operating mode that owns a proposal kind. */
export function modeForProposalKind(kind: ProposalKind): Mode {
  return kind;
}

export type PlanningState = "inactive" | "planning" | "awaiting_approval";
export type PlanApprovalAction = "approve" | "reject" | "request_changes" | "schedule";
export type PlanApprovalStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "rejected"
  | "expired"
  | "interrupted";

/** Compatibility name for the proposal-shaped approval wire record. */
export type PlanProposalStatus = PlanApprovalStatus;

export type ArtifactWorkspaceKind = "project" | "scratch";

export type PlanArtifact = {
  /** Workspace-relative path of the host-created plan artifact. */
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  workspaceKind?: ArtifactWorkspaceKind;
};

export type PlanExecutionState =
  | "queued"
  | "running"
  | "completed"
  | "interrupted";

export type PlanScheduleState = "scheduled" | "missed" | "claimed" | "cancelled";
export type PlanRevisionDraftFileReference = {
  path: string;
  name: string;
  kind?: "image" | "file";
  mimeType?: string;
  token?: string;
};

export type PlanRevisionDraft = {
  text: string;
  fileReferences: PlanRevisionDraftFileReference[];
};

export type PlanRevisionIntentInput = {
  content: string;
  providerId?: string;
  modelId?: string;
  thinkingLevel: SessionThinkingLevel;
  targetKind: ProposalKind;
  draft?: PlanRevisionDraft;
};
export type PlanRevisionIntent = PlanRevisionIntentInput & {
  state: "ready" | "started" | "failed" | "submitted";
  turnId?: string;
  errorCode?: string;
};

export type PlanExecutionFinishStatus = Extract<
  PlanExecutionState,
  "completed" | "interrupted"
>;

export type PlanProposal = {
  /** Durable approval/proposal identity. */
  id: string;
  sessionId: string;
  /** Durable host turn ID owning the SubmitPlan/SubmitGoal call. */
  turnId: string;
  /** Exact SubmitPlan/SubmitGoal tool-call ID used to create this approval. */
  toolCallId: string;
  /** Which contract this approval carries; legacy rows read back as `plan`. */
  kind: ProposalKind;
  title: string;
  /** Exact Markdown snapshot submitted for approval. */
  markdown: string;
  question: string;
  artifact?: PlanArtifact;
  /** Host schema/version for this proposal snapshot. */
  version: number;
  status: PlanProposalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  resolvedAt?: string;
  action?: PlanApprovalAction;
  targetPermissionMode?: GlobalPermissionMode;
  errorCode?: string;
  executionId?: string;
  executionState?: PlanExecutionState;
  planningProviderId?: string;
  planningModelId?: string;
  executionProviderId?: string;
  executionModelId?: string;
  scheduledFor?: string;
  scheduleTimezone?: string;
  scheduleState?: PlanScheduleState;
  executionKind?: ProposalKind;
  revisionIntent?: PlanRevisionIntent;
  /** Persisted snapshot alias retained by the host for compatibility. */
  plan: string;
};

/** Descriptor persisted by the host after approval and consumed by Main. */
export type PlanExecution = {
  id: string;
  proposalId: string;
  sessionId: string;
  /** Which contract was approved; drives the execution instruction. */
  kind: ProposalKind;
  /** Effective execution kind bound on approval: 'plan' | 'goal'. */
  executionKind?: ProposalKind;
  /** Exact approved Markdown snapshot. */
  plan: string;
  title: string;
  question: string;
  artifact: PlanArtifact;
  targetPermissionMode: GlobalPermissionMode;
  executionProviderId?: string;
  executionModelId?: string;
  state: PlanExecutionState;
};

export type PlanExecutionDescriptor = PlanExecution;
export type ApprovedPlanExecution = PlanExecution;

export type PlanningStateEvent = {
  sessionId: string;
  state: PlanningState;
  /** Absent only for `inactive` transitions that carry no proposal. */
  kind?: ProposalKind;
  proposalId?: string;
  title?: string;
  markdown?: string;
  question?: string;
  artifact?: PlanArtifact;
  version?: number;
  plan?: string;
  action?: PlanApprovalAction;
  targetPermissionMode?: GlobalPermissionMode;
  executionId?: string;
  executionState?: PlanExecutionState;
  executionKind?: ProposalKind;
  proposal?: PlanProposal;
};

export type PlansPendingResult = {
  plans: PlanProposal[];
  /** Recent immutable checkpoints for transcript restoration. */
  history?: PlanProposal[];
  state?: PlanningState;
  /** Contract kind the session is currently negotiating, when any (D198). */
  kind?: ProposalKind;
};

export type PlansQueuedExecutionsResult = {
  executions: PlanExecution[];
};

type PlanResolveIdentity = {
  proposalId: string;
  /** Identity fields must match the live host approval row exactly. */
  sessionId: string;
  turnId: string;
  toolCallId: string;
  version?: number;
};

export type PlanResolveRequest =
  | (PlanResolveIdentity & {
      action: "approve";
      targetPermissionMode: GlobalPermissionMode;
      executionProviderId?: string;
      executionModelId?: string;
      executionKind?: ProposalKind;
    })
  | (PlanResolveIdentity & {
      action: "schedule";
      targetPermissionMode: GlobalPermissionMode;
      executionProviderId: string;
      executionModelId: string;
      scheduledFor: string;
      scheduleTimezone: string;
      executionKind?: ProposalKind;
    })
  | (PlanResolveIdentity & {
      action: "reject";
      targetPermissionMode?: never;
    })
  | (PlanResolveIdentity & {
      action: "request_changes";
      targetPermissionMode?: never;
      revisionIntent?: PlanRevisionIntentInput;
    });

export type PlanResolutionResult = {
  ok: boolean;
  proposal: PlanProposal;
  state: PlanningState;
  action?: PlanApprovalAction;
  targetPermissionMode?: GlobalPermissionMode;
  execution?: PlanExecution;
};

/** Normal Team Plan yield; no approval or artifact exists until inbox consumption. */
export type PlanSubmitResult =
  | { status: "pending"; proposal: PlanProposal }
  | {
      status: "deferred";
      reason: "team_messages_pending";
      pendingMessagesCount: number;
    };
