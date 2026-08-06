/**
 * Where subagent definitions come from, and how a definition's model pin turns
 * into a usable provider binding (ADR 0062).
 *
 * Discovery mirrors prompt templates (D123): `<workspace>/.pi/agents/*.md`,
 * plus the definitions PI-Desktop ships. Project documents shadow builtins by
 * name, so a workspace can retune a bundled delegate without renaming it.
 *
 * Builtins are inline rather than packaged resource files. There are a handful
 * of them, they must exist in every install for the `Task` tool to be worth
 * offering, and a missing-file fallback path is a worse failure mode than a
 * constant.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  mergeSubagentDefinitions,
  parseSubagentDefinition,
  subagentModelKey,
  subagentPinnedProviders,
  type SubagentDefinition,
} from "@pi-desktop/shared";
import {
  resolvePiModelConfig,
  resolveThinkingCapabilities,
} from "./model-capabilities.js";
import type { RuntimeProviderConfig } from "./provider-binding.js";

/** Directory a workspace keeps its own definitions in. */
export function subagentDefinitionDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".pi", "agents");
}

/**
 * Definitions PI-Desktop ships. Each one earns its prompt-token cost by being
 * a delegation the main agent would otherwise do inline at full context cost:
 * wide searching, a second opinion on a diff, and running a test command.
 */
export const BUILTIN_SUBAGENT_DOCUMENTS: readonly string[] = [
  `---
name: explorer
description: Search the workspace for where something lives or how it works. Use when answering needs a sweep over many files and you only want the conclusion.
tools: [Read, Glob, Grep]
maxTurns: 16
---

Locate what the task asks for and report the answer, not your search path.

- Start wide (Glob/Grep on likely names), then read only the files that matter.
- Follow the definitions and call sites you find; do not stop at the first hit
  if the question implies more than one place.
- Quote the few lines that answer the question and cite \`path:line\` for each.

Report: the answer in one or two sentences, then the \`path:line\` references
that support it. If you could not find it, say what you searched and where the
trail went cold — a precise dead end is more useful than a guess.`,
  `---
name: code-reviewer
description: Review specific code or a specific change for defects. Use for a second opinion on correctness, edge cases and missing tests before you commit.
tools: [Read, Glob, Grep]
maxTurns: 20
---

Review only what the task names, and read enough surrounding code to judge it.

- Prefer defects that change behavior: wrong results, unhandled failures,
  broken invariants, races, resource leaks, missing test coverage.
- Check the code against how its callers and neighbors actually use it, not
  against a style preference.
- Say nothing about formatting, naming or structure unless it causes a defect.

Report: each finding as \`path:line\` plus one sentence on what breaks and under
what input. Order by severity. If the code is sound, say so plainly and name
the cases you checked — an empty review with no evidence is not a review.`,
  `---
name: test-runner
description: Run a specific test or build command and report what failed and why. Use when a command's output is long and only the failures matter.
tools: [Read, Glob, Grep, Bash]
maxTurns: 20
---

Run the command the task names. Do not invent a different one, and do not fix
anything: diagnosis is the deliverable.

- Run the command once. If it fails to start (missing script, wrong directory),
  find the right invocation and say what you changed.
- For each failure, read the failing test and the code under it far enough to
  name the cause.

Report: pass/fail counts, then one entry per failure with the test name, the
assertion or error, and the \`path:line\` you believe is responsible. Keep the
raw output out of the report except for the lines that carry the failure.`,
];

/** Parsed builtins, rebuilt per call so a bad constant surfaces as a
 * diagnostic in exactly the same way a bad project document does. */
function builtinSubagents(): {
  definitions: SubagentDefinition[];
  diagnostics: string[];
} {
  const definitions: SubagentDefinition[] = [];
  const diagnostics: string[] = [];
  for (const raw of BUILTIN_SUBAGENT_DOCUMENTS) {
    const parsed = parseSubagentDefinition(raw, { source: "builtin" });
    if (parsed.ok) definitions.push(parsed.definition);
    else diagnostics.push(`builtin subagent invalid: ${parsed.errors.join("; ")}`);
  }
  return { definitions, diagnostics };
}

