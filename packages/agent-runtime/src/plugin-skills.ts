/**
 * Plugin skills: instruction documents a plugin contributes to the agent's
 * system prompt through `contributes.skills`.
 *
 * Reading the files belongs to Electron main, which owns the plugin registry
 * and the permission grants; this module owns the shape, the byte budget and
 * the reuse digest so the sidecar and main agree on all three.
 */

/** Total budget across every contributed skill, separate from the 32 KiB instruction chain. */
export const MAX_PLUGIN_SKILL_TOTAL_BYTES = 16 * 1024;
/** Per-skill ceiling, so one verbose plugin cannot consume the whole budget. */
export const MAX_PLUGIN_SKILL_BYTES = 8 * 1024;

export type PluginSkill = {
  /** Contributing plugin id. */
  pluginId: string;
  /** Display name of the contributing plugin. */
  pluginName: string;
  /** Globally unique skill id, `<pluginId>/<skillId>`. */
  id: string;
  /** Skill title, from front matter or the manifest entry. */
  name?: string;
  /** One-line summary of when the skill applies. */
  description?: string;
  /** Instruction body, front matter already stripped. */
  body: string;
};

export type PluginSkills = {
  entries: PluginSkill[];
};

function limitUtf8(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return content;
  let bytes = 0;
  let end = 0;
  for (const char of content) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    bytes += charBytes;
    end += char.length;
  }
  return content.slice(0, end);
}

export type ClampOptions = {
  maxTotalBytes?: number;
  maxSkillBytes?: number;
};

/**
 * Trim a skill set to the prompt budget.
 *
 * Entries keep their order, each body is clamped to the per-skill ceiling, and
 * once the total budget is gone the remaining skills are dropped rather than
 * truncated to a useless stub.
 */
export function clampPluginSkills(
  entries: PluginSkill[],
  options: ClampOptions = {},
): PluginSkills | undefined {
  const maxTotal = Math.max(0, options.maxTotalBytes ?? MAX_PLUGIN_SKILL_TOTAL_BYTES);
  const maxSkill = Math.max(0, options.maxSkillBytes ?? MAX_PLUGIN_SKILL_BYTES);
  const kept: PluginSkill[] = [];
  let remaining = maxTotal;

  for (const entry of entries) {
    const body = entry.body.trim();
    if (!body) continue;
    const budget = Math.min(maxSkill, remaining);
    if (budget <= 0) break;
    const limited = limitUtf8(body, budget);
    if (!limited.trim()) break;
    kept.push({ ...entry, body: limited });
    remaining -= Buffer.byteLength(limited, "utf8");
  }

  return kept.length ? { entries: kept } : undefined;
}

/**
 * Stable fingerprint of a skill set.
 *
 * `AgentRuntime.matches()` compares this so enabling a plugin, revoking its
 * prompt permission or editing a skill file starts a fresh runtime instead of
 * silently reusing a session whose system prompt is already stale.
 */
export function pluginSkillsDigest(skills?: PluginSkills): string {
  if (!skills?.entries.length) return "";
  return skills.entries
    .map((entry) => `${entry.id}:${Buffer.byteLength(entry.body, "utf8")}:${hash(entry.body)}`)
    .join("|");
}

function hash(value: string): string {
  // FNV-1a: short, dependency-free, and only ever compared for equality.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
