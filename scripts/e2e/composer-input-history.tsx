import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { TFunction } from "i18next";
import { en } from "@pi-desktop/i18n";
import { ComposerInput } from "../../apps/desktop/src/features/chat/composer/ComposerInput";
import { useComposerDraft, type ComposerDraftController } from "../../apps/desktop/src/features/chat/composer/hooks/useComposerDraft";
import { useComposerInputHistory } from "../../apps/desktop/src/features/chat/composer/hooks/useComposerInputHistory";
import { useComposerSubmit, type ComposerSubmitController } from "../../apps/desktop/src/features/chat/composer/hooks/useComposerSubmit";
import { api } from "../../apps/desktop/src/lib/api";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { readEditorValue } from "../../apps/desktop/src/features/chat/composer/editor";

declare global {
  var composerInputHistoryProbe: () => Promise<unknown>;
}

const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
const noop = () => {};
const sessions = [{ id: "history-a" }, { id: "history-b" }];

let controller: ComposerDraftController;
let historyController: ReturnType<typeof useComposerInputHistory>;
let submitController: ComposerSubmitController;

function Fixture({ sessionId, t }: { sessionId: string; t: TFunction }) {
  const enhancementInvalidateRef = useRef<() => void>(() => {});
  const invalidatePromptEnhancement = () => enhancementInvalidateRef.current();
  const draft = useComposerDraft({
    variant: "docked",
    activeSessionId: sessionId,
    workspacePath: "/history-project",
    sessions,
    composerPrefill: null,
    clearComposerPrefill: noop,
    t,
    invalidatePromptEnhancement,
    inputBlocked: false,
  });
  const history = useComposerInputHistory({
    draftKey: draft.draftKey,
    referenceSessionId: sessionId,
    invalidatePromptEnhancement,
    draft,
  });
  const submit = useComposerSubmit({
    value: draft.value,
    draftKey: draft.draftKey,
    activeSessionId: sessionId,
    thinkingLevel: "off",
    modelReady: true,
    sendBlocked: false,
    pasting: false,
    activeFileReferences: draft.activeFileReferences,
    t,
    sendPrompt: async (_content, _snapshot, targetSessionId, options) => {
      options?.onAccepted?.(targetSessionId ?? sessionId);
      return true;
    },
    steerPrompt: async () => true,
    showToast: noop,
    recordHistory: history.record,
    draft,
  });
  enhancementInvalidateRef.current = submit.invalidatePromptEnhancement;
  controller = draft;
  historyController = history;
  submitController = submit;
  return (
    <ComposerInput
      inputRef={draft.ref}
      value={draft.value}
      placeholderText=""
      placeholderKey="history-fixture"
      inputBlocked={false}
      pasting={false}
      enterToSend
      runActive={false}
      composerAc={{ open: false, close: noop, hasItems: false, items: [], highlight: 0, setHighlight: noop } as never}
      onPaste={noop}
      onAcceptCompletion={noop}
      onSubmit={() => void submit.submit()}
      onInsertNewline={draft.insertNewlineInEditor}
      onInput={draft.handleInput}
      onHistoryNavigate={history.navigate}
      onCompositionStart={noop}
      onCompositionEnd={noop}
      onFocus={noop}
      onBlur={noop}
    />
  );
}

globalThis.composerInputHistoryProbe = async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  const host = document.createElement("div");
  document.body.append(host);
  const errors: unknown[] = [];
  const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
  let renderKey = 0;
  const render = (sessionId: string) => {
    useAppStore.setState({ activeSessionId: sessionId });
    flushSync(() => root.render(<I18nextProvider i18n={i18n}><Fixture key={`${sessionId}:${renderKey++}`} sessionId={sessionId} t={i18n.t} /></I18nextProvider>));
    assert(errors.length === 0, `React failed during render: ${errors.map(String).join("; ")}`);
  };
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const setDraft = async (text: string) => {
    flushSync(() => controller.applyEditorDraft(text, [], text.length));
    await frame();
  };
  const press = async (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    controller.ref.current!.dispatchEvent(event);
    await frame();
    assert(event.defaultPrevented, `${key} was not consumed by history`);
  };
  const submit = async (text: string) => {
    await setDraft(text);
    await submitController.submit();
    await frame();
    assert(controller.readLiveDraft() === "", `accepted ${text} was not cleared`);
  };
  const originalEnhancePrompt = api.enhancePrompt;
  let enhancementStarted = false;
  let releaseEnhancement = () => {};
  const enhancementGate = new Promise<void>((resolve) => { releaseEnhancement = resolve; });
  api.enhancePrompt = async () => {
    enhancementStarted = true;
    await enhancementGate;
    return { enhancedDraft: "STALE ENHANCED A" };
  };
  try {
    render("history-a");
    await submit("alpha");
    await submit("beta");
    await setDraft("");
    await press("ArrowUp");
    assert(readEditorValue(controller.ref.current!) === "beta", "ArrowUp did not recall newest input");
    await press("ArrowUp");
    assert(readEditorValue(controller.ref.current!) === "alpha", "second ArrowUp did not recall older input");
    await press("ArrowDown");
    assert(readEditorValue(controller.ref.current!) === "beta", "ArrowDown did not return to newer input");
    await press("ArrowDown");
    assert(readEditorValue(controller.ref.current!) === "", "ArrowDown did not leave history at empty draft");

    await setDraft("draft A");
    const pendingEnhancement = submitController.enhancePrompt();
    while (!enhancementStarted) await frame();
    await setDraft("");
    await press("ArrowUp");
    assert(readEditorValue(controller.ref.current!) === "beta", "history navigation did not replace enhancement source");
    releaseEnhancement();
    await pendingEnhancement;
    assert(readEditorValue(controller.ref.current!) === "beta", "stale enhancement overwrote recalled input");

    render("history-b");
    await setDraft("");
    assert(historyController.navigate("older") === false, "session B recalled session A history");
    await submit("gamma");
    await setDraft("");
    await press("ArrowUp");
    assert(readEditorValue(controller.ref.current!) === "gamma", "session B did not recall its own input");
    render("history-a");
    await setDraft("");
    await press("ArrowUp");
    assert(readEditorValue(controller.ref.current!) === "beta", "session A history was not isolated from session B");
    assert(errors.length === 0, `React errors: ${errors.map(String).join("; ")}`);
    return { ok: true, recalled: ["beta", "alpha", "beta", ""], isolated: true, staleEnhancementBlocked: true };
  } finally {
    api.enhancePrompt = originalEnhancePrompt;
    flushSync(() => root.unmount());
    host.remove();
  }
};
