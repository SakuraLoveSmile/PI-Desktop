/**
 * SubmitGoalReport tool definition and draft state management.
 *
 * Available ONLY in the autonomous execution context of an approved Goal.
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  type GoalProgressSnapshot,
  type SubmitGoalReportDraftInput,
  validateGoalReportDraft,
} from "@pi-desktop/shared";

export const SUBMIT_GOAL_REPORT_TOOL_NAME = "SubmitGoalReport" as const;

// Only known inspection/accounting tools preserve evidence. Shell, delegation,
// plugin, and unknown tools remain conservative even if a call looks read-only.
const DRAFT_PRESERVING_TOOLS = new Set([
  SUBMIT_GOAL_REPORT_TOOL_NAME,
  "TodoWrite", "UpdateGoalProgress", "ToolSearch", "Read", "Glob", "Grep",
]);

export function invalidatesGoalReportDraft(toolName: string): boolean {
  return !DRAFT_PRESERVING_TOOLS.has(toolName);
}

export type GoalReportFailureCode =
  | "REPORT_DRAFT_PERSIST_FAILED"
  | "REPORT_DRAFT_INVALIDATION_FAILED";

export function persistGoalReportFailure(
  host: { call(method: string, params: unknown): Promise<unknown> },
  execution: { sessionId: string; executionId: string },
  errorCode: GoalReportFailureCode,
): Promise<unknown> {
  return host.call("goalReports.markFailed", {
    sessionId: execution.sessionId,
    executionId: execution.executionId,
    errorCode,
  });
}

export type GoalReportDraftManagerOptions = {
  executionId: string;
  sessionId: string;
  getProgressSnapshot?: () => GoalProgressSnapshot | null | undefined;
  onDraftSubmitted?: (draft: SubmitGoalReportDraftInput) => Promise<void> | void;
  onDraftInvalidated?: () => Promise<void> | void;
  onDraftPersistenceFailure?: (error: unknown) => Promise<void> | void;
  onDraftInvalidationFailure?: (error: unknown) => Promise<void> | void;
};

export class GoalReportDraftManager {
  private currentDraft: SubmitGoalReportDraftInput | null = null;
  private invalidated = false;
  private pendingInvalidation?: Promise<void>;
  private evidenceRevision = 0;

  constructor(private readonly options: GoalReportDraftManagerOptions) {}

  get executionId(): string {
    return this.options.executionId;
  }

  get draft(): SubmitGoalReportDraftInput | null {
    return this.invalidated ? null : this.currentDraft;
  }

  isDraftValid(): boolean {
    return !this.invalidated && this.currentDraft !== null &&
      (this.currentDraft.verdict !== "met" || !this.hasIncompleteProgress());
  }

  private hasIncompleteProgress(): boolean {
    return this.options.getProgressSnapshot?.()?.items.some((item) => item.status !== "completed") ?? false;
  }

  /**
   * Invalidate draft if subsequent evidence-changing tools or steering inputs occur.
   */
  async invalidate(): Promise<void> {
    // Steering can arrive while the first submission is still being persisted,
    // before there is a local draft to clear.
    this.evidenceRevision += 1;
    if (this.currentDraft !== null) {
      this.currentDraft = null;
      this.invalidated = true;
      if (this.options.onDraftInvalidated) {
        const invalidating = this.options.onDraftInvalidated;
        const pending = Promise.resolve().then(async () => {
          try {
            await invalidating();
          } catch (error) {
            await this.options.onDraftInvalidationFailure?.(error);
            throw error;
          }
        });
        this.pendingInvalidation = pending;
        try {
          await pending;
        } finally {
          if (this.pendingInvalidation === pending) this.pendingInvalidation = undefined;
        }
      }
    }
  }

  buildTool(): AgentTool {
    return {
      name: SUBMIT_GOAL_REPORT_TOOL_NAME,
      label: "Submit goal report",
      description:
        "Submit a structured completion report for the approved Goal task. " +
        "Call this once when all verification is complete and you have prepared the summary, " +
        "metrics, criteria checklist, steps, and verification evidence. " +
        "Reconcile UpdateGoalProgress before claiming the goal is met. " +
        "Evidence-changing tools after submission invalidate the draft and require resubmission.",
      parameters: Type.Object({
        summary: Type.String({
          description: "High-level summary of the outcome reached and verified.",
        }),
        verdict: Type.Union(
          [
            Type.Literal("met"),
            Type.Literal("partial"),
            Type.Literal("blocked"),
            Type.Literal("unknown"),
          ],
          {
            description: "Your judgment on whether the approved goal was satisfied.",
          },
        ),
        metrics: Type.Optional(
          Type.Array(
            Type.Object({
              label: Type.String(),
              value: Type.String(),
              source: Type.Optional(Type.String()),
            }),
            { description: "Quantitative metrics (max 8)." },
          ),
        ),
        criteria: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.String(),
              text: Type.String(),
              verdict: Type.Union([
                Type.Literal("met"),
                Type.Literal("unmet"),
                Type.Literal("partial"),
                Type.Literal("unknown"),
              ]),
              explanation: Type.String(),
              contractRef: Type.Optional(Type.String()),
              evidenceRefs: Type.Optional(Type.Array(Type.String())),
            }),
            { description: "Checklist evaluating each acceptance criterion." },
          ),
        ),
        steps: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.String(),
              title: Type.String(),
              status: Type.Union([
                Type.Literal("completed"),
                Type.Literal("failed"),
                Type.Literal("skipped"),
              ]),
              detail: Type.Optional(Type.String()),
              evidenceRefs: Type.Optional(Type.Array(Type.String())),
            }),
            { description: "Key execution steps performed." },
          ),
        ),
        files: Type.Optional(
          Type.Array(
            Type.Object({
              path: Type.String(),
              changeType: Type.Union([
                Type.Literal("created"),
                Type.Literal("modified"),
                Type.Literal("deleted"),
                Type.Literal("referenced"),
              ]),
              attribution: Type.Union([
                Type.Literal("direct"),
                Type.Literal("subagent"),
                Type.Literal("declared"),
              ]),
              detail: Type.Optional(Type.String()),
            }),
            { description: "Files created, modified, or verified." },
          ),
        ),
        checks: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.String(),
              command: Type.String(),
              result: Type.Union([
                Type.Literal("passed"),
                Type.Literal("failed"),
                Type.Literal("inconclusive"),
              ]),
              exitCode: Type.Optional(Type.Number()),
              detail: Type.Optional(Type.String()),
              evidenceRefs: Type.Optional(Type.Array(Type.String())),
            }),
            { description: "Verification commands and checks run." },
          ),
        ),
        limitations: Type.Optional(
          Type.Array(Type.String(), {
            description: "Known limitations, boundaries, or residual risks.",
          }),
        ),
        nextSteps: Type.Optional(
          Type.Array(Type.String(), {
            description: "Suggested next steps for the user.",
          }),
        ),
        evidences: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.String(),
              kind: Type.Union([
                Type.Literal("tool_call"),
                Type.Literal("tool_result"),
                Type.Literal("message"),
                Type.Literal("file"),
                Type.Literal("subagent"),
              ]),
              refId: Type.String(),
              summary: Type.String({ description: "Summary up to 2 KiB." }),
              detail: Type.Optional(Type.String()),
            }),
            { description: "Evidences supporting criteria and checks." },
          ),
        ),
      }),
      executionMode: "sequential",
      execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
        const validation = validateGoalReportDraft(params);
        if (!validation.ok) {
          return {
            content: [{ type: "text", text: `Draft validation failed: ${validation.error}` }],
            details: { ok: false, error: validation.error },
          };
        }

        // Host RPC requests can execute concurrently. A delayed invalidation
        // must finish before a replacement is written, or it could erase it.
        const evidenceRevision = this.evidenceRevision;
        await this.pendingInvalidation;

        if (validation.value.verdict === "met" && this.hasIncompleteProgress()) {
          const error = "UpdateGoalProgress before submitting a met report: progress still contains pending, in_progress, or failed items. Use partial or blocked when work remains incomplete.";
          return {
            content: [{ type: "text", text: `Draft validation failed: ${error}` }],
            details: { ok: false, error },
          };
        }

        try {
          await this.options.onDraftSubmitted?.(validation.value);
        } catch (error) {
          if (error !== null && typeof error === "object" && "errorCode" in error &&
              error.errorCode === "INVALID_ARGUMENT") {
            this.currentDraft = null;
            this.invalidated = true;
            const message = error instanceof Error ? error.message : "Host rejected the report draft. Reconcile UpdateGoalProgress and retry SubmitGoalReport.";
            return {
              content: [{ type: "text", text: `Draft validation failed: ${message}` }],
              details: { ok: false, error: message },
            };
          }
          this.currentDraft = null;
          this.invalidated = true;
          await this.options.onDraftPersistenceFailure?.(error);
          throw new Error(
            "Goal report draft could not be persisted to the host. Retry SubmitGoalReport.",
          );
        }
        this.currentDraft = validation.value;
        this.invalidated = false;

        if (this.evidenceRevision !== evidenceRevision) {
          this.invalidated = true;
          // Finish any older delete before removing the now-persisted stale
          // submission, so a later replacement cannot be deleted out of order.
          await this.pendingInvalidation;
          await this.invalidate();
          const error = "Goal report draft was invalidated by new evidence or user steering during submission. Reconcile UpdateGoalProgress and call SubmitGoalReport again.";
          return {
            content: [{ type: "text", text: error }],
            details: { ok: false, error },
          };
        }

        return {
          content: [
            {
              type: "text",
              text: "Goal report draft recorded successfully. It will be finalized when the execution completes. Further evidence-changing tools (including Bash, Write, Edit, delegation, and unknown tools) or user steering invalidate this draft; call SubmitGoalReport again afterward. Known read-only tools, TodoWrite, ToolSearch, and UpdateGoalProgress preserve it, but progress must remain consistent with a met verdict.",
            },
          ],
          details: { ok: true },
        };
      },
    };
  }
}
