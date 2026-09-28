/** Pure wire shaping and bounded event parsing for first-party Live protocols. */

export const MAX_LIVE_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_LIVE_TEXT_BYTES = 64 * 1024;
export const MAX_LIVE_AUDIO_BYTES = 512 * 1024;

export type LiveWireEvent =
  | { kind: "ready" }
  | { kind: "audio"; bytes: Uint8Array; responseId?: string; itemId?: string; contentIndex?: number }
  | { kind: "transcript"; role: "user" | "assistant"; text: string; final: boolean; id: string }
  | { kind: "activity"; userSpeaking?: boolean; assistantSpeaking?: boolean }
  | { kind: "interrupted" }
  | { kind: "turn-complete" }
  | { kind: "delegation"; delegationId: string; instruction: string }
  | { kind: "tool-call-cancelled"; ids: string[] }
  | { kind: "closed"; code?: number }
  | { kind: "error"; code: string };

export function parseCodexMessage(value: unknown): LiveWireEvent[] {
  const event = record(value);
  if (!event || typeof event.type !== "string") return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
  if (event.type === "delegation.created") {
    const item = record(event.item);
    if (!item || item.type !== "delegation" || item.target !== "client") return [];
    const delegationId = text(item.id, 256);
    if (!delegationId || !Array.isArray(item.content)) return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
    const instruction = item.content.flatMap((part) => {
      const content = record(part);
      return content?.type === "input_text" && typeof content.text === "string" ? [content.text] : [];
    }).join("").trim();
    if (!instruction || new TextEncoder().encode(instruction).byteLength > 8 * 1024) return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
    return [{ kind: "delegation", delegationId, instruction }];
  }
  if (event.type === "error") return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
  if (event.type === "input_audio_buffer.speech_started") return [{ kind: "activity", userSpeaking: true }];
  if (event.type === "input_audio_buffer.speech_stopped") return [{ kind: "activity", userSpeaking: false }];
  if (["output_audio_buffer.started", "response.output_audio.delta", "response.audio.delta"].includes(event.type)) {
    return [{ kind: "activity", assistantSpeaking: true }];
  }
  if (["output_audio_buffer.stopped", "turn.done", "response.done"].includes(event.type)) {
    return [{ kind: "turn-complete" }, { kind: "activity", assistantSpeaking: false }];
  }
  if (event.type === "input_transcript.added" && typeof event.text === "string") {
    const transcript = text(event.text);
    return transcript ? [{ kind: "transcript", role: "user", text: transcript, final: true, id: "codex-input" }] : [];
  }
  if (event.type === "output_transcript.added" && typeof event.text === "string") {
    const transcript = text(event.text);
    return [
      ...(transcript ? [{ kind: "transcript" as const, role: "assistant" as const, text: transcript, final: true, id: "codex-output" }] : []),
      { kind: "activity", assistantSpeaking: true },
    ];
  }
  return [];
}

export function codexDelegationFeedback(delegationId: string): string {
  return JSON.stringify({
    type: "delegation.context.append",
    delegation_item_id: delegationId,
    channel: "commentary",
    content: [{
      type: "input_text",
      text: "This request did not create a new task. Follow the Host context feedback; do not retry this delegation automatically.",
    }],
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = MAX_LIVE_TEXT_BYTES): string | null {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).byteLength > max) return null;
  return value;
}

function decodeBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_LIVE_AUDIO_BYTES * 4 / 3)) return null;
  try {
    const decoded = atob(value);
    if (decoded.length === 0 || decoded.length > MAX_LIVE_AUDIO_BYTES) return null;
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export function geminiSetupMessage(input: {
  modelId: string;
  voice: string;
}): Record<string, unknown> {
  return {
    setup: {
      model: input.modelId.startsWith("models/") ? input.modelId : `models/${input.modelId}`,
      systemInstruction: {
        parts: [{ text: "You are a voice assistant in a conversation. Do not claim to perform actions. You have no access to files, tools, or the coding agent." }],
      },
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } } },
      },
      realtimeInputConfig: { automaticActivityDetection: { disabled: false } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: {
        triggerTokens: "25000",
        slidingWindow: { targetTokens: "8000" },
      },
    },
  };
}

export function geminiAudioMessage(bytes: Uint8Array): Record<string, unknown> {
  return {
    realtimeInput: {
      audio: {
        mimeType: "audio/pcm;rate=16000",
        data: bytesToBase64(bytes),
      },
    },
  };
}

