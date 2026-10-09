import type { MessageUsage } from "./types.js";

/** Captured at dispatch, before credentials or transport headers are attached. */
export type ContextInsightsCategory = "system" | "tools" | "user" | "injected" | "skill" | "assistant" | "toolResult";
export type ContextInsightsEntry = {
  id: string;
  category: ContextInsightsCategory;
  label: string;
  kind?: "thinking" | "answer" | "toolCall";
  content: string;
  estimatedTokens: number;
  originalChars: number;
  historical?: boolean;
  truncated: boolean;
  contentOmitted?: boolean;
  images?: Array<{ mimeType: string; encodedBytes: number }>;
};
export type ContextInsightsRequest = {
  id: string;
  turnId?: string;
  step: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  status: "running" | "completed" | "error" | "aborted";
  providerId: string;
  modelId: string;
  mode: string;
  purpose?: "agent" | "compaction" | "subagent";
  agentName?: string;
  parentToolCallId?: string;
  contextWindow: number;
  /** Runtime's usage-calibrated estimate; entry estimates are uncalibrated. */
  estimatedTokens: number;
  estimateSource: "runtime-usage-anchor";
  contentRevision?: number;
  captureSource?: "pi-context" | "provider-payload";
  providerPayload?: { content: string; originalChars: number; truncated: boolean; redacted: boolean; contentOmitted?: boolean };
  entries: ContextInsightsEntry[];
  usage?: MessageUsage;
  contentTruncated: boolean;
  providerStatus?: number;
  requestBytes?: number;
  omittedEntries?: number;
};
export type ContextInsightsEvent = {
  id: string;
  at: number;
  type: "compaction" | "prune" | "model" | "mode" | "injection";
  label: string;
  turnId?: string;
  requestId?: string;
  tokensBefore?: number;
  tokensAfter?: number;
};
export type ContextInsightsSnapshot = {
  version: 1;
  sessionId: string;
  requests: ContextInsightsRequest[];
  events: ContextInsightsEvent[];
  retention: {
    maxRequests: 40;
    maxEvents: 160;
    maxContentChars: 120000;
    maxTotalContentChars: 1200000;
    droppedRequests: number;
    droppedEvents: number;
  };
  updatedAt: number;
};
export const CONTEXT_INSIGHTS_MAX_REQUESTS = 40;
export const CONTEXT_INSIGHTS_MAX_EVENTS = 160;
export const CONTEXT_INSIGHTS_MAX_CONTENT_CHARS = 120000;
export function emptyContextInsights(sessionId: string): ContextInsightsSnapshot {
  return { version: 1, sessionId, requests: [], events: [], retention: {
    maxRequests: 40, maxEvents: 160, maxContentChars: 120000, maxTotalContentChars: 1200000,
    droppedRequests: 0, droppedEvents: 0,
  }, updatedAt: 0 };
}
