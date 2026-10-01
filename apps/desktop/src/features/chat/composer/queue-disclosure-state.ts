export type QueueDisclosureChoices = ReadonlyMap<string, boolean>;

export function queueDisclosureExpanded(
  choices: QueueDisclosureChoices,
  scopeKey: string,
  count: number,
): boolean {
  return choices.get(scopeKey) ?? count <= 3;
}

export function initializeQueueDisclosure(
  choices: QueueDisclosureChoices,
  scopeKey: string,
  count: number,
): QueueDisclosureChoices {
  if (count === 0 || choices.has(scopeKey)) return choices;
  return new Map(choices).set(scopeKey, count <= 3);
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
