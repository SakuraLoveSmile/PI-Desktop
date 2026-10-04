import type { MessageEntry } from "./pi-runtime-types.js";

/**
 * The transcript an approved Plan or Goal execution is built from: everything
 * from `start` on, plus the model's system state from before it.
 *
 * Execution must not see the planning turns, but the runtime prompt and the
 * tool declarations are `system` rows of that same transcript. Cutting them
 * with the turns sends the request without its prompt, and the live state a
 * compaction checkpoint folds into its durable system state lacks them too.
 * Replayed in order, the retained rows fold to the state an unsliced request
 * would have had.
 */
export function entriesFromExecutionStart(
  entries: readonly MessageEntry[],
  start: number,
): MessageEntry[] {
  return entries.filter(
    (entry, index) => index >= start || entry.message.role === "system",
  );
}
