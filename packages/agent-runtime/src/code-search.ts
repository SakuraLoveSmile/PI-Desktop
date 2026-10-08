/** Local, session-rooted code search. This tool does not replace Grep. */
import { Type } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { RuntimeHost } from "./host-client.js";

export const CODE_SEARCH_TOOL_NAME = "CodeSearch";
export type CodeIndexMetadata = {
  fileCount: number;
  indexedBytes: number;
  skippedFiles: number;
  status: "missing" | "fresh" | "partial";
};
export type CodeSearchResult = {
  hits: { path: string; line: number; text: string }[];
  truncated: boolean;
  index: CodeIndexMetadata;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateCodeSearchResult(value: unknown): value is CodeSearchResult {
  if (!record(value) || !Array.isArray(value.hits) || value.hits.length > 50 ||
      typeof value.truncated !== "boolean" || !record(value.index)) return false;
  const index = value.index;
  if (!nonnegative(index.fileCount) || !nonnegative(index.indexedBytes) ||
      !nonnegative(index.skippedFiles) || typeof index.status !== "string" ||
      !["missing", "fresh", "partial"].includes(index.status)) return false;
  if (index.status === "partial" && !value.truncated) return false;
  if (!value.hits.every((hit: unknown) => {
    if (!record(hit) || typeof hit.path !== "string" || !hit.path ||
        hit.path.startsWith("/") || /^[A-Za-z]:/.test(hit.path) ||
        hit.path.includes("\0") || hit.path.split("/").some((part) => part === ".." || part === ".") ||
        !nonnegative(hit.line) || hit.line < 1 || typeof hit.text !== "string" || [...hit.text].length > 240) return false;
    return true;
  })) return false;
  return Buffer.byteLength(JSON.stringify(value), "utf8") <= 32 * 1024;
}

type Options = { host: RuntimeHost; sessionId: string; boundPath: string };
type Request = { action: "search" | "status" | "clear"; query?: string; limit?: number };

function parseRequest(value: unknown): Request {
  if (!record(value)) throw new Error("CodeSearch arguments must be an object");
  const action = value.action ?? "search";
  if (action !== "search" && action !== "status" && action !== "clear") throw new Error("Invalid CodeSearch action");
  if (action === "search" && (typeof value.query !== "string" ||
      [...value.query].length < 1 || [...value.query].length > 500 || value.query.includes("\0"))) {
    throw new Error("query must contain 1–500 characters and no NUL bytes");
  }
  if (value.limit !== undefined && (!nonnegative(value.limit) || value.limit < 1 || value.limit > 50)) {
    throw new Error("limit must be an integer from 1 to 50");
  }
  return { action, ...(action === "search" ? { query: value.query as string } : {}),
    ...(value.limit === undefined ? {} : { limit: value.limit as number }) };
}

function failed(message: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: `CodeSearch failed: ${message}` }], details: { ok: false, error: message } };
}

export function buildCodeSearchTool(options: Options): AgentTool {
  return {
    name: CODE_SEARCH_TOOL_NAME,
    label: "Search project code",
    description: "Search literal text, case-insensitively, in the current session's local project files. " +
      "Returns relative paths, line numbers, and excerpts. Uses existing workspace ignore and sensitive-file rules. " +
      "Partial coverage is reported explicitly; no hits in a partial result do not establish absence. " +
      "Use Grep for regular expressions or explicitly scoped searches. No model, embedding, or network calls. " +
      "action=status inspects the local cache; action=clear deletes only this project's rebuildable cache. " +
      "Use clear only when the user explicitly asks to clear the code index, never as an automatic recovery step.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ minLength: 1, maxLength: 500, description: "Literal text; required for search. Not a regular expression." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "Maximum matching lines; defaults to 20." })),
      action: Type.Optional(Type.Union([Type.Literal("search"), Type.Literal("status"), Type.Literal("clear")], { description: "Defaults to search." })),
    }),
    executionMode: "sequential",
    execute: async (_id: string, params: unknown, signal?: AbortSignal): Promise<AgentToolResult<unknown>> => {
      try {
        const request = parseRequest(params);
        if (signal?.aborted) throw new Error("CodeSearch cancelled");
        const result = await options.host.call<unknown>("project.codeSearch", {
          sessionId: options.sessionId, boundPath: options.boundPath, ...request,
        });
        if (signal?.aborted) throw new Error("CodeSearch cancelled");
        if (!validateCodeSearchResult(result)) throw new Error("Host returned an invalid code search result");
        const warning = result.index.status === "partial"
          ? "Partial coverage: files were skipped, changed during the search, or a scan budget was reached. Use scoped Grep to investigate missing results.\n"
          : result.truncated ? "Results truncated by the output limit. Use scoped Grep for additional matches.\n" : "";
        return { content: [{ type: "text", text: warning + JSON.stringify(result) }], details: { ok: true, ...result } };
      } catch (error: unknown) {
        return failed(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