export function geminiAudioEndMessage(): Record<string, unknown> {
  return { realtimeInput: { audioStreamEnd: true } };
}

export function parseGeminiMessage(value: unknown): LiveWireEvent[] {
  const root = record(value);
  if (!root) return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
  if (root.setupComplete !== undefined) return [{ kind: "ready" }];
  if (root.goAway !== undefined) return [{ kind: "error", code: "LIVE_TIMEOUT" }];
  const events: LiveWireEvent[] = [];
  const cancellation = record(root.toolCallCancellation);
  if (cancellation) {
    if (!Array.isArray(cancellation.ids) || cancellation.ids.length > 16 || cancellation.ids.some((id) => !text(id, 256))) {
      return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
    }
    events.push({ kind: "tool-call-cancelled", ids: cancellation.ids as string[] });
  }
  const server = record(root.serverContent);
  if (server) {
    const interrupted = server.interrupted === true;
    if (interrupted) events.push({ kind: "interrupted" }, { kind: "activity", assistantSpeaking: false });
    const inputText = record(server.inputTranscription);
    const input = text(inputText?.text);
    if (input) events.push({ kind: "transcript", role: "user", text: input, final: inputText?.finished === true, id: "gemini-input" });
    const outputText = record(server.outputTranscription);
    const output = text(outputText?.text);
    if (output) events.push({ kind: "transcript", role: "assistant", text: output, final: outputText?.finished === true, id: "gemini-output" });
    const modelTurn = record(server.modelTurn);
    const parts = Array.isArray(modelTurn?.parts) ? modelTurn.parts : [];
    for (const part of parts) {
      const partRecord = record(part);
      const inline = record(partRecord?.inlineData);
      if (inline && !interrupted) {
        if (typeof inline.mimeType !== "string" || !/^audio\/pcm;rate=24000$/i.test(inline.mimeType)) {
          return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
        }
        const bytes = decodeBase64(inline.data);
        if (!bytes || bytes.byteLength % 2 !== 0) return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
        events.push({ kind: "audio", bytes });
      }
      const functionCall = record(partRecord?.functionCall);
      if (functionCall) {
        events.push({ kind: "error", code: "LIVE_EXECUTION_NOT_CONNECTED" });
      }
    }
    if (modelTurn && !interrupted) events.push({ kind: "activity", assistantSpeaking: true });
    if (server.turnComplete === true || server.generationComplete === true) {
      events.push({ kind: "turn-complete" }, { kind: "activity", assistantSpeaking: false });
    }
  }
  return events;
}

export function realtimeSessionUpdateMessage(input: {
  modelId: string;
  voice: string;
  profile: "realtime-ga" | "realtime-compat-v1";
}): Record<string, unknown> {
  const instructions = "You are a voice assistant. Do not claim to execute actions. There is no access to project files, tools, or the coding agent.";
  if (input.profile === "realtime-compat-v1") {
    return {
      type: "session.update",
      session: {
        model: input.modelId,
        instructions,
        modalities: ["text", "audio"],
        voice: input.voice,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: { type: "server_vad" },
      },
    };
  }
  return {
    type: "session.update",
    session: {
      type: "realtime",
      model: input.modelId,
      instructions,
      output_modalities: ["audio"],
      audio: {
        input: { format: { type: "audio/pcm", rate: 24000 }, turn_detection: { type: "server_vad" }, transcription: { model: "gpt-4o-mini-transcribe" } },
        output: { format: { type: "audio/pcm", rate: 24000 }, voice: input.voice },
      },
    },
  };
}

export function realtimeSessionMatches(input: {
  session: unknown;
  modelId: string;
  voice: string;
  profile: "realtime-ga" | "realtime-compat-v1";
}): boolean {
  const session = record(input.session);
  if (!session || session.model !== input.modelId) return false;
  if (input.profile === "realtime-compat-v1") {
    const detection = record(session.turn_detection);
    return Array.isArray(session.modalities) && session.modalities.includes("audio") &&
      session.voice === input.voice && session.input_audio_format === "pcm16" &&
      session.output_audio_format === "pcm16" && detection?.type === "server_vad";
  }
  const audio = record(session.audio);
  const inputAudio = record(audio?.input);
  const outputAudio = record(audio?.output);
  const inputFormat = record(inputAudio?.format);
  const outputFormat = record(outputAudio?.format);
  const detection = record(inputAudio?.turn_detection);
  return session.type === "realtime" && Array.isArray(session.output_modalities) && session.output_modalities.includes("audio") &&
    inputFormat?.type === "audio/pcm" && inputFormat.rate === 24000 && detection?.type === "server_vad" &&
    outputFormat?.type === "audio/pcm" && outputFormat.rate === 24000 && outputAudio?.voice === input.voice;
}

