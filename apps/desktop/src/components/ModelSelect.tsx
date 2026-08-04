import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ThinkingLevel } from "@pi-desktop/shared";
import { useAppStore } from "../stores/app-store";
import { isActivePlanExecution } from "../lib/plan-mode-state";
import { thinkingLevelForProvider } from "./Composer";
import { IconChevronDown, IconCheck, IconSearch } from "./icons";

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return (
    typeof value === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      value as ThinkingLevel,
    )
  );
}

/**
 * Model picker for the conversation top bar (Codex-style). Self-contained:
 * derives the active provider/model/mode from the store and writes changes
 * through `configureActiveSession`. Opens downward so it stays on screen when
 * anchored to the top bar.
 */
export function ModelSelect() {
  const { t } = useTranslation();
  const settings = useAppStore((s) => s.settings);
  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const providers = useAppStore((s) => s.providers);
  const providerModels = useAppStore((s) => s.providerModels);
  const loadProviderModels = useAppStore((s) => s.loadProviderModels);
  const configureActiveSession = useAppStore((s) => s.configureActiveSession);
  const showToast = useAppStore((s) => s.showToast);
  const isRunning = useAppStore((s) => s.isRunning);
  const planCheckpoint = useAppStore((s) =>
    s.activeSessionId ? s.planCheckpoints[s.activeSessionId] : undefined,
  );

  const [modelOpen, setModelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelHighlight, setModelHighlight] = useState(-1);
  const modelRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const mode = activeSession?.mode ?? settings?.defaultMode ?? "agent";
  const provider = providers.find(
    (candidate) =>
      candidate.id ===
      (activeSession?.providerId ?? settings?.defaultProviderId),
  );
  const modelId =
    activeSession?.modelId ??
    settings?.defaultModelId ??
    provider?.defaultModelId;
  const sessionThinkingLevel = activeSession?.thinkingLevel;
  const thinkingLevel: ThinkingLevel = isThinkingLevel(sessionThinkingLevel)
    ? sessionThinkingLevel
    : "off";

  const modelLabel = modelId || t("chat.model");
  const approvalPending = planCheckpoint?.status === "pending";
  const executionActive = isActivePlanExecution(planCheckpoint);
  const modelBlocked = isRunning || executionActive || approvalPending;
  const modelReady =
    !!provider &&
    provider.enabled &&
    !!modelId &&
    (provider.hasSecret || provider.authKind === "none");

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
              (model.displayName ?? "").toLowerCase().includes(modelQueryNeedle) ||
              group.provider.name.toLowerCase().includes(modelQueryNeedle),
          ),
        }))
        .filter((group) => group.models.length > 0)
    : modelGroups;
  const flatModels = filteredModelGroups.flatMap((group) =>
    group.models.map((model) => ({ provider: group.provider, model })),
  );
  const flatModelsKey = flatModels
    .map((entry) => `${entry.provider.id}:${entry.model.modelId}`)
    .join("|");
  const activeFlatIndex = flatModels.findIndex(
    (entry) => entry.provider.id === provider?.id && entry.model.modelId === modelId,
  );

  useEffect(() => {
    if (!modelOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!modelRef.current?.contains(e.target as Node)) setModelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModelOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [modelOpen]);

  useEffect(() => {
    if (!modelOpen) return;
    setModelQuery("");
    requestAnimationFrame(() => modelSearchRef.current?.focus());
  }, [modelOpen]);

  useEffect(() => {
    if (modelBlocked) setModelOpen(false);
  }, [modelBlocked]);

  useEffect(() => {
    if (!modelOpen) return;
    setModelHighlight(
      modelQueryNeedle ? (flatModels.length ? 0 : -1) : activeFlatIndex,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelOpen, modelQueryNeedle, flatModelsKey, activeFlatIndex]);

  useEffect(() => {
    if (!modelOpen || modelHighlight < 0) return;
    modelListRef.current
      ?.querySelector(`[data-model-index="${modelHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [modelOpen, modelHighlight]);

  useEffect(() => {
    if (!modelOpen) return;
    for (const candidate of providers) {
      if (candidate.enabled && (candidate.hasSecret || candidate.authKind === "none")) {
        void loadProviderModels(candidate.id);
      }
    }
  }, [modelOpen, providers, loadProviderModels]);

  const selectModel = async (candidate: typeof providers[number], nextModelId: string) => {
    try {
      await configureActiveSession({
        mode,
        providerId: candidate.id,
        modelId: nextModelId,
        thinkingLevel: thinkingLevelForProvider(candidate, thinkingLevel),
      });
      setModelOpen(false);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  const onModelMenuKeyDown = (e: ReactKeyboardEvent) => {
    if (!modelOpen) return;
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

  return (
    <div className="composer-model" ref={modelRef} onKeyDown={onModelMenuKeyDown}>
      <button
        className={`icon-btn model-chip ${modelOpen ? "active" : ""}`}
        title={`${provider?.name || t("chat.provider")} · ${modelLabel}`}
        aria-haspopup="menu"
        aria-expanded={modelOpen}
        disabled={modelBlocked}
        onClick={() => setModelOpen((open) => !open)}
        onContextMenu={(e) => {
          e.preventDefault();
          useAppStore.getState().setSettingsTab("agent");
          useAppStore.getState().setPage("settings");
        }}
      >
        <span className="model-chip-label text-sm">{modelLabel}</span>
        <IconChevronDown size={12} />
      </button>
      {modelOpen && (
        <div className="composer-model-menu ct-model-menu" role="menu">
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
                      !!model.displayName && model.displayName !== model.modelId;
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
                        onClick={() => void selectModel(group.provider, model.modelId)}
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
                              hasAlias ? "composer-model-check" : "composer-model-check ml-auto"
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
              <div className="composer-model-empty">{t("chat.noModelResults")}</div>
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
  );
}
