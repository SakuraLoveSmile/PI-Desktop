import "./runtime-test-harness.js";
import { describe, it, expect, vi } from "vitest";
import {
  type UiMessage,
  type AgentEventEnvelope,
  MAX_RESUMABLE_CHAINS_PER_AGENT,
} from "@pi-desktop/shared";
import { DesktopAgentRuntime, type RuntimeProviderConfig } from "../runtime.js";
import { subagentRuns, provider, createRuntime } from "./runtime-test-harness.js";
import { explorer, taskTool } from "./subagent-fixtures.js";
import { toolResult } from "./context-protection-fixtures.js";

describe("DesktopAgentRuntime subagents", () => {

  describe("resume (ADR 0279)", () => {
    /** Rows a delegate left in the transcript, tagged with its `Task` call. */
    function delegateRow(
      id: string,
      parentToolCallId: string,
      overrides: Partial<UiMessage> = {},
    ): UiMessage {
      return {
        id,
        role: "assistant",
        content: "reading src/app.ts",
        createdAt: "2026-08-06T00:00:01.000Z",
        status: "complete",
        parentToolCallId,
        agentName: "explorer",
        ...overrides,
      };
    }

    async function startTask(
      runtime: DesktopAgentRuntime,
      toolCallId: string,
      args: Record<string, unknown>,
    ) {
      return taskTool(runtime).execute(toolCallId, args);
    }

    it("seeds a resumed run with the chain's prior messages and keeps its model", async () => {
      const history: UiMessage[] = [
        delegateRow("child-1", "task-1"),
        {
          id: "tool-1",
          role: "tool",
          content: "",
          createdAt: "2026-08-06T00:00:02.000Z",
          toolCallId: "read-1",
          toolName: "Read",
          toolArgs: { path: "src/app.ts" },
          toolResult: {
            content: [{ type: "text", text: "line one\nline two" }],
          },
          toolStatus: "success",
          parentToolCallId: "task-1",
          agentName: "explorer",
        },
      ];
      const runtime = createRuntime({ subagents: [explorer], history });
      (runtime as any).transcriptHistory.push({
        id: "task-1",
        role: "tool",
        content: "",
        createdAt: "2026-08-06T00:00:00.000Z",
        toolCallId: "task-1",
        toolName: "Task",
        toolArgs: { agent: "explorer", task: "Explore the parser." },
        toolResult: { details: { delegationId: "del-1", agent: "explorer" } },
        toolStatus: "success",
      });
      (runtime as any).delegationChains.hydrate(
        (await import("../delegation-history.js")).rebuildChainsFromTranscript(
          (runtime as any).transcriptHistory,
        ),
      );

      subagentRuns.calls.length = 0;
      subagentRuns.deferred = true;
      const started = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "Now cover the lexer.",
        resume: "del-1",
      });
      subagentRuns.deferred = false;

      expect((started.details as any).resumedFrom).toBe("del-1");
      expect(subagentRuns.calls).toHaveLength(1);
      const options = subagentRuns.calls[0];
      // The resumed delegate replays the original brief plus its own rows; the
      // new brief is the user turn `prompt()` adds, not part of the seed.
      expect(options.task).toBe("Now cover the lexer.");
      expect(options.initialMessages[0]).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "Explore the parser." }],
      });
      expect(
        options.initialMessages.some(
          (message: any) =>
            message.role === "assistant" &&
            message.content.some(
              (block: any) => block.type === "toolCall" && block.name === "Read",
            ),
        ),
      ).toBe(true);
      const internals = runtime as any;
      const delegationId = (started.details as any).delegationId as string;
      const record = internals.delegations.get(delegationId);
      expect(record.resumedFrom).toBe("del-1");
      expect(record.delegateSessionId).toBe("del-1");
      // The chain owns its calls now (ADR 0279); the id resolves to both.
      expect(internals.delegationChains.lookup(delegationId).toolCallIds).toEqual([
        "task-1",
        "task-2",
      ]);

      await runtime.dispose();
    });

    it("rejects a model override on resume", async () => {
      const history: UiMessage[] = [delegateRow("child-1", "task-1")];
      const runtime = createRuntime({ subagents: [explorer], history });
      (runtime as any).transcriptHistory.push({
        id: "task-1",
        role: "tool",
        content: "",
        createdAt: "2026-08-06T00:00:00.000Z",
        toolCallId: "task-1",
        toolName: "Task",
        toolArgs: { agent: "explorer", task: "Explore." },
        toolResult: { details: { delegationId: "del-1" } },
        toolStatus: "success",
      });

      subagentRuns.calls.length = 0;
      const result = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "More.",
        resume: "del-1",
        model: "local/local-model",
      });

      expect(String((result.details as any).error)).toContain(
        "cannot change its model",
      );
      expect(subagentRuns.calls).toHaveLength(0);
      await runtime.dispose();
    });

    it("reports an unknown resume id without starting a delegate", async () => {
      const runtime = createRuntime({ subagents: [explorer] });
      subagentRuns.calls.length = 0;
      const result = await startTask(runtime, "task-1", {
        agent: "explorer",
        task: "Continue.",
        resume: "missing",
      });
      const message = String((result.details as any).error);
      expect(message).toContain("Unknown delegation");
      expect(message).toContain("No reusable subagent sessions");
      expect(subagentRuns.calls).toHaveLength(0);
      await runtime.dispose();
    });

    it("refuses to resume a running delegation", async () => {
      const runtime = createRuntime({ subagents: [explorer] });
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = true;
      const first = await startTask(runtime, "task-1", {
        agent: "explorer",
        task: "Find it.",
      });
      const delegationId = (first.details as any).delegationId as string;
      const second = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "Again.",
        resume: delegationId,
      });
      expect(String((second.details as any).error)).toContain("still running");
      expect(subagentRuns.calls).toHaveLength(1);
      subagentRuns.resolveRun?.({
        agentName: "explorer",
        status: "completed",
        report: "done",
        turns: 1,
        toolCalls: 0,
      });
      subagentRuns.deferred = false;
      await runtime.dispose();
    });

    it("marks a chain resumable only after it settles", async () => {
      const runtime = createRuntime({ subagents: [explorer] });
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = true;
      const started = await startTask(runtime, "task-1", {
        agent: "explorer",
        task: "Find it.",
      });
      const delegationId = (started.details as any).delegationId as string;
      const internals = runtime as any;
      expect(
        internals.delegationChains.lookup(delegationId).latestStatus,
      ).toBe("running");
      subagentRuns.resolveRun?.({
        agentName: "explorer",
        status: "completed",
        report: "done",
        turns: 1,
        toolCalls: 0,
      });
      await vi.waitFor(() => {
        expect(
          internals.delegationChains.lookup(delegationId).latestStatus,
        ).toBe("completed");
      });
      subagentRuns.deferred = false;
      await runtime.dispose();
    });

    it("lists a settled delegation in the parent's system prompt", async () => {
      const runtime = createRuntime({ subagents: [explorer] });
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = true;
      const started = await startTask(runtime, "task-1", {
        agent: "explorer",
        task: "Find it.",
        description: "find the bug",
      });
      const delegationId = (started.details as any).delegationId as string;
      subagentRuns.resolveRun?.({
        agentName: "explorer",
        status: "completed",
        report: "done",
        turns: 1,
        toolCalls: 0,
      });
      await vi.waitFor(() => {
        expect((runtime as any).agent.state.systemPrompt).toContain(
          `explorer / ${delegationId}: find the bug`,
        );
      });
      subagentRuns.deferred = false;
      await runtime.dispose();
    });

    /** A `Task` row a restart rebuilds its chains from. */
    function restartedTaskRow(
      taskCallId: string,
      delegationId: string,
      details: Record<string, unknown> = {},
    ): UiMessage {
      return {
        id: `row-${taskCallId}`,
        role: "tool",
        content: "",
        createdAt: "2026-08-06T00:00:00.000Z",
        toolCallId: taskCallId,
        toolName: "Task",
        toolArgs: { agent: "explorer", task: "Explore the parser." },
        toolResult: {
          details: { delegationId, agent: "explorer", ...details },
        },
        toolStatus: "success",
      };
    }

    /** The envelope shape a delegate's own `SubagentRun` sends. */
    function delegateEnvelope(
      parentToolCallId: string,
      event: Record<string, unknown>,
    ): AgentEventEnvelope {
      return {
        sessionId: "session-1",
        turnId: "turn-1",
        ts: Date.now(),
        event: event as unknown as AgentEventEnvelope["event"],
        parentToolCallId,
        agentName: "explorer",
      };
    }

    it("records a delegate's reads in-session so the same session can resume them", async () => {
      const runtime = createRuntime({ subagents: [explorer] });
      const internals = runtime as any;
      subagentRuns.calls.length = 0;
      subagentRuns.instances.length = 0;
      subagentRuns.result = undefined;
      subagentRuns.deferred = true;

      const started = await startTask(runtime, "task-1", {
        agent: "explorer",
        task: "Find it.",
        description: "find the bug",
      });
      const delegationId = (started.details as any).delegationId as string;
      // A live delegate's tool events reach the runtime through the Task wiring.
      const onEvent = subagentRuns.calls[0].onEvent as (
        envelope: AgentEventEnvelope,
      ) => void;
      onEvent(
        delegateEnvelope("task-1", {
          type: "tool_start",
          toolCallId: "read-1",
          toolName: "Read",
          args: { path: "src/deep.ts" },
        }),
      );
      onEvent(
        delegateEnvelope("task-1", {
          type: "tool_end",
          toolCallId: "read-1",
          result: { content: [{ type: "text", text: "line one\nline two" }] },
          isError: false,
        }),
      );

      // The row a later resume replays keeps the call's arguments.
      const row = (internals.transcriptHistory as UiMessage[]).find(
        (entry) => entry.toolCallId === "read-1",
      );
      expect(row).toMatchObject({
        role: "tool",
        toolName: "Read",
        toolArgs: { path: "src/deep.ts" },
        parentToolCallId: "task-1",
        agentName: "explorer",
      });
      expect(internals.delegationChains.lookup(delegationId)).toMatchObject({
        readFiles: ["src/deep.ts"],
        readLineCount: 2,
      });

      subagentRuns.resolveRun?.({
        agentName: "explorer",
        status: "completed",
        report: "done",
        turns: 1,
        toolCalls: 1,
      });
      await vi.waitFor(() => {
        expect(internals.agent.state.systemPrompt).toContain(
          "Files read: src/deep.ts",
        );
      });
      expect(internals.agent.state.systemPrompt).not.toContain(
        "Files read: none recorded",
      );
      expect(
        internals.delegationChains
          .resumableList({ runningDelegationIds: new Set() })
          .find(
            (chain: { latestDelegationId: string }) =>
              chain.latestDelegationId === delegationId,
          )?.readFiles,
      ).toEqual(["src/deep.ts"]);

      // No restart in between: the same runtime resumes and replays that read.
      subagentRuns.calls.length = 0;
      const resumed = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "Now the rest.",
        resume: delegationId,
      });
      expect((resumed.details as any).resumedFrom).toBe(delegationId);
      expect(subagentRuns.calls).toHaveLength(1);
      const initial = subagentRuns.calls[0].initialMessages as Array<any>;
      expect(
        initial.some(
          (message: any) =>
            message.role === "assistant" &&
            message.content.some(
              (block: any) =>
                block.type === "toolCall" && block.arguments?.path === "src/deep.ts",
            ),
        ),
      ).toBe(true);

      subagentRuns.deferred = false;
      await runtime.dispose();
    });

    it("refuses to resume a chain a restart rebuilt from a stopped Task row", async () => {
      const history: UiMessage[] = [
        restartedTaskRow("task-1", "del-1", { status: "stopped" }),
        delegateRow("child-1", "task-1"),
      ];
      const runtime = createRuntime({ subagents: [explorer], history });
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = false;

      const result = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "Continue.",
        resume: "del-1",
      });

      expect(String((result.details as any).error)).toContain(
        'ended as "stopped"',
      );
      expect(String((result.details as any).error)).toContain("cannot be resumed");
      expect(subagentRuns.calls).toHaveLength(0);
      await runtime.dispose();
    });

    it("resumes a chain a restart rebuilt from a completed Task row", async () => {
      const history: UiMessage[] = [
        restartedTaskRow("task-1", "del-1", { status: "completed" }),
        delegateRow("child-1", "task-1"),
      ];
      const runtime = createRuntime({ subagents: [explorer], history });
      subagentRuns.calls.length = 0;
      subagentRuns.result = undefined;
      subagentRuns.deferred = false;

      const result = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "Continue.",
        resume: "del-1",
      });

      expect((result.details as any).error).toBeUndefined();
      expect((result.details as any).resumedFrom).toBe("del-1");
      expect(subagentRuns.calls).toHaveLength(1);
      expect(subagentRuns.calls[0].initialMessages).toBeDefined();
      await runtime.dispose();
    });

    it.each(["session", "opt-in", "definition", "fallback", "missing"])("resumes only an authorized %s binding with a colliding private pin (#841)", async (source) => {
      const privatePin = { ...provider, id: "other-account", modelId: "recorded-model", modelConfig: undefined };
      const authorized = { ...privatePin, id: "authorized-account" };
      const own = { providerId: authorized.id, modelId: authorized.modelId };
      const target = {
        ...explorer,
        ...(source === "definition" ? { model: own } : {}),
        ...(source === "fallback" ? { fallbackModels: [own] } : {}),
      };
      const runtime = createRuntime({
        provider: source === "session" ? authorized : provider,
        subagents: [target],
        subagentProviders: {
          "other/recorded-model": privatePin,
          ...(source !== "missing" ? { "authorized-account/recorded-model": authorized } : {}),
        },
        subagentModelKeys: source === "opt-in" ? ["authorized-account/recorded-model"] : [],
        history: [restartedTaskRow("task-1", "del-1", { status: "completed", modelId: "recorded-model" }), delegateRow("child-1", "task-1")],
      });
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = false;
      try {
        const result = await startTask(runtime, "task-2", { agent: "explorer", task: "Continue.", resume: "del-1" });
        expect(result.details.error).toBeUndefined();
        expect(subagentRuns.calls[0].provider).toBe(source === "missing" ? provider : authorized);
        const records = (runtime as unknown as { delegations: Map<string, { modelChangedFrom?: string }> }).delegations;
        expect(records.get(result.details.delegationId)?.modelChangedFrom).toBe(source === "missing" ? "recorded-model" : undefined);
      } finally { await runtime.dispose(); }
    });

    it.each([true, false])("reauthorizes a live resume key after its turn grant expires: allowed=%s (#841)", async (allowed) => {
      const selected = { ...provider, id: "dynamic", modelId: "dynamic-model", modelConfig: undefined };
      const host = { call: allowed ? vi.fn().mockResolvedValue(selected) : vi.fn().mockRejectedValue(new Error("revoked")) };
      const runtime = createRuntime({
        subagents: [explorer], host,
        history: [restartedTaskRow("task-1", "del-1", { status: "completed", modelId: selected.modelId }), delegateRow("child-1", "task-1")],
      });
      const registry = (runtime as unknown as { delegationChains: { lookup(id: string): { latestModelKey?: string } | undefined } }).delegationChains;
      const chain = registry.lookup("del-1");
      if (!chain) throw new Error("fixture chain missing");
      chain.latestModelKey = "dynamic/dynamic-model";
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = false;
      try {
        await startTask(runtime, "task-2", { agent: "explorer", task: "Continue.", resume: "del-1" });
        expect(host.call).toHaveBeenCalledWith("provider.resolveSubagentModel", { key: "dynamic/dynamic-model" });
        expect(subagentRuns.calls[0].provider).toBe(allowed ? selected : provider);
      } finally { await runtime.dispose(); }
    });

    it("does not start a resumed delegate after Stop during authorization (#841)", async () => {
      let resolveGrant: (value: RuntimeProviderConfig) => void = () => {};
      const host = { call: vi.fn().mockImplementation(() => new Promise<RuntimeProviderConfig>((resolve) => { resolveGrant = resolve; })) };
      const runtime = createRuntime({ subagents: [explorer], host,
        history: [restartedTaskRow("task-1", "del-1", { status: "completed", modelId: provider.modelId }), delegateRow("child-1", "task-1")],
      });
      const registry = (runtime as unknown as { delegationChains: { lookup(id: string): { latestModelKey?: string } | undefined } }).delegationChains;
      const chain = registry.lookup("del-1");
      if (!chain) throw new Error("fixture chain missing");
      chain.latestModelKey = "dynamic/local-model";
      subagentRuns.calls.length = 0;
      try {
        const pending = startTask(runtime, "task-2", { agent: "explorer", task: "Continue.", resume: "del-1" });
        await runtime.abort();
        resolveGrant(provider);
        expect((await pending).details.error).toContain("parent turn ended");
        expect(subagentRuns.calls).toHaveLength(0);
      } finally { await runtime.dispose(); }
    });

    it("allows only one parallel resume while model authorization yields (#841)", async () => {
      const runtime = createRuntime({
        subagents: [explorer],
        history: [restartedTaskRow("task-1", "del-1", { status: "completed", modelId: provider.modelId }), delegateRow("child-1", "task-1")],
      });
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = true;
      try {
        const results = await Promise.all(["task-2", "task-3"].map((id) => startTask(runtime, id, { agent: "explorer", task: "Continue.", resume: "del-1" })));
        expect(results.filter((result) => !result.details.error)).toHaveLength(1);
        expect(results.find((result) => result.details.error)?.details.error).toContain("still running");
        expect(subagentRuns.calls).toHaveLength(1);
      } finally { subagentRuns.deferred = false; await runtime.dispose(); }
    });

    it("keeps a resumed chain on its recorded model after the session model moved", async () => {
      const remote = {
        ...provider,
        id: "remote",
        name: "Remote",
        modelId: "remote-model",
        modelConfig: undefined,
      };
      const moved = { ...provider, modelId: "next-model", modelConfig: undefined };
      const history: UiMessage[] = [
        restartedTaskRow("task-1", "del-1", {
          status: "completed",
          modelId: "remote-model",
        }),
        delegateRow("child-1", "task-1"),
      ];
      const runtime = createRuntime({
        provider: moved,
        subagents: [explorer],
        history,
        subagentProviders: { "remote/remote-model": remote },
        subagentModelKeys: ["remote/remote-model"],
      });
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = true;

      const result = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "Continue.",
        resume: "del-1",
      });

      // The session model is no reason to refuse: the chain keeps its own.
      expect((result.details as any).error).toBeUndefined();
      expect((result.details as any).resumedFrom).toBe("del-1");
      expect(subagentRuns.calls[0].provider).toBe(remote);

      subagentRuns.deferred = false;
      await runtime.dispose();
    });

    it("continues a chain whose recorded binding is gone and reports the change", async () => {
      const onEvent = vi.fn();
      const history: UiMessage[] = [
        restartedTaskRow("task-1", "del-1", {
          status: "completed",
          modelId: "gone-model",
        }),
        delegateRow("child-1", "task-1"),
      ];
      const runtime = createRuntime({ subagents: [explorer], history, onEvent });
      const internals = runtime as any;
      subagentRuns.calls.length = 0;
      subagentRuns.instances.length = 0;
      subagentRuns.deferred = true;

      const args = { agent: "explorer", task: "Continue.", resume: "del-1" };
      const result = await startTask(runtime, "task-2", args);
      const delegationId = (result.details as any).delegationId as string;

      // Refusing would strand the chain forever, so it continues on the
      // definition's current binding and records what it left behind.
      expect((result.details as any).error).toBeUndefined();
      expect((result.details as any).resumedFrom).toBe("del-1");
      expect(subagentRuns.calls[0].provider).toBe(provider);
      expect(internals.delegations.get(delegationId).modelChangedFrom).toBe(
        "gone-model",
      );

      // …and the parent sees it on the settled Task row.
      const handle = internals.handleAgentEvent.bind(runtime);
      await handle({
        type: "tool_execution_start",
        toolName: "Task",
        toolCallId: "task-2",
        args,
      });
      await handle({
        type: "tool_execution_end",
        toolName: "Task",
        toolCallId: "task-2",
        result,
        isError: false,
      });
      subagentRuns.resolveRun?.({
        agentName: "explorer",
        status: "completed",
        report: "done",
        turns: 1,
        toolCalls: 0,
      });
      await vi.waitFor(() => {
        const snapshots = onEvent.mock.calls
          .map(([envelope]) => envelope as any)
          .filter(
            (envelope) =>
              envelope.event.type === "message_end" &&
              envelope.event.message.role === "tool",
          );
        expect(snapshots).toHaveLength(1);
      });
      const snapshot = onEvent.mock.calls
        .map(([envelope]) => envelope as any)
        .find(
          (envelope) =>
            envelope.event.type === "message_end" &&
            envelope.event.message.role === "tool",
        );
      expect(snapshot.event.message.toolResult.details).toMatchObject({
        delegationId,
        status: "completed",
        modelChangedFrom: "gone-model",
      });

      subagentRuns.deferred = false;
      await runtime.dispose();
    });

    it("drops a chain whose rows are gone and keeps its id out of the reusable list", async () => {
      const history: UiMessage[] = [
        restartedTaskRow("task-1", "del-1", { status: "completed" }),
        restartedTaskRow("task-9", "del-2", { status: "completed" }),
        delegateRow("child-2", "task-9"),
      ];
      const runtime = createRuntime({ subagents: [explorer], history });
      const internals = runtime as any;
      subagentRuns.calls.length = 0;
      subagentRuns.deferred = false;
      expect(internals.delegationChains.lookup("del-2")).toBeDefined();

      const result = await startTask(runtime, "task-2", {
        agent: "explorer",
        task: "Continue.",
        resume: "del-1",
      });
      const message = String((result.details as any).error);

      expect(message).toContain('Delegation "del-1" has no recorded history');
      // The chain is dropped before the message is composed, so the id it
      // names can never come back as its own suggestion (ADR 0279 §4).
      expect(message).not.toContain("Reusable: explorer / del-1");
      expect(message.split("Reusable: ")[1]).toBe("explorer / del-2.");
      expect(internals.delegationChains.lookup("del-1")).toBeUndefined();
      expect(
        internals.delegationChains
          .resumableList({ runningDelegationIds: new Set() })
          .map((chain: { latestDelegationId: string }) => chain.latestDelegationId),
      ).toEqual(["del-2"]);
      expect(subagentRuns.calls).toHaveLength(0);
      await runtime.dispose();
    });

    it("keeps a running chain in the registry when a sibling settles", async () => {
      const runtime = createRuntime({ subagents: [explorer] });
      const internals = runtime as any;
      subagentRuns.calls.length = 0;
      subagentRuns.instances.length = 0;
      subagentRuns.result = undefined;
      subagentRuns.deferred = true;

      const startedIds: string[] = [];
      const startOne = async (toolCallId: string) => {
        const result = await startTask(runtime, toolCallId, {
          agent: "explorer",
          task: "Find it.",
        });
        startedIds.push((result.details as any).delegationId as string);
      };
      const settleNewest = async () => {
        subagentRuns.instances[subagentRuns.instances.length - 1].resolve({
          agentName: "explorer",
          status: "completed",
          report: "done",
          turns: 1,
          toolCalls: 0,
        });
        await vi.waitFor(() => {
          expect(
            internals.delegations.get(startedIds[startedIds.length - 1]).status,
          ).toBe("completed");
        });
      };

      // The chain that stays running is the oldest of the four, so a plain LRU
      // would evict it and strand the delegate still writing into it.
      await startOne("task-run");
      for (const toolCallId of ["task-a", "task-b", "task-c"]) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await startOne(toolCallId);
        await settleNewest();
      }

      const runningId = startedIds[0];
      expect(internals.delegationChains.lookup(runningId)).toMatchObject({
        latestStatus: "running",
      });
      expect(internals.delegationChains.lookup(startedIds[1])).toBeUndefined();
      expect(internals.delegationChains.lookup(startedIds[2])).toBeDefined();
      expect(internals.delegationChains.lookup(startedIds[3])).toBeDefined();
      expect(
        internals.delegationChains
          .resumableList({ runningDelegationIds: new Set([runningId]) })
          .map((chain: { latestDelegationId: string }) => chain.latestDelegationId),
      ).toEqual([startedIds[3], startedIds[2]]);
      expect(
        [startedIds[1], startedIds[2], startedIds[3]].filter((id) =>
          internals.delegationChains.lookup(id),
        ),
      ).toHaveLength(MAX_RESUMABLE_CHAINS_PER_AGENT);

      subagentRuns.deferred = false;
      await runtime.dispose();
    });
  });
});
