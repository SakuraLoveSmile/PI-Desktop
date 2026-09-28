import type { LiveBinding } from "@pi-desktop/shared";
import { MAX_LIVE_AUDIO_BYTES, MAX_LIVE_JSON_BYTES, parseRealtimeMessage, RealtimeResponseTracker, realtimeAudioMessage, realtimeSessionMatches, realtimeSessionUpdateMessage, realtimeTruncateMessages } from "@pi-desktop/voice-runtime/live";
import type { LiveAdapter, LiveAdapterContext, LivePlaybackCursor } from "./types";
import { openLiveWebSocket } from "./websocket-transport";
import { sendJsonBounded, waitForReady, waitForSocketReady, websocketJson } from "./websocket-wire";
import { WebSocket } from "ws";

const MAX_FRAME_BYTES = 24000 * 2 / 10;

function realtimeUrl(baseUrl: string, modelId: string): string {
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw Object.assign(new Error("Realtime Provider URL is invalid"), { errorCode: "LIVE_PROTOCOL_UNSUPPORTED" }); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw Object.assign(new Error("Realtime Provider must use an HTTPS base URL without credentials or query parameters"), { errorCode: "LIVE_PROTOCOL_UNSUPPORTED" });
  }
  let path = base.pathname.replace(/\/+$/, "");
  if (!path.endsWith("/realtime")) path = `${path}/realtime`;
  base.pathname = path;
  base.protocol = "wss:";
  base.search = "";
  base.searchParams.set("model", modelId);
  base.hash = "";
  return base.toString();
}

