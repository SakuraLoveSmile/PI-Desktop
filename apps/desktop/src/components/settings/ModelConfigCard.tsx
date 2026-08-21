import type { ModelBinding, ModelInfo, ThinkingLevel } from "@pi-desktop/shared";
import { THINKING_LEVELS } from "@pi-desktop/shared";
import { Badge, Input, Select } from "../ui";
import { IconClose, IconImage, IconSparkles } from "../icons";

function formatTokens(value: number): string {
  return value > 0 ? value.toLocaleString("en-US") : "";
}

function parseTokens(value: string): number {
  const parsed = Number(value.replace(/,/g, "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderedLevels(levels: ThinkingLevel[]): ThinkingLevel[] {
  return THINKING_LEVELS.filter((level) => levels.includes(level));
}

export function ModelConfigCard({
  binding,
  metadata,
  source,
  sourceLabel,
  customSourceLabel,
  visionLabel,
  textOnlyLabel,
  reasoningLabel,
  contextWindowLabel,
  maxOutputLabel,
  supportedThinkingLabel,
  defaultThinkingLabel,
  disabledThinkingLabel,
  disabledThinkingHint,
  levelLabels,
  removeLabel,
  onChange,
  onRemove,
}: {
  binding: ModelBinding;
  metadata?: ModelInfo | null;
  source: "catalog" | "custom";
  sourceLabel: string;
  customSourceLabel: string;
  visionLabel: string;
  textOnlyLabel: string;
  reasoningLabel: string;
  contextWindowLabel: string;
  maxOutputLabel: string;
  supportedThinkingLabel: string;
  defaultThinkingLabel: string;
  disabledThinkingLabel: string;
  disabledThinkingHint: string;
  levelLabels: Record<ThinkingLevel, string>;
  removeLabel: string;
  onChange: (update: Partial<ModelBinding>) => void;
  onRemove: () => void;
}) {
  const levels = orderedLevels(binding.thinkingLevels);
  const supportsVision = metadata?.capabilities.includes("vision") === true;

  const toggleLevel = (level: ThinkingLevel) => {
    const next = levels.includes(level)
      ? levels.filter((item) => item !== level)
      : orderedLevels([...levels, level]);
    const defaultThinkingLevel = next.includes(binding.defaultThinkingLevel as ThinkingLevel)
      ? binding.defaultThinkingLevel
      : next[0] ?? null;
    onChange({ thinkingLevels: next, defaultThinkingLevel });
  };

  return (
    <article className="provider-model-card">
      <div className="provider-model-card-head">
        <div className="provider-model-card-title-wrap">
          <span className="provider-model-card-id font-mono">{binding.id}</span>
          <Badge tone={source === "custom" ? "warning" : "neutral"}>
            {source === "custom" ? customSourceLabel : sourceLabel}
          </Badge>
          <div className="provider-model-capabilities" aria-label={`${binding.id} capabilities`}>
            <Badge tone={supportsVision ? "success" : "neutral"}>
              <IconImage size={12} aria-hidden="true" />
              {supportsVision ? visionLabel : textOnlyLabel}
            </Badge>
            {levels.length > 0 ? (
              <Badge tone="neutral">
                <IconSparkles size={12} aria-hidden="true" />
                {reasoningLabel}
              </Badge>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="provider-model-card-remove"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={onRemove}
        >
          <IconClose size={14} />
        </button>
      </div>

      <div className="provider-model-card-limits">
        <label className="provider-model-card-field">
          <span>{contextWindowLabel}</span>
          <Input
            value={formatTokens(binding.contextWindow)}
            inputMode="numeric"
            onChange={(event) => onChange({ contextWindow: parseTokens(event.target.value) })}
            onBlur={() => onChange({ contextWindow: Math.max(1, binding.contextWindow) })}
            aria-label={`${binding.id} ${contextWindowLabel}`}
          />
        </label>
        <label className="provider-model-card-field">
          <span>{maxOutputLabel}</span>
          <Input
            value={formatTokens(binding.maxTokens)}
            inputMode="numeric"
            onChange={(event) => onChange({ maxTokens: parseTokens(event.target.value) })}
            onBlur={() => onChange({ maxTokens: Math.max(1, binding.maxTokens) })}
            aria-label={`${binding.id} ${maxOutputLabel}`}
          />
        </label>
      </div>

      <div className="provider-model-card-thinking">
        <div className="provider-model-card-thinking-label">{supportedThinkingLabel}</div>
        <div className="provider-model-card-thinking-row">
          <div className="provider-thinking-chips" role="group" aria-label={supportedThinkingLabel}>
            {THINKING_LEVELS.map((level) => {
              const checked = levels.includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  className={`provider-thinking-chip${checked ? " selected" : ""}`}
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={levelLabels[level]}
                  onClick={() => toggleLevel(level)}
                >
                  {levelLabels[level]}
                </button>
              );
            })}
          </div>
          <label className="provider-default-thinking">
            <span>{defaultThinkingLabel}</span>
            <Select
              value={binding.defaultThinkingLevel ?? ""}
              disabled={levels.length === 0}
              onChange={(event) =>
                onChange({
                  defaultThinkingLevel: (event.target.value || null) as ThinkingLevel | null,
                })
              }
              aria-label={`${binding.id} ${defaultThinkingLabel}`}
            >
              {levels.length === 0 ? (
                <option value="">{disabledThinkingLabel}</option>
              ) : (
                levels.map((level) => (
                  <option key={level} value={level}>
                    {levelLabels[level]}
                  </option>
                ))
              )}
            </Select>
          </label>
        </div>
        {levels.length === 0 ? (
          <div className="provider-thinking-disabled-hint">{disabledThinkingHint}</div>
        ) : null}
      </div>

    </article>
  );
}
