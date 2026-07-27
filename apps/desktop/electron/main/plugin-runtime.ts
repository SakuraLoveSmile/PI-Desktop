import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import {
  pluginToolName,
  validateManifest,
  type PluginManifest,
  type PluginModule,
} from "@pi-desktop/plugin-sdk";

export type RegisteredCommand = {
  id: string;
  title: string;
  category?: string;
  keywords?: string[];
  pluginId: string;
  run: () => Promise<void>;
};

export type RegisteredPluginTool = {
  fullName: string;
  pluginId: string;
  name: string;
  description: string;
  risk?: string;
  schema?: unknown;
  execute: (args: unknown) => Promise<unknown>;
};

export type PluginPanelRequest = {
  pluginId: string;
  title: string;
  width: number;
  height: number;
  htmlPath: string;
};

export type PluginHostServices = {
  getWorkspacePath: () => string | null;
  getLocale?: () => string;
  getAppVersion?: () => string;
  showToast: (message: string, level?: "info" | "warn" | "error") => void;
  notify: (input: { title: string; body?: string }) => void;
  openExternal: (url: string) => Promise<void>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  openPanel: (request: PluginPanelRequest) => Promise<void>;
  closePanel: (pluginId: string) => Promise<void>;
  fetch?: (input: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }) => Promise<{ status: number; headers: Record<string, string>; bodyText: string }>;
  audit?: (entry: Record<string, unknown>) => void;
};

type LoadedPlugin = {
  manifest: PluginManifest;
  path: string;
  permissions: Set<string>;
};

type PluginApiError = Error & { code?: string };

function apiError(code: string, message: string): PluginApiError {
  const err = new Error(message) as PluginApiError;
  err.code = code;
  return err;
}

function ensureWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw apiError("INVALID_ARGUMENT", "path escapes workspace root");
  }
  return resolved;
}

export class PluginRuntime {
  private commands = new Map<string, RegisteredCommand>();
  private tools = new Map<string, RegisteredPluginTool>();
  private loaded = new Map<string, LoadedPlugin>();
  private toasts: Array<{ message: string; level?: string }> = [];
  private services: PluginHostServices;

  constructor(services?: Partial<PluginHostServices>) {
    this.services = {
      getWorkspacePath: () => null,
      showToast: (message, level) => {
        this.toasts.push({ message, level });
      },
      notify: (input) => {
        this.toasts.push({ message: `${input.title}${input.body ? `: ${input.body}` : ""}` });
      },
      openExternal: async () => {
        throw apiError("UNSUPPORTED", "openExternal service missing");
      },
      readClipboard: async () => "",
      writeClipboard: async () => undefined,
      openPanel: async (request) => {
        this.toasts.push({ message: `Opened panel for ${request.pluginId}` });
      },
      closePanel: async () => undefined,
      ...services,
    };
  }

  setServices(services: Partial<PluginHostServices>): void {
    this.services = { ...this.services, ...services };
  }

  getCommands(): RegisteredCommand[] {
    return [...this.commands.values()];
  }

  getTools(): RegisteredPluginTool[] {
    return [...this.tools.values()];
  }

  getLoaded(pluginId: string): LoadedPlugin | undefined {
    return this.loaded.get(pluginId);
  }

  listLoaded(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }

  drainToasts(): string[] {
    const t = this.toasts.map((x) => x.message);
    this.toasts = [];
    return t;
  }

