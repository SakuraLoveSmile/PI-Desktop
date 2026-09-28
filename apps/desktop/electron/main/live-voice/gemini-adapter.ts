import type { LiveBinding } from "@pi-desktop/shared";
import { geminiAudioEndMessage, geminiAudioMessage, geminiSetupMessage, MAX_LIVE_AUDIO_BYTES, MAX_LIVE_JSON_BYTES, parseGeminiMessage } from "@pi-desktop/voice-runtime/live";
import type { LiveAdapter, LiveAdapterContext } from "./types";
import { openLiveWebSocket } from "./websocket-transport";
import { sendJsonBounded, waitForReady, waitForSocketReady, websocketJson } from "./websocket-wire";
import { WebSocket } from "ws";

const GEMINI_LIVE_ENDPOINT = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MAX_FRAME_BYTES = 16000 * 2 / 10;

export function createGeminiAdapter(context: LiveAdapterContext): LiveAdapter {
  const binding = context.binding as Extract<LiveBinding, { adapterId: "gemini-live" }>;
  if (context.auth.kind !== "api-key") {
    throw Object.assign(new Error("Gemini Live requires a Provider API key"), { errorCode: "LIVE_AUTH_KIND_UNSUPPORTED" });
  }
  const apiKey = context.auth.apiKey;
  let socket: Awaited<ReturnType<typeof openLiveWebSocket>> | null = null;
  let closed = false;
  let muted = context.signal.aborted;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

  function onSocketMessage(data: unknown): void {
    try {
      const value = websocketJson(data, MAX_LIVE_JSON_BYTES);
      const root = value as Record<string, unknown>;
      const server = root.serverContent as Record<string, unknown> | undefined;
      const toolCall = root.toolCall as Record<string, unknown> | undefined;
      if (toolCall) {
        const calls = Array.isArray(toolCall.functionCalls) ? toolCall.functionCalls : [];
        if (calls.length > 16) throw new Error("tool call limit exceeded");
        for (const call of calls) {
          const item = call as Record<string, unknown>;
          if (typeof item.id !== "string" || typeof item.name !== "string") throw new Error("tool call shape invalid");
          sendJsonBounded(socket!, {
            toolResponse: {
              functionResponses: [{ id: item.id, name: item.name, response: { output: "Execution is not connected. No work was performed." } }],
            },
          });
          context.onEvent({ kind: "error", code: "LIVE_EXECUTION_NOT_CONNECTED" });
        }
      }
      if (server?.modelTurn && typeof server.modelTurn === "object") {
        const parts = (server.modelTurn as { parts?: unknown[] }).parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            const inline = part && typeof part === "object" ? (part as { inlineData?: unknown }).inlineData : null;
            if (inline && typeof inline === "object") {
              const mimeType = (inline as { mimeType?: unknown }).mimeType;
              if (typeof mimeType === "string" && !/audio\/pcm;rate=24000/i.test(mimeType)) {
                throw new Error("unsupported Gemini audio sample rate");
              }
            }
          }
        }
      }
      for (const event of parseGeminiMessage(value)) {
        if (event.kind === "ready") readyResolve?.();
        context.onEvent(event);
      }
    } catch {
      context.onEvent({ kind: "error", code: "LIVE_PROTOCOL_ERROR" });
      readyReject?.(Object.assign(new Error("Gemini Live protocol response is invalid"), { errorCode: "LIVE_PROTOCOL_ERROR" }));
    }
  }

  return {
    adapterId: "gemini-live",
    mediaKind: "pcm",
    async connect() {
      if (closed || context.signal.aborted) throw Object.assign(new Error("Live call was cancelled"), { errorCode: "LIVE_STALE_CALL" });
      const url = new URL(GEMINI_LIVE_ENDPOINT);
      url.searchParams.set("key", apiKey);
      const liveSocket = await openLiveWebSocket({ url: url.toString(), signal: context.signal, endpointOrigin: "third-party" });
      socket = liveSocket;
      liveSocket.on("message", onSocketMessage);
      liveSocket.once("close", (code) => {
        if (!closed) context.onEvent({ kind: "error", code: code === 1000 ? "LIVE_NETWORK_ERROR" : "LIVE_NETWORK_ERROR" });
      });
      liveSocket.once("error", () => {
        if (!closed) context.onEvent({ kind: "error", code: "LIVE_NETWORK_ERROR" });
      });
      await waitForSocketReady(liveSocket, context.signal);
      sendJsonBounded(liveSocket, geminiSetupMessage({ modelId: binding.modelId, voice: binding.voice }));
      await waitForReady(ready, context.signal, 12_000, "Gemini Live setup timed out");
      return {};
    },
    sendInputPcm(bytes) {
      if (closed || muted || !socket || socket.readyState !== WebSocket.OPEN) return;
      if (bytes.byteLength < 2 || bytes.byteLength > MAX_FRAME_BYTES || bytes.byteLength % 2 !== 0 || bytes.byteLength > MAX_LIVE_AUDIO_BYTES) {
        throw Object.assign(new Error("Gemini Live audio frame is invalid"), { errorCode: "LIVE_AUDIO_BACKPRESSURE" });
      }
      sendJsonBounded(socket, geminiAudioMessage(bytes));
    },
    async setInputMuted(nextMuted) {
      muted = nextMuted;
      if (nextMuted && socket?.readyState === WebSocket.OPEN) sendJsonBounded(socket, geminiAudioEndMessage());
    },
    async close() {
      if (closed) return;
      closed = true;
      readyReject?.(new Error("Gemini Live call closed"));
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, "call ended");
      socket = null;
    },
  };
}
