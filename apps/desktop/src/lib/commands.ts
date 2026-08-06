import { api } from "./api";
import { useAppStore } from "../stores/app-store";
import type { Mode } from "@pi-desktop/shared";

/**
 * First-party command execution shared by the command palette and the
 * composer "/" dispatch (D123). Builtin ids run app actions locally; other
 * ids round-trip to the plugin runtime via commandPalette/execute.
 */
export async function runPaletteCommand(commandId: string): Promise<void> {
  const store = useAppStore.getState();
  switch (commandId) {
    case "builtin.newChat":
    case "builtin.session.new":
      await store.newSession();
      break;
    case "builtin.session.delete": {
      const id = store.activeSessionId;
      if (id) {
        await api.deleteSession(id);
        await store.refreshSessions();
        await store.newSession();
      }
      break;
    }
    case "builtin.agent.abort":
      await store.abort();
      break;
    case "builtin.agent.compact":
      await store.compactContext();
      break;
    case "builtin.mode.agent":
    case "builtin.mode.plan":
    case "builtin.mode.goal": {
      const mode: Mode = commandId.endsWith("plan")
        ? "plan"
        : commandId.endsWith("goal")
          ? "goal"
          : "agent";
      const activeSession = store.activeSessionId
        ? store.sessions.find((session) => session.id === store.activeSessionId)
        : undefined;
      if (activeSession) {
        await store.configureActiveSession({
          mode,
          providerId: activeSession.providerId,
          modelId: activeSession.modelId,
          thinkingLevel: activeSession.thinkingLevel,
        });
      } else if (store.settings) {
        // Keep the command useful from the empty home, where no session has
        // been created yet. The next session will inherit this default.
        const next = { ...store.settings, defaultMode: mode };
        await api.setSettings(next);
        useAppStore.setState({ settings: next });
      }
      break;
    }
    case "builtin.openProject":
    case "builtin.project.open":
      await store.openProject();
      break;
    case "builtin.project.clear":
      await store.clearProject();
      break;
    case "builtin.openSettings":
    case "builtin.settings.open":
      store.setPage("settings");
      break;
    case "builtin.settings.providers":
      store.setSettingsTab("agent");
      store.setPage("settings");
      break;
    case "builtin.settings.import":
      store.setSettingsTab("import");
      store.setPage("settings");
      break;
    case "builtin.plugins.open":
      store.setPage("plugins");
      break;
    case "builtin.plugins.loadDev":
      await api.loadDevPlugin();
      await store.refreshPlugins();
      break;
    case "builtin.logs.open":
      await api.openLogs();
      break;
    default:
      await api.executeCommand(commandId);
  }
}