export function realtimeAudioMessage(bytes: Uint8Array): Record<string, unknown> {
  return { type: "input_audio_buffer.append", audio: bytesToBase64(bytes) };
}

export function realtimeTruncateMessages(cursor: {
  itemId: string;
  contentIndex: number;
  audioEndMs: number;
}): Record<string, unknown>[] {
  return [
    { type: "response.cancel" },
    { type: "conversation.item.truncate", item_id: cursor.itemId, content_index: cursor.contentIndex, audio_end_ms: Math.max(0, Math.floor(cursor.audioEndMs)) },
  ];
}

export function parseRealtimeMessage(value: unknown, profile: "realtime-ga" | "realtime-compat-v1" = "realtime-ga"): LiveWireEvent[] {
  const event = record(value);
  if (!event || typeof event.type !== "string") return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
  switch (event.type) {
    case "session.created":
      return [];
    case "session.updated":
      return [{ kind: "ready" }];
    case "input_audio_buffer.speech_started":
      return [{ kind: "activity", userSpeaking: true }, { kind: "interrupted" }];
    case "input_audio_buffer.speech_stopped":
      return [{ kind: "activity", userSpeaking: false }];
    case "response.output_audio.delta":
    case "response.audio.delta": {
      if ((event.type === "response.output_audio.delta") !== (profile === "realtime-ga")) return [];
      const bytes = decodeBase64(event.delta);
      const itemId = text(event.item_id, 256);
      const responseId = text(event.response_id, 256);
      const contentIndex = event.content_index;
      if (!bytes || !itemId || !responseId || !Number.isSafeInteger(contentIndex) || (contentIndex as number) < 0) return [{ kind: "error", code: "LIVE_PROTOCOL_ERROR" }];
      return [{ kind: "audio", bytes, responseId, itemId, contentIndex: contentIndex as number }];
    }
    case "response.output_audio_transcript.delta":
    case "response.output_audio_transcript.done":
    case "response.audio_transcript.delta":
    case "response.audio_transcript.done":
    case "response.output_text.delta":
    case "response.output_text.done": {
      if (event.type.startsWith("response.audio_transcript.") && profile !== "realtime-compat-v1") return [];
      if (event.type.startsWith("response.output_audio_transcript.") && profile !== "realtime-ga") return [];
      if (event.type.startsWith("response.output_text.") && profile !== "realtime-ga") return [];
      const valueText = text(event.delta) ?? text(event.transcript) ?? text(event.text);
      if (!valueText) return [];
      return [{ kind: "transcript", role: "assistant", text: valueText, final: event.type.endsWith(".done"), id: text(event.item_id, 256) ?? "realtime-assistant" }];
    }
    case "conversation.item.input_audio_transcription.completed": {
      const valueText = text(event.transcript);
      return valueText ? [{ kind: "transcript", role: "user", text: valueText, final: true, id: text(event.item_id, 256) ?? "realtime-user" }] : [];
    }
    case "response.created":
      return [{ kind: "activity", assistantSpeaking: true }];
    case "response.done":
    case "response.cancelled":
      return [{ kind: "turn-complete" }, { kind: "activity", assistantSpeaking: false }];
    case "error": {
      const detail = record(event.error);
      const code = typeof detail?.code === "string" && detail.code.length < 80 ? detail.code : "LIVE_PROTOCOL_ERROR";
      return [{ kind: "error", code: mapRealtimeError(code) }];
    }
    case "response.function_call_arguments.done":
    case "response.output_item.done":
      return [];
    default:
      return [];
  }
}

function mapRealtimeError(code: string): string {
  if (/rate|quota/i.test(code)) return "LIVE_RATE_LIMITED";
  if (/unauth|credential|api_key/i.test(code)) return "LIVE_AUTH_REQUIRED";
  if (/model|unsupported/i.test(code)) return "LIVE_PROTOCOL_UNSUPPORTED";
  return "LIVE_PROTOCOL_ERROR";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
  }
  return btoa(binary);
}
