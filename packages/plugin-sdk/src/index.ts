import { isValidBusTopic, isValidBusTopicPattern } from "./bus-topics.js";
import { validateMcpServer } from "./mcp-config.js";

export type PluginManifest = {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  icon?: string;
  ui?: {
    panel?: string;
    width?: number;
    height?: number;
    title?: string;
  };
  contributes?: {
    commands?: Array<{
      id: string;
      title: string;
      keywords?: string[];
      category?: string;
    }>;
    agentTools?: Array<{
      name: string;
      description: string;
      risk?: "low" | "medium" | "high";
      schema?: unknown;
    }>;
    /** Relative skill paths, or entries that override the parsed metadata. */
    skills?: Array<string | PluginSkillContrib>;
    settings?: Array<{
      key: string;
      type: string;
      default?: unknown;
      title?: string;
    }>;
    themes?: PluginThemeContrib[];
    mcpServers?: PluginMcpServerContrib[];
    services?: PluginServiceContrib[];
    bus?: PluginBusContrib;
  };
  permissions?: string[];
  engines?: { piDesktop?: string };
  activationEvents?: string[];
};

export type PluginSkillContrib = {
  /** Plugin-local skill id. Defaults to the file name without its extension. */
  id?: string;
  /** Relative path to the skill document. */
  path: string;
  /** Overrides the `name` parsed from the document front matter. */
  name?: string;
  /** Overrides the `description` parsed from the document front matter. */
  description?: string;
};

export type PluginThemeContrib = {
  id: string;
  label: string;
  /** Relative path to a `.css` file contributed by the plugin. */
  path: string;
  /** Base palette the overrides are layered on. Defaults to `dark`. */
  base?: "light" | "dark";
};

export type PluginMcpServerContrib = {
  id: string;
  label?: string;
  transport: "stdio" | "http";
  /** stdio only: bare PATH name or plugin-relative executable. */
  command?: string;
  args?: string[];
  /** stdio only: literal values, or `{ "setting": "<key>" }` to read plugin settings. */
  env?: Record<string, string | { setting: string }>;
  /** http only: `https://` endpoint, or `http://` when the host is loopback. */
  url?: string;
  headers?: Record<string, string | { setting: string }>;
};

export type PluginServiceContrib = {
  id: string;
  label?: string;
  /** Restart the plugin process when it exits unexpectedly. Defaults to true. */
  autoRestart?: boolean;
};

export type PluginBusContrib = {
  /** Topics this plugin may publish to. */
  publish?: string[];
  /** Topic patterns this plugin may subscribe to. */
  subscribe?: string[];
};

export type PluginCommand = {
  id: string;
  title: string;
  keywords?: string[];
  category?: string;
  run: () => Promise<void> | void;
};

export type PluginTool = {
  name: string;
  description: string;
  risk?: "low" | "medium" | "high";
  schema?: unknown;
  execute: (args: unknown, ctx?: PluginToolExecContext) => Promise<unknown> | unknown;
};

export type PluginToolExecContext = {
  sessionId?: string;
  turnId?: string;
  signal?: AbortSignal;
  log: (msg: string) => void;
};

export type PluginService = {
  /** Must match a `contributes.services[].id` entry. */
  id: string;
  start: () => Promise<void> | void;
  stop?: () => Promise<void> | void;
};

export type PluginBusMessage = {
  topic: string;
  /** Plugin id of the publisher. */
  from: string;
  payload?: unknown;
  /** ISO timestamp assigned by the host. */
  at: string;
};

