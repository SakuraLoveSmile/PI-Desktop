import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectRecord } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { Button, Select, cx } from "../ui";
import { IconChevronDown, IconFolder, IconFolderOpen } from "../icons";

export type AgentProjectOption = {
  name: string;
  path: string;
};

export function projectDisplayName(path: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) || path;
}

/** Recent projects plus the project currently open in the window. */
export function useAgentProjects() {
  const currentProjectPath = useAppStore((state) => state.workspace?.path ?? null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(
    currentProjectPath,
  );

  useEffect(() => {
    let cancelled = false;
    void api
      .listProjects()
      .then((result) => {
        if (cancelled) return;
        setProjects(result.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currentProjectPath) setSelectedProjectPath(currentProjectPath);
  }, [currentProjectPath]);

  const options = useMemo<AgentProjectOption[]>(() => {
    const seen = new Set<string>();
    const result: AgentProjectOption[] = [];
    const add = (path: string | null | undefined, name?: string) => {
      const normalized = path?.trim();
      if (!normalized) return;
      const key = normalized.toLocaleLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ path: normalized, name: projectDisplayName(normalized, name) });
    };
    add(currentProjectPath);
    for (const project of projects) add(project.path, project.name);
    return result;
  }, [currentProjectPath, projects]);

  useEffect(() => {
    if (options.length === 0) {
      if (selectedProjectPath) setSelectedProjectPath(null);
      return;
    }
    if (
      !selectedProjectPath ||
      !options.some((project) => project.path === selectedProjectPath)
    ) {
      setSelectedProjectPath(options[0].path);
    }
  }, [options, selectedProjectPath]);

  return {
    currentProjectPath,
    selectedProjectPath,
    setSelectedProjectPath,
    projects,
    options,
  };
}

export function AgentProjectPicker({
  value,
  options,
  label,
  onChange,
}: {
  value: string | null;
  options: readonly AgentProjectOption[];
  label: string;
  onChange: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="agent-capability-project-picker">
      <span className="sr-only">{label}</span>
      <IconFolder size={13} aria-hidden="true" />
      <Select
        value={value ?? ""}
        aria-label={label}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.length === 0 ? (
          <option value="">{t("settings.noProjects")}</option>
        ) : (
          options.map((project) => (
            <option key={project.path} value={project.path}>
              {project.name}
            </option>
          ))
        )}
      </Select>
      <IconChevronDown size={12} aria-hidden="true" />
    </label>
  );
}

export function CapabilityToggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      className={cx("settings-toggle", checked && "on")}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

export function AgentCapabilityColumn({
  title,
  path,
  scope,
  count,
  action,
  loading,
  empty,
  children,
  className,
}: {
  title: string;
  path: string;
  scope?: "global" | "project";
  count?: number;
  action?: ReactNode;
  loading: boolean;
  empty: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("agent-capability-column", className)}>
      <header className="agent-capability-column-head">
        <div className="agent-capability-column-title">
          <div className="agent-capability-column-title-line">
            {scope ? (
              <span
                className={cx("agent-capability-column-dot", `is-${scope}`)}
                aria-hidden="true"
              />
            ) : null}
            <span className="agent-capability-column-label">{title}</span>
          </div>
          <code>{path}</code>
        </div>
        <div className="agent-capability-column-actions">
          {action}
          {count !== undefined ? (
            <span className="agent-capability-count" aria-hidden="true">
              {count}
            </span>
          ) : null}
        </div>
      </header>
      <div className="agent-capability-list" role="list" aria-busy={loading}>
        {loading ? (
          <div className="agent-capability-empty" role="status">
            <IconFolderOpen size={18} aria-hidden="true" />
            <span>{empty}</span>
          </div>
        ) : children}
      </div>
    </section>
  );
}

export function CapabilityEmpty({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="agent-capability-empty" role="status">
      {icon ?? <IconFolderOpen size={18} aria-hidden="true" />}
      <span>{message}</span>
    </div>
  );
}

export function CapabilityButton({
  children,
  onClick,
  variant = "secondary",
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <Button variant={variant} size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}
