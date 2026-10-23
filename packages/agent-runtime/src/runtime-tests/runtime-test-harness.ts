import { vi } from "vitest";
import {
  type RuntimeProviderConfig,
  type CompactionStrategy,
  type PluginToolDef,
  DesktopAgentRuntime,
  type RuntimeMatchConfig,
} from "../runtime.js";
import {
  type CommandShellOption,
  type Mode,
  type SessionThinkingLevel,
  type UiMessage,
  type ContextCompactionRecord,
  type ContextCompactionSettings,
  type SubagentDefinition,
} from "@pi-desktop/shared";
import { type ProjectInstructions } from "../project-instructions.js";

/**
 * The delegate loop itself is covered in `subagent.test.ts`; here only the
 * `Task` wiring around it is under test, so `SubagentRun` is replaced by a
 * recorder. Every other export stays real.
 */
const subagentRuns = vi.hoisted(() => ({
  calls: [] as any[],
  result: undefined as any,
  /** When true, run() waits for resolveRun() so tests control settlement. */
  constructorError: undefined as unknown,
  ignoreAbort: false,
  deferred: false,
  instances: [] as Array<{ resolve: (r: unknown) => void; settled: boolean }>,
  /** Settles the oldest unresolved deferred run (tests control order). */
  resolveRun: undefined as ((result: unknown) => void) | undefined,
}));

vi.mock("../subagent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../subagent.js")>();
  return {
    ...actual,
    SubagentRun: class {
      private signal?: AbortSignal;
      constructor(options: unknown) {
        if (subagentRuns.constructorError !== undefined) {
          throw subagentRuns.constructorError;
        }
        subagentRuns.calls.push(options);
        // Per-instance: concurrent delegates must abort on their own signal.
        this.signal = (options as { signal?: AbortSignal }).signal;
      }
      run() {
        if (subagentRuns.deferred) {
          return new Promise((resolve) => {
            const instance = { resolve, settled: false };
            subagentRuns.instances.push(instance);
            subagentRuns.resolveRun = (result: unknown) => {
              const next = subagentRuns.instances.find((entry) => !entry.settled);
              if (next) {
                next.settled = true;
                next.resolve(result);
              }
            };
            if (!subagentRuns.ignoreAbort) {
              this.signal?.addEventListener(
                "abort",
                () => {
                  if (instance.settled) return;
                  instance.settled = true;
                  resolve({
                    agentName: "explorer",
                    status: "aborted",
                    report: "The delegated task was aborted.",
                    turns: 0,
                    toolCalls: 0,
                  });
                },
                { once: true },
              );
            }
          });
        }
        return Promise.resolve(
          subagentRuns.result ?? {
            agentName: "explorer",
            status: "completed",
            report: "done",
            turns: 1,
            toolCalls: 0,
          },
        );
      }
    },
  };
});

