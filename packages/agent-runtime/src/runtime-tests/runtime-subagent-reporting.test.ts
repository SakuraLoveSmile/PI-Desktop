import "./runtime-test-harness.js";
import { describe, it, vi, expect } from "vitest";
import { type SubagentDefinition, type UiMessage } from "@pi-desktop/shared";
import { subagentRuns, createRuntime } from "./runtime-test-harness.js";
import { explorer, taskTool } from "./subagent-fixtures.js";

describe("DesktopAgentRuntime subagents", () => {

  it("feeds finished reports back after the parent run ends", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);
    const prompt = vi.fn(async () => undefined);
    const waitForIdle = vi.fn(async () => undefined);
    (runtime as any).agent.prompt = prompt;
    (runtime as any).agent.waitForIdle = waitForIdle;

    await tool.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });

    const resume = (runtime as any).resumeAfterDelegations();
    subagentRuns.resolveRun!({
      agentName: "explorer",
      status: "completed",
      report: "src/app.ts:12 misses the null check.",
      turns: 2,
      toolCalls: 3,
    });
    await resume;

    expect(prompt).toHaveBeenCalledTimes(1);
    const delivered = String(
      (prompt.mock.calls as unknown as unknown[][])[0]?.[0] ?? "",
    );
    expect(delivered).toContain("src/app.ts:12 misses the null check.");
    expect(delivered).toContain("Integrate their reports");

    subagentRuns.deferred = false;
    await runtime.dispose();
  });

  it("feeds a report that settled before the parent idled (#226)", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);
    const prompt = vi.fn(async () => undefined);
    (runtime as any).agent.prompt = prompt;
    (runtime as any).agent.waitForIdle = vi.fn(async () => undefined);

    const started = await tool.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const delegationId = (started.details as any).delegationId as string;

    // The explorer finishes while the parent is still on its own line of work…
    subagentRuns.resolveRun!({
      agentName: "explorer",
      status: "completed",
      report: "src/app.ts:12 misses the null check.",
      turns: 1,
      toolCalls: 1,
    });
    await vi.waitFor(() => {
      expect((runtime as any).delegations.get(delegationId).status).toBe(
        "completed",
      );
    });
    expect((runtime as any).keepTurnOpenForDelegates()).toBe(true);

    // …and the parent then idles without a TaskWait. The settled report is
    // "done and unpublished", not "unfinished": it must still reach the parent.
    await (runtime as any).resumeAfterDelegations();

    expect(prompt).toHaveBeenCalledTimes(1);
    const delivered = String(
      (prompt.mock.calls as unknown as unknown[][])[0]?.[0] ?? "",
    );
    expect(delivered).toContain("src/app.ts:12 misses the null check.");
    expect((runtime as any).keepTurnOpenForDelegates()).toBe(false);

    // Single shot: a later idle does not replay it.
    await (runtime as any).resumeAfterDelegations();
    expect(prompt).toHaveBeenCalledTimes(1);

    subagentRuns.deferred = false;
    await runtime.dispose();
  });

  it("does not replay a report that TaskWait already returned", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const tool = taskTool(runtime);
    const wait = (runtime as any).agent.state.tools.find(
      (entry: any) => entry.name === "TaskWait",
    );
    const prompt = vi.fn(async () => undefined);
    (runtime as any).agent.prompt = prompt;
    (runtime as any).agent.waitForIdle = vi.fn(async () => undefined);

    const started = await tool.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const delegationId = (started.details as any).delegationId as string;
    subagentRuns.resolveRun!({
      agentName: "explorer",
      status: "completed",
      report: "src/app.ts:12 misses the null check.",
      turns: 1,
      toolCalls: 1,
    });
    await vi.waitFor(() => {
      expect((runtime as any).delegations.get(delegationId).status).toBe(
        "completed",
      );
    });

    const result = await wait.execute("wait-1", { delegationIds: [delegationId] });
    expect(result.content[0].text).toContain("src/app.ts:12 misses the null check.");
    expect((runtime as any).keepTurnOpenForDelegates()).toBe(false);

    await (runtime as any).resumeAfterDelegations();
    expect(prompt).not.toHaveBeenCalled();

    subagentRuns.deferred = false;
    await runtime.dispose();
  });

  it("auto-delivers TaskWait reports omitted by the bounded result", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const task = taskTool(runtime);
    const wait = (runtime as any).agent.state.tools.find(
      (entry: any) => entry.name === "TaskWait",
    );
    const prompt = vi.fn(async () => undefined);
    (runtime as any).agent.prompt = prompt;
    (runtime as any).agent.waitForIdle = vi.fn(async () => undefined);

    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = await task.execute(`task-${index}`, {
        agent: "explorer",
        task: "Find it.",
      });
      ids.push((started.details as any).delegationId as string);
    }
    for (let index = 0; index < 5; index += 1) {
      subagentRuns.resolveRun!({
        agentName: "explorer",
        status: "completed",
        report: `report-${index}-${"x".repeat(12_000)}`,
        turns: 1,
        toolCalls: 1,
      });
      await vi.waitFor(() => {
        expect((runtime as any).delegations.get(ids[index]).status).toBe(
          "completed",
        );
      });
    }

    const result = await wait.execute("wait-1", { delegationIds: ids });
    expect(result.content[0].text).toContain("more result");
    expect((runtime as any).delegations.get(ids[0]).reportDelivered).toBe(true);
    expect((runtime as any).delegations.get(ids[4]).reportDelivered).toBe(false);
    expect((runtime as any).keepTurnOpenForDelegates()).toBe(true);

    await (runtime as any).resumeAfterDelegations();

    expect(prompt).toHaveBeenCalledTimes(1);
    const delivered = String(
      (prompt.mock.calls as unknown as unknown[][])[0]?.[0] ?? "",
    );
    expect(delivered).toContain("report-4-");
    expect((runtime as any).delegations.get(ids[4]).reportDelivered).toBe(true);
    expect((runtime as any).keepTurnOpenForDelegates()).toBe(false);

    subagentRuns.deferred = false;
    await runtime.dispose();
  });

  it("lists a heartbeat for a running delegate", async () => {
    const runtime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    subagentRuns.instances.length = 0;
    subagentRuns.deferred = true;
    subagentRuns.resolveRun = undefined;
    const task = taskTool(runtime);
    const list = (runtime as any).agent.state.tools.find(
      (candidate: { name: string }) => candidate.name === "TaskList",
    );

    const started = await task.execute("task-1", {
      agent: "explorer",
      task: "Find it.",
    });
    const listed = await list.execute("list-1", {});
    expect(listed.content[0].text).toContain("running");
    expect(listed.content[0].text).toContain("explorer");
    expect(listed.content[0].text).toContain(
      (started.details as { delegationId: string }).delegationId,
    );

    subagentRuns.deferred = false;
    await runtime.dispose();
  });

  it("scopes a mutating delegate's tool calls with its permission", async () => {
    const mutator: SubagentDefinition = {
      name: "fixer",
      description: "Implement a multi-file change.",
      tools: ["Read", "Edit", "Write"],
      permission: "accept-edits",
      prompt: "Implement it.",
      source: "builtin",
    };
    const host = {
      call: vi.fn((method: string) => {
        if (method === "project.instructions.resolve") {
          return Promise.resolve(undefined);
        }
        if (method === "tools.execute") {
          return Promise.resolve({ ok: true, content: {} });
        }
        return Promise.resolve({ ok: true, content: {} });
      }),
      onNotification: vi.fn(() => () => {}),
    };
    const runtime = createRuntime({
      subagents: [mutator],
      host: host as never,
    });
    subagentRuns.calls.length = 0;
    const tool = taskTool(runtime);

    await tool.execute("task-1", { agent: "fixer", task: "Do it." });
    const options = subagentRuns.calls[0];
    // The delegate's tools are wrapped; the wrapper forwards the permission
    // scope into the host RPC while the call runs, then clears it.
    const wrappedRead = options.tools.find((entry: any) => entry.name === "Read");
    await wrappedRead.execute("read-1", { path: "src/app.ts" }, undefined, undefined);
    expect(host.call).toHaveBeenCalledWith(
      "tools.execute",
      expect.objectContaining({ permissionScope: "accept-edits" }),
    );
    expect((runtime as any).delegatePermissionScopes.has("read-1")).toBe(false);

    // Definitions without a permission stay unwrapped: the delegate's tools
    // are the catalog's own tools, so their RPC carries no scope.
    const plainRuntime = createRuntime({ subagents: [explorer] });
    subagentRuns.calls.length = 0;
    await taskTool(plainRuntime).execute("task-2", {
      agent: "explorer",
      task: "Find it.",
    });
    const plainOptions = subagentRuns.calls[0];
    expect(
      plainOptions.tools.some((entry: any) => entry.name === "Read"),
    ).toBe(true);

    await runtime.dispose();
    await plainRuntime.dispose();
  });

  it("keeps subagent rows out of the parent model context", async () => {
    const history: UiMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "Review the diff.",
        createdAt: "2026-08-06T00:00:00.000Z",
        status: "complete",
      },
      {
        id: "assistant-child",
        role: "assistant",
        content: "Reading src/app.ts",
        createdAt: "2026-08-06T00:00:01.000Z",
        status: "complete",
        parentToolCallId: "task-1",
        agentName: "reviewer",
      },
      {
        id: "assistant-parent",
        role: "assistant",
        content: "The reviewer found one issue.",
        createdAt: "2026-08-06T00:00:02.000Z",
        status: "complete",
      },
    ];
    const runtime = createRuntime({ subagents: [explorer], history });

    const ids = ((runtime as any).fullEntries as Array<any>).map(
      (entry) => entry.id,
    );
    expect(ids).toContain("user-1");
    expect(ids).toContain("assistant-parent");
    expect(ids).not.toContain("assistant-child");

    await runtime.dispose();
  });
});