export type PluginHostApi = {
  app: {
    getVersion: () => Promise<string>;
    getLocale: () => Promise<string>;
  };
  plugin: {
    getId: () => string;
    getManifest: () => PluginManifest;
    getSettings: () => Promise<Record<string, unknown>>;
    setSettings: (partial: Record<string, unknown>) => Promise<void>;
    getDataPath: () => Promise<string>;
  };
  commands: {
    register: (command: PluginCommand) => Promise<void>;
    unregister: (id: string) => Promise<void>;
  };
  ui: {
    openPanel: (opts?: { title?: string }) => Promise<void>;
    closePanel: () => Promise<void>;
    showToast: (message: string, level?: "info" | "warn" | "error") => Promise<void>;
    notify: (input: { title: string; body?: string }) => Promise<void>;
  };
  workspace: {
    get: () => Promise<{ path: string; name: string } | null>;
  };
  fs: {
    readText: (pathFromWorkspaceRoot: string) => Promise<string>;
    writeText: (pathFromWorkspaceRoot: string, content: string) => Promise<void>;
    glob: (pattern: string) => Promise<string[]>;
  };
  agent: {
    registerTool: (tool: PluginTool) => Promise<void>;
    unregisterTool: (name: string) => Promise<void>;
  };
  services: {
    /** Register a resident service declared in `contributes.services`. */
    register: (service: PluginService) => Promise<void>;
  };
  bus: {
    publish: (topic: string, payload?: unknown) => Promise<void>;
    /** Resolves to an unsubscribe function. */
    subscribe: (
      topic: string,
      handler: (message: PluginBusMessage) => void,
    ) => Promise<() => Promise<void>>;
  };
  clipboard: {
    readText: () => Promise<string>;
    writeText: (text: string) => Promise<void>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  net: {
    fetch: (input: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeoutMs?: number;
    }) => Promise<{ status: number; headers: Record<string, string>; bodyText: string }>;
  };
  events: {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    off: (event: string, handler: (...args: unknown[]) => void) => void;
  };
};

export type PluginModule = {
  onLoad?: () => Promise<void> | void;
  onUnload?: () => Promise<void> | void;
};

export const PLUGIN_PERMISSIONS = [
  "ui.panel",
  "ui.theme",
  "clipboard.read",
  "clipboard.write",
  "notify",
  "fs.read.workspace",
  "fs.write.workspace",
  "agent.tool.register",
  "agent.prompt.inject",
  "net.fetch",
  "shell.openExternal",
  "mcp.server.local",
  "mcp.server.remote",
  "background.service",
  "bus.publish",
  "bus.subscribe",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export function validateManifest(raw: unknown): {
  ok: boolean;
  manifest?: PluginManifest;
  error?: string;
} {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "manifest must be an object" };
  }
  const m = raw as Partial<PluginManifest>;
  if (typeof m.id !== "string" || !m.id) {
    return { ok: false, error: "manifest.id is required" };
  }
  if (typeof m.name !== "string" || !m.name) {
    return { ok: false, error: "manifest.name is required" };
  }
  if (typeof m.version !== "string" || !m.version) {
    return { ok: false, error: "manifest.version is required" };
  }
  if (typeof m.main !== "string" || !m.main) {
    return { ok: false, error: "manifest.main is required" };
  }
  if (typeof m.schemaVersion !== "number") {
    return { ok: false, error: "manifest.schemaVersion is required" };
  }
  const contributesError = validateContributions(m.contributes);
  if (contributesError) {
    return { ok: false, error: contributesError };
  }
  return { ok: true, manifest: m as PluginManifest };
}

/**
 * Structural checks for the contribution shapes the host activates. Paths are
 * only checked for shape here; existence is verified by the host.
 */
