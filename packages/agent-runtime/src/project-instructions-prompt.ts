export function projectInstructionsPrompt(instructions?: string): string | undefined {
  const trimmed = instructions?.trim();
  if (!trimmed) return undefined;
  return [
    "# Project instructions",
    "",
    "The following instructions come from the workspace-root AGENTS.md. Follow them when they apply to the task.",
    "",
    trimmed,
  ].join("\n");
}
