import { describe, expect, it } from "vitest";
import {
  pluginMcpToolKey,
  pluginSkillId,
  pluginThemeId,
  pluginToolName,
  resolvePluginLocalizedString,
  validateContributions,
  validateManifest,
  PLUGIN_PERMISSIONS,
} from "./index.js";

const base = { schemaVersion: 1, id: "demo.x", name: "X", version: "0.1.0", main: "main.js" };

describe("validateManifest", () => {
  it("accepts and resolves English/Chinese panel titles", () => {
    const result = validateManifest({
      ...base,
      ui: { panel: "renderer/index.html", title: { en: "Hello", "zh-CN": "你好" } },
    });
    expect(result.ok).toBe(true);
    expect(resolvePluginLocalizedString(result.manifest?.ui?.title, "en-US")).toBe("Hello");
    expect(resolvePluginLocalizedString(result.manifest?.ui?.title, "zh-CN")).toBe("你好");
  });

  it("requires both supported locales for localized panel titles", () => {
    expect(
      validateManifest({ ...base, ui: { title: { en: "Hello" } } }).error,
    ).toMatch(/zh-CN is required/);
  });

  it("accepts the new contribution shapes", () => {
    const result = validateManifest({
      ...base,
      contributes: {
        skills: ["./skills/a.md", { path: "skills/b.md", id: "b", name: "B" }],
        themes: [{ id: "midnight", label: "Midnight", path: "themes/midnight.css", base: "dark" }],
        mcpServers: [{ id: "files", transport: "stdio", command: "mcp-files" }],
        services: [{ id: "watcher", autoRestart: true }],
        bus: { publish: ["notes.created"], subscribe: ["notes.**"] },
      },
    });
    expect(result.ok).toBe(true);
  });

  it("surfaces contribution errors", () => {
    expect(
      validateManifest({ ...base, contributes: { themes: [{ id: "a", label: "A", path: "a.json" }] } })
        .error,
    ).toMatch(/\.css file/);
    expect(validateManifest({ ...base, contributes: { skills: ["../escape.md"] } }).error).toMatch(
      /\.\./,
    );
  });
});

describe("validateContributions", () => {
  it("passes when absent", () => {
    expect(validateContributions(undefined)).toBeUndefined();
  });

  it("rejects duplicate ids", () => {
    expect(
      validateContributions({
        themes: [
          { id: "a", label: "A", path: "a.css" },
          { id: "a", label: "A2", path: "b.css" },
        ],
      }),
    ).toMatch(/duplicate theme id/);
    expect(
      validateContributions({ services: [{ id: "s" }, { id: "s" }] }),
    ).toMatch(/duplicate service id/);
    expect(
      validateContributions({
        mcpServers: [
          { id: "m", transport: "stdio", command: "x" },
          { id: "m", transport: "stdio", command: "y" },
        ],
      }),
    ).toMatch(/duplicate mcp server id/);
  });

  it("rejects invalid bus declarations", () => {
    expect(validateContributions({ bus: { publish: ["notes.*"] } })).toMatch(/valid topic/);
    expect(validateContributions({ bus: { subscribe: ["notes.**.x"] } })).toMatch(/not valid/);
  });

  it("rejects malformed skill and service entries", () => {
    expect(validateContributions({ skills: [{ path: "" } as never] })).toMatch(/need a path/);
    expect(validateContributions({ services: [{ id: "1bad" }] })).toMatch(/id must match/);
  });

  it("accepts plugin-local shortcut settings and rejects undeclared commands", () => {
    expect(
      validateContributions({
        commands: [{ id: "demo.open", title: "Open" }],
        settings: [
          {
            key: "openShortcut",
            title: "Open shortcut",
            type: "shortcut",
            default: "Mod+Shift+O",
            command: "demo.open",
            scope: "plugin",
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      validateContributions({
        settings: [
          { key: "openShortcut", title: "Open shortcut", type: "shortcut", command: "demo.open" },
        ],
      }),
    ).toMatch(/undeclared command/);
  });
});

describe("naming helpers", () => {
  it("keeps the forced plugin tool prefix", () => {
    expect(pluginToolName("demo.hello", "echo-text")).toBe("plugin_demo_hello_echo_text");
    expect(pluginToolName("demo.hello", pluginMcpToolKey("files", "read_file"))).toBe(
      "plugin_demo_hello_files_read_file",
    );
  });

  it("namespaces skills and themes by plugin", () => {
    expect(pluginSkillId("demo.hello", "release")).toBe("demo.hello/release");
    expect(pluginThemeId("demo.hello", "midnight")).toBe("plugin:demo.hello:midnight");
  });
});

describe("PLUGIN_PERMISSIONS", () => {
  it("declares the capability permissions and stays unique", () => {
    for (const permission of [
      "ui.theme",
      "mcp.server.local",
      "mcp.server.remote",
      "background.service",
      "bus.publish",
      "bus.subscribe",
      "agent.prompt.inject",
      "fs.delete.workspace",
    ]) {
      expect(PLUGIN_PERMISSIONS).toContain(permission);
    }
    expect(new Set(PLUGIN_PERMISSIONS).size).toBe(PLUGIN_PERMISSIONS.length);
  });
});
