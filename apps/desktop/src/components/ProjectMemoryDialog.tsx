import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useBlockingOverlay } from "../lib/blocking-overlay";
import { Button, Input, SettingsToggle, Textarea, TooltipButton } from "./ui";
import { IconClose, IconPlus, IconSparkles, IconTrash } from "./icons";

import { useProjectMemoryEditor } from "./useProjectMemoryEditor";

export function ProjectMemoryDialog({
  project,
  onClose,
  onSaved,
  onError,
}: {
  project: { name: string; path: string; groupId?: string; legacy?: boolean; memoryOwner?: string };
  onClose: () => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  useBlockingOverlay();
  const { t } = useTranslation();
  const { editor, cards: entries, saving, dirty, failure, autoRecordEnabled,
    updateCard: updateEntry, removeCard, addCard, save, setEnabled, reload,
  } = useProjectMemoryEditor(project, onSaved, onError);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const dialog = (
    <div
      className="overlay project-instructions-dialog-overlay"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="dialog project-instructions-dialog project-memory-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-memory-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="project-instructions-dialog-head">
          <div>
            <h3 id="project-memory-dialog-title" className="project-instructions-dialog-title">
              <IconSparkles size={17} aria-hidden />
              {t("project.editMemory")}
            </h3>
            <div className="project-instructions-dialog-project">{project.name}</div>
          </div>
          <TooltipButton
            type="button"
            className="project-instructions-dialog-close"
            tooltip={t("settings.cancel")}
            ariaLabel={t("settings.cancel")}
            disabled={saving}
            onClick={onClose}
          >
            <IconClose size={16} />
          </TooltipButton>
        </div>
        <div className="project-memory-dialog-body">
          <p className="project-memory-dialog-description">{t("project.memoryDescription")}</p>
          {editor?.migrationRequired ? (
            <p className="project-memory-dialog-error" role="status">{t("project.memoryMigrationRequired")}</p>
          ) : null}
          <div className="project-auto-memory-toggle">
            <span>{t("project.autoMemoryToggle")}</span>
            <SettingsToggle
              label={t("project.autoMemoryToggle")}
              checked={autoRecordEnabled}
              disabled={editor === null || saving || editor.migrationRequired === true}
              busy={saving}
              onChange={() => void setEnabled(!autoRecordEnabled)}
            />
          </div>
          <p className="project-memory-dialog-hint">{t("project.autoMemoryDescription")}</p>
          {failure ? (
            <div className="project-memory-dialog-error" role="alert">
              <span>{t(failure === "projectChanged" ? "project.memoryProjectChanged" :
                failure === "conflict" ? "project.memoryConflict" : "project.memoryRequestFailed")}</span>
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => void reload()}>
                {t(dirty ? "project.memoryReloadDiscard" : "project.memoryReload")}
              </Button>
            </div>
          ) : null}
          <div className="project-memory-dialog-toolbar">
            <span className="project-memory-dialog-count">
              {t("project.memoryCount", { count: entries.length })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={editor === null || saving}
              onClick={addCard}
            >
              <IconPlus size={14} aria-hidden />
              {t("project.memoryAdd")}
            </Button>
          </div>
          {editor === null && !failure ? (
            <div role="status" className="project-memory-dialog-empty">{t("common.loading")}</div>
          ) : entries.length > 0 ? (
            <div className="project-memory-dialog-list" role="list" aria-label={t("project.editMemory")}>
              {entries.map((entry, index) => (
                <article className="project-memory-card" key={entry.id} role="listitem">
                  <div className="project-memory-card-head">
                    <span className="project-memory-entry-index" aria-hidden>
                      {index + 1}
                    </span>
                    <Input
                      value={entry.title}
                      placeholder={t("project.memoryEntryTitle")}
                      aria-label={`${t("project.memoryEntryTitle")} ${index + 1}`}
                      disabled={editor === null || saving}
                      onChange={(event) => updateEntry(entry.id, { title: event.target.value })}
                    />
                    <TooltipButton
                      type="button"
                      className="project-memory-remove"
                      tooltip={t("project.memoryRemove")}
                      ariaLabel={`${t("project.memoryRemove")} ${index + 1}`}
                      disabled={editor === null || saving}
                      onClick={() => removeCard(entry.id)}
                    >
                      <IconTrash size={15} />
                    </TooltipButton>
                  </div>
                  <Textarea
                    className="project-memory-entry-content"
                    value={entry.content}
                    placeholder={t("project.memoryEntryContent")}
                    aria-label={`${t("project.memoryEntryContent")} ${index + 1}`}
                    disabled={editor === null || saving}
                    onChange={(event) => updateEntry(entry.id, { content: event.target.value })}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className="project-memory-dialog-empty">
              <IconSparkles size={20} aria-hidden />
              <span>{t("project.memoryEmpty")}</span>
            </div>
          )}
          <div className="project-memory-dialog-hint">{t("project.memoryHint")}</div>
        </div>
        <div className="project-instructions-dialog-actions">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button variant="primary" disabled={editor === null || !dirty || saving} onClick={() => void save()}>
            {saving ? t("project.memorySaving") : t("project.memorySave")}
          </Button>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
