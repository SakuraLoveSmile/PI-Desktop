import { describe, expect, it } from "vitest";
import {
  codexDelegationFeedback,
  geminiSetupMessage,
  parseCodexMessage,
  parseGeminiMessage,
  parseRealtimeMessage,
  realtimeSessionMatches,
  realtimeSessionUpdateMessage,
  realtimeTruncateMessages,
} from "./protocol.js";

describe("Live wire profiles", () => {
  it("keeps Codex transcripts visible and answers client delegation without granting execution", () => {
    expect(parseCodexMessage({ type: "output_transcript.added", text: "Hello there." })).toEqual([
      { kind: "transcript", role: "assistant", text: "Hello there.", final: true, id: "codex-output" },
      { kind: "activity", assistantSpeaking: true },
    ]);
    expect(parseCodexMessage({
      type: "delegation.created",
      item: { type: "delegation", target: "client", id: "delegation-1", content: [{ type: "input_text", text: "Read a local file" }] },
    })).toEqual([{ kind: "delegation", delegationId: "delegation-1", instruction: "Read a local file" }]);
    expect(codexDelegationFeedback("delegation-1")).toContain("did not create a new task");
  });

  it("waits for Gemini setup completion and normalizes every audio part", () => {
    expect(geminiSetupMessage({ modelId: "gemini-live", voice: "Kore" })).toMatchObject({
      setup: {
        model: "models/gemini-live",
        systemInstruction: { parts: [{ text: expect.stringContaining("no access to files") }] },
        generationConfig: { responseModalities: ["AUDIO"] },
        contextWindowCompression: { triggerTokens: "25000", slidingWindow: { targetTokens: "8000" } },
      },
    });
    const bytes = btoa(String.fromCharCode(0, 0, 1, 0));
    expect(parseGeminiMessage({ setupComplete: {} })).toEqual([{ kind: "ready" }]);
    const events = parseGeminiMessage({ serverContent: { modelTurn: { parts: [
      { inlineData: { mimeType: "audio/pcm;rate=24000", data: bytes } },
      { inlineData: { mimeType: "audio/pcm;rate=24000", data: bytes } },
    ] }, turnComplete: true } });
    expect(events.map((event) => event.kind)).toEqual([
      "audio",
      "audio",
      "activity",
      "turn-complete",
      "activity",
    ]);
    expect(events.slice(0, 2)).toEqual([
      { kind: "audio", bytes: new Uint8Array([0, 0, 1, 0]) },
      { kind: "audio", bytes: new Uint8Array([0, 0, 1, 0]) },
    ]);
    expect(events.slice(2)).toEqual([
      { kind: "activity", assistantSpeaking: true },
      { kind: "turn-complete" },
      { kind: "activity", assistantSpeaking: false },
    ]);
    expect(parseGeminiMessage({ toolCallCancellation: { ids: ["call-1"] } })).toEqual([
      { kind: "tool-call-cancelled", ids: ["call-1"] },
    ]);
    expect(parseGeminiMessage({ serverContent: {
      interrupted: true,
      modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: bytes } }] },
    } })).toEqual([
      { kind: "interrupted" },
      { kind: "activity", assistantSpeaking: false },
    ]);
    expect(parseGeminiMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: bytes } }] } } })).toEqual([
      { kind: "error", code: "LIVE_PROTOCOL_ERROR" },
    ]);
  });

  it("truncates realtime output at the played cursor after cancelling", () => {
    expect(realtimeTruncateMessages({ itemId: "item-1", contentIndex: 0, audioEndMs: 825.9 })).toEqual([
      { type: "response.cancel" },
      { type: "conversation.item.truncate", item_id: "item-1", content_index: 0, audio_end_ms: 825 },
    ]);
    expect(parseRealtimeMessage({ type: "input_audio_buffer.speech_started" })).toEqual([
      { kind: "activity", userSpeaking: true },
      { kind: "interrupted" },
    ]);
  });

  it("keeps GA and compat-v1 session fields and audio events distinct", () => {
    const ga = realtimeSessionUpdateMessage({ modelId: "gpt-realtime", voice: "marin", profile: "realtime-ga" }).session as Record<string, unknown>;
    expect(ga).toMatchObject({ type: "realtime", output_modalities: ["audio"] });
    expect(ga).toHaveProperty("audio.input.format", { type: "audio/pcm", rate: 24000 });
    expect(ga).toHaveProperty("audio.output.format", { type: "audio/pcm", rate: 24000 });
    expect(ga).not.toHaveProperty("input_audio_format");
    expect(realtimeSessionMatches({ session: ga, modelId: "gpt-realtime", voice: "marin", profile: "realtime-ga" })).toBe(true);
    expect(realtimeSessionMatches({ session: { ...ga, output_modalities: ["text"] }, modelId: "gpt-realtime", voice: "marin", profile: "realtime-ga" })).toBe(false);

    const compat = realtimeSessionUpdateMessage({ modelId: "gateway-realtime", voice: "cove", profile: "realtime-compat-v1" }).session as Record<string, unknown>;
    expect(compat).toMatchObject({ modalities: ["text", "audio"], input_audio_format: "pcm16", output_audio_format: "pcm16", voice: "cove" });
    expect(compat).not.toHaveProperty("type");
    expect(compat).not.toHaveProperty("audio");
    expect(compat).not.toHaveProperty("output_modalities");
    expect(realtimeSessionMatches({ session: compat, modelId: "gateway-realtime", voice: "cove", profile: "realtime-compat-v1" })).toBe(true);

    const audio = btoa(String.fromCharCode(0, 0, 1, 0));
    expect(parseRealtimeMessage({ type: "response.output_audio.delta", delta: audio, response_id: "ga-response", item_id: "ga-item", content_index: 0 }, "realtime-ga")[0]).toMatchObject({ kind: "audio", responseId: "ga-response", itemId: "ga-item" });
    expect(parseRealtimeMessage({ type: "response.audio.delta", delta: audio, response_id: "compat-response", item_id: "compat-item", content_index: 0 }, "realtime-compat-v1")[0]).toMatchObject({ kind: "audio", responseId: "compat-response", itemId: "compat-item" });
    expect(parseRealtimeMessage({ type: "response.audio.delta", delta: audio, response_id: "wrong-profile", item_id: "wrong-profile", content_index: 0 }, "realtime-ga")).toEqual([]);
  });
});