  async loadFromPath(
    pluginPath: string,
    grantedPermissions?: string[],
  ): Promise<PluginManifest> {
    const manifestPath = join(pluginPath, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new Error("PLUGIN_INVALID: manifest.json missing");
    }
    const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    const validated = validateManifest(raw);
    if (!validated.ok || !validated.manifest) {
      throw new Error(`PLUGIN_INVALID: ${validated.error}`);
    }
    const manifest = validated.manifest;
    await this.unload(manifest.id);

    const mainPath = join(pluginPath, manifest.main);
    if (!existsSync(mainPath)) {
      throw new Error("PLUGIN_LOAD_FAILED: main entry missing");
    }

    const require = createRequire(import.meta.url);
    let mod: PluginModule;
    try {
      delete require.cache[require.resolve(mainPath)];
      mod = require(mainPath) as PluginModule;
    } catch {
      mod = (await import(pathToFileURL(mainPath).href)) as PluginModule;
    }

    const declared = new Set(manifest.permissions ?? []);
    const granted = new Set(grantedPermissions ?? manifest.permissions ?? []);
    for (const perm of declared) {
      if (!granted.has(perm)) {
        // Install-time grants win; undeclared runtime use still fails later.
        granted.add(perm);
      }
    }

    const loaded: LoadedPlugin = {
      manifest,
      path: pluginPath,
      permissions: granted,
    };
    this.loaded.set(manifest.id, loaded);

    const api = this.createApi(loaded);
    (globalThis as any).pi = api;

    try {
      if (mod.onLoad) await mod.onLoad();
    } catch (error) {
      await this.unload(manifest.id);
      throw error;
    }
    return manifest;
  }

  async unload(pluginId: string): Promise<void> {
    for (const [id, cmd] of this.commands) {
      if (cmd.pluginId === pluginId) this.commands.delete(id);
    }
    for (const [name, tool] of this.tools) {
      if (tool.pluginId === pluginId) this.tools.delete(name);
    }
    this.loaded.delete(pluginId);
    await this.services.closePanel(pluginId);
  }

  async invokePanelBridge(
    pluginId: string,
    channel: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    const loaded = this.loaded.get(pluginId);
    if (!loaded) throw apiError("NOT_FOUND", `plugin not loaded: ${pluginId}`);
    const api = this.createApi(loaded);
    switch (channel) {
      case "ui.showToast":
        await api.ui.showToast(String(payload?.message ?? ""), payload?.level as any);
        return { ok: true };
      case "ui.notify":
        await api.ui.notify({
          title: String(payload?.title ?? "Plugin"),
          body: payload?.body ? String(payload.body) : undefined,
        });
        return { ok: true };
      case "ui.closePanel":
        await api.ui.closePanel();
        return { ok: true };
      case "fs.readText":
        return api.fs.readText(String(payload?.path ?? ""));
      case "fs.writeText":
        await api.fs.writeText(String(payload?.path ?? ""), String(payload?.content ?? ""));
        return { ok: true };
      case "fs.glob":
        return api.fs.glob(String(payload?.pattern ?? "*"));
      case "clipboard.readText":
        return api.clipboard.readText();
      case "clipboard.writeText":
        await api.clipboard.writeText(String(payload?.text ?? ""));
        return { ok: true };
      case "shell.openExternal":
        await api.shell.openExternal(String(payload?.url ?? ""));
        return { ok: true };
      case "net.fetch":
        return api.net.fetch({
          url: String(payload?.url ?? ""),
          method: payload?.method ? String(payload.method) : undefined,
          headers: (payload?.headers as Record<string, string> | undefined) ?? undefined,
          body: payload?.body ? String(payload.body) : undefined,
          timeoutMs: typeof payload?.timeoutMs === "number" ? payload.timeoutMs : undefined,
        });
      case "plugin.getSettings":
        return api.plugin.getSettings();
      case "workspace.get":
        return api.workspace.get();
      default:
        throw apiError("UNSUPPORTED", `unknown panel channel: ${channel}`);
    }
  }

  private assertPermission(loaded: LoadedPlugin, perm: string): void {
    if (!loaded.permissions.has(perm)) {
      this.services.audit?.({
        pluginId: loaded.manifest.id,
        api: perm,
        ok: false,
        errorCode: "PERMISSION_DENIED",
        ts: Date.now(),
      });
      throw apiError("PERMISSION_DENIED", `missing permission: ${perm}`);
    }
  }

