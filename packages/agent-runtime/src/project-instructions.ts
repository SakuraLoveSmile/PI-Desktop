import { readFile } from "node:fs/promises";
import { join } from "node:path";

const INSTRUCTION_FILE_NAME = "AGENTS.md";
const MAX_INSTRUCTION_CHARS = 64_000;

/**
 * Read the workspace-root AGENTS.md used to configure a PI-Desktop agent.
 * Missing or unreadable files intentionally behave as no project instructions.
 */
export async function loadProjectInstructions(
  workspaceRoot: string | null | undefined,
): Promise<string | undefined> {
  if (!workspaceRoot?.trim()) return undefined;

  try {
    const content = await readFile(join(workspaceRoot, INSTRUCTION_FILE_NAME), "utf8");
    const trimmed = content.trim();
    return trimmed ? trimmed.slice(0, MAX_INSTRUCTION_CHARS) : undefined;
  } catch {
    return undefined;
  }
}
