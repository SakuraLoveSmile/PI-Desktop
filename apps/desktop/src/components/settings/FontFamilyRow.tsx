import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { AppSettings } from "@pi-desktop/shared";
import {
  buildFontOptions,
  loadSystemFonts,
  readableFontFamily,
} from "../../lib/fonts";
import { IconCheck, IconChevronDown, IconSearch } from "../icons";

/**
 * Global UI font picker (Settings → Basics → Appearance). Offers the
 * system default, bundled open-licensed families, and installed system
 * families; the selected stack is persisted as `AppSettings.fontFamily`
 * and applied to `--font-sans` by App. Selecting System default persists an
 * empty stack, which every consumer treats as the built-in token stack.
 */
export function FontFamilyRow({
  settings,
  saveSettings,
}: {
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuPosition(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSystemFonts()
      .then((fonts) => {
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closeMenu]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
  }, [open]);

  // Focus only once the portaled menu is measured and revealed; a hidden
  // (visibility: hidden) menu cannot receive focus.
  useEffect(() => {
    if (!open || !menuPosition) return;
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, menuPosition]);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const triggerVisible =
      triggerRect.bottom > 0 && triggerRect.top < window.innerHeight;
    if (!triggerVisible) {
      closeMenu();
      return;
    }
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const maxLeft = Math.max(
      margin,
      window.innerWidth - menuRect.width - margin,
    );
    const left = Math.min(Math.max(margin, triggerRect.left), maxLeft);
    const below = triggerRect.bottom + gap;
    const above = triggerRect.top - menuRect.height - gap;
    const maxTop = Math.max(
      margin,
      window.innerHeight - menuRect.height - margin,
    );
    const top =
      below <= maxTop
        ? Math.max(margin, below)
        : above >= margin
          ? above
          : Math.min(below, maxTop);
    setMenuPosition((previous) =>
      previous && previous.top === top && previous.left === left
        ? previous
        : { top, left },
    );
  }, [closeMenu]);

  const options = useMemo(
    () => buildFontOptions(systemFonts ?? [], settings.fontFamily),
    [systemFonts, settings.fontFamily],
  );
  const selectedValue = settings.fontFamily ?? "";
  const selectedOption =
    options.find((option) => option.value === selectedValue) ?? null;
  const selectedLabel =
    selectedOption?.label ?? readableFontFamily(settings.fontFamily ?? "");
  const selectedFamily = selectedOption?.family ?? readableFontFamily(selectedValue);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle),
    );
  }, [options, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updateMenuPosition);
    return () => window.cancelAnimationFrame(frame);
  }, [open, filtered, systemFonts, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onViewportChange = (event: Event) => {
      // Scrolling inside the font list cannot move the fixed menu; skip it
      // so the handler does not force a layout read on every scroll tick.
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      updateMenuPosition();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const index = filtered.findIndex((option) => option.value === selectedValue);
    setHighlight(index >= 0 ? index : 0);
  }, [open, filtered, selectedValue]);

  useEffect(() => {
    if (!open || highlight < 0) return;
    listRef.current
      ?.querySelector(`[data-font-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  const selectOption = async (value: string) => {
    closeMenu();
    try {
      await saveSettings(value ? { fontFamily: value } : { fontFamily: "" });
    } catch {
      // The generic settings row treats save failures as transient; the
      // store is only updated on success.
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!filtered.length) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => {
        if (current < 0) return delta > 0 ? 0 : filtered.length - 1;
        return (current + delta + filtered.length) % filtered.length;
      });
    } else if (event.key === "Enter") {
      const target = event.target as HTMLElement;
      if (target.tagName === "BUTTON") return;
      const option = filtered[highlight];
      if (option) {
        event.preventDefault();
        void selectOption(option.value);
      }
    }
  };

  const groupLabel = (group: string) => {
    if (group === "bundled") return t("settings.fontBundled");
    if (group === "system") return t("settings.fontSystem");
    if (group === "custom") return t("settings.fontCustom");
    return t("settings.fontSystemDefault");
  };

  let flatIndex = -1;

  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{t("settings.font")}</div>
        <div className="settings-row-desc">{t("settings.fontDesc")}</div>
      </div>
      <div className="settings-row-control">
        <div className="settings-font" ref={rootRef} onKeyDown={onKeyDown}>
          <button
            ref={triggerRef}
            type="button"
            className="settings-font-trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="settings-font-trigger-label" style={{ fontFamily: selectedFamily || undefined }}>
              {selectedLabel}
            </span>
            <IconChevronDown size={14} />
          </button>
          {open &&
            typeof document !== "undefined" &&
            createPortal(
              <div
                ref={menuRef}
                className={`settings-font-menu${
                  menuPosition ? " is-open" : ""
                }`}
                role="listbox"
                aria-label={t("settings.font")}
                onKeyDown={onKeyDown}
                style={
                  menuPosition
                    ? {
                        top: `${menuPosition.top}px`,
                        left: `${menuPosition.left}px`,
                      }
                    : undefined
                }
              >
                <div className="settings-font-search">
                  <IconSearch size={13} />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    placeholder={t("settings.fontSearchPlaceholder")}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                {loadError && !systemFonts ? (
                  <div className="settings-font-empty">
                    {t("settings.fontLoadError")}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="settings-font-empty">
                    {t("settings.noResults")}
                  </div>
                ) : (
                  <div className="settings-font-list" ref={listRef}>
                    {filtered.map((option) => {
                      flatIndex += 1;
                      const index = flatIndex;
                      const previous = index === 0 ? null : filtered[index - 1];
                      const showGroup =
                        !previous || previous.group !== option.group;
                      return (
                        <div key={`${option.group}:${option.value}`}>
                          {showGroup ? (
                            <div className="settings-font-group-label">
                              {groupLabel(option.group)}
                            </div>
                          ) : null}
                          <div className="settings-font-row">
                            <button
                              type="button"
                              role="option"
                              aria-selected={option.value === selectedValue}
                              data-font-index={index}
                              className={[
                                "settings-font-item",
                                index === highlight && "kb-active",
                                option.value === selectedValue && "active",
                              ].join(" ")}
                              style={{ fontFamily: option.family || undefined }}
                              onClick={() => void selectOption(option.value)}
                              onMouseEnter={() => setHighlight(index)}
                            >
                              <span className="settings-font-item-label">
                                {option.group === "default"
                                  ? t("settings.fontSystemDefault")
                                  : option.label}
                              </span>
                              {option.license ? (
                                <span className="settings-font-item-license">
                                  {option.license}
                                </span>
                              ) : null}
                              {option.value === selectedValue ? (
                                <IconCheck
                                  size={14}
                                  className="settings-font-check"
                                />
                              ) : null}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>,
              document.body,
            )}
        </div>
      </div>
    </div>
  );
}
