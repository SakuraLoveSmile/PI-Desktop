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
import type { ComposerCommand, FsIndexEntry, Mode } from "@pi-desktop/shared";
import { AnchoredMenu } from "../../../components/settings/AnchoredMenu";
import { TooltipButton } from "../../../components/ui";
import { IconPlus } from "../../../components/icons";
import { ComposerPlusMenuBody } from "./ComposerPlusMenuBody";
import { searchPlusMenuFiles } from "./plus-menu-files";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";

export type ComposerPlusMenuProps = {
  t: TFunction;
  mode: Mode;
  disabled?: boolean;
  controlsBlocked?: boolean;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onSelectMode: (mode: Mode) => Promise<void> | void;
  onPickAndAttach: () => Promise<void> | void;
  onInsertReference: (item: { path: string; name: string; isDir: boolean }) => void;
  onInsertCommand: (command: ComposerCommand) => void;
  onCloseOtherMenus?: () => void;
};

function matchesCommand(command: ComposerCommand, needle: string): boolean {
  return (
    command.name.toLowerCase().includes(needle) ||
    command.title.toLowerCase().includes(needle) ||
    Boolean(command.description?.toLowerCase().includes(needle))
  );
}

export function ComposerPlusMenu({
  t,
  mode,
  disabled = false,
  controlsBlocked = false,
  open,
  setOpen,
  onSelectMode,
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

  const filteredFiles = useMemo(() => searchPlusMenuFiles(files, q), [files, q]);

  const pluginCommands = useMemo(() => {
    const list = commands.filter(
      (c) => c.kind === "plugin" || c.kind === "extension",
    );
    if (!q) return list.slice(0, 6);
    return list.filter((c) => matchesCommand(c, q)).slice(0, 8);
  }, [commands, q]);

  const otherCommands = useMemo(() => {
    const list = commands.filter(
      (c) => c.kind === "skill" || c.kind === "builtin" || c.kind === "template",
    );
    if (!q) return list.slice(0, 8);
    return list.filter((c) => matchesCommand(c, q)).slice(0, 10);
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
      <ComposerPlusMenuBody
        t={t}
        mode={mode}
        controlsBlocked={controlsBlocked}
        query={query}
        onQueryChange={setQuery}
        searchInputRef={searchInputRef}
        onSearchKeyDown={handleKeyDown}
        files={filteredFiles}
        pluginCommands={pluginCommands}
        otherCommands={otherCommands}
        onPickAndAttach={() => {
          setOpen(false);
          void onPickAndAttach();
        }}
        onInsertReference={(item) => {
          setOpen(false);
          onInsertReference(item);
        }}
        onInsertCommand={(command) => {
          setOpen(false);
          onInsertCommand(command);
        }}
        onToggleMode={(target) => void onToggleMode(target)}
      />
    </AnchoredMenu>
  );
}
