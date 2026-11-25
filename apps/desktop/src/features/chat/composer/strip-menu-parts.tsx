import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconLock,
  IconSearch,
} from "../../../components/icons";
import { Button, Input } from "../../../components/ui";
import { shortenPath } from "../../../lib/project-archive";

/*
 * Pieces shared by the workspace strip menus (project, location, branch): one
 * row, header, field and reason language (PI-UI-1126, D652). Each menu keeps
 * its own state and actions; these only draw.
 */

/** Folder that holds a project, with the home folder written `~`; empty at a filesystem root. */
export function projectParentLabel(projectPath: string): string {
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut > 0 ? shortenPath(trimmed.slice(0, cut)) : "";
}

/** The chevron that marks a trigger as a menu, or a lock while a running task holds it. */
export function StripTriggerTail({ locked = false }: { locked?: boolean }) {
  return locked
    ? <IconLock size={11} className="composer-footer-lock" aria-hidden />
    : <IconChevronDown size={10} className="composer-footer-chevron" aria-hidden />;
}

/** Why the rows below are inert. */
export function StripMenuBanner({ children }: { children: ReactNode }) {
  return <div className="composer-footer-banner" role="status">
    <IconLock size={12} aria-hidden />
    <span>{children}</span>
  </div>;
}

/** Back arrow and the title of a sub-view. */
export function StripMenuHeader({ title, backLabel, disabled = false, onBack }: {
  title: string;
  backLabel: string;
  disabled?: boolean;
  onBack: () => void;
}) {
  return <div className="composer-footer-header">
    <Button type="button" variant="ghost" className="composer-footer-back" aria-label={backLabel} disabled={disabled} onClick={onBack}>
      <IconChevronLeft size={14} aria-hidden />
    </Button>
    <span className="composer-footer-title">{title}</span>
  </div>;
}

/** A search field with its icon inside it. */
export function StripMenuSearch(props: InputHTMLAttributes<HTMLInputElement>) {
  return <div className="composer-footer-search">
    <IconSearch size={14} aria-hidden />
    <Input {...props} />
  </div>;
}

/** A labelled text field with an optional visible hint under it. */
export function StripMenuField({ label, hint, value, disabled, onChange }: {
  label: string;
  hint?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return <div className="composer-footer-field">
    <label className="composer-footer-field-label" htmlFor={id}>{label}</label>
    <Input id={id} autoFocus value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    {hint ? <p className="composer-footer-field-hint">{hint}</p> : null}
  </div>;
}

/** The create view's single action, compact and at the right. */
export function StripMenuSubmit({ label, disabled }: { label: string; disabled: boolean }) {
  return <div className="composer-footer-actions">
    <Button type="submit" variant="primary" className="composer-footer-submit" disabled={disabled}>{label}</Button>
  </div>;
}

/**
 * The inside of a menu row: a lead icon, the name and, when it is current, a
 * check. A row with a second line stacks it under the name; a path is clipped
 * at its start, so the folder that matters stays visible.
 */
export function StripRowBody({ icon, name, sub, path = false, current = false, tag }: {
  icon: ReactNode;
  name: string;
  sub?: string;
  path?: boolean;
  current?: boolean;
  tag?: string;
}) {
  const check = current ? <IconCheck size={15} className="composer-footer-check" aria-hidden /> : null;
  if (sub) {
    return <>
      {icon}
      <span className="composer-footer-text">
        <span className="composer-footer-line">
          <span className="composer-footer-label">{name}</span>
          {check}
        </span>
        <span className={path ? "composer-footer-sub is-path" : "composer-footer-sub"}>
          {path ? <bdi>{sub}</bdi> : sub}
        </span>
      </span>
    </>;
  }
  return <>
    {icon}
    <span className="composer-footer-label">{name}</span>
    {tag ? <span className="composer-footer-tag">{tag}</span> : null}
    {check}
  </>;
}
