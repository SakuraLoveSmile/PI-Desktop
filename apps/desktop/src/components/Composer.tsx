import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  Mode,
  PermissionMode,
  ProviderPublic,
  ThinkingLevel,
} from "@pi-desktop/shared";
import {
  fileReferenceLabel,
  PERMISSION_MODES,
  serializeComposerFileReferences,
} from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import type { ComposerDraftSnapshot } from "../lib/composer-smart-stop";
import { api } from "../lib/api";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { headAsk, queuedAskCount } from "../lib/pending-asks";
import { runPaletteCommand } from "../lib/commands";
import {
  resolveComposerCommand,
  useComposerAutocomplete,
} from "../lib/use-composer-autocomplete";
import { ComposerAutocomplete } from "./ComposerAutocomplete";
import { AskToolCard } from "./AskToolCard";
import { PlanApprovalBar } from "./PlanApprovalBar";
import {
  IconArrowUp,
  IconShield,
  IconStop,
  IconChevronDown,
  IconCheck,
  IconListChecks,
  IconSparkles,
  IconTarget,
  IconFileText,
  IconX,
} from "./icons";

const COMPOSER_MIN_HEIGHT_PX = 28;
const COMPOSER_MAX_VISIBLE_ROWS = 7;
let composerFileReferenceSequence = 0;

type ComposerFileReference = {
  id: string;
  sessionId: string;
  path: string;
  name: string;
};

function createFileReference(
  path: string,
  preferredName?: string,
  sessionId = "",
): ComposerFileReference {
  composerFileReferenceSequence += 1;
  return {
    id: `composer-file-${composerFileReferenceSequence}`,
    sessionId,
    path,
    name: fileReferenceLabel(path, preferredName),
  };
}

/**
 * The composer-left chip is the only mode control, so one click steps through
 * every mode in a fixed order: execute freely, plan first, then goal contract.
 */
const MODE_CYCLE: readonly Mode[] = ["agent", "plan", "goal"];

function nextMode(mode: Mode): Mode {
  const index = MODE_CYCLE.indexOf(mode);
  return MODE_CYCLE[(index + 1) % MODE_CYCLE.length] ?? "agent";
}

const MODE_LABEL_KEYS: Record<Mode, string> = {
  agent: "settings.modeAgent",
  plan: "settings.modePlan",
  goal: "settings.modeGoal",
};

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "plan") return <IconListChecks size={14} />;
  if (mode === "goal") return <IconTarget size={14} />;
  return <IconShield size={14} />;
}

function clipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files);
  if (files.length === 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

/**
 * Keep the display order in sync with the runtime's extended thinking
 * levels. Providers decide which of these entries are actually rendered.
 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

const THINKING_LEVEL_I18N_KEYS: Record<ThinkingLevel, string> = {
  off: "chat.effortOff",
  minimal: "chat.effortMinimal",
  low: "chat.effortLow",
  medium: "chat.effortMid",
  high: "chat.effortHigh",
  xhigh: "chat.effortXhigh",
  max: "chat.effortMax",
};

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.includes(value as ThinkingLevel);
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    typeof value === "string" &&
    PERMISSION_MODES.includes(value as PermissionMode)
  );
}

const PERMISSION_MODE_I18N_KEYS: Record<PermissionMode, string> = {
  inherit: "chat.permissionInherit",
  ask: "chat.permissionAsk",
  "accept-edits": "chat.permissionAcceptEdits",
  auto: "chat.permissionAuto",
};

function providerThinkingLevels(provider?: ProviderPublic | null): ThinkingLevel[] {
  if (!provider?.supportsReasoning) return [];
  const declared = new Set(
    Array.isArray(provider.supportedThinkingLevels)
      ? provider.supportedThinkingLevels
      : [],
  );
  return THINKING_LEVELS.filter((level) => declared.has(level));
}

/**
 * Preserve the current level when changing providers, but never carry a
 * reasoning level into a provider that cannot accept it.
 */
export function thinkingLevelForProvider(
  provider: ProviderPublic | null | undefined,
  current: ThinkingLevel,
): ThinkingLevel {
  const available = providerThinkingLevels(provider);
  if (!provider?.supportsReasoning) return "off";
  if (available.includes(current)) return current;
  const requestedIndex = THINKING_LEVELS.indexOf(current);
  for (let index = requestedIndex; index < THINKING_LEVELS.length; index += 1) {
    const candidate = THINKING_LEVELS[index];
    if (available.includes(candidate)) return candidate;
  }
  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVELS[index];
    if (available.includes(candidate)) return candidate;
  }
  return "off";
}

