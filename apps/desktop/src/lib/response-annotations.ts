/**
 * Response annotations (ADR 0223 / D400).
 *
 * The reference implementation (ChatGPT desktop app) does not put a quoted
 * excerpt into the composer as text. Selecting text in a response and choosing
 * "Add to chat" attaches a **numbered annotation** to that response: the
 * annotated pass gains an inline numbered marker, the composer shows one
 * annotation attachment, and the next prompt carries the excerpts in a
 * structured block the model reads as `Annotation 1`, `Annotation 2`, … in
 * array order.
 *
 * This module owns that contract: the wire block the prompt carries, the request
 * text a stored prompt reduces back to, and the inline marker geometry.
 */

/** Heading the annotation block opens with, exactly as the reference sends it. */
export const ANNOTATION_BLOCK_HEADING = "# Response annotations:";
export const ANNOTATION_BLOCK_OPEN = "<response-annotations>";
export const ANNOTATION_BLOCK_CLOSE = "</response-annotations>";
/** Heading the user's own request is filed under, after the block. */
export const ANNOTATION_REQUEST_HEADING = "## My request:";

/**
 * The instruction sentence the block carries, verbatim from the reference. The
 * directive it asks for is the marker the renderer draws: an answered annotation
 * shows up as a numbered reference in the model's own answer, which is the only
 * place the reference marks one.
 */
export const ANNOTATION_INSTRUCTION =
  "Each item contains text selected from an earlier assistant response and may include a user comment. Treat items as Annotation 1, Annotation 2, and so on in array order. Use every selection as context and address every comment. For every annotation you address, include its inline directive `:codex-annotation{index=\"N\"}`, where N is its one-based array position (for example, `:codex-annotation{index=\"1\"}`). Do not use unstructured annotation labels.";

/** Longest excerpt one annotation carries, matching the quote cap (D398). */
export const MAX_ANNOTATION_CHARS = 2000;

/** Inline marker syntax, matching the reference directive. */
const MARKER_TOKEN = /:codex-annotation\{index="(\d+)"\}/g;

export type ResponseAnnotation = {
  id: string;
  /** Assistant turn the annotation is anchored to; also its selection row id. */
  messageId: string;
  /** The excerpt, as Markdown, at the moment it was annotated. */
  text: string;
  /** Free-form user comment; empty until the comment editor exists. */
  annotation: string;
  createdAt: number;
};

/** Annotations of one session, in the order they were made. */
export type ResponseAnnotationMap = Record<string, ResponseAnnotation[]>;

export function responseAnnotation(input: {
  id: string;
  messageId: string;
  text: string;
  annotation?: string;
  createdAt?: number;
}): ResponseAnnotation {
  return {
    id: input.id,
    messageId: input.messageId,
    text: annotationExcerpt(input.text),
    annotation: (input.annotation ?? "").trim(),
    createdAt: input.createdAt ?? Date.now(),
  };
}

/** Wire shape of one annotation inside the block, as the reference sends it. */
function annotationPayload(annotation: ResponseAnnotation): {
  text: string;
  annotation: string;
  source: { messageId: string };
} {
  return {
    text: annotation.text,
    annotation: annotation.annotation,
    source: { messageId: annotation.messageId },
  };
}

/**
 * The prompt a session's annotations turn the composer text into: the block
 * first, then the request under its own heading, so the model can tell the
 * excerpts from the instruction.
 */
export function responseAnnotationPrompt(
  content: string,
  annotations: readonly ResponseAnnotation[],
): string {
  if (annotations.length === 0) return content;
  return [
    ANNOTATION_BLOCK_HEADING,
    ANNOTATION_INSTRUCTION,
    ANNOTATION_BLOCK_OPEN,
    JSON.stringify(annotations.map(annotationPayload)),
    ANNOTATION_BLOCK_CLOSE,
    "",
    ANNOTATION_REQUEST_HEADING,
    content,
  ].join("\n");
}

/**
 * The request a stored prompt reduces back to. A prompt the host echoes back
 * carries the block; the transcript, the composer's edit seed, and the minimap
 * excerpt all show the request only.
 */
export function requestTextWithoutAnnotations(prompt: string): string {
  const text = String(prompt ?? "");
  if (!text.startsWith(`${ANNOTATION_BLOCK_HEADING}\n`)) return text;
  const heading = `\n${ANNOTATION_REQUEST_HEADING}\n`;
  const index = text.lastIndexOf(heading);
  if (index === -1) return text;
  return text.slice(index + heading.length);
}

/** Cap one excerpt, never cutting between the halves of a surrogate pair. */
export function annotationExcerpt(
  text: string,
  limit = MAX_ANNOTATION_CHARS,
): string {
  const normalized = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (normalized.length <= limit) return normalized;
  const cut = normalized.slice(0, limit);
  const whole = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  return `${whole.trimEnd()}…`;
}

/* ---------- inline markers ---------- */

export const ANNOTATION_MARKER_CLASS = "response-annotation-marker";

/**
 * The token that stands in for one numbered marker. It is the reference's own
 * directive syntax, so a model that cites an annotation renders as a marker
 * instead of leaving the raw directive in the answer.
 */
export function annotationMarkerToken(index: number): string {
  return `:codex-annotation{index="${index}"}`;
}

/** One piece of a text node split around its marker tokens. */
export type AnnotationMarkerSegment =
  | { kind: "text"; value: string }
  | { kind: "marker"; index: number };

/**
 * Split rendered text around its marker tokens, so the markdown pass can turn
 * each marker into a numbered element instead of leaving the raw directive in
 * the answer.
 */
export function splitAnnotationMarkerTokens(
  text: string,
): AnnotationMarkerSegment[] {
  const value = String(text ?? "");
  const segments: AnnotationMarkerSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(MARKER_TOKEN)) {
    const at = match.index ?? 0;
    if (at > cursor) segments.push({ kind: "text", value: value.slice(cursor, at) });
    segments.push({ kind: "marker", index: Number(match[1]) });
    cursor = at + match[0].length;
  }
  if (cursor < value.length) segments.push({ kind: "text", value: value.slice(cursor) });
  return segments;
}

/** Replace marker tokens with the given text (used by plain-text surfaces). */
export function stripAnnotationMarkerTokens(
  text: string,
  replacement = "",
): string {
  return String(text ?? "").replace(MARKER_TOKEN, replacement);
}