export const provider: RuntimeProviderConfig = {
  id: "local",
  name: "Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  modelId: "local-model",
  apiKey: "",
  authKind: "none",
  supportsReasoning: true,
  supportedThinkingLevels: ["off", "low", "medium", "high"],
  modelConfig: {
    source: "generic",
    name: "Local Catalog Model",
    baseUrl: "https://catalog.invalid/v1",
    reasoning: true,
    thinkingLevelMap: { minimal: null, xhigh: null, max: null },
    input: ["text", "image"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    contextWindow: 256_000,
    maxTokens: 32_000,
  },
};

export const commandShell: CommandShellOption = {
  id: "bash",
  label: "Bash",
  dialect: "posix",
  available: true,
  isDefault: true,
};

export function createRuntime(
  overrides: Partial<{
    provider: RuntimeProviderConfig;
    mode: Mode | "chat";
    thinkingLevel: SessionThinkingLevel;
    history: UiMessage[];
    compaction: ContextCompactionRecord;
    compactionSettings: ContextCompactionSettings;
    compactionStrategy: CompactionStrategy;
    projectPath: string;
    scratchDir: string;
    customSystemPrompt: import("../custom-system-prompt.js").CustomSystemPrompt;
    projectInstructions: import("../project-instructions.js").ProjectInstructions;
    projectMemory: string;
    pluginTools: PluginToolDef[];
    subagents: SubagentDefinition[];
    subagentProviders: Record<string, RuntimeProviderConfig>;
    subagentModelKeys: string[];
    advisorProvider: RuntimeProviderConfig;
    subagentMaxDepth: number;
    subagentMaxConcurrency: number;
    pluginSkills: import("../plugin-skills-prompt.js").PluginSkillDef[];
    commandShell: CommandShellOption;
    turnId: string;
    executionProfile: "standard" | "team";
    teamContext: {
      teamSessionId: string;
      callerSessionId: string;
      isLead: boolean;
      memberName?: string;
      workPurpose?: "execute" | "plan_research";
      planningId?: string;
      roundId?: string;
      expertConfig?: import("@pi-desktop/shared").ExpertTeamConfigSnapshot;
    };
    host: { call: ReturnType<typeof vi.fn>; onNotification?: ReturnType<typeof vi.fn> };
    onEvent: (envelope: unknown) => void;
  }> = {},
) {
  return new DesktopAgentRuntime({
    host: (overrides.host ?? { call: vi.fn(), onNotification: vi.fn(() => () => {}) }) as never,
    sessionId: "session-1",
    mode: overrides.mode === "chat" ? "plan" : overrides.mode ?? "agent",
    turnId: overrides.turnId,
    executionProfile: overrides.executionProfile,
    teamContext: overrides.teamContext,
    provider: overrides.provider ?? provider,
    advisorProvider: overrides.advisorProvider,
    commandShell: overrides.commandShell ?? commandShell,
    thinkingLevel: overrides.thinkingLevel ?? "medium",
    history: overrides.history,
    compaction: overrides.compaction,
    compactionSettings: overrides.compactionSettings,
    compactionStrategy: overrides.compactionStrategy,
    projectPath: overrides.projectPath,
    scratchDir: overrides.scratchDir,
    customSystemPrompt: overrides.customSystemPrompt,
    pluginTools: overrides.pluginTools,
    subagents: overrides.subagents,
    subagentProviders: overrides.subagentProviders,
    subagentModelKeys: overrides.subagentModelKeys,
    subagentMaxDepth: overrides.subagentMaxDepth,
    subagentMaxConcurrency: overrides.subagentMaxConcurrency,
    projectInstructions: overrides.projectInstructions,
    projectMemory: overrides.projectMemory,
    pluginSkills: overrides.pluginSkills,
    onEvent: overrides.onEvent ?? vi.fn(),
  });
}

/** Minimal pi-ai assistant message; overrides carry the shape under test. */
export function assistantMessage(overrides: {
  content: unknown[];
  stopReason?: string;
}) {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "local",
    model: "local-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: overrides.stopReason ?? "stop",
    timestamp: 2,
    content: overrides.content,
  };
}

export function runtimeMatches(
  runtime: DesktopAgentRuntime,
  overrides: Partial<RuntimeMatchConfig> = {},
): boolean {
  return runtime.matches({
    mode: runtime.getMode(),
    provider: (runtime as any).provider,
    thinkingLevel: (runtime as any).thinkingLevel,
    pluginTools: (runtime as any).pluginTools,
    pluginSkills: (runtime as any).pluginSkills,
    projectInstructions: (runtime as any).baseProjectInstructions,
    customSystemPrompt: (runtime as any).customSystemPrompt,
    projectMemory: (runtime as any).projectMemory,
    projectPath: (runtime as any).projectPath,
    commandShell: (runtime as any).commandShell,
    subagents: (runtime as any).subagents,
    subagentProviders: (runtime as any).subagentProviders,
    subagentModelKeys: [...(runtime as any).subagentModelKeys],
    advisorProvider: (runtime as any).advisorProvider,
    ...overrides,
  });
}

export { subagentRuns };
