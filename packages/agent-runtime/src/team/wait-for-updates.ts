import { BackgroundProcessUpdates } from "./background-process-updates.js";
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TeamBoardProjection } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";
import { pendingMailboxNextStep, readPendingMailbox, type PendingMailboxSummary } from "./pending-mailbox.js";
import { randomUUID } from "node:crypto";
import type { OrdinaryInboxSummary } from "./ordinary-inbox.js";

interface WaitForUpdatesOptions {
  teamSessionId: string;
  callerSessionId: string;
  host: RuntimeHost;
  backgroundProcesses?: BackgroundProcessUpdates;
  getTurnId?: () => string | undefined;
  approvedExecution?: () => boolean;
  isLead?: boolean;
  mode?: string;
  captureMailboxGuard?: () => (() => boolean);
  /** Capture an ordinary Plan Lead turn and yield only while it still owns the wait. */
  captureInboxYield?: () => ((toolCallId: string) => boolean) | undefined;
  captureOrdinaryInbox?: () => ((boundaryId: string, signal?: AbortSignal) => Promise<OrdinaryInboxSummary | undefined>) | undefined;
}

function result(details: NonNullable<AgentToolResult["details"]>): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

function errorResult(error: unknown): AgentToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: "Error: " + message }],
    details: { error: message },
  };
}

