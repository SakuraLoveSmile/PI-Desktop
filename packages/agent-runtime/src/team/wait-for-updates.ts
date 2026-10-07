import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TeamBoardProjection } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";

interface WaitForUpdatesOptions {
  teamSessionId: string;
  callerSessionId: string;
  host: RuntimeHost;
  getTurnId?: () => string | undefined;
  approvedExecution?: () => boolean;
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
  return {
    name: "wait_for_updates",
    label: "Wait for Updates",
    description:
      "Wait for teammate updates (mailbox messages, task board updates) with a timeout in seconds.",
    parameters: Type.Object({
      timeoutSeconds: Type.Optional(Type.Number({
        description: "Timeout in seconds (1-60, default 10).",
        minimum: 1,
        maximum: 60,
      })),
    }),
    execute: async (_toolCallId, params, signal): Promise<AgentToolResult> => {
      const expectedTurnId = opts.getTurnId?.();
      const readInbox = async () => {
        if (!opts.approvedExecution?.() || !expectedTurnId) return undefined;
        const inbox = await host.call<{ turnId: string; messages: Array<{ id: string; content: string }> }>("team.readExecutionInbox", {
          teamSessionId, callerSessionId, expectedTurnId,
        });
        signal?.throwIfAborted();
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
          const details = value.details;
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
            host.call<{ messages: unknown[] }>("team.listMessages", {
              teamSessionId, callerSessionId, sessionId: callerSessionId,
            }),
          ]);
          if (board.status === "rejected") throw board.reason;
          if (mailbox.status === "rejected") throw mailbox.reason;
          return { revision: board.value.revision, count: mailbox.value.messages.length };
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
            const current = await readState();
            if (settled) return;
            if (Date.now() >= deadline) {
              finishDeadline();
              return;
            }
            successfulRecheck = true;
            if (current.revision !== baseline.revision) {
              finish(result({ updated: true, reason: "task_board_changed", revision: current.revision }));
            } else if (current.count !== baseline.count) {
              finish(result({ updated: true, reason: "new_mailbox_messages", count: current.count }));
            }
          } catch (error) {
            recheckError = errorResult(error);
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
            if (settled || (method !== "team.changed" && method !== "team.messageQueued") ||
                !payload || typeof payload !== "object" ||
                !("teamSessionId" in payload) || payload.teamSessionId !== teamSessionId) return;
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
            if (opts.approvedExecution?.() && expectedTurnId) {
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
            if (dirty) void recheck();
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
