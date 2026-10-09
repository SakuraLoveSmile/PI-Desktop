import { useEffect, useRef, useState } from "react";
import type { ProjectMemoryEditor } from "@pi-desktop/shared";
import { api } from "../lib/api";
import { cardsFromEditor, editorChanges, memoryEditorFailure, type EditorCard, type MemoryEditorFailure } from "./project-memory-editor-model";

function newCard(): EditorCard {
  const id = globalThis.crypto?.randomUUID?.() ??
    "memory-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  return { id, title: "", content: "" };
}

export function useProjectMemoryEditor(
  project: { path: string; groupId?: string; legacy?: boolean },
  onSaved: () => void,
  onError: (error: unknown) => void,
) {
  const projectPath = project.path;
  const scope = JSON.stringify([project.path, project.groupId, project.legacy]);
  const [failure, setFailure] = useState<MemoryEditorFailure | null>(null);
  const callbacks = useRef({ onSaved, onError });
  callbacks.current = { onSaved, onError };
  const [editor, setEditor] = useState<ProjectMemoryEditor | null>(null);
  const [cards, setCards] = useState<EditorCard[]>([]);
  const [saving, setSaving] = useState(false);
  // An editor request belongs to a particular mount/project load, not just a path.
  // A -> B -> A can otherwise accept a response from the first A.
  const generation = useRef(0);
  const loadedGeneration = useRef<number | null>(null);
  const loadedScope = useRef<string | null>(null);
  const pending = useRef<symbol | null>(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;

  const checkOwner = (result: ProjectMemoryEditor) => {
    if (project.groupId && !project.legacy && result.owner !== `group:${project.groupId}`) {
      throw Object.assign(new Error("Project memory owner changed; refresh the project list"), {
        code: "PROJECT_CHANGED",
      });
    }
  };

  useEffect(() => {
    const requestGeneration = ++generation.current;
    const isCurrent = () => generation.current === requestGeneration && currentScope.current === scope;
    loadedGeneration.current = null;
    loadedScope.current = null;
    pending.current = null;
    setSaving(false);
    setFailure(null);
    setEditor(null);
    setCards([]);
    void api.getProjectMemoryEditor(projectPath).then(({ editor: result }) => {
      if (!isCurrent()) return;
      checkOwner(result);
      loadedGeneration.current = requestGeneration;
      loadedScope.current = scope;
      setEditor(result);
      setCards(cardsFromEditor(result));
    }).catch((error) => { if (isCurrent()) reportFailure(error); });
    return () => {
      generation.current++;
      loadedGeneration.current = null;
      loadedScope.current = null;
      pending.current = null;
    };
  }, [scope]);

  const reportFailure = (error: unknown) => {
    setFailure(memoryEditorFailure(error));
    callbacks.current.onError(error);
  };

  const loaded = loadedGeneration.current === generation.current && loadedScope.current === scope &&
    currentScope.current === scope
    ? editor : null;
  const active = failure === "projectChanged" ? null : loaded;
  const changes = loaded ? editorChanges(loaded, cards) : null;
  const dirty = changes !== null;
  const updateCard = (id: string, patch: Partial<EditorCard>) => {
    setCards((current) => current.map((item) =>
      item.id === id ? { ...item, ...patch } : item));
  };
  const removeCard = (id: string) => {
    setCards((current) => current.filter((item) => item.id !== id));
  };
  const addCard = () => setCards((current) => [...current, newCard()]);

  const save = async () => {
    if (!active || !changes || !dirty || pending.current) return;
    const requestGeneration = generation.current;
    const request = Symbol("save");
    pending.current = request;
    setSaving(true);
    const isCurrent = () => generation.current === requestGeneration &&
      currentScope.current === scope && pending.current === request;
    try {
      const { editor: next } = await api.saveProjectMemoryEditor(projectPath, {
        expectedOwner: active.owner,
        expectedMemory: active.memory,
        ...changes,
      });
      if (!isCurrent()) return;
      setEditor(next);
      setCards(cardsFromEditor(next));
      setFailure(null);
      callbacks.current.onSaved();
    } catch (error) {
      if (isCurrent()) reportFailure(error);
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setSaving(false);
      }
    }
  };

  const setEnabled = async (enabled: boolean) => {
    if (!active || pending.current) return;
    const requestGeneration = generation.current;
    const request = Symbol("toggle");
    pending.current = request;
    setSaving(true);
    const isCurrent = () => generation.current === requestGeneration &&
      currentScope.current === scope && pending.current === request;
    try {
      const { autoRecordEnabled } = await api.setProjectAutoMemoryEnabled(projectPath, active.owner, enabled);
      if (!isCurrent()) return;
      // The switch is immediate, but unsaved editor baselines must stay intact.
      setEditor((current) => current ? {
        ...current, autoRecordEnabled,
      } : current);
      setFailure((current) => current === "conflict" ? current : null);
      callbacks.current.onSaved();
    } catch (error) {
      if (isCurrent()) reportFailure(error);
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setSaving(false);
      }
    }
  };
  const reload = async () => {
    if (pending.current) return;
    const requestGeneration = generation.current;
    const request = Symbol("reload");
    pending.current = request;
    setSaving(true);
    const isCurrent = () => generation.current === requestGeneration &&
      currentScope.current === scope && pending.current === request;
    try {
      const { editor: next } = await api.getProjectMemoryEditor(projectPath);
      if (!isCurrent()) return;
      checkOwner(next);
      loadedGeneration.current = requestGeneration;
      loadedScope.current = scope;
      setEditor(next);
      setCards(cardsFromEditor(next));
      setFailure(null);
    } catch (error) {
      if (isCurrent()) reportFailure(error);
    } finally {
      if (isCurrent()) {
        pending.current = null;
        setSaving(false);
      }
    }
  };
  return {
    editor: active, cards: loaded ? cards : [], saving, dirty, failure,
    autoRecordEnabled: loaded?.autoRecordEnabled ?? false,
    updateCard, removeCard, addCard, save, setEnabled, reload,
  };
}
