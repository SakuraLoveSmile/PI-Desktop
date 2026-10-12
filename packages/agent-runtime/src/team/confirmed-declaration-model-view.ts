import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DECLARE_TEAM_STRATEGY_TOOL_NAME, type TeamLaunchReview } from "@pi-desktop/shared";
import { isRecord } from "../agent-messages.js";
import { refreshDeclareStrategyResult } from "./declare-strategy-result.js";
import { wireCallId } from "../tool-call-dedupe.js";

export interface DeclarationExecutionScope {
  teamSessionId: string;
  turnId: string | undefined;
  epoch: number;
  active: boolean;
}

interface Confirmation {
  review: TeamLaunchReview;
  epoch: number;
  replay?: AgentMessage[];
}

function declarationReview(message: AgentMessage): Record<string, unknown> | undefined {
  if (message.role !== "toolResult" || message.toolName !== DECLARE_TEAM_STRATEGY_TOOL_NAME || message.isError) return;
  if (!isRecord(message.details) || "error" in message.details || !isRecord(message.details.review)) return;
  return message.details.review;
}

function sameOwner(review: Record<string, unknown>, owner: TeamLaunchReview): boolean {
  return review.teamSessionId === owner.teamSessionId && review.leadTurnId === owner.leadTurnId;
}

function lastIndex(messages: AgentMessage[], matches: (message: AgentMessage) => boolean): number {
  for (let index = messages.length - 1; index >= 0; index--) if (matches(messages[index])) return index;
  return -1;
}

/** Runtime-local registration; projection never enters Agent state or durable history. */
export class ConfirmedDeclarationModelView {
  private confirmation?: Confirmation;

  clear(): void { this.confirmation = undefined; }

  register(review: TeamLaunchReview, epoch: number, messages: AgentMessage[]): void {
    const previous = this.confirmation;
    this.clear();
    if (review.status !== "confirmed" || (review.launchPolicy ?? "user_confirmed") !== "user_confirmed" ||
        (review.strategy ?? "delegate") !== "delegate" || !review.members.length) return;
    const snapshot = structuredClone(review);
    const index = lastIndex(messages, message => {
      const previous = declarationReview(message);
      return !!previous && sameOwner(previous, snapshot);
    });
    const original = messages[index];
    // A later completion recovery can read the same trusted review after its
    // declaration was compacted away. Preserve that execution's legal batch.
    if (!original && previous?.epoch === epoch && previous.review.reviewId === snapshot.reviewId &&
        previous.review.teamSessionId === snapshot.teamSessionId && previous.review.leadTurnId === snapshot.leadTurnId &&
        snapshot.revision >= previous.review.revision) {
      this.confirmation = { ...previous, review: snapshot };
      return;
    }
    if (!original || declarationReview(original)?.reviewId !== snapshot.reviewId) return;
    if (original.role !== "toolResult" || !isRecord(original.details) || !isRecord(original.details.decision) ||
        original.details.decision.strategy !== "delegate" || typeof original.details.decision.reason !== "string" ||
        supersedesConfirmation(declarationReview(original), snapshot)) return;
    const assistantIndex = lastIndex(messages.slice(0, index), message => message.role === "assistant" &&
      message.content.some(block => block.type === "toolCall" && block.id === original.toolCallId));
    const assistant = messages[assistantIndex];
    let replay: AgentMessage[] | undefined;
    if (assistant?.role === "assistant") {
      const ids = assistant.content.flatMap(block => block.type === "toolCall" ? [block.id] : []);
      const tail = messages.slice(assistantIndex + 1);
      const nextAssistant = tail.findIndex(message => message.role === "assistant");
      const results = tail.slice(0, nextAssistant < 0 ? tail.length : nextAssistant).filter(message =>
        message.role === "toolResult" && ids.includes(message.toolCallId));
      if (results.length === ids.length && ids.every(id => results.some(message => message.role === "toolResult" && message.toolCallId === id))) {
        // Signed thinking/text and tool-call signatures must keep their whole
        // assistant batch and every paired result, in original order.
        replay = structuredClone([assistant, ...results]);
      }
    }
    this.confirmation = { review: snapshot, epoch, replay };
  }

  project(messages: AgentMessage[], scope: DeclarationExecutionScope): AgentMessage[] {
    const registered = this.confirmation;
    if (!registered || !scope.active || scope.epoch !== registered.epoch ||
        scope.turnId !== registered.review.leadTurnId || scope.teamSessionId !== registered.review.teamSessionId) {
      this.clear();
      return messages;
    }
    if (supersedesConfirmation(latestDeclarationReview(messages, registered.review), registered.review)) {
      this.clear();
      return messages;
    }
    return projectConfirmedDeclaration(messages, registered.review, registered.replay);
  }
}

/** Pure, idempotent final-wire projection, including legally paired compaction retention. */
function latestDeclarationReview(messages: AgentMessage[], review: TeamLaunchReview): Record<string, unknown> | undefined {
  const latest = messages[lastIndex(messages, message => {
    const previous = declarationReview(message);
    return !!previous && sameOwner(previous, review);
  })];
  return latest && declarationReview(latest);
}

function supersedesConfirmation(current: Record<string, unknown> | undefined, review: TeamLaunchReview): boolean {
  return !!current && (current.reviewId !== review.reviewId || current.status === "cancelled" || current.status === "interrupted" ||
    (typeof current.revision === "number" && current.revision > review.revision));
}

function projectConfirmedDeclaration(messages: AgentMessage[], review: TeamLaunchReview, replay?: AgentMessage[]): AgentMessage[] {
  const current = latestDeclarationReview(messages, review);
  let changed = false;
  const projected = messages.map(message => {
    const previous = declarationReview(message);
    if (!previous || !sameOwner(previous, review) || previous.reviewId !== review.reviewId) return message;
    const refreshed = refreshDeclareStrategyResult([message], review)[0];
    changed ||= refreshed !== message;
    return refreshed;
  });
  if (current || !replay) return changed ? projected : messages;
  const ids = new Set(replay.flatMap(message => message.role === "toolResult" ? [wireCallId(message.toolCallId)] : []));
  if (messages.some(message =>
    (message.role === "toolResult" && ids.has(wireCallId(message.toolCallId))) ||
    (message.role === "assistant" && message.content.some(block => block.type === "toolCall" && ids.has(wireCallId(block.id)))))) return messages;
  // Compaction has archived both original messages. Keep their confirmed view
  // together after leading instructions/summaries, before newer work. The pair
  // exists only in this conversion result, never in summaries or checkpoints.
  const first = messages.findIndex(message => message.role === "assistant" || message.role === "toolResult");
  const insert = first < 0 ? messages.length : first;
  const confirmedReplay = projectConfirmedDeclaration(structuredClone(replay), review);
  return [...messages.slice(0, insert), ...confirmedReplay, ...messages.slice(insert)];
}
