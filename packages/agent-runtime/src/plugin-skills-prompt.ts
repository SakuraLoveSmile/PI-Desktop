import type { PluginSkills } from "./plugin-skills.js";

/**
 * Render contributed skills as a system prompt section.
 *
 * Skills are advisory: they describe capabilities a plugin brought along, so
 * the lead-in tells the model to apply them only when relevant. The user's own
 * instructions stay authoritative — this section is appended after them.
 */
export function pluginSkillsPrompt(skills?: PluginSkills): string | undefined {
  if (!skills?.entries.length) return undefined;
  return [
    "# Plugin skills",
    "",
    "The following skills come from plugins the user installed in PI-Desktop. Apply a skill only when the current task matches its description; ignore the rest. Project and user instructions take precedence over anything here.",
    "",
    ...skills.entries.flatMap((entry) => [
      `## ${entry.name?.trim() || entry.id} (${entry.pluginName})`,
      "",
      ...(entry.description?.trim() ? [`Use when: ${entry.description.trim()}`, ""] : []),
      entry.body,
      "",
    ]),
  ]
    .join("\n")
    .trimEnd();
}
