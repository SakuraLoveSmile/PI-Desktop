import type { ComposerHistoryEntry } from "../../../lib/composer-input-history";

export type HistoryDirection = "older" | "newer";

export function stepHistoryIndex(
  index: number | null,
  direction: HistoryDirection,
  length: number,
): number | null {
  if (length <= 0) return null;
  if (direction === "older") return index === null ? 0 : Math.min(index + 1, length - 1);
  if (index === null || index <= 0) return null;
  return index - 1;
}

export type HistoryNavigationPlan =
  | { action: "ignore" }
  | { action: "keep" }
  | { action: "load"; index: number }
  | { action: "exit" };

export function planHistoryNavigation(input: {
  index: number | null;
  direction: HistoryDirection;
  length: number;
  draftEmpty: boolean;
}): HistoryNavigationPlan {
  if (input.index === null) {
    if (input.direction === "newer" || !input.draftEmpty || input.length === 0) {
      return { action: "ignore" };
    }
    return { action: "load", index: 0 };
  }
  const next = stepHistoryIndex(input.index, input.direction, input.length);
  if (next === null) return { action: "exit" };
  if (next === input.index) return { action: "keep" };
  return { action: "load", index: next };
}

export type HistoryStepResult = {
  consumed: boolean;
  entries: readonly ComposerHistoryEntry[];
  index: number | null;
  applied: boolean;
};

export function runHistoryStep<TReference>(options: {
  entries: readonly ComposerHistoryEntry[];
  index: number | null;
  keptReferences: readonly TReference[];
  direction: HistoryDirection;
  draftEmpty: boolean;
  edited: boolean;
  loadHistory: () => readonly ComposerHistoryEntry[];
  createReference: (
    reference: ComposerHistoryEntry["fileReferences"][number],
  ) => TReference;
  effects: {
    applyDraft: (text: string, references: readonly TReference[], caret: number) => void;
  };
}): HistoryStepResult {
  const browsing = options.index !== null && !options.edited;
  const entries = browsing ? options.entries : options.loadHistory();
  const plan = planHistoryNavigation({
    index: browsing ? options.index : null,
    direction: options.direction,
    length: entries.length,
    draftEmpty: options.draftEmpty,
  });
  if (plan.action === "ignore") {
    if (options.edited) return { consumed: false, entries: [], index: null, applied: false };
    return { consumed: false, entries: options.entries, index: options.index, applied: false };
  }
  if (plan.action === "keep") {
    return { consumed: true, entries: options.entries, index: options.index, applied: false };
  }
  if (plan.action === "exit") {
    options.effects.applyDraft("", options.keptReferences, 0);
    return { consumed: true, entries: [], index: null, applied: false };
  }
  const entry = entries[plan.index];
  if (!entry) return { consumed: true, entries: [], index: null, applied: false };
  options.effects.applyDraft(
    entry.text,
    [...options.keptReferences, ...entry.fileReferences.map(options.createReference)],
    entry.text.length,
  );
  return { consumed: true, entries, index: plan.index, applied: true };
}
