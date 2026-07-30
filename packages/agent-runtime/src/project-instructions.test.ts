import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectInstructions } from "./project-instructions.js";
import { projectInstructionsPrompt } from "./project-instructions-prompt.js";

let root: string | undefined;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("loadProjectInstructions", () => {
  it("loads a non-empty workspace-root AGENTS.md", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-desktop-instructions-"));
    await writeFile(join(root, "AGENTS.md"), "Use pnpm for package commands.\n");

    await expect(loadProjectInstructions(root)).resolves.toBe(
      "Use pnpm for package commands.",
    );
  });

  it("treats missing and blank instruction files as absent", async () => {
    root = await mkdtemp(join(tmpdir(), "pi-desktop-instructions-"));
    await expect(loadProjectInstructions(root)).resolves.toBeUndefined();

    await writeFile(join(root, "AGENTS.md"), " \n\t ");
    await expect(loadProjectInstructions(root)).resolves.toBeUndefined();
  });
});

describe("projectInstructionsPrompt", () => {
  it("labels project instructions before adding them to the system prompt", () => {
    expect(projectInstructionsPrompt("Run focused tests.")).toBe(
      "# Project instructions\n\n" +
        "The following instructions come from the workspace-root AGENTS.md. Follow them when they apply to the task.\n\n" +
        "Run focused tests.",
    );
  });
});
