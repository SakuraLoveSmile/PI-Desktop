import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { IPC } from "@pi-desktop/shared";
import { AgentMcpPage } from "../../apps/desktop/src/components/settings/AgentMcpPage";
import { AgentSubagentsPage } from "../../apps/desktop/src/components/settings/AgentSubagentsPage";
import { McpMarketPanel } from "../../apps/desktop/src/components/settings/McpMarketPanel";
import { SkillMarketPanel } from "../../apps/desktop/src/components/settings/SkillMarketPanel";
import { SubagentFallbackModels } from "../../apps/desktop/src/components/settings/SubagentFallbackModels";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";
import { createCapabilitiesFixture } from "./settings-capabilities-fixture.js";
import { exerciseHostCollectionRaces } from "./host-collection-races";
import { api } from "../../apps/desktop/src/lib/api";
import { AgentInstructionsSection } from "../../apps/desktop/src/features/settings/agent-sections";

declare global { var agentCapabilitiesProbe: () => Promise<unknown>; }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check() && performance.now() < deadline) await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  assert(check(), label);
}
async function click(button: HTMLButtonElement | undefined) {
  assert(button && !button.disabled, "Expected enabled action");
  await act(async () => button!.click());
}
globalThis.agentCapabilitiesProbe = async () => {
  const i18n = createInstance(); await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const original = { getAgentInstructions: api.getAgentInstructions, saveAgentInstructions: api.saveAgentInstructions };
  let resolveRead: ((value: Awaited<ReturnType<typeof api.getAgentInstructions>>) => void) | undefined;
  let rejectRead: ((error: Error) => void) | undefined;
  let reads = 0, failSave = true, saves = 0;
  const file = { scope: "global" as const, path: "/fixture/AGENTS.md", content: "Existing instructions", exists: true };
  api.getAgentInstructions = () => { reads++; return new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }); };
  api.saveAgentInstructions = async (_scope, content) => { saves++; if (failSave) throw new Error("Fixture write failed"); return { file: { ...file, content } }; };
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><AgentInstructionsSection /></I18nextProvider>));
    const editor = () => node.querySelector<HTMLTextAreaElement>("textarea")!;
    assert(editor().disabled, "Instruction editor must be disabled until a successful read");
    await act(async () => rejectRead!(new Error("Fixture read failed")));
    await until(() => Boolean(node.querySelector('[role="alert"]')), "Read failure must be visible");
    assert(editor().disabled && saves === 0, "Read failure cannot enable an empty replacement draft");
    await click([...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t("errors.action.retry")));
    assert(reads === 2, "Retry must perform one new read");
    await act(async () => resolveRead!({ global: file }));
    await until(() => !editor().disabled, "Successful retry enables editing");
    assert(editor().value === file.content, "Loaded instructions populate the editor");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor(), "Unsaved user instructions"); editor().dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await i18n.changeLanguage("en-US"); });
    assert(reads === 2 && editor().value === "Unsaved user instructions", "Locale changes must not reload and replace an unsaved instruction draft");
    const save = () => [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === i18n.t("settings.instructionsSave"));
    await click(save());
    await until(() => Boolean(node.querySelector('[role="alert"]')), "Save failure must be visible");
    assert(editor().value === "Unsaved user instructions" && !save()!.disabled, "Failed save keeps draft and retry available");
    failSave = false; await click(save());
    await until(() => save()!.disabled, "Successful save establishes a clean baseline");
    assert(saves === 2 && !node.querySelector('[role="alert"]'), "Successful retry clears error");
    Object.assign(api, original);
    const checks = ["loading lock", "failed load and explicit retry", "draft preserved on failed save", "successful save baseline"];
    const previousBridge = window.piDesktop;
    let fixture = createCapabilitiesFixture(new URLSearchParams("mcpSave=error&mcpRefresh=error&subagentSave=error&subagentRefresh=error&mcpMarket=error&skillMarket=error"));
    window.piDesktop = {
      channels: IPC, platform: "darwin", on: () => () => {},
      async invoke<T>(channel: string, ...args: unknown[]) {
        if (channel === IPC.invoke.projectList) return { ok: true, data: { projects: fixture.projects } as T };
        if (channel === IPC.invoke.settingsGet) return { ok: true, data: useAppStore.getState().settings as T };
        const result = fixture.invoke(channel, args[0]);
        if (!result.handled) throw new Error(`Unexpected capability fixture IPC ${channel}`);
        return { ok: true, data: result.data as T };
      },
    };
    const mount = async (component: ReactNode) => { await act(async () => root.render(<I18nextProvider i18n={i18n}>{component}</I18nextProvider>)); };
    const textButton = (parent: ParentNode, label: string) => [...parent.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label);
    const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      assert(element && !element.disabled, "Expected editable field");
      await act(async () => { const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    try {
      useAppStore.setState({ settings: { language: "en", theme: "light", defaultMode: "agent", enterToSend: true }, providers: [], workspace: undefined });
      await mount(<AgentMcpPage />);
      await until(() => node.querySelectorAll('.agent-capability-row').length === 1, "MCP list loads");
      assert(node.querySelectorAll('.agent-capability-page button').length > 0 && [...node.querySelectorAll('button')].filter(button => button.textContent === i18n.t("settings.addMcp")).length === 1, "MCP has one primary add entry");
      const panel = node.querySelector('.agent-capability-panel')!;
      const control = node.querySelector('.agent-mcp-scope')!;
      assert(panel && control && !panel.contains(control), "Machine endpoint is independent of server inventory");
      await click(node.querySelector<HTMLButtonElement>('button[aria-label="' + i18n.t("settings.editMcpOf", { name: "Documentation" }) + '"]')!);
      await until(() => Boolean(document.querySelector('[role="dialog"]')), "MCP editor opens");
      const dialog = () => document.querySelector('[role="dialog"]')!;
      await type(dialog().querySelector<HTMLInputElement>('.ext-field-pair input')!, "Edited documentation");
      await click(textButton(dialog(), i18n.t("common.save")));
      assert(dialog()?.querySelector<HTMLInputElement>('.ext-field-pair input')?.value === "Edited documentation" && dialog()?.querySelector('[role="alert"]'), "MCP failed save retains draft with nearby error");
      await click(textButton(dialog(), i18n.t("common.save")));
      await until(() => !document.querySelector('[role="dialog"]'), "MCP save retry closes editor");
      assert(node.textContent?.includes(i18n.t("settings.saveState.refreshFailed")), "MCP persistence success is distinguished from refresh failure");
      assert(!useAppStore.getState().toasts.some(toast => toast.message.includes("Fixture mcpRefresh")), "A post-save read failure must not add a second generic error toast");
      await click(textButton(node, i18n.t("errors.action.retry")));
      await until(() => node.textContent?.includes("Edited documentation") === true && !node.querySelector('.settings-save-feedback'), "MCP refresh retry restores saved row without another write");
      assert(fixture.calls.filter(call => call.channel === IPC.invoke.mcpUpsert).length === 2, "Refresh retry must not repeat the write");
      await type(node.querySelector<HTMLInputElement>('input.agent-capability-search')!, "no-matches");
      assert(node.textContent?.includes(i18n.t("settings.capabilityNoMatches")) && node.querySelector('.agent-mcp-scope'), "MCP search cannot hide machine state");
      for (const filter of ["Global", "Project", "All"]) {
        await click([...node.querySelectorAll<HTMLButtonElement>('.agent-capability-segment button')].find(button => button.textContent?.startsWith(i18n.t(`settings.capabilityFilter${filter}`))));
        assert(node.querySelectorAll('.agent-mcp-scope').length === 1 &&
          !node.querySelector('.agent-capability-panel')?.contains(node.querySelector('.agent-mcp-scope')),
          "The single machine endpoint remains independent of filtered server inventory");
        const endpointToggle = node.querySelector<HTMLButtonElement>('.agent-mcp-scope [role="switch"]');
        assert(endpointToggle && !endpointToggle.disabled, "Search and level filters cannot disable the host-owned endpoint switch");
      }
      await click(node.querySelector<HTMLButtonElement>('.agent-mcp-scope [role="switch"]')!);
      assert(fixture.calls.at(-1)?.channel === IPC.invoke.mcpControlSet &&
        node.querySelector('.agent-mcp-scope [role="switch"]')?.getAttribute("aria-checked") === "true",
        "The endpoint stays operable through its own channel while the inventory has no search matches");
      checks.push("MCP edit, failed-save draft, save versus refresh failure, read-only retry, search and independent endpoint");
      await mount(<div />);
      fixture = createCapabilitiesFixture(new URLSearchParams("capabilities=empty"));
      await mount(<AgentMcpPage />);
      await until(() => node.textContent?.includes(i18n.t("settings.mcpEmpty")) === true, "Empty MCP inventory resolves");
      await click([...node.querySelectorAll<HTMLButtonElement>('.agent-capability-segment button')].find(button => button.textContent?.startsWith(i18n.t("settings.capabilityFilterProject"))));
      assert(textButton(node, i18n.t("settings.addMcp"))?.disabled, "Project Add stays disabled without a project");
      await click(textButton(node, i18n.t("settings.skillsManageProjects")));
      assert(useAppStore.getState().settingsTab === "projects", "No-project action reaches project management");
      checks.push("Empty MCP inventory, project creation guard and Manage Projects action");
      fixture = createCapabilitiesFixture(new URLSearchParams("subagentSave=error&subagentRefresh=error&mcpMarket=error&skillMarket=error"));


      await mount(<AgentSubagentsPage />);
      await until(() => node.querySelectorAll('.agent-capability-row').length > 1, "Subagent definitions load");
      const list = node.querySelector('.agent-capability-panel')!;
      const limits = [...node.querySelectorAll('section')].find(panel => panel.textContent?.includes(i18n.t("settings.subagentRuntimeLimits")))!;
      assert(list && limits && Boolean(list.compareDocumentPosition(limits) & Node.DOCUMENT_POSITION_FOLLOWING), "Runtime settings follow definitions");
      assert([...node.querySelectorAll('button')].filter(button => button.textContent === i18n.t("extensions.subagents.add")).length === 1, "Subagents has one add entry");
      const ownRow = [...node.querySelectorAll('.agent-capability-row')].find(row => row.textContent?.includes("fixture-reviewer"))!;
      await click(ownRow.querySelector<HTMLButtonElement>('button[aria-label="' + i18n.t("extensions.subagents.rowActions", { name: "fixture-reviewer" }) + '"]')!);
      await until(() => Boolean(document.querySelector('[role="dialog"]')), "Subagent editor opens");
      await type(dialog().querySelector<HTMLInputElement>('input')!, "updated-reviewer");
      await click(textButton(dialog(), i18n.t("common.save")));
      assert(dialog()?.querySelector<HTMLInputElement>('input')?.value === "updated-reviewer" && dialog()?.querySelector('[role="alert"]'), "Subagent failed save retains draft with nearby error");
      await click(textButton(dialog(), i18n.t("common.save")));
      await until(() => !document.querySelector('[role="dialog"]'), "Subagent save retry closes editor");
      assert(node.textContent?.includes(i18n.t("settings.saveState.refreshFailed")), "Subagent persistence success is distinguished from refresh failure");
      await click(textButton(node, i18n.t("errors.action.retry")));
      await until(() => node.textContent?.includes("updated-reviewer") === true && !node.querySelector('.settings-save-feedback'), "Subagent refresh retry restores the saved row");
      assert(fixture.calls.filter(call => call.channel === IPC.invoke.subagentUpdate).length === 2, "Subagent refresh retry cannot repeat the write");
      checks.push("Subagent list before limits, editor failure, save versus refresh failure and read-only retry");

      let back = 0;
      for (const [kind, component, prefix] of [
        ["mcp", <McpMarketPanel installedIds={[]} onBack={() => back++} onInstalled={() => {}} />, "mcpm"],
        ["skill", <SkillMarketPanel installedIds={[]} onBack={() => back++} onInstalled={() => {}} />, "sklm"],
      ] as const) {
        await mount(component);
        await until(() => Boolean(textButton(node, i18n.t("errors.action.retry"))), `${kind} market error exposes retry`);
        await click(textButton(node, i18n.t("errors.action.retry")));
        await until(() => !textButton(node, i18n.t("errors.action.retry")), `${kind} market retry recovers`);
        await type(node.querySelector<HTMLInputElement>(`.${prefix}-search input`)!, "no matching isolated catalog item");
        await until(() => Boolean(node.querySelector(`.${prefix}-empty`)), `${kind} market no matches`);
        await click(node.querySelector<HTMLButtonElement>(`.${prefix}-back`)!);
      }
      assert(back === 2, "Both markets preserve explicit return action");
      checks.push("Skill and MCP market failures, explicit retry, search and return");

      let values = ["fixture/a", "fixture/b"];
      const fallback = () => <SubagentFallbackModels primary="fixture/primary" values={values} choices={[]} onChange={(next) => { values = next; void mount(fallback()); }} />;
      await mount(fallback());
      await click(node.querySelector<HTMLButtonElement>('button[aria-label="' + i18n.t("extensions.subagents.fallbackMoveDown", { model: "fixture/a" }) + '"]')!);
      assert(values.join(",") === "fixture/b,fixture/a", "Fallback ordering follows explicit move");
      await click(node.querySelector<HTMLButtonElement>('button[aria-label="' + i18n.t("extensions.subagents.fallbackRemove", { model: "fixture/a" }) + '"]')!);
      assert(values.join(",") === "fixture/b", "Fallback remove targets selected model");
      checks.push("Fallback ordering and remove");
      checks.push(...await exerciseHostCollectionRaces({ mount, node, i18n }));
      return { ok: true, checks };
    } finally { window.piDesktop = previousBridge; }

  } finally { await act(async () => root.unmount()); node.remove(); Object.assign(api, original); }
};
