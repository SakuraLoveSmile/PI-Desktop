import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ModelInfo } from "@pi-desktop/shared";
import { Input, cx } from "../ui";

type MenuPosition = {
  top: number;
  left: number;
  width: number;
};

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;

export function ModelCombobox({
  value,
  models,
  loading = false,
  loadingLabel,
  placeholder,
  onChange,
}: {
  value: string;
  models: ModelInfo[];
  loading?: boolean;
  loadingLabel?: string;
  placeholder?: string;
  onChange: (modelId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
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
  const showMenu = menuOpen && filtered.length > 0;
  const activeOptionId =
    showMenu && highlight >= 0 ? `${listId}-option-${highlight}` : undefined;

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuPosition(null);
  }, []);

  const updateMenuPosition = useCallback(() => {
    const anchor = comboRef.current;
    const menu = listRef.current;
    if (!anchor || !menu) return;

    const anchorRect = anchor.getBoundingClientRect();
    const anchorVisible =
      anchorRect.bottom > 0 &&
      anchorRect.top < window.innerHeight &&
      anchorRect.right > 0 &&
      anchorRect.left < window.innerWidth;
    if (!anchorVisible) {
      closeMenu();
      return;
    }

    const menuRect = menu.getBoundingClientRect();
    const width = Math.min(
      anchorRect.width,
      Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2),
    );
    const maxLeft = Math.max(
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN,
    );
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, anchorRect.left),
      maxLeft,
    );
    const maxTop = Math.max(
      VIEWPORT_MARGIN,
      window.innerHeight - menuRect.height - VIEWPORT_MARGIN,
    );
    const below = anchorRect.bottom + MENU_GAP;
    const above = anchorRect.top - menuRect.height - MENU_GAP;
    const top =
      below <= maxTop
        ? Math.max(VIEWPORT_MARGIN, below)
        : above >= VIEWPORT_MARGIN
          ? above
          : Math.min(Math.max(VIEWPORT_MARGIN, below), maxTop);

    setMenuPosition((previous) =>
      previous &&
      previous.top === top &&
      previous.left === left &&
      previous.width === width
        ? previous
        : { top, left, width },
    );
  }, [closeMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        comboRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu();
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, [closeMenu, menuOpen]);

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

  useLayoutEffect(() => {
    if (!showMenu) return;
    const frame = window.requestAnimationFrame(updateMenuPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [showMenu, filtered.length, updateMenuPosition]);

  useEffect(() => {
    if (!showMenu) return;
    const onViewportChange = (event: Event) => {
      // Scrolling inside the menu does not move its anchor.
      const target = event.target as Node | null;
      if (target && listRef.current?.contains(target)) return;
      updateMenuPosition();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [showMenu, updateMenuPosition]);

  const pickModel = (modelId: string) => {
    onChange(modelId);
    closeMenu();
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
      closeMenu();
    }
  };

  const menu = showMenu ? (
    <div
      className={cx("provider-model-menu", menuPosition && "is-open")}
      id={listId}
      role="listbox"
      ref={listRef}
      style={
        menuPosition
          ? {
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
            }
          : undefined
      }
    >
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
  ) : null;

  return (
    <div className="provider-model-combo" ref={comboRef}>
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
      {typeof document !== "undefined" && menu
        ? createPortal(menu, document.body)
        : null}
    </div>
  );
}