export function createOpenAIRealtimeAdapter(context: LiveAdapterContext): LiveAdapter {
  const binding = context.binding as Extract<LiveBinding, { adapterId: "openai-realtime" }>;
  if (context.auth.kind !== "api-key") {
    throw Object.assign(new Error("Realtime requires an API-key Provider"), { errorCode: "LIVE_AUTH_KIND_UNSUPPORTED" });
  }
  const apiKey = context.auth.apiKey;
  const baseUrl = context.auth.baseUrl;
  let socket: Awaited<ReturnType<typeof openLiveWebSocket>> | null = null;
  let closed = false;
  let muted = true;
  let createdResolve: (() => void) | null = null;
  let updatedResolve: (() => void) | null = null;
  let createdReject: ((error: Error) => void) | null = null;
  let updatedReject: ((error: Error) => void) | null = null;
  let sessionUpdateSent = false;
  let configured = false;
  const responseTracker = new RealtimeResponseTracker();
  const rejectedFunctionCalls = new Set<string>();
  const created = new Promise<void>((resolve, reject) => { createdResolve = resolve; createdReject = reject; });
  const updated = new Promise<void>((resolve, reject) => { updatedResolve = resolve; updatedReject = reject; });

  function onSocketMessage(data: unknown): void {
    try {
      const value = websocketJson(data, MAX_LIVE_JSON_BYTES);
      const event = value as Record<string, unknown>;
      let staleCompletion = false;
      if (event.type === "session.created") {
        createdResolve?.();
        if (!sessionUpdateSent) {
          sessionUpdateSent = true;
          sendJsonBounded(socket!, realtimeSessionUpdateMessage({ modelId: binding.modelId, voice: binding.voice, profile: binding.wireProfile }));
        }
      }
      if (event.type === "session.updated" && sessionUpdateSent) {
        if (!realtimeSessionMatches({ session: event.session, modelId: binding.modelId, voice: binding.voice, profile: binding.wireProfile })) {
          throw Object.assign(new Error("Realtime session confirmation does not match the selected audio profile"), { errorCode: "LIVE_PROTOCOL_ERROR" });
        }
        configured = true;
        updatedResolve?.();
      }
      if (event.type === "response.created") {
        const response = event.response && typeof event.response === "object" ? event.response as { id?: unknown } : null;
        const responseId = typeof response?.id === "string" ? response.id : typeof event.response_id === "string" ? event.response_id : null;
        if (!responseId) throw Object.assign(new Error("Realtime response omitted its identity"), { errorCode: "LIVE_PROTOCOL_ERROR" });
        responseTracker.add(responseId);
      }
      if (event.type === "input_audio_buffer.speech_started") {
        responseTracker.interrupt();
      }
      if (event.type === "response.done" || event.type === "response.cancelled") {
        const response = event.response && typeof event.response === "object" ? event.response as { id?: unknown } : null;
        const responseId = typeof event.response_id === "string" ? event.response_id : typeof response?.id === "string" ? response.id : null;
        if (!responseId) throw Object.assign(new Error("Realtime completion omitted its response identity"), { errorCode: "LIVE_PROTOCOL_ERROR" });
        staleCompletion = responseTracker.finish(responseId);
      }
      if (event.type === "error") {
        const detail = event.error && typeof event.error === "object" ? event.error as { code?: unknown } : null;
        if (detail?.code === "response_cancel_not_active") return;
      }
      if (event.type === "response.output_item.done") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string" && !rejectedFunctionCalls.has(item.call_id)) {
          if (rejectedFunctionCalls.size >= 256) throw Object.assign(new Error("Realtime function-call limit exceeded"), { errorCode: "LIVE_PROTOCOL_ERROR" });
          rejectedFunctionCalls.add(item.call_id);
          sendJsonBounded(socket!, { type: "conversation.item.create", item: { type: "function_call_output", call_id: item.call_id, output: "Execution is not connected. No work was performed." } });
          sendJsonBounded(socket!, { type: "response.create" });
          context.onEvent({ kind: "error", code: "LIVE_EXECUTION_NOT_CONNECTED" });
        }
      }
      const normalizedEvents = parseRealtimeMessage(value, binding.wireProfile);
      for (const normalized of normalizedEvents) {
        if (normalized.kind === "audio" && normalized.responseId && !responseTracker.shouldAcceptAudio(normalized.responseId)) continue;
        if (staleCompletion && (normalized.kind === "turn-complete" || (normalized.kind === "activity" && normalized.assistantSpeaking === false))) continue;
        context.onEvent(normalized);
      }
    } catch {
      context.onEvent({ kind: "error", code: "LIVE_PROTOCOL_ERROR" });
      const failure = Object.assign(new Error("Realtime protocol response is invalid"), { errorCode: "LIVE_PROTOCOL_ERROR" });
      createdReject?.(failure);
      updatedReject?.(failure);
    }
  }

  return {
    adapterId: "openai-realtime",
    mediaKind: "pcm",
    async connect() {
      if (closed || context.signal.aborted) throw Object.assign(new Error("Live call was cancelled"), { errorCode: "LIVE_STALE_CALL" });
      const url = realtimeUrl(baseUrl, binding.modelId);
      const liveSocket = await openLiveWebSocket({ url, headers: { Authorization: `Bearer ${apiKey}`, ...(binding.wireProfile === "realtime-compat-v1" ? { "OpenAI-Beta": "realtime=v1" } : {}) }, signal: context.signal, endpointOrigin: "user" });
      socket = liveSocket;
      liveSocket.on("message", onSocketMessage);
      liveSocket.once("close", () => { if (!closed) context.onEvent({ kind: "error", code: "LIVE_NETWORK_ERROR" }); });
      liveSocket.once("error", () => { if (!closed) context.onEvent({ kind: "error", code: "LIVE_NETWORK_ERROR" }); });
      await waitForSocketReady(liveSocket, context.signal);
      await waitForReady(created, context.signal, 12_000, "Realtime session creation timed out");
      await waitForReady(updated, context.signal, 12_000, "Realtime session update timed out");
      return {};
    },
    sendInputPcm(bytes) {
      if (closed || !configured || muted || !socket || socket.readyState !== WebSocket.OPEN) return;
      if (bytes.byteLength < 2 || bytes.byteLength > MAX_FRAME_BYTES || bytes.byteLength > MAX_LIVE_AUDIO_BYTES || bytes.byteLength % 2 !== 0) {
        throw Object.assign(new Error("Realtime audio frame is invalid"), { errorCode: "LIVE_AUDIO_BACKPRESSURE" });
      }
      sendJsonBounded(socket, realtimeAudioMessage(bytes));
    },
    async setInputMuted(nextMuted) {
      muted = nextMuted;
    },
    async interrupt(cursors?: LivePlaybackCursor[]) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (responseTracker.shouldSendCancel()) sendJsonBounded(socket, { type: "response.cancel" });
      for (const cursor of cursors ?? []) {
        const messages = realtimeTruncateMessages({ itemId: cursor.itemId, contentIndex: cursor.contentIndex, audioEndMs: cursor.playedSamples * 1000 / cursor.sampleRate });
        // Local playback is already stopped; send the measured interruption cursor upstream.
        sendJsonBounded(socket, messages[1]);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      createdReject?.(new Error("Realtime call closed"));
      updatedReject?.(new Error("Realtime call closed"));
      responseTracker.clear();
      rejectedFunctionCalls.clear();
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, "call ended");
      socket = null;
    },
  };
}
