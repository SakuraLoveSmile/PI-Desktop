import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import { type CommandShellOption } from "@pi-desktop/shared";
import { commandShell, createRuntime, runtimeMatches } from "./runtime-test-harness.js";

describe("DesktopAgentRuntime configuration matching", () => {

  it("uses the active shell dialect in prompts and runtime reuse", async () => {
    const powershell: CommandShellOption = {
      id: "windows-powershell",
      label: "Windows PowerShell",
      dialect: "powershell",
      available: true,
      isDefault: true,
    };
    const runtime = createRuntime({ commandShell: powershell });
    const systemPrompt = (runtime as any).agent.state.systemPrompt as string;
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );

    expect(systemPrompt).toContain("Windows PowerShell");
    expect(systemPrompt).toContain("$env:PI_SCRATCH_DIR");
    expect(systemPrompt).not.toContain("Git Bash (POSIX bash on Windows)");
    expect(bash.description).toContain("Windows PowerShell");
    expect((bash.parameters as any).properties.timeout).toMatchObject({
      type: "number",
      minimum: 1,
      // Accepts a millisecond value so the runtime can read it as seconds.
      maximum: 100_000_000,
    });
    expect(runtimeMatches(runtime, { commandShell: powershell })).toBe(true);
    expect(runtimeMatches(runtime, { commandShell })).toBe(false);

    await runtime.dispose();
  });

  it("formats scratch directory with forward slashes for POSIX shells", async () => {
    const gitBash: CommandShellOption = {
      id: "git-bash",
      label: "Git Bash",
      dialect: "posix",
      available: true,
      isDefault: false,
    };
    const windowsScratch = "C:\\Users\\User\\.pi-desktop\\scratch\\sess-123";
    const runtime = createRuntime({
      commandShell: gitBash,
      scratchDir: windowsScratch,
    });
    const systemPrompt = (runtime as any).agent.state.systemPrompt as string;
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );

    const posixScratch = "C:/Users/User/.pi-desktop/scratch/sess-123";
    expect(systemPrompt).toContain(`\`${posixScratch}\``);
    expect(systemPrompt).toContain("in Bash: $PI_SCRATCH_DIR");
    expect(systemPrompt).not.toContain(windowsScratch);
    expect(bash.description).toContain(posixScratch);

    await runtime.dispose();
  });

  it("sends the default Bash timeout and preserves explicit overrides", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({ host });
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );
    expect(bash.description).toContain("60-second timeout");
    expect((bash.parameters as any).properties.timeout.description).toContain(
      "defaults to 60 seconds",
    );

    await bash.execute("bash-default", { command: "printf default" });
    const defaultCall = host.call.mock.calls.at(-1)!;
    expect(defaultCall[0]).toBe("tools.execute");
    expect(defaultCall[1]).toMatchObject({
      toolName: "Bash",
      expectedCommandShellId: "bash",
      expectedCommandShellDialect: "posix",
      timeoutMs: 60_000,
    });

    await bash.execute("bash-timeout", { command: "printf timed", timeout: 1.25 });
    const timedCall = host.call.mock.calls.at(-1)!;
    expect(timedCall[1]).toMatchObject({
      expectedCommandShellId: "bash",
      expectedCommandShellDialect: "posix",
      timeoutMs: 1_250,
    });

    await runtime.dispose();
  });

  it("accepts Bash timeout bounds and rejects invalid values before host execution", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({ host });
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );

    await bash.execute("bash-min", { command: "printf min", timeout: 1 });
    expect(host.call).toHaveBeenLastCalledWith(
      "tools.execute",
      expect.objectContaining({ timeoutMs: 1_000 }),
    );
    await bash.execute("bash-max", { command: "printf max", timeout: 21_600 });
    expect(host.call).toHaveBeenLastCalledWith(
      "tools.execute",
      expect.objectContaining({ timeoutMs: 21_600_000 }),
    );
    await bash.execute("bash-half-hour", { command: "printf half", timeout: 1_800 });
    expect(host.call).toHaveBeenLastCalledWith(
      "tools.execute",
      expect.objectContaining({ timeoutMs: 1_800_000 }),
    );

    for (const timeout of [Number.NaN, Number.POSITIVE_INFINITY, 0.999]) {
      await expect(
        bash.execute(`bash-invalid-${String(timeout)}`, {
          command: "printf invalid",
          timeout,
        }),
      ).rejects.toMatchObject({ errorCode: "INVALID_ARGUMENT" });
    }
    expect(host.call).toHaveBeenCalledTimes(3);
    await runtime.dispose();
  });

  it("reads a millisecond Bash timeout as seconds and clamps it to the ceiling", async () => {
    const host = {
      call: vi.fn().mockResolvedValue({ ok: true, content: "done" }),
    };
    const runtime = createRuntime({ host });
    const bash = (runtime as any).agent.state.tools.find(
      (tool: any) => tool.name === "Bash",
    );

    await bash.execute("bash-ms", { command: "printf ms", timeout: 120_000 });
    expect(host.call).toHaveBeenLastCalledWith(
      "tools.execute",
      expect.objectContaining({ timeoutMs: 120_000 }),
    );

    // 30 minutes in milliseconds: honour as 1800 seconds, no longer clamped to 300.
    await bash.execute("bash-ms-half-hour", {
      command: "printf over",
      timeout: 1_800_000,
    });
    expect(host.call).toHaveBeenLastCalledWith(
      "tools.execute",
      expect.objectContaining({ timeoutMs: 1_800_000 }),
    );

    // Above the honoured seconds ceiling once converted: clamp.
    await bash.execute("bash-ms-over", {
      command: "printf over",
      timeout: 30_000_000,
    });
    expect(host.call).toHaveBeenLastCalledWith(
      "tools.execute",
      expect.objectContaining({ timeoutMs: 21_600_000 }),
    );

    expect(host.call).toHaveBeenCalledTimes(3);
    await runtime.dispose();
  });

  it("accepts aliased tool argument names and folds them onto the canonical ones", async () => {
    const host = {
      call: vi.fn().mockImplementation(async (method: string) =>
        method === "project.instructions.resolve"
          ? { entries: [] }
          : { ok: true, content: "done" },
      ),
    };
    const runtime = createRuntime({ host });
    // Read the full registry so aliases can be exercised independently of the
    // active set selected for a particular session mode.
    const tool = (name: string) => (runtime as any).toolCatalog.get(name);

    for (const name of ["Read", "Write", "Edit"]) {
      expect((tool(name).parameters as any).properties.file_path).toMatchObject({
        type: "string",
      });
    }
    for (const name of ["Glob", "Grep"]) {
      expect((tool(name).parameters as any).properties.query).toMatchObject({
        type: "string",
      });
    }

    const lastExecute = () =>
      host.call.mock.calls
        .filter((call: unknown[]) => call[0] === "tools.execute")
        .at(-1)![1] as Record<string, unknown>;

    await tool("Read").execute("read-alias", {
      file_path: "src/a.ts",
      limit: 10,
    });
    expect(lastExecute()).toMatchObject({
      toolName: "Read",
      args: { path: "src/a.ts", limit: 10 },
    });

    await tool("Grep").execute("grep-alias", { query: "foo", path: "src" });
    expect(lastExecute()).toMatchObject({
      toolName: "Grep",
      args: { pattern: "foo", path: "src" },
    });

    // The canonical name wins when a call somehow carries both.
    await tool("Read").execute("read-both", {
      path: "src/canonical.ts",
      file_path: "src/alias.ts",
    });
    expect(lastExecute()).toMatchObject({ args: { path: "src/canonical.ts" } });

    // Extra path spellings weaker models reach for (issue #454): every one of
    // these folds onto `path` so the model does not silently fall back to Bash
    // when its tokenizer prefers a non-canonical argument name.
    for (const alias of ["filepath", "filePath", "filename", "fileName", "file"]) {
      await tool("Read").execute(`read-${alias}`, {
        [alias]: `src/${alias}.ts`,
      });
      expect(lastExecute()).toMatchObject({
        toolName: "Read",
        args: { path: `src/${alias}.ts` },
      });
      const seen = lastExecute().args as Record<string, unknown>;
      expect(seen[alias]).toBeUndefined();
    }

    // Neither spelling present still fails, and before any host execution.
    // The message now names the accepted aliases and shows a minimal example
    // so the next call can self-correct instead of falling back to shell.
    await expect(
      tool("Read").execute("read-missing", { limit: 5 }),
    ).rejects.toMatchObject({
      errorCode: "INVALID_ARGUMENT",
      message: expect.stringMatching(
        /`path` is required.*(file_path|filepath).*Example.*"path"/s,
      ),
    });
    expect(
      host.call.mock.calls.filter((call: unknown[]) => call[0] === "tools.execute"),
    ).toHaveLength(3 + 5);

    await runtime.dispose();
  });
});
