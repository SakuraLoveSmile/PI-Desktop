/**
 * SubmitGoalReport tool definition and draft state management.
 *
 * Available ONLY in the autonomous execution context of an approved Goal.
 */

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  type SubmitGoalReportDraftInput,
  validateGoalReportDraft,
} from "@pi-desktop/shared";

export const SUBMIT_GOAL_REPORT_TOOL_NAME = "SubmitGoalReport" as const;

export type GoalReportDraftManagerOptions = {
  executionId: string;
  sessionId: string;
  onDraftSubmitted?: (draft: SubmitGoalReportDraftInput) => Promise<void> | void;
  onDraftInvalidated?: () => Promise<void> | void;
  onDraftPersistenceFailure?: (error: unknown) => Promise<void> | void;
  onDraftInvalidationFailure?: (error: unknown) => Promise<void> | void;
};

export class GoalReportDraftManager {
  private currentDraft: SubmitGoalReportDraftInput | null = null;
  private invalidated = false;

  constructor(private readonly options: GoalReportDraftManagerOptions) {}

  get executionId(): string {
    return this.options.executionId;
  }

  get draft(): SubmitGoalReportDraftInput | null {
    return this.invalidated ? null : this.currentDraft;
  }

  isDraftValid(): boolean {
    return !this.invalidated && this.currentDraft !== null;
  }

  /**
   * Invalidate draft if subsequent ordinary tools or steering inputs occur after submission.
   */
  async invalidate(): Promise<void> {
    if (this.currentDraft !== null) {
      this.currentDraft = null;
      this.invalidated = true;
      if (this.options.onDraftInvalidated) {
        try {
          await this.options.onDraftInvalidated();
        } catch (error) {
          await this.options.onDraftInvalidationFailure?.(error);
          throw error;
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
        "metrics, criteria checklist, steps, and verification evidence.",
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
      execute: async (_toolCallId: string, params: any): Promise<AgentToolResult<any>> => {
        const validation = validateGoalReportDraft(params);
        if (!validation.ok) {
          return {
            content: [{ type: "text", text: `Draft validation failed: ${validation.error}` }],
            details: { ok: false, error: validation.error },
          };
        }

        try {
          await this.options.onDraftSubmitted?.(validation.value);
        } catch (error) {
          this.currentDraft = null;
          this.invalidated = true;
          await this.options.onDraftPersistenceFailure?.(error);
          throw new Error(
            "Goal report draft could not be persisted to the host. Retry SubmitGoalReport.",
          );
        }
        this.currentDraft = validation.value;
        this.invalidated = false;

        return {
          content: [
            {
              type: "text",
              text: "Goal report draft recorded successfully. It will be finalized when the execution completes.",
            },
          ],
          details: { ok: true },
        };
      },
    };
  }
}