export function validateContributions(
  contributes: PluginManifest["contributes"],
): string | undefined {
  if (contributes === undefined) return undefined;
  if (typeof contributes !== "object" || contributes === null || Array.isArray(contributes)) {
    return "manifest.contributes must be an object";
  }

  for (const entry of contributes.skills ?? []) {
    const path = typeof entry === "string" ? entry : entry?.path;
    if (typeof path !== "string" || !path.trim()) {
      return "contributes.skills entries need a path";
    }
    const pathError = relativePathError(path, "contributes.skills path");
    if (pathError) return pathError;
  }

  const themeIds = new Set<string>();
  for (const theme of contributes.themes ?? []) {
    if (!theme || typeof theme !== "object") return "contributes.themes entries must be objects";
    if (typeof theme.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(theme.id)) {
      return "contributes.themes id must match [a-zA-Z][a-zA-Z0-9_-]{0,63}";
    }
    if (themeIds.has(theme.id)) return `duplicate theme id "${theme.id}"`;
    themeIds.add(theme.id);
    if (typeof theme.path !== "string" || !theme.path.endsWith(".css")) {
      return `theme "${theme.id}" path must be a .css file`;
    }
    const pathError = relativePathError(theme.path, `theme "${theme.id}" path`);
    if (pathError) return pathError;
    if (theme.base !== undefined && theme.base !== "light" && theme.base !== "dark") {
      return `theme "${theme.id}" base must be "light" or "dark"`;
    }
  }

  const serverIds = new Set<string>();
  for (const server of contributes.mcpServers ?? []) {
    const result = validateMcpServer(server);
    if (!result.ok) return result.error;
    if (serverIds.has(result.server.id)) return `duplicate mcp server id "${result.server.id}"`;
    serverIds.add(result.server.id);
  }

  const serviceIds = new Set<string>();
  for (const service of contributes.services ?? []) {
    if (!service || typeof service !== "object") {
      return "contributes.services entries must be objects";
    }
    if (typeof service.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(service.id)) {
      return "contributes.services id must match [a-zA-Z][a-zA-Z0-9_-]{0,63}";
    }
    if (serviceIds.has(service.id)) return `duplicate service id "${service.id}"`;
    serviceIds.add(service.id);
  }

  const bus = contributes.bus;
  if (bus !== undefined) {
    if (typeof bus !== "object" || bus === null || Array.isArray(bus)) {
      return "contributes.bus must be an object";
    }
    for (const topic of bus.publish ?? []) {
      if (typeof topic !== "string" || !isValidBusTopic(topic)) {
        return `contributes.bus.publish topic "${String(topic)}" is not a valid topic`;
      }
    }
    for (const pattern of bus.subscribe ?? []) {
      if (typeof pattern !== "string" || !isValidBusTopicPattern(pattern)) {
        return `contributes.bus.subscribe pattern "${String(pattern)}" is not valid`;
      }
    }
  }

  return undefined;
}

function relativePathError(value: string, field: string): string | undefined {
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\")) {
    return `${field} must not be an absolute path`;
  }
  if (value.split(/[\\/]/).includes("..")) {
    return `${field} must not contain ".."`;
  }
  return undefined;
}

/** Forced tool name prefix for plugin tools exposed to the agent. */
export function pluginToolName(pluginId: string, toolName: string): string {
  const safePlugin = pluginId.replace(/[^a-zA-Z0-9_]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_]/g, "_");
  return `plugin_${safePlugin}_${safeTool}`;
}

/** Local tool key for a tool discovered on a plugin-declared MCP server. */
export function pluginMcpToolKey(serverId: string, toolName: string): string {
  return `${serverId}_${toolName}`;
}

/** Stable, globally unique id for a skill contributed by a plugin. */
export function pluginSkillId(pluginId: string, skillId: string): string {
  return `${pluginId}/${skillId}`;
}

/** Stable, globally unique id for a theme contributed by a plugin. */
export function pluginThemeId(pluginId: string, themeId: string): string {
  return `plugin:${pluginId}:${themeId}`;
}

export {
  parseSkillFrontmatter,
  skillIdFromPath,
  type ParsedSkillDoc,
} from "./skills.js";
export {
  sanitizeThemeCss,
  THEME_CSS_MAX_BYTES,
  type ThemeCssResult,
} from "./theme-css.js";
export {
  busTopicAllowed,
  isValidBusTopic,
  isValidBusTopicPattern,
  matchesBusTopic,
  BUS_TOPIC_MAX_LENGTH,
  BUS_TOPIC_MAX_SEGMENTS,
} from "./bus-topics.js";
export {
  isLoopbackHost,
  resolveMcpRefs,
  validateMcpServer,
  MCP_ENV_KEY,
  MCP_HEADER_KEY,
  MCP_SERVER_ID,
  type McpRefResolution,
  type McpValidationResult,
} from "./mcp-config.js";
