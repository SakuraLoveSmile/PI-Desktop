import { useEffect, useRef } from "react";
import type { ComposerDraftSnapshot } from "../../../../lib/composer-smart-stop";
import {
  loadComposerInputHistory,
  rememberComposerInput,
  type ComposerHistoryEntry,
} from "../../../../lib/composer-input-history";
import { createFileReference } from "../editor";
import { runHistoryStep, type HistoryDirection } from "../input-history";
import type { ComposerDraftController } from "./useComposerDraft";

type UseComposerInputHistoryOptions = {
  draftKey: string;
  referenceSessionId: string;
  invalidatePromptEnhancement: () => void;
  draft: Pick<ComposerDraftController, "readLiveDraft" | "fileReferencesRef" | "applyEditorDraft" | "draftRevision">;
};

export type ComposerInputHistoryController = {
  navigate: (direction: HistoryDirection) => boolean;
  exitBrowsing: () => void;
  record: (snapshot: ComposerDraftSnapshot, sessionId: string) => void;
};

export function useComposerInputHistory({ draftKey, referenceSessionId, invalidatePromptEnhancement, draft }: UseComposerInputHistoryOptions): ComposerInputHistoryController {
  const indexRef = useRef<number | null>(null);
  const entriesRef = useRef<readonly ComposerHistoryEntry[]>([]);
  const appliedRevisionRef = useRef(-1);

  const exitBrowsing = () => {
    indexRef.current = null;
    entriesRef.current = [];
  };

  useEffect(() => {
    exitBrowsing();
  }, [draftKey]);

  const navigate = (direction: HistoryDirection): boolean => {
    const edited = indexRef.current !== null && draft.draftRevision(draftKey) !== appliedRevisionRef.current;
    const result = runHistoryStep({
      entries: entriesRef.current,
      index: indexRef.current,
      keptReferences: draft.fileReferencesRef.current.filter((reference) => reference.sessionId !== referenceSessionId),
      direction,
      draftEmpty: !draft.readLiveDraft().trim() && !draft.fileReferencesRef.current.some((reference) => reference.sessionId === referenceSessionId),
      edited,
      loadHistory: () => loadComposerInputHistory(referenceSessionId),
      createReference: (reference) => createFileReference(reference.path, reference.name, referenceSessionId, reference),
      effects: {
        applyDraft: (text, references, caret) => {
          // Recalled text supersedes the draft an enhancement request captured.
          // This also covers the empty draft applied when leaving history.
          invalidatePromptEnhancement();
          draft.applyEditorDraft(text, [...references], caret);
        },
      },
    });
    entriesRef.current = result.entries;
    indexRef.current = result.index;
    if (result.applied) appliedRevisionRef.current = draft.draftRevision(draftKey);
    return result.consumed;
  };

  const record = (snapshot: ComposerDraftSnapshot, sessionId: string) => {
    rememberComposerInput(sessionId, snapshot);
  };

  return { navigate, exitBrowsing, record };
}
