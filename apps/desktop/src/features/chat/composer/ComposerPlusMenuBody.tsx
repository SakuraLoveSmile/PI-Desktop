import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import type { TFunction } from "i18next";
import type { ComposerCommand, FsIndexEntry, Mode } from "@pi-desktop/shared";
import { SettingsToggle } from "../../../components/ui";
import {
  IconFileText,
  IconFolder,
  IconPaperclip,
  IconPlug,
  IconSearch,
  IconSparkles,
} from "../../../components/icons";
import { ModeIcon } from "./ComposerModeIcon";
import { fileDir, fileLeaf } from "./plus-menu-files";

export type ComposerPlusMenuBodyProps = {
  t: TFunction;
  mode: Mode;
  controlsBlocked: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  searchInputRef?: Ref<HTMLInputElement>;
  onSearchKeyDown?: (event: ReactKeyboardEvent) => void;
  /** Workspace entries already matched to the search; empty without one. */
  files: readonly FsIndexEntry[];
  pluginCommands: readonly ComposerCommand[];
  otherCommands: readonly ComposerCommand[];
  onPickAndAttach: () => void;
  onInsertReference: (item: { path: string; name: string; isDir: boolean }) => void;
  onInsertCommand: (command: ComposerCommand) => void;
  onToggleMode: (target: "plan" | "goal") => void;
};

/** A command's one-line description; the context inspector shows its own title. */
function commandDescription(t: TFunction, command: ComposerCommand): string {
  return command.id === "builtin.context.inspect"
    ? t("contextInsights.title")
    : command.description || command.title;
}

/**
 * The Add menu's rows. Every row is one line: an icon, a name and, when there
 * is one, a quiet description after it; the data and the close-then-act wiring
 * stay with the caller.
 */
export function ComposerPlusMenuBody({
  t,
  mode,
  controlsBlocked,
  query,
  onQueryChange,
  searchInputRef,
  onSearchKeyDown,
  files,
  pluginCommands,
  otherCommands,
  onPickAndAttach,
  onInsertReference,
  onInsertCommand,
  onToggleMode,
}: ComposerPlusMenuBodyProps) {
  return (
    <>
      <div className="composer-plus-search" role="search">
        <IconSearch size={14} className="composer-plus-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="text"
          className="composer-plus-search-input"
          placeholder={t("chat.searchPlusMenu", "Search files, commands, actions…")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>

      <div className="composer-plus-content" role="none">
        <button type="button" className="composer-plus-item" role="menuitem" onClick={onPickAndAttach}>
          <IconPaperclip size={15} className="composer-item-icon" aria-hidden="true" />
          <span className="composer-plus-item-name">{t("chat.addFiles")}</span>
        </button>

        {/* Workspace files and folders: a search result, never a default list */}
        {files.length > 0 && (
          <div role="none">
            <div className="composer-plus-group-title">{t("chat.fileMenu", "File references")}</div>
            {files.map((entry) => {
              const isDir = entry.kind === "dir";
              const label = isDir ? entry.path : fileLeaf(entry.path);
              return (
                <button
                  key={entry.path}
                  type="button"
                  className="composer-plus-item"
                  role="menuitem"
                  title={entry.path}
                  onClick={() => onInsertReference({ path: entry.path, name: label, isDir })}
                >
                  {isDir ? (
                    <IconFolder size={15} className="composer-item-icon" aria-hidden="true" />
                  ) : (
                    <IconFileText size={15} className="composer-item-icon" aria-hidden="true" />
                  )}
                  <span className="composer-plus-item-name">{label}</span>
                  {isDir ? null : <span className="composer-plus-item-desc">{fileDir(entry.path)}</span>}
                </button>
              );
            })}
          </div>
        )}

        {pluginCommands.length > 0 && (
          <div role="none">
            <div className="composer-plus-group-title">{t("chat.slashGroupPlugins", "Plugin commands")}</div>
            {pluginCommands.map((command) => (
              <button
                key={command.name}
                type="button"
                className="composer-plus-item"
                role="menuitem"
                onClick={() => onInsertCommand(command)}
              >
                <IconPlug size={15} className="composer-item-icon" aria-hidden="true" />
                <span className="composer-plus-item-name">/{command.name}</span>
                <span className="composer-plus-item-desc">{commandDescription(t, command)}</span>
              </button>
            ))}
          </div>
        )}

        {otherCommands.length > 0 && (
          <div role="none">
            <div className="composer-plus-group-title">{t("chat.slashMenu", "Commands")}</div>
            {otherCommands.map((command) => (
              <button
                key={command.name}
                type="button"
                className="composer-plus-item"
                role="menuitem"
                onClick={() => onInsertCommand(command)}
              >
                <IconSparkles size={15} className="composer-item-icon" aria-hidden="true" />
                <span className="composer-plus-item-name">/{command.name}</span>
                <span className="composer-plus-item-desc">{commandDescription(t, command)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="composer-plus-separator" />

      {/* Mode switches: Plan and Goal */}
      <div className="composer-plus-modes" role="none">
        {(["plan", "goal"] as const).map((target) => (
          <div key={target} className="composer-plus-toggle-row">
            <div className="composer-plus-toggle-label">
              <ModeIcon mode={target} />
              <span>{target === "plan" ? t("settings.modePlan", "Plan") : t("settings.modeGoal", "Goal")}</span>
            </div>
            <SettingsToggle
              checked={mode === target}
              disabled={controlsBlocked}
              label={target === "plan" ? t("settings.modePlan") : t("settings.modeGoal")}
              onChange={() => onToggleMode(target)}
            />
          </div>
        ))}
      </div>
    </>
  );
}