  private createApi(loaded: LoadedPlugin) {
    const pluginId = loaded.manifest.id;
    const pluginPath = loaded.path;
    const self = this;

    const dataPath = () => {
      const root = process.env.PI_DESKTOP_DATA_DIR
        ? resolve(process.env.PI_DESKTOP_DATA_DIR)
        : join(homedir(), ".pi-desktop");
      const dir = join(root, "plugins", "data", pluginId.replace(/[^a-zA-Z0-9._-]/g, "_"));
      mkdirSync(dir, { recursive: true });
      return dir;
    };

    return {
      app: {
        getVersion: async () => this.services.getAppVersion?.() ?? "0.2.1",
        getLocale: async () => this.services.getLocale?.() ?? "en",
      },
      plugin: {
        getId: () => pluginId,
        getManifest: () => loaded.manifest,
        getSettings: async () => {
          const defaults: Record<string, unknown> = {};
          for (const s of loaded.manifest.contributes?.settings ?? []) {
            defaults[s.key] = s.default;
          }
          const file = join(dataPath(), "settings.json");
          if (!existsSync(file)) return defaults;
          try {
            return { ...defaults, ...JSON.parse(readFileSync(file, "utf8")) };
          } catch {
            return defaults;
          }
        },
        setSettings: async (partial: Record<string, unknown>) => {
          const current = await this.createApi(loaded).plugin.getSettings();
          const next = { ...current, ...partial };
          writeFileSync(join(dataPath(), "settings.json"), JSON.stringify(next, null, 2), "utf8");
        },
        getDataPath: async () => dataPath(),
      },
      commands: {
        register: async (command: {
          id: string;
          title: string;
          keywords?: string[];
          category?: string;
          run: () => Promise<void> | void;
        }) => {
          this.commands.set(command.id, {
            id: command.id,
            title: command.title,
            category: command.category,
            keywords: command.keywords,
            pluginId,
            run: async () => {
              await command.run();
            },
          });
        },
        unregister: async (id: string) => {
          this.commands.delete(id);
        },
      },
      ui: {
        openPanel: async (options?: { title?: string }) => {
          this.assertPermission(loaded, "ui.panel");
          const panel = loaded.manifest.ui?.panel;
          if (!panel) throw apiError("NOT_FOUND", "plugin does not declare ui.panel");
          const htmlPath = join(pluginPath, panel);
          if (!existsSync(htmlPath)) {
            throw apiError("NOT_FOUND", `panel html missing: ${panel}`);
          }
          await this.services.openPanel({
            pluginId,
            title: options?.title || loaded.manifest.ui?.title || loaded.manifest.name,
            width: loaded.manifest.ui?.width ?? 480,
            height: loaded.manifest.ui?.height ?? 360,
            htmlPath,
          });
          this.services.audit?.({
            pluginId,
            api: "ui.openPanel",
            ok: true,
            ts: Date.now(),
          });
        },
        closePanel: async () => {
          await this.services.closePanel(pluginId);
        },
        showToast: async (message: string, level?: "info" | "warn" | "error") => {
          this.services.showToast(message, level);
        },
        notify: async (input: { title: string; body?: string }) => {
          this.assertPermission(loaded, "notify");
          this.services.notify(input);
        },
      },
      workspace: {
        get: async () => {
          const path = this.services.getWorkspacePath();
          if (!path) return null;
          return { path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path };
        },
      },
      fs: {
        readText: async (pathFromWorkspaceRoot: string) => {
          this.assertPermission(loaded, "fs.read.workspace");
          const root = this.services.getWorkspacePath();
          if (!root) throw apiError("NOT_FOUND", "No workspace is open");
          const full = ensureWithinRoot(root, pathFromWorkspaceRoot);
          const content = readFileSync(full, "utf8");
          this.services.audit?.({
            pluginId,
            api: "fs.readText",
            ok: true,
            ts: Date.now(),
            path: pathFromWorkspaceRoot,
          });
          return content;
        },
        writeText: async (pathFromWorkspaceRoot: string, content: string) => {
          this.assertPermission(loaded, "fs.write.workspace");
          const root = this.services.getWorkspacePath();
          if (!root) throw apiError("NOT_FOUND", "No workspace is open");
          const full = ensureWithinRoot(root, pathFromWorkspaceRoot);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf8");
          this.services.audit?.({
            pluginId,
            api: "fs.writeText",
            ok: true,
            ts: Date.now(),
            path: pathFromWorkspaceRoot,
          });
        },
        glob: async (pattern: string) => {
          this.assertPermission(loaded, "fs.read.workspace");
          const root = this.services.getWorkspacePath();
          if (!root) throw apiError("NOT_FOUND", "No workspace is open");
          const matches: string[] = [];
          const visit = (dir: string, rel = "") => {
            for (const entry of readdirSync(dir)) {
              const full = join(dir, entry);
              const nextRel = rel ? `${rel}/${entry}` : entry;
              const st = statSync(full);
              if (st.isDirectory()) visit(full, nextRel);
              else if (matchGlob(nextRel, pattern)) matches.push(nextRel);
            }
          };
          visit(root);
          return matches.slice(0, 500);
        },
      },
      agent: {
        registerTool: async (tool: {
          name: string;
          description: string;
          risk?: "low" | "medium" | "high";
          schema?: unknown;
          execute: (args: unknown, ctx?: unknown) => Promise<unknown> | unknown;
        }) => {
          this.assertPermission(loaded, "agent.tool.register");
          const fullName = pluginToolName(pluginId, tool.name);
          this.tools.set(fullName, {
            fullName,
            pluginId,
            name: tool.name,
            description: tool.description,
            risk: tool.risk,
            schema: tool.schema,
            execute: async (args) => tool.execute(args, {
              sessionId: "unknown",
              log: (msg: string) => {
                self.services.audit?.({
                  pluginId,
                  api: "tool.log",
                  message: msg,
                  ts: Date.now(),
                });
              },
            }),
          });
        },
        unregisterTool: async (name: string) => {
          const fullName = pluginToolName(pluginId, name);
          this.tools.delete(fullName);
        },
      },
      clipboard: {
        readText: async () => {
          this.assertPermission(loaded, "clipboard.read");
          const text = await this.services.readClipboard();
          this.services.audit?.({
            pluginId,
            api: "clipboard.readText",
            ok: true,
            ts: Date.now(),
          });
          return text;
        },
        writeText: async (text: string) => {
          this.assertPermission(loaded, "clipboard.write");
          await this.services.writeClipboard(text);
          this.services.audit?.({
            pluginId,
            api: "clipboard.writeText",
            ok: true,
            ts: Date.now(),
          });
        },
      },
      shell: {
        openExternal: async (url: string) => {
          this.assertPermission(loaded, "shell.openExternal");
          if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
            throw apiError("INVALID_ARGUMENT", "only http(s)/mailto URLs allowed");
          }
          await this.services.openExternal(url);
          this.services.audit?.({
            pluginId,
            api: "shell.openExternal",
            ok: true,
            ts: Date.now(),
            url,
          });
        },
      },
      net: {
        fetch: async (input: {
          url: string;
          method?: string;
          headers?: Record<string, string>;
          body?: string;
          timeoutMs?: number;
        }) => {
          this.assertPermission(loaded, "net.fetch");
          if (!/^https?:\/\//i.test(input.url)) {
            throw apiError("INVALID_ARGUMENT", "only http(s) URLs allowed");
          }
          if (this.services.fetch) {
            const result = await this.services.fetch(input);
            this.services.audit?.({
              pluginId,
              api: "net.fetch",
              ok: true,
              ts: Date.now(),
              url: input.url,
              status: result.status,
            });
            return result;
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 15000);
          try {
            const res = await fetch(input.url, {
              method: input.method ?? "GET",
              headers: input.headers,
              body: input.body,
              signal: controller.signal,
            });
            const headers: Record<string, string> = {};
            res.headers.forEach((value, key) => {
              headers[key] = value;
            });
            const bodyText = await res.text();
            this.services.audit?.({
              pluginId,
              api: "net.fetch",
              ok: true,
              ts: Date.now(),
              url: input.url,
              status: res.status,
            });
            return { status: res.status, headers, bodyText };
          } finally {
            clearTimeout(timer);
          }
        },
      },
      events: {
        on: () => undefined,
        off: () => undefined,
      },
    };
  }
}

function matchGlob(path: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedPattern === "*" || normalizedPattern === "**/*") return true;
  const escape = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escape}$`, "i").test(normalizedPath);
}
