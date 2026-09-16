import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type {
  Mode,
  ProviderPublic,
  ThinkingLevel,
} from "@pi-desktop/shared";
import {
  initialThinkingLevelForBinding,
  modelIdsMatch,
} from "@pi-desktop/shared";
import { useAppStore } from "../../../../stores/app-store";
import {
  composerModelMatchesQuery,
  composerModelsForProvider,
  composerProviderDisplayName,
  composerProviderSearchText,
} from "../../../../lib/composer-models";
import { providerThinkingLevels } from "../../../../lib/session-thinking";
import {
  thinkingLevelForProvider,
  thinkingProviderForModel,
  type ComposerMenuView,
  type ThinkingSelectionMode,
} from "../model";

type UseComposerModelMenuOptions = {
  mode: Mode;
  activeSessionId: string | null | undefined;
  provider: ProviderPublic | undefined;
  modelId: string | undefined;
  thinkingProvider: ProviderPublic | null | undefined;
  thinkingLevel: ThinkingLevel;
  controlsBlocked: boolean;
};

export function useComposerModelMenu({
  mode,
  activeSessionId,
  provider,
  modelId,
  thinkingProvider: resolvedThinkingProvider,
  thinkingLevel,
  controlsBlocked,
}: UseComposerModelMenuOptions) {
  const providers = useAppStore((s) => s.providers);
  const providerModels = useAppStore((s) => s.providerModels);
  const loadProviderModels = useAppStore((s) => s.loadProviderModels);
  const configureActiveSession = useAppStore((s) => s.configureActiveSession);
  const showToast = useAppStore((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ComposerMenuView>("root");
  const [query, setQuery] = useState("");
  const [modelHighlight, setModelHighlight] = useState(-1);
  const [thinkingHighlight, setThinkingHighlight] = useState(-1);
  const [thinkingMode, setThinkingMode] = useState<ThinkingSelectionMode>("slider");
  const rootMenuRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const thinkingListRef = useRef<HTMLDivElement>(null);
  const thinkingSliderRef = useRef<HTMLInputElement>(null);

  const thinkingProvider =
    resolvedThinkingProvider ??
    thinkingProviderForModel(
      provider,
      modelId,
      provider ? providerModels[provider.id] : undefined,
    );
  const availableThinkingLevels = providerThinkingLevels(thinkingProvider);
  const thinkingMenuLevels: ThinkingLevel[] = availableThinkingLevels.length
    ? availableThinkingLevels
    : ["off"];
  const modelGroups = useMemo(
    () =>
      providers
        .filter(
          (candidate) =>
            candidate.enabled &&
            (candidate.hasSecret || candidate.authKind === "none"),
        )
        .map((candidate) => {
          const models = composerModelsForProvider(
            candidate,
            providerModels[candidate.id],
          );
          return {
            provider: candidate,
            providerDisplayName: composerProviderDisplayName(candidate),
            providerSearchText: composerProviderSearchText(candidate),
            models,
          };
        })
        .filter((group) => group.models.length > 0),
    [providers, providerModels],
  );
  const queryNeedle = query.trim().toLowerCase();
  const filteredModelGroups = useMemo(
    () =>
      queryNeedle
        ? modelGroups
            .map((group) => ({
              ...group,
              models: group.models.filter((model) =>
                composerModelMatchesQuery(
                  model,
                  group.providerSearchText,
                  queryNeedle,
                ),
              ),
            }))
            .filter((group) => group.models.length > 0)
        : modelGroups,
    [modelGroups, queryNeedle],
  );
  const flatModels = useMemo(
    () =>
      filteredModelGroups.flatMap((group) =>
        group.models.map((model) => ({ provider: group.provider, model })),
      ),
    [filteredModelGroups],
  );
  const flatModelsKey = useMemo(
    () => flatModels.map((entry) => `${entry.provider.id}:${entry.model.modelId}`).join("|"),
    [flatModels],
  );
  const activeFlatIndex = useMemo(
    () =>
      flatModels.findIndex(
        (entry) =>
          entry.provider.id === provider?.id &&
          entry.model.modelId === modelId,
      ),
    [flatModels, provider?.id, modelId],
  );

  useEffect(() => {
    if (!open || view !== "model") return;
    setModelHighlight(queryNeedle ? (flatModels.length ? 0 : -1) : activeFlatIndex);
  }, [activeFlatIndex, flatModels.length, flatModelsKey, open, queryNeedle, view]);

  useEffect(() => {
    if (!open || view !== "thinking") return;
    setThinkingHighlight(
      thinkingLevel ? thinkingMenuLevels.indexOf(thinkingLevel) : -1,
    );
  }, [open, thinkingLevel, thinkingMenuLevels, view]);

  useEffect(() => {
    if (!open) return;
    for (const candidate of providers) {
      if (candidate.enabled && (candidate.hasSecret || candidate.authKind === "none")) {
        void loadProviderModels(candidate.id);
      }
    }
  }, [loadProviderModels, open, providers]);

  useEffect(() => {
    if (open) return;
    setView("root");
    setQuery("");
    setModelHighlight(-1);
    setThinkingHighlight(-1);
    setThinkingMode("slider");
  }, [open]);

  useEffect(() => {
    if (controlsBlocked) setOpen(false);
  }, [controlsBlocked]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      if (view === "root") rootMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      if (view === "model") modelSearchRef.current?.focus();
      if (view === "thinking") {
        // The slider is the default surface: focus its input so arrows land
        // in the slider instead of the radio list. A single-level binding
        // renders the radio list directly, so focus its first row instead.
        if (thinkingMode === "slider" && thinkingMenuLevels.length > 1) {
          thinkingSliderRef.current?.focus();
        } else {
          thinkingListRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }
      if (view === "model" && modelHighlight >= 0) {
        modelListRef.current
          ?.querySelector(`[data-model-index="${modelHighlight}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
      if (view === "thinking" && thinkingMode === "list" && thinkingHighlight >= 0) {
        thinkingListRef.current
          ?.querySelector(`[data-thinking-index="${thinkingHighlight}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    });
  }, [open, thinkingMenuLevels.length, thinkingMode, view]);

  useEffect(() => {
    if (!open || view !== "model" || modelHighlight < 0) return;
    modelListRef.current
      ?.querySelector(`[data-model-index="${modelHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [modelHighlight, open, view]);

  useEffect(() => {
    if (!open || view !== "thinking" || thinkingHighlight < 0) return;
    thinkingListRef.current
      ?.querySelector(`[data-thinking-index="${thinkingHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, thinkingHighlight, view]);

  const showView = (nextView: ComposerMenuView) => {
    setView(nextView);
    setModelHighlight(-1);
    setThinkingHighlight(-1);
    // Entering the reasoning submenu always restarts on the slider (issue #417).
    if (nextView === "thinking") setThinkingMode("slider");
    if (nextView !== "model") setQuery("");
  };

  const selectModel = async (candidate: ProviderPublic, nextModelId: string) => {
    try {
      const nextModelProvider = thinkingProviderForModel(
        candidate,
        nextModelId,
        providerModels[candidate.id],
      );
      const nextBinding = candidate.models.find((entry) =>
        modelIdsMatch(entry.id, nextModelId),
      );
      const nextThinkingLevel = activeSessionId
        ? thinkingLevelForProvider(nextModelProvider, thinkingLevel)
        : initialThinkingLevelForBinding(
            nextBinding,
            nextModelProvider?.supportedThinkingLevels,
          );
      await configureActiveSession({
        mode,
        providerId: candidate.id,
        modelId: nextModelId,
        thinkingLevel: nextThinkingLevel,
      });
      setQuery("");
      setView("root");
      setModelHighlight(-1);
      setThinkingHighlight(-1);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    }
  };

  /**
   * Toggle the reasoning submenu between its slider and radio-list
   * presentations. The list opens with the current level highlighted so
   * Up/Down/Enter behave exactly as before the slider existed.
   */
  const showThinkingMode = (mode: ThinkingSelectionMode) => {
    setThinkingMode(mode);
    setThinkingHighlight(
      mode === "list" ? thinkingMenuLevels.indexOf(thinkingLevel) : -1,
    );
  };

  /**
   * Commit a reasoning level while staying in the reasoning submenu, so a
   * dragged slider or a tick click keeps its surface for further tweaks.
   * Returns false when the configuration is rejected, mirroring the list
   * selection path's error contract.
   *
   * A drag can emit one commit per crossed stop. Idle sessions persist each
   * configure directly, so concurrent promises could resolve out of order and
   * land the store on a stale level. The chain serializes the sends: each
   * configure starts only after the previous one has settled its store write.
   */
  const thinkingCommitChainRef = useRef<Promise<boolean | void>>(Promise.resolve());
  const commitThinkingLevel = async (level: ThinkingLevel) => {
    const send = async (): Promise<boolean> => {
      try {
        await configureActiveSession({
          mode,
          providerId: provider?.id,
          modelId,
          thinkingLevel: level,
        });
        return true;
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), {
          variant: "error",
        });
        return false;
      }
    };
    const run = thinkingCommitChainRef.current.then(send);
    thinkingCommitChainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const selectThinkingLevel = async (level: ThinkingLevel) => {
    if (!(await commitThinkingLevel(level))) return;
    setView("root");
    setModelHighlight(-1);
    setThinkingHighlight(-1);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowLeft" && view !== "root") {
      event.preventDefault();
      showView("root");
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      if (event.key === "Enter" && view === "model" && event.target instanceof HTMLInputElement) {
        const entry = flatModels[modelHighlight];
        if (entry) {
          event.preventDefault();
          void selectModel(entry.provider, entry.model.modelId);
        }
      }
      if (event.key === "Enter" && view === "thinking") {
        const level = thinkingMenuLevels[thinkingHighlight] ?? thinkingMenuLevels[0];
        if (level) {
          event.preventDefault();
          void selectThinkingLevel(level);
        }
      }
      return;
    }
    if (view === "root") return;
    event.preventDefault();
    if (view === "model") {
      if (!flatModels.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setModelHighlight((current) => {
        const base = current < 0 ? (delta > 0 ? -1 : flatModels.length) : current;
        return (base + delta + flatModels.length) % flatModels.length;
      });
      return;
    }
    if (!thinkingMenuLevels.length) return;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    setThinkingHighlight((current) => {
      const base = current < 0 ? (delta > 0 ? -1 : thinkingMenuLevels.length) : current;
      return (base + delta + thinkingMenuLevels.length) % thinkingMenuLevels.length;
    });
  };

  return {
    open,
    setOpen,
    view,
    query,
    setQuery,
    modelHighlight,
    setModelHighlight,
    thinkingHighlight,
    setThinkingHighlight,
    rootMenuRef,
    modelSearchRef,
    modelListRef,
    thinkingListRef,
    thinkingSliderRef,
    modelGroups: filteredModelGroups,
    flatModels,
    thinkingMenuLevels,
    thinkingMode,
    showView,
    showThinkingMode,
    selectModel,
    commitThinkingLevel,
    selectThinkingLevel,
    onMenuKeyDown,
    controlsBlocked,
  };
}
