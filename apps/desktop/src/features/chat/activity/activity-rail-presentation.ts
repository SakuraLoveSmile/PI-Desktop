import { backgroundProcessIsActive, type BackgroundProcessSummary } from "@pi-desktop/shared";

type StatusItem = { id: string; status?: string; attentionStatus?: string };
const attentionStatus = (item: StatusItem) => item.attentionStatus ?? item.status;
const activeStatuses = new Set(["running", "starting", "stopping", "working", "in_progress", "queued"]);
const failedStatuses = new Set(["failed", "error", "denied", "interrupted", "blocked"]);

export function activityStatusTone(status?: string): "neutral" | "success" | "error" | "warning" {
  if (status === "timed_out" || status === "degraded") return "warning";
  if (failedStatuses.has(status ?? "")) return "error";
  if (activeStatuses.has(status ?? "") || ["completed", "complete", "success", "done"].includes(status ?? "")) return "success";
  return "neutral";
}

export function activityGroupSummary(items: readonly StatusItem[]) {
  return {
    total: items.length,
    running: items.filter((item) => activeStatuses.has(attentionStatus(item) ?? "")).length,
    failed: items.filter((item) => failedStatuses.has(attentionStatus(item) ?? "")).length,
    timedOut: items.filter((item) => attentionStatus(item) === "timed_out").length,
  };
}

export function activityAttention(items: readonly StatusItem[]): string[] {
  return items.filter((item) => activeStatuses.has(attentionStatus(item) ?? "") || failedStatuses.has(attentionStatus(item) ?? "") || ["timed_out", "degraded"].includes(attentionStatus(item) ?? ""))
    .map((item) => `${item.id}:${attentionStatus(item)}`).sort();
}

export type ActivityDisclosureState = { open: boolean; attention: string[] };

/** A manual collapse holds until a new item or an attention-status transition. */
export function reconcileActivityDisclosure(state: ActivityDisclosureState, attention: string[], preserveMissing = false): ActivityDisclosureState {
  if (preserveMissing) attention = [...new Set([...state.attention, ...attention])].sort();
  if (state.attention.length === attention.length && state.attention.every((item, i) => item === attention[i])) return state;
  const known = new Set(state.attention);
  return { open: state.open || attention.some((item) => !known.has(item)), attention };
}

export function processActivityGroups(processes: readonly BackgroundProcessSummary[], sessionId: string, hidden: ReadonlySet<string>) {
  const scoped = processes.filter((process) => process.sessionId === sessionId);
  return {
    active: scoped.filter((process) => backgroundProcessIsActive(process.status)),
    ended: scoped.filter((process) => !backgroundProcessIsActive(process.status) && !hidden.has(process.id)),
  };
}

/** Read literal shell words only. This does not evaluate quotes, expansions or commands. */
function commandSegments(command: string): string[][] {
  const segments: string[][] = [[]];
  let word = "";
  let quote = "";
  const flush = () => { if (word) segments.at(-1)?.push(word); word = ""; };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (quote === '"' && char === "\\" && command[index + 1] === '"') word += command[++index];
      else if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') quote = char;
    else if (/\s/.test(char)) flush();
    else if (char === "&" || char === ";" || char === "|") {
      flush();
      if (segments.at(-1)?.length) segments.push([]);
    } else if (char === "\\" && /[\s'"\\]/.test(command[index + 1] ?? "")) word += command[++index];
    else word += char;
  }
  flush();
  return segments.filter((segment) => segment.length > 0);
}

function basename(value: string): string { return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value; }

export function backgroundProcessTitle(command: string): string {
  const segments = commandSegments(command);
  const words = [...(segments.find((segment) => !["cd", "export", "set"].includes(segment[0])) ?? segments[0] ?? [])];
  while (words[0] === "env" || /^[A-Za-z_][\w]*=/.test(words[0] ?? "")) words.shift();
  const executable = basename(words[0] ?? "");
  if (!executable) return command.trim();
  const args = words.slice(1);
  let title = executable;
  if (/^(?:node|python\d?(?:\.\d+)?|bash|sh|zsh|tsx|ts-node|ruby|perl|deno|bun)(?:\.exe)?$/.test(executable)) {
    const script = args[0] === "-m" ? args[1]
      : args[0] === "run" && ["deno", "bun"].includes(executable) ? args[1]
      : args[0] && !args[0].startsWith("-") ? args[0] : undefined;
    if (script) title = basename(script);
  } else if (["npm", "pnpm", "yarn", "npx", "cargo", "make", "just", "uv", "docker"].includes(executable)) {
    const subcommand = args.filter((arg) => !arg.startsWith("-"))[0];
    const target = subcommand && ["run", "exec"].includes(subcommand) ? args[args.indexOf(subcommand) + 1] : subcommand;
    if (target && !target.startsWith("-")) title += ` ${basename(target)}`;
  }
  const tokens = segments.flat();
  const portArg = tokens.find((token) => /^(?:--port=|PORT=)\d+$/.test(token))?.split("=").at(-1)
    ?? tokens.find((_, index) => ["--port", "-p"].includes(tokens[index - 1]) && /^\d+$/.test(tokens[index]));
  const port = Number(portArg);
  return title + (portArg && port > 0 && port <= 65535 ? ` · :${port}` : "");
}


export function activityVisibleItems<T>(items: readonly T[], expanded: boolean, limit = 5): readonly T[] {
  return expanded ? items : items.slice(0, limit);
}

export function activityOutputGroups<T extends { groupLabel?: string }>(items: readonly T[]): { label: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = item.groupLabel ?? "";
    const group = groups.get(label) ?? [];
    group.push(item);
    groups.set(label, group);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

export function activityFailures<T extends StatusItem>(items: readonly T[]): T[] {
  return items.filter((item) => failedStatuses.has(attentionStatus(item) ?? "") || attentionStatus(item) === "timed_out");
}
