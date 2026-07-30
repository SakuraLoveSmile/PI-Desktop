import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { runPaletteCommand } from "../lib/commands";
import { useAppStore } from "../stores/app-store";
import type { CommandItem } from "@pi-desktop/shared";

type CommandGroup = { category: string; items: CommandItem[] };

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [active, setActive] = useState(0);
  const showToast = useAppStore((s) => s.showToast);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    void api.searchCommands("").then((res) => setCommands(res.commands));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void api.searchCommands(query).then((res) => {
        setCommands(res.commands);
        setActive(0);
      });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [query, open]);

  // Group flat results by category, preserving first-seen order.
  const groups = useMemo<CommandGroup[]>(() => {
    const map = new Map<string, CommandItem[]>();
    for (const command of commands) {
      const key = command.category ?? t("palette.uncategorized");
      const list = map.get(key);
      if (list) list.push(command);
      else map.set(key, [command]);
    }
    return Array.from(map, ([category, items]) => ({ category, items }));
  }, [commands, t]);

  if (!open) return null;

  const run = async (command: CommandItem) => {
    try {
      await runPaletteCommand(command.id);
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), { variant: "error" });
    }
  };

  // Flat index across grouped render so keyboard nav maps to the right item.
  let flatIndex = -1;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div
        className="palette-dialog"
        role="dialog"
        aria-label={t("commandPalette")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <svg
            className="palette-input-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="palette-input"
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.placeholder")}
            value={query}
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((v) => Math.min(v + 1, Math.max(commands.length - 1, 0)));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((v) => Math.max(v - 1, 0));
              }
              if (e.key === "Enter" && commands[active]) {
                e.preventDefault();
                void run(commands[active]);
              }
            }}
          />
        </div>
        <div className="palette-results" role="listbox" aria-label={t("commandPalette")}>
          {commands.length === 0 ? (
            <div className="palette-empty">{t("palette.empty")}</div>
          ) : (
            groups.map((group) => (
              <div key={group.category} role="group" aria-label={group.category}>
                <div className="palette-group-label">{group.category}</div>
                {group.items.map((command) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const isActive = index === active;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`palette-item${isActive ? " active" : ""}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => void run(command)}
                    >
                      <span className="palette-item-title">{command.title}</span>
                      {command.source === "plugin" && (
                        <span className="palette-item-badge">{t("plugins.title")}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
