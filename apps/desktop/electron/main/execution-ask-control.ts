import type { AskToolRequest, AskToolResolution } from "@pi-desktop/shared";

export type ExecutionAskControl = {
  pending(sessionId: string): Promise<AskToolRequest[]>;
  resolve(resolution: AskToolResolution): Promise<unknown>;
};

function invalid(message: string): never {
  throw Object.assign(new Error(message), { errorCode: "ASKTOOL_INVALID_ARGUMENT" });
}

/** Validate the external shape before calling the trusted input adapter. */
export function askControlInput(args: readonly unknown[], resolving: boolean): AskToolResolution | { sessionId: string } {
  if (args.length !== 1 || !args[0] || typeof args[0] !== "object" || Array.isArray(args[0])) invalid("one asktool input object is required");
  const input = args[0] as Record<string, unknown>;
  const keys = resolving ? ["sessionId", "requestId", "expectedToolCallId", "answers"] : ["sessionId"];
  if (Object.keys(input).some(key => !keys.includes(key))) invalid("unexpected asktool field");
  for (const key of keys.filter(key => key !== "answers")) {
    if (typeof input[key] !== "string" || !(input[key] as string).trim() || input[key] !== (input[key] as string).trim()) invalid(`${key} must be a nonempty identity`);
  }
  if (!resolving) return { sessionId: input.sessionId as string };
  if (!Array.isArray(input.answers) || input.answers.some(answer => answer !== null && (!Array.isArray(answer) || !answer.length || answer.some(value => typeof value !== "string" || !value.trim())))) invalid("answers must be ordered nonempty arrays of nonempty strings or null");
  return input as AskToolResolution;
}

export async function invokeAskControl(control: ExecutionAskControl, operation: string, args: readonly unknown[]) {
  const input = askControlInput(args, operation === "agent/askTool/resolve");
  if (operation === "agent/askTool/resolve") return control.resolve(input as AskToolResolution);
  const asks = await control.pending(input.sessionId);
  return { sessionId: input.sessionId, asks: asks.map(({ requestId, toolCallId, turnId, createdAt, questions }) => ({ requestId, toolCallId, ...(turnId ? { turnId } : {}), ...(createdAt ? { createdAt } : {}), questions })) };
}
