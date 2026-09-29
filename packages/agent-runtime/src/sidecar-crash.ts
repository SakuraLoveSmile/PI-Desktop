import { ErrorCodes } from "@pi-desktop/shared";

export type SidecarCrashKind = "oom" | "crashed";

const OOM_MARKERS = [
  "Last few GCs ---",
  "heap out of memory",
  "Reached heap limit",
  "CALL_AND_RETRY_LAST Allocation failed",
] as const;

export type SidecarCrash = { kind: SidecarCrashKind; marker?: string };

export function sidecarCrashErrorCode(kind: SidecarCrashKind): string {
  return kind === "oom" ? ErrorCodes.AGENT_SIDECAR_OOM : ErrorCodes.AGENT_SIDECAR_CRASHED;
}

export function classifySidecarCrash(stderrTail: unknown): SidecarCrash {
  const text = Array.isArray(stderrTail)
    ? stderrTail.filter((line): line is string => typeof line === "string").join("\n")
    : typeof stderrTail === "string" ? stderrTail : "";
  for (const marker of OOM_MARKERS) {
    if (text.includes(marker)) return { kind: "oom", marker };
  }
  return { kind: "crashed" };
}
