import {
  useState,
  useEffect,
  useRef,
  useMemo,
  type Dispatch,
  type SetStateAction,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { TFunction } from "i18next";
import type { ComposerCommand, ExecutionProfile, FsIndexEntry, Mode } from "@pi-desktop/shared";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { TooltipButton, SettingsToggle } from "../../../components/ui";
import {
  IconBot,
  IconCheck,
  IconFileText,
  IconFolder,
  IconPaperclip,
  IconPlus,
  IconPlug,
  IconSearch,
  IconSparkles,
  IconUsers,
} from "../../../components/icons";
import { ModeIcon } from "./ComposerModeIcon";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";

export type ComposerPlusMenuProps = {
  t: TFunction;
  mode: Mode;
  executionProfile: ExecutionProfile;
  disabled?: boolean;
  controlsBlocked?: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onSelectMode: (mode: Mode) => Promise<void> | void;
  onSelectProfile: (profile: ExecutionProfile) => Promise<void> | void;
  onPickAndAttach: () => Promise<void> | void;
  onInsertReference: (item: { path: string; name: string; isDir: boolean }) => void;
  onInsertCommand: (command: ComposerCommand) => void;
  onCloseOtherMenus?: () => void;
};

function fileLeaf(path: string): string {
  const parts = path.split(/[\/\\]/);
  return parts[parts.length - 1] || path;
}

export function ComposerPlusMenu({
  t,
  mode,
  executionProfile,
  disabled = false,
  controlsBlocked = false,
  open,
  setOpen,
  onSelectMode,
  onSelectProfile,
  onPickAndAttach,
  onInsertReference,
  onInsertCommand,
  onCloseOtherMenus,
}: ComposerPlusMenuProps) {
  const [query, setQuery] = useState("");
  const [commands, setCommands] = useState<ComposerCommand[]>([]);
  const [files, setFiles] = useState<FsIndexEntry[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const workspace = useAppStore((s) => s.workspace);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    // Auto-focus search on open
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    let cancelled = false;
    void api
      .composerCommands()
      .then((res) => {
        if (!cancelled) setCommands(res.commands || []);
      })
      .catch(() => {
        if (!cancelled) setCommands([]);
      });

    if (workspace?.path) {
      void api
        .fsIndex()
        .then((res) => {
          if (!cancelled) setFiles(res.entries || []);
        })
        .catch(() => {
          if (!cancelled) setFiles([]);
        });
    } else {
      setFiles([]);
    }

    return () => {
      cancelled = true;
    };
  }, [open, workspace?.path]);

  const q = query.trim().toLowerCase();

  const filteredFiles = useMemo(() => {
    if (!q) return files.slice(0, 8);
    return files
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 10);
  }, [files, q]);

  const pluginCommands = useMemo(() => {
    const list = commands.filter(
      (c) => c.kind === "plugin" || c.kind === "extension",
    );
    if (!q) return list.slice(0, 6);
    return list
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [commands, q]);

  const otherCommands = useMemo(() => {
    const list = commands.filter(
      (c) => c.kind === "skill" || c.kind === "builtin" || c.kind === "template",
    );
    if (!q) return list.slice(0, 8);
    return list
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [commands, q]);

  const onToggleMode = async (target: "plan" | "goal") => {
    if (controlsBlocked) return;
    const nextMode: Mode = mode === target ? "agent" : target;
    await onSelectMode(nextMode);
  };

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <AnchoredMenu
      className="composer-plus"
      open={open && !disabled}
      onClose={() => setOpen(false)}
      menuClassName="composer-plus-menu"
      label={t("chat.addFiles")}
      role="menu"
      align="start"
      side="top"
      trigger={(ref) => (
        <TooltipButton
          ref={ref}
          type="button"
          className={`icon-btn icon-btn-square ${open ? "active" : ""}`}
          tooltip={t("chat.addFiles")}
          ariaLabel={t("chat.addFiles")}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled || controlsBlocked}
          onClick={() => {
            onCloseOtherMenus?.();
            setOpen((prev) => !prev);
          }}
        >
          <IconPlus size={15} aria-hidden="true" />
        </TooltipButton>
      )}
    >
      <div className="composer-plus-search" role="search">
        <IconSearch size={14} className="composer-plus-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="text"
          className="composer-plus-search-input"
          placeholder={t("chat.searchPlusMenu", "Search files, commands, actions…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="composer-plus-content" role="none">
        {/* Attachment Item */}
        <button
          type="button"
          className="composer-plus-item"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            void onPickAndAttach();
          }}
        >
          <IconPaperclip size={14} className="composer-item-icon" aria-hidden="true" />
          <div className="flex-1 text-left min-w-0">
            <div className="font-medium text-sm">{t("chat.addFiles")}</div>
          </div>
        </button>

        {/* Workspace Files and Folders */}
        {filteredFiles.length > 0 && (
          <div role="none">
            <div className="composer-plus-group-title">
              {t("chat.fileMenu", "File references")}
            </div>
            {filteredFiles.map((entry) => {
              const isDir = entry.kind === "dir";
              const label = isDir ? entry.path : fileLeaf(entry.path);
              return (
                <button
                  key={entry.path}
                  type="button"
                  className="composer-plus-item"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onInsertReference({
                      path: entry.path,
                      name: label,
                      isDir,
                    });
                  }}
                >
                  {isDir ? (
                    <IconFolder size={14} className="composer-item-icon" aria-hidden="true" />
                  ) : (
                    <IconFileText size={14} className="composer-item-icon" aria-hidden="true" />
                  )}
                  <div className="flex-1 text-left min-w-0 truncate">
                    <div className="font-medium text-sm truncate">{label}</div>
                    {isDir ? null : (
                      <div className="text-xs text-muted truncate">{entry.path}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Agents (Execution Profile) */}
        <div role="none">
          <div className="composer-plus-group-title">
            {t("chat.executionProfile", "Execution profile")}
          </div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={executionProfile === "standard"}
            className={`composer-plus-item ${executionProfile === "standard" ? "active" : ""}`}
            onClick={async () => {
              setOpen(false);
              if (executionProfile !== "standard") {
                await onSelectProfile("standard");
              }
            }}
          >
            <IconBot size={14} className="composer-item-icon" aria-hidden="true" />
            <div className="flex-1 text-left min-w-0">
              <div className="font-medium text-sm">{t("chat.profileAgent")}</div>
              <div className="text-xs text-muted truncate">
                {t("chat.profileAgentDesc")}
              </div>
            </div>
            {executionProfile === "standard" ? <IconCheck size={13} aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={executionProfile === "team"}
            className={`composer-plus-item ${executionProfile === "team" ? "active" : ""}`}
            onClick={async () => {
              setOpen(false);
              if (executionProfile !== "team") {
                await onSelectProfile("team");
              }
            }}
          >
            <IconUsers size={14} className="composer-item-icon" aria-hidden="true" />
            <div className="flex-1 text-left min-w-0">
              <div className="font-medium text-sm">{t("chat.profileTeam")}</div>
              <div className="text-xs text-muted truncate">
                {t("chat.profileTeamDesc")}
              </div>
            </div>
            {executionProfile === "team" ? <IconCheck size={13} aria-hidden="true" /> : null}
          </button>
        </div>

        {/* Plugins */}
        {pluginCommands.length > 0 && (
          <div role="none">
            <div className="composer-plus-group-title">
              {t("chat.slashGroupPlugins", "Plugin commands")}
            </div>
            {pluginCommands.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                className="composer-plus-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onInsertCommand(cmd);
                }}
              >
                <IconPlug size={14} className="composer-item-icon" aria-hidden="true" />
                <div className="flex-1 text-left min-w-0 truncate">
                  <div className="font-medium text-sm truncate">/{cmd.name}</div>
                  <div className="text-xs text-muted truncate">
                    {cmd.description || cmd.title}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Skills and Commands */}
        {otherCommands.length > 0 && (
          <div role="none">
            <div className="composer-plus-group-title">
              {t("chat.slashMenu", "Commands")}
            </div>
            {otherCommands.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                className="composer-plus-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onInsertCommand(cmd);
                }}
              >
                <IconSparkles size={14} className="composer-item-icon" aria-hidden="true" />
                <div className="flex-1 text-left min-w-0 truncate">
                  <div className="font-medium text-sm truncate">/{cmd.name}</div>
                  <div className="text-xs text-muted truncate">
                    {cmd.description || cmd.title}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="composer-plus-separator" />

      {/* Mode Switches: Plan and Goal */}
      <div className="composer-plus-modes" role="none">
        <div className="composer-plus-toggle-row">
          <div className="composer-plus-toggle-label">
            <ModeIcon mode="plan" />
            <span>{t("settings.modePlan", "Plan")}</span>
          </div>
          <SettingsToggle
            checked={mode === "plan"}
            disabled={controlsBlocked}
            label={t("settings.modePlan")}
            onChange={() => void onToggleMode("plan")}
          />
        </div>
        <div className="composer-plus-toggle-row">
          <div className="composer-plus-toggle-label">
            <ModeIcon mode="goal" />
            <span>{t("settings.modeGoal", "Goal")}</span>
          </div>
          <SettingsToggle
            checked={mode === "goal"}
            disabled={controlsBlocked}
            label={t("settings.modeGoal")}
            onChange={() => void onToggleMode("goal")}
          />
        </div>
      </div>
    </AnchoredMenu>
  );
}
