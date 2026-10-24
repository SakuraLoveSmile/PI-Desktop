import type { AskToolRequest } from "@pi-desktop/shared";
import type { RuntimeHost } from "../host-client.js";

type Answers = Array<string[] | null>;
type DurableAsk = { request: AskToolRequest; status: string; answers?: Answers; queueId?: string };

/** Only a Host-bound Lead question can release its wait without an answer. */
export async function waitForLeadAsk(options: {
  host: RuntimeHost;
  request: AskToolRequest;
  turnId: string;
  signal?: AbortSignal;
  wait: (request: AskToolRequest, signal?: AbortSignal) => Promise<Answers>;
  pending: (request?: AskToolRequest) => void;
}): Promise<Answers | undefined> {
  const identity = { sessionId: options.request.sessionId, callerSessionId: options.request.sessionId, turnId: options.turnId };
  // Renderer lifecycle metadata stays local. Host owns the separate turnId
  // envelope and accepts only its existing durable question contract.
  const { requestId, sessionId, toolCallId, questions, teamPending, teamManaged } = options.request;
  const registered = await options.host.call<{ ask: DurableAsk; deadlineMs: number }>("team.registerLeadAsk", {
    ...identity, request: { requestId, sessionId, toolCallId, questions,
      ...(teamPending === undefined ? {} : { teamPending }),
      ...(teamManaged === undefined ? {} : { teamManaged }) },
  });
  options.signal?.throwIfAborted();
  if (!Number.isFinite(registered?.deadlineMs)) throw new Error("ASKTOOL_INVALID_STATE: Host question deadline missing");
  const waitAbort = new AbortController();
  const cancel = () => waitAbort.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    const deferred = new Promise<Answers | undefined>((resolve, reject) => {
      timer = setTimeout(() => {
        options.host.call<{ ask: DurableAsk }>("team.deferLeadAsk", {
          ...identity, requestId: options.request.requestId,
        }).then(({ ask }) => {
          options.signal?.throwIfAborted();
          if (ask.status === "answered_live" && ask.answers) { resolve(ask.answers); return; }
          if (ask.status === "answered" && ask.queueId) { expired = true; options.pending(); resolve(undefined); waitAbort.abort(); return; }
          if (ask.status !== "pending" || !ask.request.teamPending) throw new Error("ASKTOOL_INVALID_STATE: Host did not defer the question");
          expired = true;
          options.pending({ ...ask.request, teamManaged: true });
          resolve(undefined);
          waitAbort.abort();
        }).catch(reject);
      }, Math.max(0, registered.deadlineMs - Date.now()));
    });
    const answers = await Promise.race([options.wait({ ...options.request, teamManaged: true }, waitAbort.signal), deferred]);
    options.signal?.throwIfAborted();
    if (!expired && answers) await options.host.call("team.ackLeadAsk", { ...identity, requestId: options.request.requestId });
    return expired ? undefined : answers;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    waitAbort.abort();
  }
}