async function loadProjectSubagents(
  dir: string,
): Promise<{ definitions: SubagentDefinition[]; diagnostics: string[] }> {
  const definitions: SubagentDefinition[] = [];
  const diagnostics: string[] = [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => /\.md$/i.test(name)).sort();
  } catch {
    // No `.pi/agents` directory is the common case, not an error.
    return { definitions, diagnostics };
  }
  for (const name of names) {
    const filePath = join(dir, name);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      diagnostics.push(
        `${filePath}: unreadable (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }
    const parsed = parseSubagentDefinition(raw, {
      source: "project",
      fallbackName: name,
      filePath,
    });
    for (const warning of parsed.warnings) diagnostics.push(`${filePath}: ${warning}`);
    if (parsed.ok) definitions.push(parsed.definition);
    else diagnostics.push(`${filePath}: ${parsed.errors.join("; ")}`);
  }
  return { definitions, diagnostics };
}

/**
 * Definitions offered to a session, builtins plus this workspace's own.
 * Load failures degrade to diagnostics: a malformed document must not cost the
 * session its other delegates, let alone its turn.
 */
export async function loadSubagentDefinitions(
  workspaceRoot: string | null | undefined,
  overrideDir?: string,
): Promise<{ definitions: SubagentDefinition[]; diagnostics: string[] }> {
  const builtin = builtinSubagents();
  const dir =
    overrideDir ?? (workspaceRoot ? subagentDefinitionDir(workspaceRoot) : undefined);
  const project = dir
    ? await loadProjectSubagents(dir)
    : { definitions: [], diagnostics: [] };
  const merged = mergeSubagentDefinitions([
    ...project.definitions,
    ...builtin.definitions,
  ]);
  const diagnostics = [...project.diagnostics, ...builtin.diagnostics];
  if (merged.dropped.length > 0) {
    diagnostics.push(
      `dropped subagents past the catalog cap: ${merged.dropped.join(", ")}`,
    );
  }
  return { definitions: merged.definitions, diagnostics };
}

/** The stored-provider fields a pin can be resolved against. */
export type SubagentProviderSource = {
  id: string;
  name: string;
  vendorKey?: string;
  baseUrl?: string;
  defaultModelId?: string;
  authKind?: string;
  apiStyle?: string;
};

/** Loose spelling used when matching a pin against a provider name. */
function providerAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Match a pin's `providerId` against configured providers.
 *
 * Stored provider ids are UUIDs, so a hand-written definition almost never
 * names one. The vendor key (`anthropic`) and the display name are what a
 * person actually writes, and both are accepted.
 */
function findProvider(
  providerId: string,
  providers: readonly SubagentProviderSource[],
): SubagentProviderSource | undefined {
  const alias = providerAlias(providerId);
  return (
    providers.find((provider) => provider.id === providerId) ??
    providers.find((provider) => providerAlias(provider.vendorKey ?? "") === alias) ??
    providers.find((provider) => providerAlias(provider.name) === alias)
  );
}

/**
 * Resolve every distinct model pin into a provider binding the sidecar can
 * use, keyed by `subagentModelKey`.
 *
 * A pin that cannot be resolved is deliberately left out of the map instead of
 * falling back to the session provider: a definition that asks for a cheap
 * model must not silently start spending the expensive one. The runtime turns
 * the missing entry into a tool error naming the pin.
 */
export async function resolveSubagentProviders(input: {
  definitions: readonly SubagentDefinition[];
  providers: readonly SubagentProviderSource[];
  getSecret: (providerId: string) => Promise<string | undefined>;
}): Promise<{
  providers: Record<string, RuntimeProviderConfig>;
  diagnostics: string[];
}> {
  const resolved: Record<string, RuntimeProviderConfig> = {};
  const diagnostics: string[] = [];
  const allowed = subagentPinnedProviders(input.definitions);
  const secrets = new Map<string, string | undefined>();

  for (const definition of input.definitions) {
    const pin = definition.model;
    if (!pin) continue;
    const key = subagentModelKey(pin);
    if (resolved[key]) continue;
    if (!allowed.includes(pin.providerId)) {
      diagnostics.push(
        `${definition.name}: too many pinned providers, ignoring "${key}"`,
      );
      continue;
    }
    const provider = findProvider(pin.providerId, input.providers);
    if (!provider) {
      diagnostics.push(
        `${definition.name}: no enabled provider matches "${pin.providerId}"`,
      );
      continue;
    }
    if (!secrets.has(provider.id)) {
      try {
        secrets.set(provider.id, await input.getSecret(provider.id));
      } catch {
        secrets.set(provider.id, undefined);
      }
    }
    const apiKey = secrets.get(provider.id) ?? "";
    if (!apiKey && provider.authKind !== "none") {
      diagnostics.push(`${definition.name}: provider "${provider.name}" has no API key`);
      continue;
    }
    const capabilities = resolveThinkingCapabilities({
      vendorKey: provider.vendorKey || "custom",
      modelId: pin.modelId,
      apiStyle: provider.apiStyle,
    });
    const modelConfig = resolvePiModelConfig({
      vendorKey: provider.vendorKey || "custom",
      modelId: pin.modelId,
      apiStyle: provider.apiStyle,
    });
    resolved[key] = {
      id: provider.id,
      name: provider.name,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      modelId: pin.modelId,
      apiKey,
      ...(provider.authKind ? { authKind: provider.authKind } : {}),
      ...(provider.apiStyle ? { apiStyle: provider.apiStyle } : {}),
      supportsReasoning: capabilities.supportsReasoning,
      supportedThinkingLevels: [...capabilities.supportedThinkingLevels],
      ...(modelConfig ? { modelConfig } : {}),
    };
  }
  return { providers: resolved, diagnostics };
}
