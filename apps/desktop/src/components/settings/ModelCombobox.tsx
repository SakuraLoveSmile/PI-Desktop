import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ModelInfo } from "@pi-desktop/shared";
import { Input, cx } from "../ui";

export function ModelCombobox({
  value,
  models,
  loading = false,
  loadingLabel,
  placeholder,
  flowMenu = false,
  onChange,
}: {
  value: string;
  models: ModelInfo[];
  loading?: boolean;
  loadingLabel?: string;
  placeholder?: string;
  flowMenu?: boolean;
  onChange: (modelId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = `model-combobox-list-${useId().replace(/:/g, "")}`;

  const needle = value.trim().toLowerCase();
  const isExactPick = models.some((model) => model.modelId === value);
  // An exact selection shows the full list again so nearby options stay reachable.
  const filtered =
    needle && !isExactPick
      ? models.filter(
          (model) =>
            model.modelId.toLowerCase().includes(needle) ||
            (model.displayName ?? "").toLowerCase().includes(needle),
        )
      : models;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!comboRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    setHighlight(filtered.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, needle, filtered.length]);

  useEffect(() => {
    if (!menuOpen || highlight < 0) return;
    listRef.current
      ?.querySelector(`[data-model-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [menuOpen, highlight]);

  const pickModel = (modelId: string) => {
    onChange(modelId);
    setMenuOpen(false);
  };

  const onComboKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!menuOpen) {
        setMenuOpen(true);
        return;
      }
      if (!filtered.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => {
        const base = current < 0 ? (delta > 0 ? -1 : filtered.length) : current;
        return (base + delta + filtered.length) % filtered.length;
      });
    } else if (event.key === "Enter") {
      if (menuOpen && highlight >= 0 && filtered[highlight]) {
        event.preventDefault();
        pickModel(filtered[highlight].modelId);
      }
    } else if (event.key === "Escape" && menuOpen) {
      event.stopPropagation();
      setMenuOpen(false);
    }
  };

  const showMenu = menuOpen && filtered.length > 0;
  const activeOptionId =
    showMenu && highlight >= 0 ? `${listId}-option-${highlight}` : undefined;

  return (
    <div
      className={cx("provider-model-combo", flowMenu && "provider-model-combo-flow")}
      ref={comboRef}
    >
      <Input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setMenuOpen(true);
        }}
        onFocus={() => setMenuOpen(true)}
        onKeyDown={onComboKeyDown}
        className="font-mono text-sm-plus"
        placeholder={placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        role="combobox"
        aria-controls={showMenu ? listId : undefined}
        aria-expanded={showMenu}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
      />
      {loading ? (
        <span className="provider-model-spinner" aria-label={loadingLabel} />
      ) : models.length > 0 ? (
        <span className="provider-model-chevron" aria-hidden="true" />
      ) : null}
      {showMenu ? (
        <div className="provider-model-menu" id={listId} role="listbox" ref={listRef}>
          {filtered.map((model, index) => (
            <button
              key={model.modelId}
              id={`${listId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={value === model.modelId}
              data-model-index={index}
              className={cx(
                "provider-model-option",
                index === highlight && "highlighted",
                value === model.modelId && "selected",
              )}
              onMouseEnter={() => setHighlight(index)}
              // Fires before the input's blur; click would come too late.
              onMouseDown={(event) => {
                event.preventDefault();
                pickModel(model.modelId);
              }}
            >
              <span className="provider-model-option-id font-mono">
                {model.modelId}
              </span>
              {model.displayName && model.displayName !== model.modelId ? (
                <span className="provider-model-option-name">{model.displayName}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
