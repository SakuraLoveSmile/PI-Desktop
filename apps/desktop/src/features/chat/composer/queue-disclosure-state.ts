export type QueueDisclosureChoices = ReadonlyMap<string, boolean>;

/**
 * A queue of two or more rows folds by default; one row is always listed. Only
 * an explicit toggle is stored, so the default follows the live count instead
 * of freezing whatever count the queue had when it was first seen.
 */
export function queueDisclosureExpanded(
  choices: QueueDisclosureChoices,
  scopeKey: string,
  count: number,
): boolean {
  return choices.get(scopeKey) ?? count <= 1;
}

export function toggleQueueDisclosure(
  choices: QueueDisclosureChoices,
  scopeKey: string,
  count: number,
): QueueDisclosureChoices {
  return new Map(choices).set(scopeKey, !queueDisclosureExpanded(choices, scopeKey, count));
}

export function resetEmptyQueueDisclosure(
  choices: QueueDisclosureChoices,
  scopeKey: string,
): QueueDisclosureChoices {
  if (!choices.has(scopeKey)) return choices;
  const next = new Map(choices);
  next.delete(scopeKey);
  return next;
}
