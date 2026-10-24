/**
 * Announce each settled probe once. Idle, in-flight and cache-only answers do
 * not toast; persistent discovery failures are also shown by the model pane.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAppStore } from "../../stores/app-store";
import { canRecommendFrom } from "./recommended-models";
import { modelsFetchErrorText } from "./models-fetch-error-copy";
import type { ProviderModelsState } from "./useProviderModels";

export type ProbeOutcome = {
  message: string;
  variant: "success" | "error" | "info";
};

/**
 * The settled outcome of a probe, or null while nothing is settled: idle, in
 * flight, and a cache-only answer all leave the question open.
 */
export function probeOutcome(
  discovery: Pick<
    ProviderModelsState,
    "status" | "models" | "error" | "source"
  >,
  namedService: boolean,
  t: TFunction,
): ProbeOutcome | null {
  if (discovery.status !== "ready" && discovery.status !== "error") return null;
  if (discovery.source === "cache") return null;
  const count = discovery.models.length;
  if (discovery.error) {
    // A named vendor without a model-list route still accepted the key, so the
    // catalog answer is news about the service rather than a refusal.
    if (canRecommendFrom(discovery, namedService)) {
      return {
        message: t("settings.connectionNoModelList", { count }),
        variant: "info",
      };
    }
    return { message: modelsFetchErrorText(discovery.error, t), variant: "error" };
  }
  return {
    message: t(
      discovery.source === "remote"
        ? "settings.connectionReady"
        : "settings.connectionCatalog",
      { count },
    ),
    variant: "success",
  };
}

/**
 * Announce each settled probe once. Every surface that probes the endpoint goes
 * through this hook, so a refusal is reported once no matter which of the
 * dialog's parts asked, and a fixed answer is never repeated.
 */
export function useProbeFeedback(
  discovery: ProviderModelsState,
  namedService: boolean,
): void {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const outcome = probeOutcome(discovery, namedService, t);
    if (!outcome) {
      // The next settled answer is a new answer.
      reported.current = null;
      return;
    }
    const key = `${outcome.variant}\u0000${outcome.message}`;
    if (reported.current === key) return;
    reported.current = key;
    showToast(outcome.message, { variant: outcome.variant });
  }, [
    discovery.status,
    discovery.source,
    discovery.error,
    discovery.models.length,
    namedService,
    showToast,
    t,
  ]);
}
