import type { AssistantActivityItem, AssistantTurnPart } from "./assistant-turns";
import type { TeamDispatchCardItem, TeamDispatchIndex } from "./team-dispatch";

export type TeamTimelineSegment =
  | { kind: "parts"; key: string; parts: AssistantTurnPart[] }
  | { kind: "cards"; key: string; cards: TeamDispatchCardItem[]; joining: boolean };

export type TeamTimeline = {
  sections: TeamTimelineSegment[][];
  parts: AssistantTurnPart[];
  activePart: AssistantTurnPart | undefined;
};

type ActivityPart = Extract<AssistantTurnPart, { kind: "activity" }>;
// Transcript reuse preserves unchanged items while replacing a streaming source
// part. Keep one latest piece per first item, without retaining old revisions.
const splitCache = new WeakMap<AssistantActivityItem, ActivityPart>();

function isAnchor(item: AssistantActivityItem, index: TeamDispatchIndex): boolean {
  return item.kind === "tool" && index.cardsByMessageId.has(item.message.id);
}

function firstMessageId(part: AssistantTurnPart): string {
  return part.kind === "message" ? part.message.id : part.items[0].message.id;
}

function splitPiece(
  items: AssistantActivityItem[],
  endedAt: string | undefined,
): ActivityPart {
  const previous = splitCache.get(items[0]);
  if (
    previous && previous.endedAt === endedAt && previous.items.length === items.length &&
    previous.items.every((item, position) => item === items[position])
  ) return previous;
  const piece: ActivityPart = { kind: "activity", items, endedAt };
  splitCache.set(items[0], piece);
  return piece;
}

/** Render only turns whose dispatch index supplies a card anchor. */
export function projectTeamTimeline(
  sections: readonly { parts: readonly AssistantTurnPart[] }[],
  index: TeamDispatchIndex,
  opts: { active: boolean; joining: boolean },
): TeamTimeline | null {
  if (!sections.some((section) => section.parts.some((part) =>
    part.kind === "message"
      ? index.cardsByMessageId.has(part.message.id)
      : part.items.some((item) => isAnchor(item, index))
  ))) return null;

  const seen = new Set<string>();
  const parts: AssistantTurnPart[] = [];
  const projected = sections.map((section) => {
    const segments: TeamTimelineSegment[] = [];
    const appendPart = (part: AssistantTurnPart) => {
      // Empty activity groups have no row and must not become a live tail.
      if (part.kind === "activity" && part.items.length === 0) return;
      parts.push(part);
      const last = segments.at(-1);
      if (last?.kind === "parts") last.parts.push(part);
      else segments.push({ kind: "parts", key: `parts:${firstMessageId(part)}`, parts: [part] });
    };
    const appendCards = (messageIds: string[]) => {
      const cards: TeamDispatchCardItem[] = [];
      for (const messageId of messageIds) {
        for (const card of index.cardsByMessageId.get(messageId) ?? []) {
          const taskKey = JSON.stringify([card.teamSessionId, card.taskId]);
          if (seen.has(taskKey)) continue;
          seen.add(taskKey);
          cards.push(card);
        }
      }
      if (cards.length > 0) {
        segments.push({ kind: "cards", key: `cards:${messageIds[0]}`, cards, joining: false });
      }
    };

    for (const part of section.parts) {
      if (part.kind === "message") {
        appendPart(part);
        appendCards([part.message.id]);
        continue;
      }
      if (!part.items.some((item) => isAnchor(item, index))) {
        appendPart(part);
        continue;
      }
      let pending: AssistantActivityItem[] = [];
      let position = 0;
      while (position < part.items.length) {
        const item = part.items[position];
        if (!isAnchor(item, index)) {
          pending.push(item);
          position++;
          continue;
        }
        if (pending.length > 0) {
          appendPart(splitPiece(pending, item.message.createdAt));
          pending = [];
        }
        const anchors: string[] = [];
        // A batch ends at thinking/search; ordinary tools are hoisted past its cards.
        while (position < part.items.length && part.items[position].kind === "tool") {
          const tool = part.items[position++];
          if (isAnchor(tool, index)) anchors.push(tool.message.id);
          else pending.push(tool);
        }
        appendCards(anchors);
      }
      if (pending.length > 0) appendPart(splitPiece(pending, part.endedAt));
    }
    return segments;
  });

  const lastSection = projected.at(-1);
  if (opts.joining && lastSection) {
    const last = lastSection.at(-1);
    if (last?.kind === "cards") last.joining = true;
    else {
      lastSection.push({
        kind: "cards", key: `joining:${last?.key ?? "empty"}`, cards: [], joining: true,
      });
    }
  }
  const tail = lastSection?.at(-1);
  return {
    sections: projected,
    parts,
    activePart: opts.active && tail?.kind === "parts" ? tail.parts.at(-1) : undefined,
  };
}
