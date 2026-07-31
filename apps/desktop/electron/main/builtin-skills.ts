import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginSkillDoc } from "./plugin-runtime";
import { parseSkillDoc } from "./plugin-runtime";

/**
 * Skills PI-Desktop ships itself.
 *
 * These use the same prompt-injection path as plugin-contributed skills, so a
 * first-party skill and a third-party one are indistinguishable downstream —
 * but they need no permission grant, because the host is not a plugin.
 */

/** Bundled skill teaching the plugin-development loop. */
export const PLUGIN_DEV_SKILL_FILE = "plugin-development.md";
export const PLUGIN_DEV_SKILL_ID = "pi-desktop/plugin-development";

/** electron-builder copies `resources/skills` to `<resources>/skills`. */
function resolveBuiltinSkillPath(fileName: string): string | null {
  const candidates = [
    join(process.resourcesPath || "", "skills", fileName),
    join(__dirname, "../../resources/skills", fileName),
    join(__dirname, "../../../resources/skills", fileName),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * True when this workspace looks like plugin development: a plugin manifest at
 * the root, or a plugin already loaded from inside it.
 *
 * The gate matters. A plugin-authoring primer in every session would burn
 * context for the vast majority of sessions that never write a plugin; the
 * three plugin tools stay registered regardless, and calling one puts a
 * manifest in the workspace, which activates the skill on the next prompt.
 */
export function isPluginWorkspace(
  workspacePath: string | null | undefined,
  pluginPaths: string[] = [],
): boolean {
  if (!workspacePath) return false;
  const manifestPath = join(workspacePath, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (
        manifest &&
        typeof manifest === "object" &&
        typeof manifest.schemaVersion === "number" &&
        typeof manifest.main === "string"
      ) {
        return true;
      }
    } catch {
      // An unparseable manifest is not evidence either way.
    }
  }
  const prefix = workspacePath.endsWith("/") ? workspacePath : `${workspacePath}/`;
  return pluginPaths.some((path) => path === workspacePath || path.startsWith(prefix));
}

/** Front matter carries the skill's title and applicability line. */
function readBuiltinSkill(fileName: string): string | null {
  const path = resolveBuiltinSkillPath(fileName);
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export type BuiltinSkillInput = {
  workspacePath?: string | null;
  /** Directories of currently loaded plugins, used to detect a dev workspace. */
  pluginPaths?: string[];
};

/**
 * Built-in skills that apply to the given session, read fresh so a packaged
 * update takes effect without a restart.
 */
export function builtinSkills(input: BuiltinSkillInput): PluginSkillDoc[] {
  if (!isPluginWorkspace(input.workspacePath, input.pluginPaths)) return [];
  const raw = readBuiltinSkill(PLUGIN_DEV_SKILL_FILE);
  if (!raw?.trim()) return [];
  const parsed = parseSkillDoc(raw);
  if (!parsed.body) return [];
  return [
    {
      pluginId: "pi-desktop",
      pluginName: "PI-Desktop",
      id: PLUGIN_DEV_SKILL_ID,
      name: parsed.name ?? "PI-Desktop plugin development",
      description: parsed.description,
      body: parsed.body,
    },
  ];
}