function cssPixels(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type ComposerPrefill = {
  text: string;
  token: number;
};

const HOME_DRAFT_KEY = "__home__";

function draftKeyForSession(sessionId: string | null | undefined) {
  return sessionId ?? HOME_DRAFT_KEY;
}

export function Composer({
  variant = "docked",
  prefill,
}: {
  variant?: "home" | "docked";
  prefill?: ComposerPrefill | null;
}) {
  const { t } = useTranslation();
  const sendPrompt = useAppStore((s) => s.sendPrompt);
  const abort = useAppStore((s) => s.abort);
  const isRunning = useAppStore((s) => s.isRunning);
  const settings = useAppStore((s) => s.settings);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const workspacePath = useAppStore((s) => s.workspace?.path ?? "");
  const newSession = useAppStore((s) => s.newSession);
  const providers = useAppStore((s) => s.providers);
  const configureActiveSession = useAppStore((s) => s.configureActiveSession);
  const showToast = useAppStore((s) => s.showToast);
  const composerPrefill = useAppStore((s) => s.composerPrefill);
  const clearComposerPrefill = useAppStore((s) => s.clearComposerPrefill);
  const planCheckpoint = useAppStore((s) =>
    s.activeSessionId ? s.planCheckpoints[s.activeSessionId] : undefined,
  );
  const pendingAsk = useAppStore((s) =>
    headAsk(s.pendingAsks, s.activeSessionId),
  );
  const queuedAsks = useAppStore((s) =>
    queuedAskCount(s.pendingAsks, s.activeSessionId),
  );
  const [value, setValue] = useState("");
  const [fileReferences, setFileReferences] = useState<ComposerFileReference[]>([]);
  const [cursor, setCursor] = useState(0);
  const [composing, setComposing] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const permissionRef = useRef<HTMLDivElement>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [pasting, setPasting] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const draftKey = draftKeyForSession(activeSessionId);
  const draftCacheRef = useRef(new Map<string, ComposerDraftSnapshot>());
  const draftKeyRef = useRef(draftKey);
  const approvalPending = planCheckpoint?.status === "pending";
  const executionActive = isActivePlanExecution(planCheckpoint);
  const runActive = isRunning || executionActive;
  const inputBlocked = approvalPending || pasting;
  const controlsBlocked = approvalPending;
  const sendBlocked = runActive || approvalPending || pasting;
  const referenceSessionId = activeSessionId ?? "";
  const activeFileReferences = fileReferences.filter(
    (fileReference) => fileReference.sessionId === referenceSessionId,
  );

  useEffect(() => {
    const previousKey = draftKeyRef.current;
    if (previousKey !== draftKey) {
      draftCacheRef.current.set(previousKey, {
        text: value,
        fileReferences: fileReferences
          .filter((fileReference) => fileReference.sessionId === previousKey)
          .map(({ path, name }) => ({ path, name })),
      });
      draftKeyRef.current = draftKey;
      const nextDraft = draftCacheRef.current.get(draftKey);
      setValue(nextDraft?.text ?? "");
      setFileReferences(
        nextDraft?.fileReferences.map((fileReference) =>
          createFileReference(fileReference.path, fileReference.name, referenceSessionId),
        ) ?? [],
      );
      setCursor(nextDraft?.text.length ?? 0);
      return;
    }

    draftCacheRef.current.set(draftKey, {
      text: value,
      fileReferences: fileReferences
        .filter((fileReference) => fileReference.sessionId === referenceSessionId)
        .map(({ path, name }) => ({ path, name })),
    });
  }, [draftKey, fileReferences, referenceSessionId, value]);

  useEffect(() => {
    const sessionIds = new Set(sessions.map((session) => session.id));
    for (const key of draftCacheRef.current.keys()) {
      if (key !== HOME_DRAFT_KEY && key !== draftKey && !sessionIds.has(key)) {
        draftCacheRef.current.delete(key);
      }
    }
  }, [draftKey, sessions]);

  useEffect(() => {
    if (!controlsBlocked) return;
    setPermissionOpen(false);
    setThinkingOpen(false);
  }, [controlsBlocked]);

  useEffect(() => {
    // Relative autocomplete references belong to the workspace that produced
    // them. Never carry hidden canonical paths into another project.
    setFileReferences([]);
  }, [workspacePath]);

  useEffect(() => {
    if (!composerPrefill) return;
    if (composerPrefill.sessionId !== activeSessionId) return;
    setValue(composerPrefill.text);
    setFileReferences((current) => [
      ...current.filter(
        (fileReference) => fileReference.sessionId !== composerPrefill.sessionId,
      ),
      ...composerPrefill.fileReferences.map((fileReference) =>
        createFileReference(
          fileReference.path,
          fileReference.name,
          composerPrefill.sessionId,
        ),
      ),
    ]);
    clearComposerPrefill();
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, [activeSessionId, composerPrefill, clearComposerPrefill]);

  useEffect(() => {
    if (!prefill?.text) return;
    setValue(prefill.text);
    setFileReferences([]);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, [prefill]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measure wrapped visual lines, not newline characters. The draft starts
    // at one optical row, grows through seven rows, then scrolls internally.
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    const lineHeight = cssPixels(style.lineHeight) || COMPOSER_MIN_HEIGHT_PX;
    const verticalChrome =
      cssPixels(style.paddingTop) +
      cssPixels(style.paddingBottom) +
      cssPixels(style.borderTopWidth) +
      cssPixels(style.borderBottomWidth);
    const maxHeight = Math.ceil(
      lineHeight * COMPOSER_MAX_VISIBLE_ROWS + verticalChrome,
    );
    const next = Math.max(
      COMPOSER_MIN_HEIGHT_PX,
      Math.min(el.scrollHeight, maxHeight),
    );
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value]);

  useEffect(() => {
    if (!permissionOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!permissionRef.current?.contains(e.target as Node))
        setPermissionOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPermissionOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [permissionOpen]);

  useEffect(() => {
    if (!thinkingOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!thinkingRef.current?.contains(e.target as Node))
        setThinkingOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThinkingOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [thinkingOpen]);

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const mode: Mode = activeSession
    ? activeSession.mode
    : settings?.defaultMode ?? "agent";
  // Permission mode (D115/D132): inherited sessions still resolve through the
  // global setting, but the composer presents only the effective mode.
  const globalPermissionMode: PermissionMode =
    settings?.defaultPermissionMode ?? "ask";
  const sessionPermissionMode: PermissionMode = isPermissionMode(
    activeSession?.permissionMode,
  )
    ? activeSession.permissionMode
    : "inherit";
  const effectivePermissionMode: Exclude<PermissionMode, "inherit"> =
    sessionPermissionMode === "inherit"
      ? (globalPermissionMode as Exclude<PermissionMode, "inherit">)
      : sessionPermissionMode;
  const composerPermissionMode: Exclude<PermissionMode, "inherit"> =
    mode === "goal" ? "auto" : effectivePermissionMode;
  const provider = providers.find(
    (candidate) =>
      candidate.id ===
      (activeSession?.providerId ?? settings?.defaultProviderId),
  );
  const modelId =
    activeSession?.modelId ??
    settings?.defaultModelId ??
    provider?.defaultModelId;
  const thinkingProvider =
    provider &&
    activeSession?.providerId === provider.id &&
    activeSession.modelId === modelId &&
    typeof activeSession.supportsReasoning === "boolean"
      ? {
          ...provider,
          supportsReasoning: activeSession.supportsReasoning,
          supportedThinkingLevels:
            activeSession.supportedThinkingLevels ?? (["off"] as ThinkingLevel[]),
        }
      : provider;
  const sessionThinkingLevel = activeSession?.thinkingLevel;
  const configuredThinkingLevel = isThinkingLevel(sessionThinkingLevel)
    ? sessionThinkingLevel
    : "off";
  const availableThinkingLevels = providerThinkingLevels(thinkingProvider);
  const thinkingLevel = thinkingLevelForProvider(
    thinkingProvider,
    configuredThinkingLevel,
  );
  const thinkingLabel = t(THINKING_LEVEL_I18N_KEYS[thinkingLevel], {
    defaultValue: THINKING_LEVEL_LABELS[thinkingLevel],
  });
  const modelReady =
    !!provider &&
    provider.enabled &&
    !!modelId &&
    (provider.hasSecret || provider.authKind === "none");
  const enterToSend = settings?.enterToSend ?? true;
  const hasDraftContent = Boolean(value.trim() || activeFileReferences.length);

  const clearDraftForKey = (key: string) => {
    draftCacheRef.current.delete(key);
    const currentKey = draftKeyForSession(useAppStore.getState().activeSessionId);
    if (currentKey !== key) return;
    setValue("");
    setFileReferences((current) =>
      current.filter(
        (fileReference) => fileReference.sessionId !== key,
      ),
    );
    setCursor(0);
  };

  const draftSnapshot = (text: string): ComposerDraftSnapshot => ({
    text: text.trim(),
    fileReferences: activeFileReferences.map(({ path, name }) => ({ path, name })),
  });

  const submit = async () => {
    const content = serializeComposerFileReferences(value, activeFileReferences);
    if (!content || sendBlocked) return;
    const submittedDraftKey = draftKey;
    // Slash dispatch (D123): builtin/plugin aliases execute locally without
    // a session or a model; templates and unknown /names stay prompt text
    // (main expands templates). Runs before the model-ready gate on purpose.
    if (content.startsWith("/")) {
      const commandEnd = content.search(/\s/);
      const name = content.slice(
        1,
        commandEnd === -1 ? undefined : commandEnd,
      );
      const command = name ? await resolveComposerCommand(name) : null;
      if (command && command.kind !== "template" && command.id) {
        const commandBody =
          commandEnd === -1 ? "" : content.slice(commandEnd).trim();
        const isModeCommand =
          command.id === "builtin.mode.agent" ||
          command.id === "builtin.mode.plan" ||
          command.id === "builtin.mode.goal";

        // Mode aliases can prefix a real prompt, e.g. `/plan-mode inspect
        // this change`. Switch first, then send only the prompt body through
        // the normal agent path so the user's message remains visible.
        if (isModeCommand && commandBody) {
          try {
            await runPaletteCommand(command.id);
            const visibleDraft = value.trim();
            const visibleCommandEnd = visibleDraft.search(/\s/);
            const visibleCommandBody =
              visibleCommandEnd === -1
                ? ""
                : visibleDraft.slice(visibleCommandEnd).trim();
            const accepted = await sendPrompt(
              commandBody,
              draftSnapshot(visibleCommandBody),
            );
            if (accepted) clearDraftForKey(submittedDraftKey);
          } catch (e) {
            showToast(e instanceof Error ? e.message : String(e), {
              variant: "error",
            });
          }
          return;
        }

        // A local command is consumed only when it has no trailing text. A
        // command with unsupported arguments falls through as prompt text;
        // never silently discard a draft the user typed after the alias.
        if (!commandBody) {
          try {
            if (command.kind === "builtin") await runPaletteCommand(command.id);
            else await api.executeCommand(command.id);
            clearDraftForKey(submittedDraftKey);
          } catch (e) {
            showToast(e instanceof Error ? e.message : String(e), {
              variant: "error",
            });
          }
          return;
        }
      }
    }
    if (!modelReady) return;
    const accepted = await sendPrompt(content, draftSnapshot(value));
    if (accepted) clearDraftForKey(submittedDraftKey);
  };

  const pasteClipboardFiles = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (inputBlocked) return;
    const files = clipboardFiles(event.clipboardData);
    if (!files.length) return;

    event.preventDefault();
    const selectionStart = event.currentTarget.selectionStart ?? cursor;
    const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
    setPasting(true);
    try {
      const payload = await Promise.all(
        files.map(async (file) => ({
          name: file.name || undefined,
          mimeType: file.type || undefined,
          data: await file.arrayBuffer(),
        })),
      );
      let sessionId = activeSessionId;
      if (!sessionId) {
        await newSession();
        sessionId = useAppStore.getState().activeSessionId;
      }
      if (!sessionId) throw new Error("session unavailable");
      if (!activeSessionId) {
        setFileReferences((current) =>
          current.map((fileReference) =>
            fileReference.sessionId === ""
              ? { ...fileReference, sessionId }
              : fileReference,
          ),
        );
      }

      const result = await api.pasteFiles(sessionId, payload);
      setFileReferences((current) => [
        ...current,
        ...result.files.map((file) =>
          createFileReference(file.path, file.name, sessionId),
        ),
      ]);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(selectionStart, selectionEnd);
      });
      showToast(t("chat.filesPasted", { count: result.files.length }), {
        variant: "success",
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      setPasting(false);
    }
  };

  const composerAc = useComposerAutocomplete({
    value,
    cursor,
    composing,
    enabled: !inputBlocked,
  });

  const acceptCompletion = (index: number) => {
    const result = composerAc.accept(index);
    if (!result) return;
    setValue(result.value);
    setCursor(result.cursor);
    const acceptedFileReference = result.fileReference;
    if (acceptedFileReference) {
      setFileReferences((current) => [
        ...current,
        createFileReference(
          acceptedFileReference.path,
          acceptedFileReference.name,
          referenceSessionId,
        ),
      ]);
    }
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(result.cursor, result.cursor);
    });
  };

  // Keep the transcript's bottom reserve in sync with the composer's real
  // height (it grows with multi-line input) so the last message sits just
  // above the box instead of far below it.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const publish = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty(
        "--composer-dock-height",
        `${Math.round(h)}px`,
      );
    };
    publish();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);

  return (
    <div
      ref={dockRef}
      className={`composer-dock composer-dock-${variant}`}
    >
      <div className="composer-stack">
        {planCheckpoint?.status === "pending" ? (
          <PlanApprovalBar proposal={planCheckpoint} />
        ) : null}
        {pendingAsk ? (
          <AskToolCard request={pendingAsk} queued={queuedAsks} />
        ) : null}
        <div className={`composer-shell${inputBlocked ? " is-gated" : ""}`}>
          {inputFocused ? (
            <ComposerAutocomplete ac={composerAc} onAccept={acceptCompletion} />
          ) : null}
          <div className="composer-input-wrap">
            {activeFileReferences.length ? (
              <div
                className="composer-file-references"
                role="list"
                aria-label={t("chat.fileReferences")}
              >
                {activeFileReferences.map((fileReference) => (
                  <div
                    key={fileReference.id}
                    className="composer-file-reference"
                    role="listitem"
                    title={fileReference.path}
                    aria-label={`${fileReference.name} — ${fileReference.path}`}
                  >
                    <IconFileText size={13} aria-hidden />
                    <span className="composer-file-reference-name">
                      {fileReference.name}
                    </span>
                    <button
                      type="button"
                      className="composer-file-reference-remove"
                      title={t("chat.removeFileReference", {
                        name: fileReference.name,
                      })}
                      aria-label={t("chat.removeFileReference", {
                        name: fileReference.name,
                      })}
                      disabled={inputBlocked}
                      onClick={() => {
                        setFileReferences((current) =>
                          current.filter(
                            (candidate) => candidate.id !== fileReference.id,
                          ),
                        );
                        requestAnimationFrame(() => ref.current?.focus());
                      }}
                    >
                      <IconX size={11} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <textarea
              ref={ref}
              className={variant === "docked" ? "composer-input" : "composer-input composer-input-home"}
              readOnly={inputBlocked}
              aria-readonly={inputBlocked}
              aria-busy={pasting}
              rows={2}
              placeholder={t(variant === "home" ? "chat.placeholderHome" : "chat.placeholder")}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={value}
              onPaste={pasteClipboardFiles}
              onChange={(e) => {
                setValue(e.target.value);
                setCursor(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={(e) => {
                setCursor(e.currentTarget.selectionStart ?? 0);
              }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(e) => {
                setComposing(false);
                setCursor(e.currentTarget.selectionStart ?? 0);
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(e) => {
                // An Enter that confirms an IME candidate (isComposing, or the
                // WebKit 229 quirk) must commit the text, never send it — and
                // never drive the autocomplete menu (D125).
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
                  return;
                if (
                  e.key === "Backspace" &&
                  value.length === 0 &&
                  activeFileReferences.length
                ) {
                  e.preventDefault();
                  const lastReference = activeFileReferences.at(-1);
                  setFileReferences((current) =>
                    current.filter(
                      (fileReference) => fileReference.id !== lastReference?.id,
                    ),
                  );
                  return;
                }
                if (composerAc.open && e.key === "Escape") {
                  // Escape closes only the menu; overlay handlers must not
                  // also fire on the same press.
                  e.preventDefault();
                  e.stopPropagation();
                  composerAc.close();
                  return;
                }
                if (composerAc.hasItems) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const delta = e.key === "ArrowDown" ? 1 : -1;
                    const count = composerAc.items.length;
                    composerAc.setHighlight(
                      (composerAc.highlight + delta + count) % count,
                    );
                    return;
                  }
                  if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
                    e.preventDefault();
                    acceptCompletion(composerAc.highlight);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey && enterToSend) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <div className="composer-toolbar">
            <div className="composer-left">
              <button
                className="icon-btn mode-chip composer-mode-chip"
                title={t("settings.mode")}
                disabled={controlsBlocked}
                onClick={async () => {
                  setThinkingOpen(false);
                  setPermissionOpen(false);
                  const next: Mode = nextMode(mode);
                  try {
                    await configureActiveSession({
                      mode: next,
                      providerId: provider?.id,
                      modelId,
                      thinkingLevel,
                    });
                  } catch (e) {
                    showToast(e instanceof Error ? e.message : String(e), {
                      variant: "error",
                    });
                  }
                }}
              >
                <ModeIcon mode={mode} />
                <span className="text-sm">{t(MODE_LABEL_KEYS[mode])}</span>
              </button>
              {thinkingProvider?.supportsReasoning &&
              availableThinkingLevels.length ? (
                <div className="composer-thinking" ref={thinkingRef}>
                  <button
                    className={`icon-btn mode-chip thinking-chip ${
                      thinkingOpen ? "active" : ""
                    }`}
                    title={`${t("chat.thinking")} · ${thinkingLabel}`}
                    aria-haspopup="menu"
                    aria-expanded={thinkingOpen}
                    disabled={controlsBlocked}
                    onClick={() => {
                      setPermissionOpen(false);
                      setThinkingOpen((open) => !open);
                    }}
                  >
                    <IconSparkles size={14} />
                    <span className="text-sm">
                      {t("chat.thinking")} · {thinkingLabel}
                    </span>
                    <IconChevronDown size={12} />
                  </button>
                  {thinkingOpen ? (
                    <div
                      className="composer-model-menu composer-thinking-menu"
                      role="menu"
                      aria-label={t("chat.thinking")}
                    >
                      <div className="composer-thinking-list">
                        {availableThinkingLevels.map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={`composer-plus-item ${
                              thinkingLevel === level ? "active" : ""
                            }`}
                            role="menuitemradio"
                            aria-checked={thinkingLevel === level}
                            disabled={controlsBlocked}
                            onClick={async () => {
                              try {
                                await configureActiveSession({
                                  mode,
                                  providerId: thinkingProvider.id,
                                  modelId,
                                  thinkingLevel: level,
                                });
                                setThinkingOpen(false);
                              } catch (error) {
                                showToast(
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                                  { variant: "error" },
                                );
                              }
                            }}
                          >
                            <span className="flex-1">
                              {t(THINKING_LEVEL_I18N_KEYS[level], {
                                defaultValue: THINKING_LEVEL_LABELS[level],
                              })}
                            </span>
                            {thinkingLevel === level ? (
                              <IconCheck
                                size={14}
                                className="composer-model-check"
                              />
                            ) : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {mode === "agent" || mode === "plan" || mode === "goal" ? (
                <div className="composer-permission" ref={permissionRef}>
                  <button
                    className={`icon-btn mode-chip ${permissionOpen ? "active" : ""}`}
                    title={
                      mode === "goal"
                        ? `${t("chat.permissionMode")} · ${t("goal.autoWarning")}`
                        : mode === "plan" && composerPermissionMode === "auto"
                          ? `${t("chat.permissionMode")} · ${t("plan.autoWarning")}`
                          : t("chat.permissionMode")
                    }
                    aria-haspopup={mode === "goal" ? undefined : "menu"}
                    aria-expanded={mode === "goal" ? false : permissionOpen}
                    disabled={controlsBlocked || mode === "goal"}
                    onClick={() => {
                      setThinkingOpen(false);
                      setPermissionOpen((open) => !open);
                    }}
                  >
                    <span className="text-sm">
                      {t(PERMISSION_MODE_I18N_KEYS[composerPermissionMode])}
                    </span>
                    <IconChevronDown size={12} />
                  </button>
                  {permissionOpen && mode !== "goal" && (
                    <div className="composer-permission-menu" role="menu">
                      {(["ask", "accept-edits", "auto"] as const).map(
                        (candidate) => (
                          <button
                            key={candidate}
                            type="button"
                            role="menuitemradio"
                            aria-checked={composerPermissionMode === candidate}
                            disabled={controlsBlocked}
                            className={`composer-plus-item ${
                              composerPermissionMode === candidate ? "active" : ""
                            }`}
                            onClick={async () => {
                              setPermissionOpen(false);
                              try {
                                await configureActiveSession({
                                  mode,
                                  providerId: provider?.id,
                                  modelId,
                                  thinkingLevel,
                                  permissionMode: candidate,
                                });
                              } catch (e) {
                                showToast(
                                  e instanceof Error ? e.message : String(e),
                                  { variant: "error" },
                                );
                              }
                            }}
                          >
                            <span className="flex-1 text-left">
                              {t(PERMISSION_MODE_I18N_KEYS[candidate])}
                            </span>
                            {composerPermissionMode === candidate ? (
                              <IconCheck size={13} />
                            ) : null}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="composer-right">
              {runActive ? (
                <button className="stop-btn" title={t("chat.abort")} onClick={() => void abort()}>
                  <IconStop size={14} />
                </button>
              ) : (
                <button
                  className="send-btn"
                  title={
                    modelReady ? t("chat.send") : t("settings.addProvider")
                  }
                  disabled={
                    !hasDraftContent ||
                    sendBlocked ||
                    (!modelReady && !value.trim().startsWith("/"))
                  }
                  onClick={() => void submit()}
                >
                  <IconArrowUp size={15} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
