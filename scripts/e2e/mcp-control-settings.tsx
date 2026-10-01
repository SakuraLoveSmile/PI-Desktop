import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { McpControlStatus } from "@pi-desktop/shared";
import { AgentMcpPage } from "../../apps/desktop/src/components/settings/AgentMcpPage";
import { api } from "../../apps/desktop/src/lib/api";

declare global {
  var mcpControlSettingsProbe: () => Promise<unknown>;
}

const assert = (value: unknown, message: string): asserts value => {
  if (!value) throw new Error(message);
};

const frame = () => new Promise<void>((resolve) => {
  const timeout = setTimeout(resolve, 50);
  requestAnimationFrame(() => {
    clearTimeout(timeout);
    resolve();
  });
});

const waitFor = async (condition: () => boolean, label: string) => {
  const deadline = performance.now() + 5_000;
  while (!condition()) {
    assert(performance.now() < deadline, `timed out: ${label}`);
    await frame();
  }
};

type Fixture = {
  state: McpControlStatus;
  getFailures: number;
  setCalls: boolean[];
  nextSet: (() => Promise<McpControlStatus>) | null;
};

const status = (patch: Partial<McpControlStatus> = {}): McpControlStatus => ({
  enabled: false,
  running: false,
  source: "preference",
  connectionFile: "/tmp/pi-desktop-e2e/mcp-control.json",
  error: null,
  ...patch,
});

globalThis.mcpControlSettingsProbe = async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: catalogs.en } },
    interpolation: { escapeValue: false },
  });

  const fixture: Fixture = {
    state: status(),
    getFailures: 1,
    setCalls: [],
    nextSet: null,
  };
  const original = {
    listProjects: api.listProjects,
    listMcpServers: api.listMcpServers,
    onPluginChanged: api.onPluginChanged,
    onHostStatus: api.onHostStatus,
    mcpControlGet: api.mcpControlGet,
    mcpControlSet: api.mcpControlSet,
  };
  api.listProjects = async () => ({ projects: [] });
  api.listMcpServers = async () => ({ servers: [], statuses: [] });
  api.onPluginChanged = () => () => {};
  api.onHostStatus = () => () => {};
  api.mcpControlGet = async () => {
    if (fixture.getFailures > 0) {
      fixture.getFailures -= 1;
      throw new Error("host temporarily unavailable");
    }
    return structuredClone(fixture.state);
  };
  api.mcpControlSet = (enabled) => {
    fixture.setCalls.push(enabled);
    if (fixture.nextSet) return fixture.nextSet();
    throw new Error("unexpected control mutation");
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let key = 0;
  const render = () => {
    flushSync(() => root.render(
      <I18nextProvider i18n={i18n}>
        <AgentMcpPage key={++key} />
      </I18nextProvider>,
    ));
  };
  const scope = () => document.querySelector<HTMLElement>(".agent-mcp-scope");
  const toggle = () => scope()?.querySelector<HTMLButtonElement>('button[role="switch"]');
  const retry = () => [...(scope()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((button) => button.textContent?.includes("Retry"));
  const click = (element: HTMLElement | null | undefined, label: string) => {
    assert(element, `${label}: missing control`);
    flushSync(() => element.click());
  };

  try {
    // The first read fails. Re-entering the settings page retries the real read path.
    render();
    await waitFor(() => scope()?.textContent?.includes("State unavailable") === true, "initial read error");
    render();
    await waitFor(() => toggle()?.getAttribute("aria-checked") === "false", "read recovery");

    // The switch stays off while the host is still deciding, then follows its reply.
    let resolveEnable!: (value: McpControlStatus) => void;
    fixture.nextSet = () => new Promise((resolve) => { resolveEnable = resolve; });
    click(toggle(), "enable");
    await waitFor(() => toggle()?.getAttribute("aria-busy") === "true", "enable pending");
    assert(toggle()?.getAttribute("aria-checked") === "false", "toggle flipped before host response");
    resolveEnable(fixture.state = status({ enabled: true, running: true }));
    await waitFor(() => toggle()?.getAttribute("aria-checked") === "true", "enabled response");

    // A refused start is rendered as failed and exposes a retry action.
    fixture.state = status();
    render();
    await waitFor(() => toggle()?.getAttribute("aria-checked") === "false", "reset before failed start");
    fixture.nextSet = async () => {
      fixture.state = status({ enabled: true, running: false, error: "port 37123 is already in use" });
      return structuredClone(fixture.state);
    };
    click(toggle(), "enable with occupied port");
    await waitFor(() => toggle()?.getAttribute("aria-checked") === "true", "failed state value");
    assert(scope()?.getAttribute("role") === "presentation", "control strip lost presentation role");
    assert(scope()?.querySelector('[role="alert"]')?.textContent?.includes("port 37123") === true, "host failure missing");
    assert(retry(), "failed start did not expose retry");

    fixture.nextSet = async () => {
      fixture.state = status({ enabled: true, running: true });
      return structuredClone(fixture.state);
    };
    click(retry(), "retry");
    await waitFor(() => toggle()?.getAttribute("aria-checked") === "true" && !scope()?.querySelector('[role="alert"]'), "retry success");

    // Turning it off follows the host response too.
    fixture.nextSet = async () => {
      fixture.state = status();
      return structuredClone(fixture.state);
    };
    click(toggle(), "disable");
    await waitFor(() => toggle()?.getAttribute("aria-checked") === "false", "disabled response");

    // A launch environment override reports the effective state and disables the switch.
    fixture.state = status({ enabled: true, running: true, source: "environment" });
    fixture.nextSet = null;
    render();
    await waitFor(() => toggle()?.getAttribute("aria-checked") === "true", "environment override");
    assert(toggle()?.disabled === true, "environment override did not disable switch");
    assert(scope()?.textContent?.includes("Controlled by a launch argument") === true, "environment override label missing");

    return {
      ok: true,
      getRecovery: true,
      hostResponseGatedToggle: true,
      setCalls: fixture.setCalls,
      failedStartRetry: true,
      environmentOverride: true,
    };
  } finally {
    root.unmount();
    host.remove();
    api.listProjects = original.listProjects;
    api.listMcpServers = original.listMcpServers;
    api.onPluginChanged = original.onPluginChanged;
    api.onHostStatus = original.onHostStatus;
    api.mcpControlGet = original.mcpControlGet;
    api.mcpControlSet = original.mcpControlSet;
  }
};
