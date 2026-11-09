import type { AssistedUpdateBlockedReason } from "@pi-desktop/shared";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Why an ad-hoc macOS install cannot update itself in place, in words that say
 * what to do about it. Every reason is a literal catalog key so the renderer
 * key test sees each one.
 */
export function assistedBlockedMessage(
  reason: AssistedUpdateBlockedReason,
  t: Translate,
): string {
  switch (reason) {
    case "translocated":
      return t("updates.assistedBlockedTranslocated");
    case "read-only":
      return t("updates.assistedBlockedReadOnly");
    case "not-writable":
      return t("updates.assistedBlockedNotWritable");
    case "symlink":
      return t("updates.assistedBlockedSymlink");
    default:
      return reason satisfies never;
  }
}
