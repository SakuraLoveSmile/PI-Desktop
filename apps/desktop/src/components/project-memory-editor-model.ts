import type { ProjectMemory, ProjectMemoryEditor, ProjectMemoryEntry } from "@pi-desktop/shared";

export type EditorCard = ProjectMemoryEntry;

export function memoryEntries(memory: ProjectMemory): ProjectMemoryEntry[] {
  if (memory.entries) return memory.entries;
  return memory.content.trim()
    ? [{ id: "legacy-project-memory", title: "", content: memory.content.trim() }]
    : [];
}

export function cardsFromEditor(editor: ProjectMemoryEditor): EditorCard[] {
  return memoryEntries(editor.memory).map((entry) => ({ ...entry }));
}

export function editorChanges(editor: ProjectMemoryEditor, cards: EditorCard[]): {
  entries: ProjectMemoryEntry[];
} | null {
  if (JSON.stringify(cards) === JSON.stringify(memoryEntries(editor.memory))) return null;
  return { entries: cards.map(({ id, title, content }) => ({
    id: id.trim(), title: title.trim(), content: content.trim(),
  })).filter((entry) => entry.content.length > 0) };
}

export type MemoryEditorFailure = "conflict" | "request" | "projectChanged";

function errorCode(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if ("errorCode" in value && typeof value.errorCode === "string") return value.errorCode;
  if ("code" in value && typeof value.code === "string") return value.code;
  return undefined;
}

export function memoryEditorFailure(error: unknown): MemoryEditorFailure {
  if (error === null || typeof error !== "object") return "request";
  // IPC exposes the host's structured data as details; direct host failures use data.
  const code = errorCode("details" in error ? error.details : undefined) ??
    errorCode("data" in error ? error.data : undefined) ?? errorCode(error);
  if (code === "PROJECT_CHANGED") return "projectChanged";
  if (code === "CONFLICT") return "conflict";
  return "request";
}
