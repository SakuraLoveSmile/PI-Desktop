/**
 * Model picker for a settings row that pins one provider model (ADR 0121).
 *
 * The menu lists the runnable models the Composer would offer, narrowed by a
 * search box, with a leading row that clears the pin. What clearing means is the
 * caller's choice: the prompt enhancement follows the Composer's model, while the
 * Advisor turns off. Clearing is reported as an empty provider and model id.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { sameComposerModelId } from "../../lib/composer-models";
import { providerDisplayName, providerSearchText } from "../../lib/provider-display";
import { Button, Input, cx } from "../ui";
import { IconCheck, IconChevronDown, IconSearch } from "../icons";
import { AnchoredMenu } from "./AnchoredMenu";
import type { defaultModelOptions } from "./default-model";

export type ModelPinOption = ReturnType<typeof defaultModelOptions>[number];

export function ModelPinMenu({
  label,
  options,
  pinnedProviderId,
  pinnedModelId,
  clearLabel,
  disabled,
  busy = false,
  onPick,
}: {
  label: string;
  options: readonly ModelPinOption[];
  pinnedProviderId: string;
  pinnedModelId: string;
  clearLabel: string;
  disabled: boolean;
  busy?: boolean;
  onPick: (providerId: string, modelId: string) => Promise<boolean | void>;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(({ provider, modelId }) =>
      `${providerSearchText(provider)} ${modelId}`.toLowerCase().includes(needle),
    );
  }, [options, query]);

  const pick = async (providerId: string, modelId: string) => {
    const saved = await onPick(providerId, modelId);
    if (saved !== false) setPicking(false);
  };

  return (
    <AnchoredMenu
      className="model-default-anchor"
      open={picking}
      onClose={() => setPicking(false)}
      menuClassName="model-default-menu"
      label={label}
      align="end"
      trigger={(ref) => (
        <Button
          ref={ref}
          className="settings-text-action model-default-trigger"
          variant="ghost"
          disabled={disabled || busy}
          onClick={() => {
            setQuery("");
            setPicking((current) => !current);
          }}
          aria-haspopup="listbox"
          aria-expanded={picking}
        >
          {t("settings.changeDefaultModel")}
          <IconChevronDown
            className="model-default-trigger-chevron"
            size={13}
            aria-hidden
          />
        </Button>
      )}
    >
      <div className="model-default-search">
        <IconSearch size={14} aria-hidden />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("settings.defaultModelSearch")}
          aria-label={t("settings.defaultModelSearch")}
          autoFocus
        />
      </div>
      <div className="model-default-results" role="presentation">
        {visible.length === 0 ? (
          <div className="model-default-no-results">{t("settings.noModelMatches")}</div>
        ) : null}
        <ul className="model-default-list">
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!pinnedProviderId}
              disabled={busy}
              aria-label={clearLabel}
              className={cx("model-default-option", !pinnedProviderId && "is-current")}
              onClick={() => void pick("", "")}
            >
              <span className="model-default-option-check" aria-hidden>
                {!pinnedProviderId ? <IconCheck size={12} /> : null}
              </span>
              <span className="model-default-option-model">{clearLabel}</span>
            </button>
          </li>
          {visible.map(({ provider, modelId }, index) => {
            const isCurrent =
              pinnedProviderId === provider.id && sameComposerModelId(pinnedModelId, modelId);
            const previous = visible[index - 1];
            const startsGroup = !previous || previous.provider.id !== provider.id;
            return (
              <li key={`${provider.id}:${modelId}`}>
                {startsGroup ? (
                  <div
                    className={cx(
                      "model-default-provider-group",
                      index > 0 && "has-divider",
                    )}
                  >
                    {providerDisplayName(provider)}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  disabled={busy}
                  aria-label={`${providerDisplayName(provider)} · ${modelId}`}
                  className={cx("model-default-option", isCurrent && "is-current")}
                  onClick={() => void pick(provider.id, modelId)}
                >
                  <span className="model-default-option-check" aria-hidden>
                    {isCurrent ? <IconCheck size={12} /> : null}
                  </span>
                  <span className="model-default-option-model font-mono">{modelId}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </AnchoredMenu>
  );
}