export function createWaitForUpdatesTool(opts: WaitForUpdatesOptions): AgentTool {
  const { teamSessionId, callerSessionId, host } = opts;
  const consumed = new Set<string>();
  const background = opts.backgroundProcesses ?? new BackgroundProcessUpdates(host, callerSessionId);
  return {
    name: "wait_for_updates",
    label: "Wait for Updates",
    description:
      "Wait for teammate updates (mailbox messages, task board updates) or an owned background process ending, with a timeout in seconds.",
    parameters: Type.Object({
      timeoutSeconds: Type.Optional(Type.Number({
        description: "Timeout in seconds (1-60, default 10).",
        minimum: 1,
        maximum: 60,
      })),
    }),
    execute: async (toolCallId, params, signal): Promise<AgentToolResult> => {
      const expectedTurnId = opts.getTurnId?.();
      const ownsMailbox = opts.captureMailboxGuard?.();
      const ordinaryInbox = opts.isLead && opts.mode === "agent" && !opts.approvedExecution?.()
        ? opts.captureOrdinaryInbox?.() : undefined;
      const boundaryId = randomUUID();
      const waitAbort = new AbortController();
      const ordinarySignal = AbortSignal.any([waitAbort.signal, ...(signal ? [signal] : [])]);
      const assertCurrent = () => {
        signal?.throwIfAborted();
        if ((opts.getTurnId && opts.getTurnId() !== expectedTurnId) || ownsMailbox?.() === false) {
          throw new Error("TEAM_PLANNING_STALE: team mailbox context changed");
        }
      };
      background.prime();
      const yieldInbox = opts.approvedExecution?.() ? undefined : opts.captureInboxYield?.();
      const readInbox = async () => {
        if (ordinaryInbox) {
          const summary = await ordinaryInbox(boundaryId, ordinarySignal);
          assertCurrent();
          if (summary) return result(summary);
        }
        if (!opts.approvedExecution?.() || !expectedTurnId) return undefined;
        const inbox = await host.call<{ turnId: string; messages: Array<{ id: string; content: string }> }>("team.readExecutionInbox", {
          teamSessionId, callerSessionId, expectedTurnId,
        });
        assertCurrent();
        if (opts.getTurnId?.() !== expectedTurnId || inbox.turnId !== expectedTurnId) throw new Error("TEAM_PLANNING_STALE: approved execution changed");
        const messages = inbox.messages.filter(message => !consumed.has(message.id));
        return messages.length ? result({ updated: true, reason: "execution_inbox", messages }) : undefined;
      };
      const p = params as { timeoutSeconds?: number };
      const timeoutMs = Math.min(Math.max(Number(p.timeoutSeconds) || 10, 1), 60) * 1000;
      const deadline = Date.now() + timeoutMs;
      const finalRecheckAt = deadline - Math.min(1000, timeoutMs / 2);
      const fallbackMs = host.onNotification ? 5000 : 1000;

      return new Promise<AgentToolResult>((resolve) => {
        let settled = false;
        let baseline: { revision: number; count: number } | undefined;
        let checking = false;
        let dirty = false;
        let successfulRecheck = false;
        let finalRecheckStarted = false;
        let recheckError: AgentToolResult | undefined;
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
        let notificationTimer: ReturnType<typeof setTimeout> | undefined;
        let unsubscribe: (() => void) | undefined;

        const finish = (value: AgentToolResult) => {
          if (settled) return;
          settled = true;
          waitAbort.abort();
          const details = value.details;
          if (details && typeof details === "object" && "backgroundProcess" in details) {
            const detail = details.backgroundProcess;
            if (detail && typeof detail === "object" && "process" in detail && detail.process &&
                typeof detail.process === "object" && "id" in detail.process && typeof detail.process.id === "string") {
              background.consume(detail.process.id);
            }
          }
          if (details && typeof details === "object" && "reason" in details &&
              details.reason === "execution_inbox" && "messages" in details && Array.isArray(details.messages)) {
            for (const message of details.messages) {
              if (message && typeof message === "object" && "id" in message && typeof message.id === "string") {
                consumed.add(message.id);
              }
            }
          }
          clearTimeout(deadlineTimer);
          clearTimeout(fallbackTimer);
          clearTimeout(notificationTimer);
          signal?.removeEventListener("abort", abort);
          unsubscribe?.();
          resolve(value);
        };
        const abort = () => finish(result({ updated: false, reason: "aborted" }));
        const finishDeadline = () => finish(successfulRecheck
          ? result({ updated: false, reason: "timeout" })
          : recheckError ?? errorResult(new Error(baseline
            ? "Timed out checking team updates"
            : "Timed out reading team update baseline")));
        const readState = async () => {
          // Keep the read single-flight even when one RPC rejects before its peer settles.
          const [board, mailbox] = await Promise.allSettled([
            host.call<TeamBoardProjection>("team.getBoard", { teamSessionId, callerSessionId }),
            readPendingMailbox(host, teamSessionId, callerSessionId),
          ]);
          if (board.status === "rejected") throw board.reason;
          if (mailbox.status === "rejected") throw mailbox.reason;
          assertCurrent();
          return { revision: board.value.revision, ...mailbox.value };
        };
        const yieldPendingInbox = (summary: PendingMailboxSummary): boolean => {
          if (!summary.pendingMessagesCount || settled || signal?.aborted || Date.now() >= deadline ||
              opts.approvedExecution?.() || !yieldInbox?.(toolCallId)) return false;
          finish({ ...result({ updated: true, reason: "pending_mailbox_messages", count: summary.pendingMessagesCount, ...summary }), terminate: true });
          return true;
        };
        const showPendingInbox = (summary: PendingMailboxSummary): boolean => {
          if (!opts.isLead || opts.mode === "plan" || opts.approvedExecution?.() || !summary.pendingMessagesCount) return false;
          finish(result({ updated: true, reason: "pending_mailbox_messages", count: summary.pendingMessagesCount,
            ...summary, nextStep: pendingMailboxNextStep(opts.mode, false) }));
          return true;
        };
        const scheduleFallback = () => {
          if (settled) return;
          clearTimeout(fallbackTimer);
          const untilFinalRecheckMs = finalRecheckAt - Date.now();
          if (untilFinalRecheckMs <= 0 && finalRecheckStarted) return;
          // Reserve RPC headroom for one final read without repeatedly shortening the interval.
          fallbackTimer = setTimeout(() => {
            fallbackTimer = undefined;
            void recheck();
          }, Math.max(0, Math.min(fallbackMs, untilFinalRecheckMs)));
        };
        const recheck = async () => {
          if (settled) return;
          if (Date.now() >= deadline) {
            finishDeadline();
            return;
          }
          if (!baseline || checking) {
            dirty = true;
            return;
          }
          checking = true;
          if (Date.now() >= finalRecheckAt) finalRecheckStarted = true;
          dirty = false;
          // A fallback racing with an event shares the same read and next timer.
          clearTimeout(fallbackTimer);
          clearTimeout(notificationTimer);
          notificationTimer = undefined;
          try {
            const inbox = await readInbox();
            if (inbox && !settled) { finish(inbox); return; }
            let backgroundProcess;
            try {
              backgroundProcess = await background.read(signal, () => !settled && ownsMailbox?.() !== false && (!expectedTurnId || opts.getTurnId?.() === expectedTurnId));
            } catch (error) {
              if (!settled) finish(errorResult(error));
              return;
            }
            if (settled) return;
            if (Date.now() >= deadline) { finishDeadline(); return; }
            if (backgroundProcess) { finish(result({ updated: true, reason: "background_process_completed", backgroundProcess })); return; }
            const current = await readState();
            if (settled) return;
            if (Date.now() >= deadline) {
              finishDeadline();
              return;
            }
            successfulRecheck = true;
            if (yieldPendingInbox(current.summary) || showPendingInbox(current.summary)) return;
            if (current.revision !== baseline.revision) {
              finish(result({ updated: true, reason: "task_board_changed", revision: current.revision }));
            } else if (current.count !== baseline.count) {
              finish(result({ updated: true, reason: "new_mailbox_messages", count: current.count }));
            }
          } catch (error) {
            if ((opts.getTurnId && opts.getTurnId() !== expectedTurnId) || ownsMailbox?.() === false) {
              finish(errorResult(error));
            } else recheckError = errorResult(error);
          } finally {
            checking = false;
            if (!settled) {
              if (Date.now() >= deadline) {
                finishDeadline();
              } else if (dirty) {
                void recheck();
              } else {
                scheduleFallback();
              }
            }
          }
        };

        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        deadlineTimer = setTimeout(finishDeadline, timeoutMs);
        try {
          // Subscribe before reading the baseline so a concurrent mutation wakes us.
          unsubscribe = host.onNotification?.((method, payload) => {
            if (settled) return;
            const processChanged = background.changed(method, payload);
            const teamChanged = (method === "team.changed" || method === "team.messageQueued") &&
              payload && typeof payload === "object" && "teamSessionId" in payload && payload.teamSessionId === teamSessionId;
            if (!processChanged && !teamChanged) return;
            clearTimeout(notificationTimer);
            notificationTimer = setTimeout(() => {
              notificationTimer = undefined;
              void recheck();
            }, 100);
          });
          // Abort may be raised synchronously while registering the subscription.
          if (settled) {
            unsubscribe?.();
            return;
          }
          const initialize = async () => {
            // The listener and total deadline own every read, including inbox
            // consumption. An idle call must still subscribe synchronously.
            if (ordinaryInbox || (opts.approvedExecution?.() && expectedTurnId)) {
              const inbox = await readInbox();
              if (settled) return;
              if (inbox) { finish(inbox); return; }
            }
            const initial = await readState();
            if (settled) return;
            if (Date.now() >= deadline) {
              finishDeadline();
              return;
            }
            baseline = initial;
            if (yieldPendingInbox(initial.summary)) return;
            // Existing background outcomes retain their once-only priority.
            if (!background.hasPending() && showPendingInbox(initial.summary)) return;
            if (dirty || background.hasPending()) void recheck();
            else scheduleFallback();
          };
          void initialize().catch((error: unknown) => finish(errorResult(error)));
        } catch (error) {
          finish(errorResult(error));
        }
      });
    },
  };
}
