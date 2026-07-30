import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  PermissionMode,
  ProviderPublic,
  ThinkingLevel,
} from "@pi-desktop/shared";
import { PERMISSION_MODES } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { api } from "../lib/api";
import { runPaletteCommand } from "../lib/commands";
import {
  resolveComposerCommand,
  useComposerAutocomplete,
} from "../lib/use-composer-autocomplete";
import { ComposerAutocomplete } from "./ComposerAutocomplete";
import {
  IconArrowUp,
  IconShield,
  IconStop,
  IconChevronDown,
  IconCheck,
  IconSearch,
  IconSparkles,
} from "./icons";

const COMPOSER_MIN_HEIGHT_PX = 28;
const COMPOSER_MAX_VISIBLE_ROWS = 7;

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

export function Composer({ variant = "docked" }: { variant?: "home" | "docked" }) {
  const { t } = useTranslation();
  const sendPrompt = useAppStore((s) => s.sendPrompt);
  const abort = useAppStore((s) => s.abort);
  const isRunning = useAppStore((s) => s.isRunning);
  const settings = useAppStore((s) => s.settings);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const providers = useAppStore((s) => s.providers);
  const providerModels = useAppStore((s) => s.providerModels);
  const loadProviderModels = useAppStore((s) => s.loadProviderModels);
  const configureActiveSession = useAppStore((s) => s.configureActiveSession);
  const showToast = useAppStore((s) => s.showToast);
  const composerPrefill = useAppStore((s) => s.composerPrefill);
  const clearComposerPrefill = useAppStore((s) => s.clearComposerPrefill);
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [composing, setComposing] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  const permissionRef = useRef<HTMLDivElement>(null);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelHighlight, setModelHighlight] = useState(-1);
  const ref = useRef<HTMLTextAreaElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

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
    if (!modelOpen) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (modelOpen && !modelRef.current?.contains(t)) setModelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModelOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  // Opening the menu lazily fills each ready provider's model list; entries
  // render immediately from the configured model and refine when discovery
  // answers.
  useEffect(() => {
    if (!modelOpen) return;
    for (const candidate of providers) {
      if (candidate.enabled && (candidate.hasSecret || candidate.authKind === "none")) {
        void loadProviderModels(candidate.id);
      }
    }
  }, [modelOpen, providers, loadProviderModels]);

  // Each open starts from a clean filter with the keyboard ready to type.
  useEffect(() => {
    if (!modelOpen) return;
    setModelQuery("");
    requestAnimationFrame(() => modelSearchRef.current?.focus());
  }, [modelOpen]);

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
  const mode = activeSession?.mode ?? settings?.defaultMode ?? "agent";
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
  const modelLabel = modelId || t("chat.model");
  const modelReady =
    !!provider &&
    provider.enabled &&
    !!modelId &&
    (provider.hasSecret || provider.authKind === "none");
  const enterToSend = settings?.enterToSend ?? true;

  const modelGroups = providers
    .filter(
      (candidate) =>
        candidate.enabled && (candidate.hasSecret || candidate.authKind === "none"),
    )
    .map((candidate) => {
      const discovered = providerModels[candidate.id];
      const models =
        discovered && discovered.length > 0
          ? discovered
          : candidate.defaultModelId
            ? [
                {
                  modelId: candidate.defaultModelId,
                  displayName: candidate.defaultModelId,
                },
              ]
            : [];
      return { provider: candidate, models };
    })
    .filter((group) => group.models.length > 0);
  const totalModelCount = modelGroups.reduce(
    (count, group) => count + group.models.length,
    0,
  );
  const showModelSearch = totalModelCount > 5;
  const modelQueryNeedle = modelQuery.trim().toLowerCase();
  const filteredModelGroups = modelQueryNeedle
    ? modelGroups
        .map((group) => ({
          ...group,
          models: group.models.filter(
            (model) =>
              model.modelId.toLowerCase().includes(modelQueryNeedle) ||
              (model.displayName ?? "")
                .toLowerCase()
                .includes(modelQueryNeedle) ||
              group.provider.name.toLowerCase().includes(modelQueryNeedle),
          ),
        }))
        .filter((group) => group.models.length > 0)
    : modelGroups;
  const flatModels = filteredModelGroups.flatMap((group) =>
    group.models.map((model) => ({ provider: group.provider, model })),
  );
  // Stable identity for the filtered list so highlight effects don't rerun on
  // every render just because flatMap allocates a fresh array.
  const flatModelsKey = flatModels
    .map((entry) => `${entry.provider.id}:${entry.model.modelId}`)
    .join("|");
  const activeFlatIndex = flatModels.findIndex(
    (entry) => entry.provider.id === provider?.id && entry.model.modelId === modelId,
  );

  // While filtering, keep the first hit primed for Enter; otherwise park the
  // highlight on the configured model so the list opens scrolled to it.
  useEffect(() => {
    if (!modelOpen) return;
    setModelHighlight(modelQueryNeedle ? (flatModels.length ? 0 : -1) : activeFlatIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelOpen, modelQueryNeedle, flatModelsKey, activeFlatIndex]);

  useEffect(() => {
    if (!modelOpen || modelHighlight < 0) return;
    modelListRef.current
      ?.querySelector(`[data-model-index="${modelHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [modelOpen, modelHighlight]);

  const selectModel = async (candidate: ProviderPublic, nextModelId: string) => {
    try {
      await configureActiveSession({
        mode,
        providerId: candidate.id,
        modelId: nextModelId,
        thinkingLevel: thinkingLevelForProvider(candidate, thinkingLevel),
      });
      setModelOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), {
        variant: "error",
      });
    }
  };

  const onModelMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (!modelOpen) return;
    // Keys pressed while composing (IME candidate navigation/confirm) belong
    // to the IME, not the menu.
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flatModels.length) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setModelHighlight((current) => {
        const base = current < 0 ? (delta > 0 ? -1 : flatModels.length) : current;
        return (base + delta + flatModels.length) % flatModels.length;
      });
    } else if (e.key === "Enter") {
      // Buttons inside the menu (thinking levels, settings) keep their own
      // Enter behavior; only the search box and the chip route to selection.
      const target = e.target as HTMLElement;
      if (target.tagName === "BUTTON" && !target.classList.contains("model-chip"))
        return;
      const entry = flatModels[modelHighlight];
      if (entry) {
        e.preventDefault();
        void selectModel(entry.provider, entry.model.modelId);
      }
    }
  };
  const submit = async () => {
    const content = value.trim();
    if (!content || isRunning) return;
    // Slash dispatch (D123): builtin/plugin aliases execute locally without
    // a session or a model; templates and unknown /names stay prompt text
    // (main expands templates). Runs before the model-ready gate on purpose.
    if (content.startsWith("/")) {
      const name = content.slice(1).split(/\s/, 1)[0];
      const command = name ? await resolveComposerCommand(name) : null;
      if (command && command.kind !== "template" && command.id) {
        setValue("");
        try {
          if (command.kind === "builtin") await runPaletteCommand(command.id);
          else await api.executeCommand(command.id);
        } catch (e) {
          showToast(e instanceof Error ? e.message : String(e), {
            variant: "error",
          });
        }
        return;
      }
    }
    if (!modelReady) return;
    setValue("");
    await sendPrompt(content);
  };

  const composerAc = useComposerAutocomplete({
    value,
    cursor,
    composing,
    enabled: !isRunning,
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
        <div className="composer-shell">
          {inputFocused ? (
            <ComposerAutocomplete ac={composerAc} onAccept={acceptCompletion} />
          ) : null}
          <div className="composer-input-wrap">
            <textarea
              ref={ref}
              className={variant === "docked" ? "composer-input" : "composer-input composer-input-home"}
              rows={2}
              placeholder={t(variant === "home" ? "chat.placeholderHome" : "chat.placeholder")}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              value={value}
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
                disabled={isRunning || !activeSession}
                onClick={async () => {
                  setThinkingOpen(false);
                  setPermissionOpen(false);
                  setModelOpen(false);
                  const next = mode === "agent" ? "chat" : "agent";
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
                <IconShield size={14} />
                <span className="text-sm">
                  {mode === "chat"
                    ? t("settings.modeChat")
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
                    disabled={isRunning || !activeSession}
                    onClick={() => {
                      setPermissionOpen(false);
                      setModelOpen(false);
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
              {mode === "agent" ? (
                <div className="composer-permission" ref={permissionRef}>
                  <button
                    className={`icon-btn mode-chip ${permissionOpen ? "active" : ""}`}
                    title={t("chat.permissionMode")}
                    aria-haspopup="menu"
                    aria-expanded={permissionOpen}
                    disabled={isRunning || !activeSession}
                    onClick={() => {
                      setThinkingOpen(false);
                      setModelOpen(false);
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
              <div
                className="composer-model"
                ref={modelRef}
                onKeyDown={onModelMenuKeyDown}
              >
                <button
                  className={`icon-btn model-chip ${modelOpen ? "active" : ""}`}
                  title={`${provider?.name || t("chat.provider")} · ${modelLabel}`}
                  aria-haspopup="menu"
                  aria-expanded={modelOpen}
                  disabled={isRunning}
                  onClick={() => {
                    setThinkingOpen(false);
                    setPermissionOpen(false);
                    setModelOpen((open) => !open);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    useAppStore.getState().setSettingsTab("agent");
                    useAppStore.getState().setPage("settings");
                  }}
                >
                  <span className="model-chip-label text-sm">
                    {modelLabel}
                  </span>
                  <IconChevronDown size={12} />
                </button>
                {modelOpen && (
                  <div className="composer-model-menu" role="menu">
                    <div className="composer-model-heading">
                      <div className="truncate text-sm-plus font-medium text-text-primary">
                        {modelId || t("chat.model")}
                      </div>
                      <div className="truncate text-xs-plus text-text-muted">
                        {provider?.name || t("chat.provider")}
                      </div>
                    </div>
                    <div className="composer-plus-sep" />
                    {showModelSearch ? (
                      <div className="composer-model-search">
                        <IconSearch size={13} />
                        <input
                          ref={modelSearchRef}
                          type="text"
                          value={modelQuery}
                          placeholder={t("chat.searchModels")}
                          spellCheck={false}
                          autoCorrect="off"
                          autoCapitalize="off"
                          onChange={(e) => setModelQuery(e.target.value)}
                        />
                      </div>
                    ) : null}
                    <div className="composer-model-list" ref={modelListRef}>
                      {(() => {
                        let flatIndex = 0;
                        return filteredModelGroups.map((group) => (
                          <div
                            key={group.provider.id}
                            className="composer-model-group"
                            role="group"
                            aria-label={group.provider.name}
                          >
                            <div className="composer-model-group-label">
                              {group.provider.name}
                            </div>
                            {group.models.map((model) => {
                              const index = flatIndex++;
                              const active =
                                provider?.id === group.provider.id &&
                                modelId === model.modelId;
                              const hasAlias =
                                !!model.displayName &&
                                model.displayName !== model.modelId;
                              return (
                                <button
                                  key={model.modelId}
                                  data-model-index={index}
                                  className={`composer-plus-item ${active ? "active" : ""} ${
                                    modelHighlight === index ? "kb-active" : ""
                                  }`}
                                  role="menuitemradio"
                                  aria-checked={active}
                                  onMouseMove={() => setModelHighlight(index)}
                                  onClick={() =>
                                    void selectModel(group.provider, model.modelId)
                                  }
                                >
                                  <span className="truncate">
                                    {model.displayName || model.modelId}
                                  </span>
                                  {hasAlias ? (
                                    <span className="ml-auto max-w-[170px] truncate font-mono text-text-secondary">
                                      {model.modelId}
                                    </span>
                                  ) : null}
                                  {active ? (
                                    <IconCheck
                                      size={14}
                                      className={
                                        hasAlias
                                          ? "composer-model-check"
                                          : "composer-model-check ml-auto"
                                      }
                                    />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        ));
                      })()}
                      {flatModels.length === 0 ? (
                        <div className="composer-model-empty">
                          {t("chat.noModelResults")}
                        </div>
                      ) : null}
                    </div>
                    <div className="composer-plus-sep" />
                    <button
                      className="composer-plus-item"
                      role="menuitem"
                      onClick={() => {
                        setModelOpen(false);
                        useAppStore.getState().setSettingsTab("agent");
                        useAppStore.getState().setPage("settings");
                      }}
                    >
                      <span>{t("nav.settings")}</span>
                    </button>
                  </div>
                )}
              </div>

              {isRunning ? (
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
