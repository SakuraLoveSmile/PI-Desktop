import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  Mode,
  PermissionMode,
  ProviderPublic,
  ThinkingLevel,
} from "@pi-desktop/shared";
import { formatFileInsert, PERMISSION_MODES } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { runPaletteCommand } from "../lib/commands";
import {
  resolveComposerCommand,
  useComposerAutocomplete,
} from "../lib/use-composer-autocomplete";
import { ComposerAutocomplete } from "./ComposerAutocomplete";
import { PlanApprovalBar } from "./PlanApprovalBar";
import {
  IconArrowUp,
  IconShield,
  IconStop,
  IconChevronDown,
  IconCheck,
  IconListChecks,
  IconSparkles,
} from "./icons";

const COMPOSER_MIN_HEIGHT_PX = 28;
const COMPOSER_MAX_VISIBLE_ROWS = 7;

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
  const newSession = useAppStore((s) => s.newSession);
  const providers = useAppStore((s) => s.providers);
  const configureActiveSession = useAppStore((s) => s.configureActiveSession);
  const showToast = useAppStore((s) => s.showToast);
  const composerPrefill = useAppStore((s) => s.composerPrefill);
  const clearComposerPrefill = useAppStore((s) => s.clearComposerPrefill);
  const planCheckpoint = useAppStore((s) =>
    s.activeSessionId ? s.planCheckpoints[s.activeSessionId] : undefined,
  );
  const [value, setValue] = useState("");
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
  const approvalPending = planCheckpoint?.status === "pending";
  const executionActive = isActivePlanExecution(planCheckpoint);
  const composerBlocked = isRunning || executionActive || approvalPending || pasting;
  const runActive = isRunning || executionActive;

  useEffect(() => {
    if (!composerBlocked) return;
    setPermissionOpen(false);
    setThinkingOpen(false);
  }, [composerBlocked]);

  useEffect(() => {
    if (!composerPrefill) return;
    setValue(composerPrefill);
    clearComposerPrefill();
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, [composerPrefill, clearComposerPrefill]);

  useEffect(() => {
    if (!prefill?.text) return;
    setValue(prefill.text);
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

  const submit = async () => {
    const content = value.trim();
    if (!content || composerBlocked || pasting) return;
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
          command.id === "builtin.mode.plan";

        // Mode aliases can prefix a real prompt, e.g. `/plan-mode inspect
        // this change`. Switch first, then send only the prompt body through
        // the normal agent path so the user's message remains visible.
        if (isModeCommand && commandBody) {
          try {
            await runPaletteCommand(command.id);
            const accepted = await sendPrompt(commandBody);
            if (accepted) setValue("");
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
            setValue("");
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
    const accepted = await sendPrompt(content);
    if (accepted) setValue("");
  };

  const pasteClipboardFiles = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (composerBlocked || pasting) return;
    const files = clipboardFiles(event.clipboardData);
    if (!files.length) return;

    event.preventDefault();
    const input = ref.current;
    const current = input?.value ?? value;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? start;
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

      const result = await api.pasteFiles(sessionId, payload);
      const insertion = result.files
        .map((file) => formatFileInsert(file.path, "file"))
        .join("");
      const next = current.slice(0, start) + insertion + current.slice(end);
      const nextCursor = start + insertion.length;
      setValue(next);
      setCursor(nextCursor);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCursor, nextCursor);
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
    enabled: !composerBlocked,
  });

  const acceptCompletion = (index: number) => {
    const result = composerAc.accept(index);
    if (!result) return;
    setValue(result.value);
    setCursor(result.cursor);
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
        <div className={`composer-shell${composerBlocked ? " is-gated" : ""}`}>
          {inputFocused ? (
            <ComposerAutocomplete ac={composerAc} onAccept={acceptCompletion} />
          ) : null}
          <div className="composer-input-wrap">
            <textarea
              ref={ref}
              className={variant === "docked" ? "composer-input" : "composer-input composer-input-home"}
              readOnly={composerBlocked}
              aria-readonly={composerBlocked}
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
                className="icon-btn mode-chip"
                title={t("settings.mode")}
                disabled={composerBlocked || !activeSession}
                onClick={async () => {
                  setThinkingOpen(false);
                  setPermissionOpen(false);
                  const next: Mode = mode === "agent" ? "plan" : "agent";
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
                {mode === "plan" ? (
                  <IconListChecks size={14} />
                ) : (
                  <IconShield size={14} />
                )}
                <span className="text-sm">
                  {mode === "plan"
                    ? t("settings.modePlan")
                    : t("settings.modeAgent")}
                </span>
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
                    disabled={composerBlocked || !activeSession}
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
                            disabled={composerBlocked}
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
              {mode === "agent" || mode === "plan" ? (
                <div className="composer-permission" ref={permissionRef}>
                  <button
                    className={`icon-btn mode-chip ${permissionOpen ? "active" : ""}`}
                    title={
                      mode === "plan" && effectivePermissionMode === "auto"
                        ? `${t("chat.permissionMode")} · ${t("plan.autoWarning")}`
                        : t("chat.permissionMode")
                    }
                    aria-haspopup="menu"
                    aria-expanded={permissionOpen}
                    disabled={composerBlocked || !activeSession}
                    onClick={() => {
                      setThinkingOpen(false);
                      setPermissionOpen((open) => !open);
                    }}
                  >
                    <span className="text-sm">
                      {t(PERMISSION_MODE_I18N_KEYS[effectivePermissionMode])}
                    </span>
                    <IconChevronDown size={12} />
                  </button>
                  {permissionOpen && (
                    <div className="composer-permission-menu" role="menu">
                      {(["ask", "accept-edits", "auto"] as const).map(
                        (candidate) => (
                          <button
                            key={candidate}
                            type="button"
                            role="menuitemradio"
                            aria-checked={effectivePermissionMode === candidate}
                            disabled={composerBlocked}
                            className={`composer-plus-item ${
                              effectivePermissionMode === candidate ? "active" : ""
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
                            {effectivePermissionMode === candidate ? (
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
                    !value.trim() ||
                    composerBlocked ||
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
