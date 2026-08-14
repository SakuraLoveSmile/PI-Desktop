import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppStore } from "../../stores/app-store";
import { api } from "../../lib/api";
import { IconTerminal } from "../icons";
import { WorkTabEmpty } from "./WorkTabEmpty";

/**
 * Terminal sessions must survive React unmounts (tab switches, panel
 * close), so xterm instances and their host elements live in this
 * module-level cache keyed by workspace path. The PTY itself lives in the
 * main process (D099); this cache only preserves the renderer surface.
 */
type TermEntry = {
  termId: string | null;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  creating: boolean;
};

const termCache = new Map<string, TermEntry>();

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function terminalTheme() {
  const dark = document.documentElement.dataset.theme !== "light";
  return {
    background: cssVar("--ds-bg-primary") || (dark ? "#181818" : "#ffffff"),
    foreground: cssVar("--ds-text-primary") || (dark ? "#e8e8e8" : "#1f1f1f"),
    cursor: cssVar("--ds-text-primary") || undefined,
    selectionBackground: dark
      ? "rgba(255, 255, 255, 0.22)"
      : "rgba(0, 0, 0, 0.18)",
  };
}

function ensureEntry(cwd: string): TermEntry {
  let entry = termCache.get(cwd);
  if (entry) return entry;
  const host = document.createElement("div");
  host.className = "work-terminal-xterm";
  const term = new Terminal({
    fontFamily:
      'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.25,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 4000,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  entry = { termId: null, term, fit, host, creating: false };
  // Bound once per entry; routes through the current termId so restarts
  // never stack duplicate handlers.
  term.onData((data) => {
    if (entry!.termId) void api.terminalWrite(entry!.termId, data);
  });
  termCache.set(cwd, entry);
  return entry;
}

export function TerminalTab({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const workspace = useAppStore((s) => s.workspace);
  const cwd = workspace?.path ?? null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [exited, setExited] = useState<string | null>(null);
  const [attachTick, setAttachTick] = useState(0);

  const fitAndReport = useCallback((entry: TermEntry) => {
    if (!entry.host.isConnected || entry.host.offsetWidth < 40) return;
    try {
      entry.fit.fit();
    } catch {
      return;
    }
    if (entry.termId) {
      void api.terminalResize(entry.termId, entry.term.cols, entry.term.rows);
    }
  }, []);

  const startSession = useCallback(
    async (entry: TermEntry, path: string) => {
      if (entry.creating || entry.termId) return;
      entry.creating = true;
      try {
        const created = await api.terminalCreate({
          cwd: path,
          cols: entry.term.cols,
          rows: entry.term.rows,
        });
        entry.termId = created.termId;
        if (created.replay) entry.term.write(created.replay);
        setExited(null);
        fitAndReport(entry);
      } catch {
        entry.term.writeln(`\r\n${t("panel.terminal.startFailed")}`);
      } finally {
        entry.creating = false;
      }
    },
    [fitAndReport, t],
  );

  // Attach the cached host element for the active workspace.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cwd) return;
    const entry = ensureEntry(cwd);
    container.appendChild(entry.host);
    void startSession(entry, cwd);
    if (active) {
      fitAndReport(entry);
      entry.term.focus();
    }
    return () => {
      // Detach only — the entry (and PTY) stays alive for the next mount.
      if (entry.host.parentElement === container) {
        container.removeChild(entry.host);
      }
    };
  }, [cwd, active, startSession, fitAndReport, attachTick]);

  // Route PTY output/exit pushes to the cached terminals.
  useEffect(() => {
    const offData = api.onTerminalData(({ termId, data }) => {
      for (const entry of termCache.values()) {
        if (entry.termId === termId) entry.term.write(data);
      }
    });
    const offExit = api.onTerminalExit(({ termId }) => {
      for (const [path, entry] of termCache.entries()) {
        if (entry.termId === termId) {
          entry.termId = null;
          entry.term.writeln(`\r\n\x1b[2m${t("panel.terminal.exited")}\x1b[0m`);
          if (path === cwd) setExited(path);
        }
      }
    });
    return () => {
      offData();
      offExit();
    };
  }, [cwd, t]);

  // Refit on container resize (panel drag, window resize, tab re-show).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cwd) return;
    const entry = ensureEntry(cwd);
    const observer = new ResizeObserver(() => fitAndReport(entry));
    observer.observe(container);
    return () => observer.disconnect();
  }, [cwd, fitAndReport]);

  // Keep xterm colors in sync with the app theme.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = terminalTheme();
      for (const entry of termCache.values()) {
        entry.term.options.theme = theme;
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const restart = useCallback(() => {
    if (!cwd) return;
    const entry = termCache.get(cwd);
    if (entry) {
      entry.term.reset();
      entry.termId = null;
    }
    setExited(null);
    if (entry) void startSession(entry, cwd);
    setAttachTick((n) => n + 1);
  }, [cwd, startSession]);

  if (!cwd) {
    return (
      <WorkTabEmpty
        icon={IconTerminal}
        title={t("panel.terminal.noWorkspace")}
        body={t("panel.terminal.noWorkspaceHint")}
      />
    );
  }

  return (
    <div className="work-terminal">
      <div ref={containerRef} className="work-terminal-host" />
      {exited === cwd && (
        <div className="work-terminal-exited">
          <span>{t("panel.terminal.exited")}</span>
          <button type="button" className="btn btn-secondary" onClick={restart}>
            {t("panel.terminal.restart")}
          </button>
        </div>
      )}
    </div>
  );
}
