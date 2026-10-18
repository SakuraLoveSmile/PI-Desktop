import { serializeComposerFileReferences } from "@pi-desktop/shared";
import type { ComposerDraftSnapshot } from "../../../lib/composer-smart-stop";

/** Resume is text-only; preserve attachment drafts rather than silently dropping bytes. */
export function blockedGoalMessage(content: string, draft?: ComposerDraftSnapshot): string {
  if (draft?.fileReferences.some((reference) => reference.kind === "image" ||
    reference.mimeType?.toLowerCase().startsWith("image/") || reference.plugin?.kind === "attachment")) {
    throw new Error("GOAL_RESUME_ATTACHMENTS_UNSUPPORTED");
  }
  return draft ? serializeComposerFileReferences(draft.text, draft.fileReferences) : content;
}
