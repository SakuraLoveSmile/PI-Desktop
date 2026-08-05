import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseMcpImport, type McpServerInput } from "@pi-desktop/shared";
import { Button, Textarea, cx } from "../ui";
import { IconCircleAlert, IconServer, IconTerminal, IconX } from "../icons";

const SAMPLE = `{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}`;

/**
 * Paste-to-import for MCP configuration.
 *
 * Nobody types an MCP server from scratch: they have a JSON block from a README
 * or another client. So the paste box is a first-class entry point, and it shows
 * exactly what it understood before anything is saved — a silent import that
 * quietly drops half the servers is worse than a refusal.
 */
export function McpImportSheet({
  saving,
  onClose,
  onImport,
}: {
  saving: boolean;
  onClose: () => void;
  onImport: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saving, onClose]);

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const parsed = parseMcpImport(text);
      return { ...parsed, error: null as string | null };
    } catch (error) {
      return {
        servers: [] as McpServerInput[],
        skipped: [] as Array<{ id: string; reason: string }>,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [text]);

  return (
    <div
      className="overlay ext-sheet-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="dialog ext-sheet is-narrow"
        role="dialog"
        aria-modal
        aria-labelledby="mcp-import-title"
      >
        <div className="ext-sheet-head">
          <div>
            <h3 id="mcp-import-title" className="ext-sheet-title">
              {t("extensions.mcp.importTitle")}
            </h3>
            <p className="ext-sheet-sub">{t("extensions.mcp.importSubtitle")}</p>
          </div>
          <button
            type="button"
            className="ext-sheet-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <IconX size={14} />
          </button>
        </div>

        <div className="ext-sheet-body">
          <Textarea
            className="ext-import-box"
            value={text}
            rows={12}
            autoFocus
            placeholder={SAMPLE}
            aria-label={t("extensions.mcp.importTitle")}
            onChange={(event) => setText(event.target.value)}
          />
          {preview?.error ? (
            <div className="ext-import-error" role="alert">
              <IconCircleAlert size={14} />
              <span>{preview.error}</span>
            </div>
          ) : preview ? (
            <div className="ext-import-preview">
              <div className="ext-import-count">
                {t("extensions.mcp.importFound", { count: preview.servers.length })}
              </div>
              {preview.servers.map((server) => (
                <div key={server.id} className="ext-import-row">
                  <span className="ext-import-icon" aria-hidden>
                    {server.transport === "http" ? (
                      <IconServer size={13} />
                    ) : (
                      <IconTerminal size={13} />
                    )}
                  </span>
                  <span className="ext-import-name">{server.label || server.id}</span>
                  <span className="ext-import-detail">
                    {server.transport === "http"
                      ? server.url
                      : [server.command, ...(server.args ?? [])].join(" ")}
                  </span>
                </div>
              ))}
              {preview.skipped.map((entry) => (
                <div key={`skip-${entry.id}`} className={cx("ext-import-row", "is-skipped")}>
                  <span className="ext-import-icon" aria-hidden>
                    <IconCircleAlert size={13} />
                  </span>
                  <span className="ext-import-name">{entry.id}</span>
                  <span className="ext-import-detail">{entry.reason}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="ext-sheet-actions">
          <span className="ext-sheet-note">{t("extensions.mcp.importNote")}</span>
          <div className="ext-sheet-actions-end">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => onImport(text)}
              disabled={saving || !preview?.servers.length}
            >
              {saving
                ? t("extensions.mcp.importing")
                : t("extensions.mcp.importAction", { count: preview?.servers.length ?? 0 })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
