import { act, type ReactNode } from "react";
import type { i18n } from "i18next";
import { IPC } from "@pi-desktop/shared";
import { AgentMcpPage } from "../../apps/desktop/src/components/settings/AgentMcpPage";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { createCapabilitiesFixture } from "./settings-capabilities-fixture.js";
import { SettingsPage } from "../../apps/desktop/src/features/settings/SettingsPage";

const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
};
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check() && performance.now() < deadline) await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  assert(check(), label);
}

/** Controlled preload scheduling exercises real page/save/reload wiring. */
export async function exerciseHostCollectionRaces({ mount, node, i18n }: {
  mount: (component: ReactNode) => Promise<void>;
  node: HTMLElement;
  i18n: i18n;
}) {
  const previous = window.piDesktop;
  const checks: string[] = [];
  let fixture = createCapabilitiesFixture();
  let nextRead: ReturnType<typeof deferred<unknown>> | null = null;
  let nextWrite: ReturnType<typeof deferred<void>> | null = null;
  let pendingRead: ReturnType<typeof deferred<unknown>> | null = null;
  let pendingWrite: ReturnType<typeof deferred<void>> | null = null;
  let failRead = false;
  const requests: Array<{ channel: string; input: unknown }> = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  window.piDesktop = {
    channels: IPC, platform: "darwin",
    on(channel, callback) {
      const entries = listeners.get(channel) ?? new Set(); entries.add(callback); listeners.set(channel, entries);
      return () => { entries.delete(callback); };
    },
    async invoke<T>(channel: string, ...args: unknown[]) {
      const input = args[0]; requests.push({ channel, input });
      if (channel === IPC.invoke.projectList) return { ok: true, data: { projects: fixture.projects } as T };
      if (channel === IPC.invoke.mcpUpsert && nextWrite) {
        const gate = nextWrite; nextWrite = null; pendingWrite = gate; await gate.promise;
      }
      if (channel === IPC.invoke.mcpList && (input as { level?: string })?.level === "global") {
        if (failRead) { failRead = false; throw new Error("Latest fixture read failed"); }
        if (nextRead) {
          const gate = nextRead; nextRead = null; pendingRead = gate;
          return { ok: true, data: await gate.promise as T };
        }
      }
      const result = fixture.invoke(channel, input);
      if (!result.handled) throw new Error(`Unexpected race fixture IPC ${channel}`);
      return { ok: true, data: result.data as T };
    },
  };
  const emit = async () => { await act(async () => { for (const listener of listeners.get(IPC.event.pluginChanged) ?? []) listener({}); }); };
  const labelButton = (parent: ParentNode, label: string) => [...parent.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label);
  const click = async (button: HTMLButtonElement | undefined | null) => {
    assert(button && !button.disabled, "Race fixture action must be enabled");
    await act(async () => button!.click());
  };
  const fresh = async (parameters = "") => {
    await mount(<div />);
    fixture = createCapabilitiesFixture(new URLSearchParams(parameters));
    requests.length = 0; nextRead = null; nextWrite = null; pendingRead = null; pendingWrite = null;
    useAppStore.setState({ workspace: { path: fixture.projects[0].path, name: fixture.projects[0].name }, toasts: [] });
    await mount(<AgentMcpPage />);
    await until(() => node.querySelectorAll('.agent-capability-row').length === 1, "Race fixture inventory loaded");
  };
  const editAndSave = async () => {
    await click(node.querySelector<HTMLButtonElement>('.agent-capability-row button.settings-icon-button'));
    await until(() => Boolean(document.querySelector('[role="dialog"]')), "Race editor opens");
    const input = document.querySelector<HTMLInputElement>('.ext-field-pair input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Race saved label");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(labelButton(document.querySelector('[role="dialog"]')!, i18n.t("common.save")));
  };
  const countReads = () => requests.filter(call => call.channel === IPC.invoke.mcpList).length;
  try {
    await fresh();
    nextRead = deferred<unknown>();
    await editAndSave();
    await until(() => pendingRead !== null, "Save refresh A is waiting");
    await emit();
    await until(() => node.textContent?.includes("Race saved label") === true, "Plugin refresh B lands first");
    await act(async () => pendingRead!.resolve({ servers: [], statuses: [] }));
    await until(() => !document.querySelector('[role="dialog"]'), "Persisted editor closes after superseded read");
    assert(!node.querySelector('.settings-save-feedback'), "A superseded save refresh cannot report failure after newer refresh B succeeded");
    assert(node.textContent?.includes("Race saved label"), "A stale read cannot replace the newer rows");
    checks.push("save refresh A pending, plugin refresh B succeeds, A finishes without false failure");

    await fresh("mcpRefresh=error");
    await editAndSave();
    await until(() => Boolean(node.querySelector('.settings-save-feedback')), "Real post-save read error remains visible");
    nextRead = deferred<unknown>();
    await click(labelButton(node, i18n.t("errors.action.retry")));
    await until(() => pendingRead !== null, "Retry A waits");
    await click(labelButton(node, i18n.t("errors.action.retry")));
    await until(() => !node.querySelector('.settings-save-feedback'), "Retry B succeeds");
    await act(async () => pendingRead!.reject(new Error("Obsolete retry A failed")));
    assert(!node.querySelector('.settings-save-feedback'), "Obsolete Retry A cannot restore a failure after Retry B succeeds");
    failRead = true; await emit();
    assert(useAppStore.getState().toasts.some(toast => toast.message === "Latest fixture read failed"), "Latest ordinary read failures remain observable");
    checks.push("retry A superseded by successful retry B; obsolete failure ignored, current errors still visible");

    for (const destination of ["project", "unmount"] as const) {
      await fresh();
      nextWrite = deferred<void>();
      await editAndSave();
      await until(() => pendingWrite !== null, "Scope A write waits");
      if (destination === "project") {
        await act(async () => useAppStore.setState({ workspace: { path: fixture.projects[1].path, name: fixture.projects[1].name } }));
        await until(() => requests.some(call => call.channel === IPC.invoke.mcpList && (call.input as { projectPath?: string })?.projectPath === fixture.projects[1].path), "Scope B list loaded");
      } else await mount(<div data-testid="destination" />);
      const readsBeforeRelease = countReads();
      await act(async () => pendingWrite!.resolve());
      assert(countReads() === readsBeforeRelease, "A retired save must not revive its old fetcher after scope change or unmount");
      assert(!node.querySelector('.settings-save-feedback') && useAppStore.getState().toasts.length === 0, "A retired save cannot write feedback into its replacement page");
      if (destination === "project") {
        await click(node.querySelector<HTMLButtonElement>('.agent-capability-row button.settings-icon-button'));
        await until(() => Boolean(document.querySelector('[role="dialog"]')), "Scope B remains editable");
        assert(!labelButton(document.querySelector('[role="dialog"]')!, i18n.t("common.save"))?.disabled, "A retired save cannot leave the new scope stuck saving");
      }
    }
    checks.push("pending save cannot revive old fetcher or feedback after project switch or unmount");

    const scopeFailures: string[] = [];
    for (const tab of ["mcp", "skills"] as const) {
      await mount(<div />);
      const projects = fixture.projects;
      const writes: Array<{ projectPath?: string }> = [];
      const pendingSave = deferred<void>();
      let holdWrite = true;
      let saveStarted = false;
      let failWrite = false;
      let holdSkillRead = false;
      let skillReadStarted = false;
      const pendingSkillRead = deferred<void>();
      const listChannel = tab === "mcp" ? IPC.invoke.mcpList : IPC.invoke.skillList;
      const writeChannel = tab === "mcp" ? IPC.invoke.mcpUpsert : IPC.invoke.skillUpdate;
      const record = (projectPath: string) => ({
        id: "same-id", name: "Original skill", label: "Original MCP", description: "Scope fixture",
        enabled: true, level: "project", projectPath, scope: { mode: "projects", projects: [projectPath] },
        path: `${projectPath}/.agents/${tab}/same-id`, source: "created", sizeBytes: 32,
        transport: "stdio", command: "node", args: [], createdAt: "2026-10-24", updatedAt: "2026-10-24",
      });
      window.piDesktop = {
        channels: IPC, platform: "darwin", on: () => () => {},
        async invoke<T>(channel: string, ...args: unknown[]) {
          const input = args[0] as { level?: string; projectPath?: string } | undefined;
          let data: unknown;
          if (channel === IPC.invoke.projectList) data = { projects };
          else if (channel === IPC.invoke.pluginScenicThemesDestinations) data = [];
          else if (channel === IPC.invoke.mcpControlGet) data = { enabled: false, running: false, source: "preference", connectionFile: "/fixture/control.json", error: null };
          else if (channel === listChannel) {
            const rows = input?.level === "project" && input.projectPath ? [record(input.projectPath)] : [];
            data = tab === "mcp" ? { servers: rows, statuses: [] } : { skills: rows };
          } else if (channel === IPC.invoke.skillRead && input?.projectPath) {
            if (holdSkillRead) { holdSkillRead = false; skillReadStarted = true; await pendingSkillRead.promise; }
            data = { skill: record(input.projectPath), body: "# Original skill\n\nFixture body." };
          } else if (channel === writeChannel) {
            writes.push({ projectPath: input?.projectPath });
            if (failWrite) { failWrite = false; throw new Error("Scope fixture save failed"); }
            if (holdWrite) { holdWrite = false; saveStarted = true; await pendingSave.promise; }
            data = {};
          } else throw new Error(`Unexpected scope fixture IPC ${channel}`);
          return { ok: true, data: data as T };
        },
      };
      useAppStore.setState({ settingsTab: tab, workspace: { path: projects[0].path, name: projects[0].name }, toasts: [] });
      await mount(<SettingsPage />);
      await until(() => node.querySelectorAll('.agent-capability-row').length === 1, `${tab}: project A inventory loaded through Settings`);
      await click(node.querySelector<HTMLButtonElement>('.agent-capability-row button.settings-icon-button'));
      await until(() => Boolean(document.querySelector('[role="dialog"]')), `${tab}: project A editor opens`);
      const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "Project A draft");
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(labelButton(document.querySelector('[role="dialog"]')!, i18n.t("common.save")));
      await until(() => saveStarted, `${tab}: project A save waits`);
      await act(async () => useAppStore.setState({ workspace: { path: projects[1].path, name: projects[1].name } }));
      await act(async () => pendingSave.resolve());
      // Do not open B's row: that used to replace the leaked editor and conceal
      // the bug. Attempt the existing sheet action exactly as a user could.
      const leakedEditor = document.querySelector('[role="dialog"]');
      if (leakedEditor) await click(labelButton(leakedEditor, i18n.t("common.save")));
      if (writes.some(write => write.projectPath === projects[1].path)) scopeFailures.push(`${tab}: project A draft was written to project B`);
      if (leakedEditor) scopeFailures.push(`${tab}: project A editor survived the scope change`);
      assert(writes[0]?.projectPath === projects[0].path, `${tab}: the original save stays bound to project A`);

      // The current scope must still retain its draft and offer a retry after
      // a genuine persistence failure; retiring A must not weaken that path.
      await click(node.querySelector<HTMLButtonElement>('.agent-capability-row button.settings-icon-button'));
      await until(() => Boolean(document.querySelector('[role="dialog"]')), `${tab}: project B opens a fresh editor`);
      const retryField = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(retryField, "Project B retry draft");
        retryField.dispatchEvent(new Event("input", { bubbles: true }));
      });
      failWrite = true;
      await click(labelButton(document.querySelector('[role="dialog"]')!, i18n.t("common.save")));
      assert(document.querySelector('[role="dialog"] [role="alert"]'), `${tab}: current save failure stays visible beside the draft`);
      assert(document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value === "Project B retry draft", `${tab}: current save failure retains the draft`);
      await click(labelButton(document.querySelector('[role="dialog"]')!, i18n.t("common.save")));
      await until(() => !document.querySelector('[role="dialog"]'), `${tab}: current save retry succeeds`);

      if (tab === "skills") {
        await act(async () => useAppStore.setState({ workspace: { path: projects[0].path, name: projects[0].name } }));
        holdSkillRead = true;
        await click(node.querySelector<HTMLButtonElement>('.agent-capability-row button.settings-icon-button'));
        await until(() => skillReadStarted, "Skills project A editor read waits");
        await act(async () => useAppStore.setState({ workspace: { path: projects[1].path, name: projects[1].name } }));
        await act(async () => pendingSkillRead.resolve());
        assert(!document.querySelector('[role="dialog"]'), "Skills retired project A read cannot open its editor in B");
        assert(!node.querySelector<HTMLButtonElement>('.agent-capability-row button.settings-icon-button')?.disabled, "Skills retired read cannot leave B's matching row busy");
      }
      await mount(<div />);
    }
    assert(scopeFailures.length === 0, scopeFailures.join("; "));
    checks.push("Settings MCP and Skills close pending project A editors on workspace B without writing A drafts into B");
    checks.push("Settings current-scope MCP and Skills failed-save drafts retry successfully; retired Skills reads cannot reopen A or lock B");
    return checks;
  } finally { await mount(<div />); window.piDesktop = previous; }
}
