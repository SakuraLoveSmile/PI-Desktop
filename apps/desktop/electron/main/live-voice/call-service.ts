import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  ErrorCodes,
  OAUTH_AUTH_KIND,
  type AppSettings,
  type LiveBinding,
  type LiveBindingReadiness,
  type LiveCallView,
  type LiveConnectRequest,
  type LiveControlEvent,
  type LiveDelegationRequest,
  type LiveEndReason,
  type LiveEndRequest,
  type LiveMediaReport,
  type LivePhase,
  type LivePlaybackCursor,
  type LivePrepareRequest,
  type LivePreparedCall,
  type LiveStatus,
  type LiveTranscriptEvent,
  type LiveVoiceSettings,
  validateLiveVoiceSettings,
} from "@pi-desktop/shared";
import type { LiveWireEvent } from "@pi-desktop/voice-runtime/live";
import { LiveAuthResolver } from "./auth-resolver";
import type { LivePcmBridge } from "./audio-port";
import type { LiveAdapter, LiveAdapterContext, LiveResolvedAuth } from "./types";

export type LiveOwner = {
  webContentsId: number;
  frameProcessId: number;
  frameRoutingId: number;
  url: string;
};

export type LiveCallServiceDeps = {
  loadSettings: () => Promise<AppSettings>;
  authResolver: LiveAuthResolver;
  createAdapter: (context: LiveAdapterContext) => LiveAdapter;
  createPcmBridge: (input: {
    callId: string;
    owner: LiveOwner;
    inputSampleRate: 16000 | 24000;
    outputSampleRate: 24000;
    onInput: (bytes: Uint8Array, captureEpoch: number) => void;
    onPlaybackPosition: (cursors: LivePlaybackCursor[]) => void;
    onReleased: () => void;
    onFailure: (code: string) => void;
  }) => LivePcmBridge;
  sendView: (owner: LiveOwner, view: LiveCallView) => void;
  sendControl: (owner: LiveOwner, event: LiveControlEvent) => void;
  sendTranscript: (owner: LiveOwner, event: LiveTranscriptEvent) => void;
  ownerAlive: (owner: LiveOwner) => boolean;
  acquireMicrophone: (callId: string) => () => void;
  acquireBackgroundThrottlingLease?: (callId: string) => () => void;
  now?: () => number;
};

type Slot = {
  callId: string;
  requestId: string;
  requestedBindingId: string;
  owner: LiveOwner;
  binding: LiveBinding | null;
  settingsRevision: number;
  phase: LivePhase;
  revision: number;
  abort: AbortController;
  desiredMuted: boolean;
  muted: boolean;
  captureEpoch: number;
  playbackEpoch: number;
  microphoneActive: boolean;
  mediaRelease: "pending" | "confirmed" | "unconfirmed";
  mediaReleased: Promise<void>;
  resolveMediaReleased: (() => void) | null;
  connectedAt?: string;
  playbackBlocked?: boolean;
  userSpeaking: boolean;
  assistantSpeaking: boolean;
  error?: { code: string; stage?: string; retriable: boolean };
  notice?: { code: string; retriable: boolean };
  adapter: LiveAdapter | null;
  bridge: LivePcmBridge | null;
  releaseMicrophone: (() => void) | null;
  releaseBackgroundLease: (() => void) | null;
  heartbeatAt: number;
  maxDurationTimer?: ReturnType<typeof setTimeout>;
  heartbeatTimer?: ReturnType<typeof setTimeout>;
  reservationTimer?: ReturnType<typeof setTimeout>;
  connectPromise?: Promise<{ answerSdp?: string; revision: number }>;
  connectFingerprint?: string;
  delegationInstructions: Map<string, string>;
  pendingControls: Map<string, { timer: ReturnType<typeof setTimeout> }>;
  transcriptLengths: Map<string, number>;
};

type RequestEntry = { fingerprint: string; promise: Promise<LivePreparedCall> };
type SettingsSnapshot = { value: LiveVoiceSettings; fingerprint: string; revision: number; invalid: boolean };

const MAX_CALLS_PER_OWNER_REQUEST_CACHE = 64;
const MAX_DELEGATIONS_PER_CALL = 256;
const MAX_TRANSCRIPT_SEGMENTS = 200;
const MAX_TRANSCRIPT_BYTES = 64 * 1024;
const MAX_INSTRUCTION_BYTES = 8 * 1024;
const PREPARE_DEADLINE_MS = 5_000;
const RESERVATION_TIMEOUT_MS = 60_000;
const AUTH_TIMEOUT_MS = 15_000;
const CONNECT_TIMEOUT_MS = 15_000;
const TOTAL_CONNECT_TIMEOUT_MS = 40_000;
const OWNER_LEASE_MS = 20_000;
const OWNER_HEARTBEAT_MS = 5_000;
const MAX_CALL_MS = 30 * 60_000;
const REJECTION_ACK_TIMEOUT_MS = 1_000;

function ownerKey(owner: LiveOwner): string {
  return `${owner.webContentsId}:${owner.frameProcessId}:${owner.frameRoutingId}`;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function liveVoiceFromSettings(settings: unknown): { value: LiveVoiceSettings; invalid: boolean } {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { value: { enabled: false, bindings: [] }, invalid: true };
  const raw = (settings as { liveVoice?: unknown }).liveVoice;
  if (raw === undefined) return { value: { enabled: false, bindings: [] }, invalid: false };
  try {
    return { value: validateLiveVoiceSettings(raw), invalid: false };
  } catch {
    return { value: { enabled: false, bindings: [] }, invalid: true };
  }
}

function transition(slot: Slot, next: LivePhase): void {
  const allowed: Record<LivePhase, readonly LivePhase[]> = {
    idle: ["preparing"],
    preparing: ["acquiring-mic", "closing", "failed"],
    "acquiring-mic": ["negotiating", "connecting", "closing", "failed"],
    negotiating: ["connecting", "closing", "failed"],
    connecting: ["connected", "closing", "failed"],
    connected: ["reconnecting", "closing", "failed"],
    reconnecting: ["connected", "closing", "failed"],
    closing: ["ended", "failed"],
    ended: [],
    failed: [],
  };
  if (slot.phase !== next && !allowed[slot.phase].includes(next)) {
    throw Object.assign(new Error("Live call state transition is invalid"), { errorCode: "LIVE_PROTOCOL_ERROR" });
  }
  slot.phase = next;
}

function errorCode(error: unknown, fallback = "LIVE_NETWORK_ERROR"): { code: string; retriable: boolean } {
  const value = error && typeof error === "object" ? error as { errorCode?: unknown; retriable?: unknown } : null;
  const allowed = new Set<string>([
    "LIVE_DISABLED", "LIVE_NOT_CONFIGURED", "LIVE_PROVIDER_NOT_FOUND", "LIVE_AUTH_KIND_UNSUPPORTED", "LIVE_AUTH_REQUIRED",
    "LIVE_ACCOUNT_ID_MISSING", "LIVE_ACCESS_DENIED", "LIVE_RATE_LIMITED", "LIVE_PROTOCOL_UNSUPPORTED", "LIVE_PROTOCOL_ERROR",
    "LIVE_ALREADY_ACTIVE", "LIVE_REQUEST_CONFLICT", "LIVE_SETTINGS_IN_USE", "LIVE_MEDIA_RELEASE_UNCONFIRMED", "LIVE_STALE_CALL",
    "LIVE_INVALID_OWNER", "LIVE_MICROPHONE_BUSY", "LIVE_MICROPHONE_DENIED", "LIVE_MICROPHONE_UNAVAILABLE", "LIVE_MEDIA_UNSUPPORTED",
    "LIVE_PLAYBACK_BLOCKED", "LIVE_TIMEOUT", "LIVE_NETWORK_ERROR", "LIVE_NETWORK_POLICY_UNSUPPORTED", "LIVE_AUDIO_BACKPRESSURE",
    "LIVE_EXECUTION_NOT_CONNECTED",
  ]);
  const code = typeof value?.errorCode === "string" && allowed.has(value.errorCode) ? value.errorCode : fallback;
  return { code, retriable: typeof value?.retriable === "boolean" ? value.retriable : ["LIVE_TIMEOUT", "LIVE_NETWORK_ERROR", "LIVE_RATE_LIMITED"].includes(code) };
}

export class LiveCallService {
  private current: Slot | null = null;
  private terminal: LiveCallView | null = null;
  private quarantine: { owner: LiveOwner; releaseMicrophone: (() => void) | null } | null = null;
  private readonly requests = new Map<string, RequestEntry>();
  private readonly cancellationTombstones = new Map<string, number>();
  private settingsSnapshot: SettingsSnapshot | null = null;
  private settingsWritePending = false;
  private readonly deps: LiveCallServiceDeps;
  private readonly now: () => number;

  constructor(deps: LiveCallServiceDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  async status(): Promise<LiveStatus> {
    const snapshot = await this.readSettings();
    const bindings: LiveBindingReadiness[] = [];
    for (const binding of snapshot.value.bindings) {
      let item: LiveBindingReadiness = {
        bindingId: binding.id,
        adapterId: binding.adapterId,
        configured: true,
        credentialsPresent: false,
        selectable: false,
      };
      try {
        const record = await this.deps.authResolver.provider(binding.providerId);
        if (!record?.provider) item = { ...item, reason: "missing-provider" };
        else {
          item = { ...item, providerLabel: `${record.provider.name} · ${record.provider.id.slice(-6)}` };
          if (!record.provider.enabled) item = { ...item, reason: "disabled" };
          else if (!this.providerMatches(binding, record.provider)) item = { ...item, reason: "wrong-auth-kind" };
          else if (!record.provider.hasSecret) item = { ...item, reason: "missing-credentials" };
          else item = { ...item, credentialsPresent: true, selectable: snapshot.value.enabled && !snapshot.invalid, ...(snapshot.value.enabled ? {} : { reason: "disabled" }) };
        }
      } catch {
        item = { ...item, reason: "missing-provider" };
      }
      if (snapshot.invalid) item = { ...item, selectable: false, reason: "invalid-settings" };
      bindings.push(item);
    }
    return {
      enabled: snapshot.value.enabled && !snapshot.invalid,
      settingsRevision: snapshot.revision,
      ...(snapshot.value.selectedBindingId ? { selectedBindingId: snapshot.value.selectedBindingId } : {}),
      bindings,
      call: this.current ? this.toView(this.current) : this.terminal,
    };
  }

  hasMicrophoneReservation(owner: LiveOwner): boolean {
    const slot = this.current;
    return Boolean(
      slot &&
      ownerKey(slot.owner) === ownerKey(owner) &&
      slot.releaseMicrophone &&
      ["preparing", "acquiring-mic", "negotiating", "connecting", "connected", "reconnecting"].includes(slot.phase),
    );
  }

  prepare(owner: LiveOwner, request: LivePrepareRequest): Promise<LivePreparedCall> {
    validatePrepareRequest(request);
    const key = `${ownerKey(owner)}:${request.requestId}`;
    const requestFingerprint = fingerprint(request);
    const existing = this.requests.get(key);
    if (existing) {
      if (existing.fingerprint !== requestFingerprint) return Promise.reject(liveError("LIVE_REQUEST_CONFLICT"));
      return existing.promise;
    }
    this.pruneTombstones();
    if (this.cancellationTombstones.has(key)) return Promise.reject(liveError("LIVE_STALE_CALL"));
    if (this.current || this.quarantine) return Promise.reject(liveError(this.quarantine ? "LIVE_MEDIA_RELEASE_UNCONFIRMED" : "LIVE_ALREADY_ACTIVE"));
    if (this.settingsWritePending) return Promise.reject(liveError("LIVE_SETTINGS_IN_USE"));

    const slot = this.makeSlot(owner, request);
    try {
      // Reserve the process-wide capture lease synchronously with prepare so
      // Dictation cannot begin while the renderer is opening its permission UI.
      slot.releaseMicrophone = this.deps.acquireMicrophone(slot.callId);
    } catch (error) {
      return Promise.reject(error);
    }
    this.current = slot;
    this.terminal = null;
    const promise = Promise.resolve().then(() => this.runPrepare(slot, request)).catch(async (error: unknown) => {
      await this.failAndCleanup(slot, error, "prepare");
      throw error;
    });
    this.requests.set(key, { fingerprint: requestFingerprint, promise });
    this.trimRequests();
    this.publish(slot);
    return promise;
  }

  async connect(owner: LiveOwner, request: LiveConnectRequest): Promise<{ answerSdp?: string; revision: number }> {
    const slot = this.requireCurrent(owner, request.callId);
    const offeredSdp = request.offerSdp;
    if (slot.binding?.adapterId === "codex-live") {
      if (typeof offeredSdp !== "string" || Buffer.byteLength(offeredSdp, "utf8") > 256 * 1024) throw liveError("LIVE_PROTOCOL_ERROR");
    } else if (offeredSdp !== undefined) throw liveError("LIVE_PROTOCOL_ERROR");
    const connectFingerprint = fingerprint({ callId: request.callId, offerSdp: offeredSdp ?? null });
    if (slot.connectPromise) {
      if (slot.connectFingerprint !== connectFingerprint) throw liveError("LIVE_REQUEST_CONFLICT");
      return slot.connectPromise;
    }
    slot.connectFingerprint = connectFingerprint;
    slot.connectPromise = this.runConnect(slot, offeredSdp).catch(async (error: unknown) => {
      await this.failAndCleanup(slot, error, "handshake");
      throw error;
    });
    return slot.connectPromise;
  }

  async setMuted(owner: LiveOwner, request: { callId: string; muted: boolean; captureEpoch: number }): Promise<LiveCallView> {
    const slot = this.requireCurrent(owner, request.callId, true);
    if (typeof request.muted !== "boolean" || !Number.isSafeInteger(request.captureEpoch) || request.captureEpoch <= slot.captureEpoch) throw liveError("LIVE_STALE_CALL");
    if (!request.muted && slot.phase !== "connected") throw liveError("LIVE_STALE_CALL");
    slot.captureEpoch = request.captureEpoch;
    slot.muted = request.muted;
    slot.desiredMuted = request.muted;
    this.publish(slot);
    try {
      if (slot.bridge) await slot.bridge.setMuted(request.muted, request.captureEpoch);
      if (slot.adapter?.setInputMuted) await slot.adapter.setInputMuted(request.muted);
      this.assertCurrent(slot);
      return this.toView(slot);
    } catch (error) {
      if (!request.muted) {
        slot.muted = true;
        slot.desiredMuted = true;
        this.publish(slot);
      }
      throw error;
    }
  }

  reportMedia(owner: LiveOwner, report: LiveMediaReport): LiveCallView {
    const slot = this.requireCurrent(owner, report.callId, report.kind === "released");
    switch (report.kind) {
      case "microphone-active":
        slot.microphoneActive = report.active;
        slot.mediaRelease = report.active ? "pending" : slot.mediaRelease;
        break;
      case "phase":
        if (report.phase === "connected") {
          if (!slot.adapter || slot.phase === "closing" || slot.phase === "failed") throw liveError("LIVE_STALE_CALL");
          if (slot.phase !== "connected") transition(slot, "connected");
          slot.connectedAt ??= new Date(this.now()).toISOString();
          slot.mediaRelease = slot.microphoneActive ? "pending" : slot.mediaRelease;
          this.startCallTimers(slot);
        } else if (slot.phase === "acquiring-mic" || slot.phase === "negotiating") {
          transition(slot, "connecting");
        }
        break;
      case "activity":
        if (report.userSpeaking !== undefined) slot.userSpeaking = report.userSpeaking;
        if (report.assistantSpeaking !== undefined) slot.assistantSpeaking = report.assistantSpeaking;
        break;
      case "playback-blocked":
        slot.playbackBlocked = report.blocked;
        if (report.blocked) slot.notice = { code: "LIVE_PLAYBACK_BLOCKED", retriable: true };
        break;
      case "released":
        slot.microphoneActive = false;
        slot.mediaRelease = "confirmed";
        slot.resolveMediaReleased?.();
        slot.resolveMediaReleased = null;
        break;
    }
    this.publish(slot);
    return this.toView(slot);
  }

  reportPlayback(owner: LiveOwner, input: { callId: string; cursors: LivePlaybackCursor[] }): void {
    const slot = this.requireCurrent(owner, input.callId);
    if (!Array.isArray(input.cursors) || input.cursors.length > 64) throw liveError("LIVE_PROTOCOL_ERROR");
    slot.bridge?.reportPlayback(input.cursors);
  }

  async reportDelegation(owner: LiveOwner, request: LiveDelegationRequest): Promise<{ accepted: boolean }> {
    const slot = this.requireCurrent(owner, request.callId);
    if (slot.binding?.adapterId !== "codex-live" || typeof request.delegationId !== "string" || !request.delegationId.trim() || request.delegationId.length > 256 || typeof request.instruction !== "string" || Buffer.byteLength(request.instruction, "utf8") > MAX_INSTRUCTION_BYTES) {
      throw liveError("LIVE_PROTOCOL_ERROR");
    }
    const id = request.delegationId.trim();
    const prior = slot.delegationInstructions.get(id);
    if (prior !== undefined) {
      if (prior !== request.instruction) throw liveError("LIVE_PROTOCOL_ERROR");
      return { accepted: true };
    }
    if (slot.delegationInstructions.size >= MAX_DELEGATIONS_PER_CALL) throw liveError("LIVE_PROTOCOL_ERROR");
    slot.delegationInstructions.set(id, request.instruction);
    const actionId = randomUUID();
    const timer = setTimeout(() => {
      const current = this.current;
      if (current !== slot || !slot.pendingControls.has(actionId)) return;
      slot.pendingControls.delete(actionId);
      slot.notice = { code: "LIVE_EXECUTION_NOT_CONNECTED", retriable: false };
      void this.failAndCleanup(slot, liveError("LIVE_PROTOCOL_ERROR"), "control");
    }, REJECTION_ACK_TIMEOUT_MS);
    slot.pendingControls.set(actionId, { timer });
    this.deps.sendControl(owner, { callId: slot.callId, kind: "reject-delegation", actionId, delegationId: id, reason: "EXECUTION_NOT_CONNECTED" });
    this.publish(slot);
    return { accepted: true };
  }

  reportControlApplied(owner: LiveOwner, input: { callId: string; actionId: string; applied: boolean; errorCode?: string }): void {
    const slot = this.requireCurrent(owner, input.callId);
    if (typeof input.actionId !== "string" || typeof input.applied !== "boolean") throw liveError("LIVE_PROTOCOL_ERROR");
    const pending = slot.pendingControls.get(input.actionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    slot.pendingControls.delete(input.actionId);
    if (!input.applied) {
      slot.notice = { code: "LIVE_EXECUTION_NOT_CONNECTED", retriable: false };
      this.publish(slot);
      void this.failAndCleanup(slot, liveError("LIVE_PROTOCOL_ERROR"), "control");
    }
  }

  async end(owner: LiveOwner, request: LiveEndRequest): Promise<{ ok: true }> {
    if ("requestId" in request) {
      const key = `${ownerKey(owner)}:${request.requestId}`;
      const slot = this.current;
      if (slot?.requestId === request.requestId && ownerKey(slot.owner) === ownerKey(owner)) await this.endSlot(slot, request.reason);
      else {
        this.cancellationTombstones.set(key, this.now() + 2 * 60_000);
        this.pruneTombstones();
      }
      return { ok: true };
    }
    const slot = this.requireCurrent(owner, request.callId, true);
    await this.endSlot(slot, request.reason);
    return { ok: true };
  }

  heartbeat(owner: LiveOwner, callId: string): { ok: true } {
    const slot = this.requireCurrent(owner, callId);
    slot.heartbeatAt = this.now();
    this.armHeartbeat(slot);
    return { ok: true };
  }

  beginSettingsWrite(nextSettings: unknown): () => void {
    if (this.settingsWritePending) throw liveError("LIVE_SETTINGS_IN_USE");
    const next = liveVoiceFromSettings(nextSettings);
    if (next.invalid) throw Object.assign(new Error("liveVoice settings are invalid"), { errorCode: ErrorCodes.INVALID_PARAMS });
    const slot = this.current;
    if (slot && next.value.enabled) {
      const lockedBindingId = slot.binding?.id ?? slot.requestedBindingId;
      const nextBinding = next.value.bindings.find((binding) => binding.id === lockedBindingId);
      const lockedBinding = slot.binding ?? this.settingsSnapshot?.value.bindings.find((binding) => binding.id === lockedBindingId);
      if (!nextBinding || !lockedBinding || fingerprint(nextBinding) !== fingerprint(lockedBinding)) throw liveError("LIVE_SETTINGS_IN_USE");
      if (!slot.binding && next.value.selectedBindingId && next.value.selectedBindingId !== lockedBindingId) throw liveError("LIVE_SETTINGS_IN_USE");
    }
    this.settingsWritePending = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.settingsWritePending = false;
    };
  }

  async settingsWritten(settings: AppSettings): Promise<void> {
    const previous = this.settingsSnapshot;
    const raw = liveVoiceFromSettings(settings);
    const nextFingerprint = fingerprint(raw.value);
    const revision = previous ? previous.revision + (previous.fingerprint === nextFingerprint ? 0 : 1) : 1;
    this.settingsSnapshot = { value: raw.value, invalid: raw.invalid, fingerprint: nextFingerprint, revision };
    if (!raw.value.enabled && this.current) await this.endSlot(this.current, "disabled");
  }

  async invalidateProvider(providerId: string): Promise<void> {
    const slot = this.current;
    if (slot?.binding?.providerId === providerId) await this.endSlot(slot, "provider-invalidated");
  }

  async endForLifecycle(reason: LiveEndReason, owner?: LiveOwner, ownerGone = false): Promise<void> {
    if (ownerGone && owner) this.ownerDestroyed(owner);
    const slot = this.current;
    if (slot && (!owner || ownerKey(slot.owner) === ownerKey(owner))) await this.endSlot(slot, reason, ownerGone);
  }

  ownerDestroyed(owner: LiveOwner): void {
    const slot = this.current;
    if (slot && ownerKey(slot.owner) === ownerKey(owner)) {
      slot.microphoneActive = false;
      slot.mediaRelease = "confirmed";
      slot.resolveMediaReleased?.();
      slot.resolveMediaReleased = null;
    }
    if (this.quarantine && ownerKey(this.quarantine.owner) === ownerKey(owner)) {
      this.quarantine.releaseMicrophone?.();
      this.quarantine = null;
    }
  }

  async endForWebContents(webContentsId: number, reason: LiveEndReason, ownerGone = false): Promise<void> {
    const slot = this.current;
    if (!slot || slot.owner.webContentsId !== webContentsId) return;
    if (ownerGone) this.ownerDestroyed(slot.owner);
    await this.endSlot(slot, reason, ownerGone);
  }

  private async runPrepare(slot: Slot, request: LivePrepareRequest): Promise<LivePreparedCall> {
    const snapshot = await this.withDeadline(this.readSettings(), PREPARE_DEADLINE_MS, "prepare");
    this.assertCurrent(slot);
    if (snapshot.invalid) throw liveError("LIVE_NOT_CONFIGURED");
    if (!snapshot.value.enabled) throw liveError("LIVE_DISABLED");
    if (request.expectedSettingsRevision !== snapshot.revision) throw liveError("LIVE_SETTINGS_IN_USE");
    const binding = snapshot.value.bindings.find((item) => item.id === request.bindingId);
    if (!binding) throw liveError("LIVE_NOT_CONFIGURED");
    if (snapshot.value.selectedBindingId && snapshot.value.selectedBindingId !== binding.id) throw liveError("LIVE_NOT_CONFIGURED");
    const record = await this.withDeadline(this.deps.authResolver.provider(binding.providerId), PREPARE_DEADLINE_MS, "prepare");
    this.assertCurrent(slot);
    if (!record?.provider?.enabled) throw liveError("LIVE_PROVIDER_NOT_FOUND");
    if (!this.providerMatches(binding, record.provider)) throw liveError("LIVE_AUTH_KIND_UNSUPPORTED");
    if (!record.provider.hasSecret) throw liveError("LIVE_AUTH_REQUIRED");
    slot.binding = Object.freeze({ ...binding });
    slot.settingsRevision = snapshot.revision;
    transition(slot, "acquiring-mic");
    if (binding.adapterId === "gemini-live" || binding.adapterId === "openai-realtime") {
      slot.bridge = this.deps.createPcmBridge({
        callId: slot.callId,
        owner: slot.owner,
        inputSampleRate: binding.adapterId === "gemini-live" ? 16000 : 24000,
        outputSampleRate: 24000,
        onInput: (bytes, epoch) => this.onInput(slot, bytes, epoch),
        onPlaybackPosition: () => undefined,
        onReleased: () => this.confirmMediaReleased(slot),
        onFailure: (code) => { void this.failAndCleanup(slot, liveError(code), "media"); },
      });
    }
    slot.releaseBackgroundLease = this.deps.acquireBackgroundThrottlingLease?.(slot.callId) ?? null;
    slot.reservationTimer = setTimeout(() => {
      if (this.current === slot && slot.phase !== "connected") void this.failAndCleanup(slot, liveError("LIVE_TIMEOUT"), "permission");
    }, RESERVATION_TIMEOUT_MS);
    this.armHeartbeat(slot);
    this.publish(slot);
    const prepared: Omit<LivePreparedCall, "mediaKind" | "portNonce"> = {
      callId: slot.callId,
      requestId: slot.requestId,
      bindingId: binding.id,
      adapterId: binding.adapterId,
      inputSampleRate: binding.adapterId === "gemini-live" ? 16000 : 24000,
      outputSampleRate: 24000,
      initialMuted: slot.desiredMuted,
      revision: slot.revision,
    };
    if (binding.adapterId === "codex-live") return { ...prepared, mediaKind: "webrtc" };
    if (!slot.bridge) throw liveError("LIVE_PROTOCOL_ERROR");
    return { ...prepared, mediaKind: "pcm", portNonce: slot.bridge.portNonce };
  }

  private async runConnect(slot: Slot, offerSdp?: string): Promise<{ answerSdp?: string; revision: number }> {
    this.assertCurrent(slot);
    if (!slot.binding) throw liveError("LIVE_STALE_CALL");
    if (slot.binding.adapterId !== "codex-live" && !slot.bridge) throw liveError("LIVE_PROTOCOL_ERROR");
    if (slot.binding.adapterId === "codex-live" && !offerSdp) throw liveError("LIVE_PROTOCOL_ERROR");
    if (slot.reservationTimer) clearTimeout(slot.reservationTimer);
    if (slot.phase === "acquiring-mic") transition(slot, slot.binding.adapterId === "codex-live" ? "negotiating" : "connecting");
    this.publish(slot);
    const totalTimer = setTimeout(() => slot.abort.abort(new Error("Live call startup timed out")), TOTAL_CONNECT_TIMEOUT_MS);
    try {
      const result = await this.withDeadline(
        this.deps.authResolver.resolve(slot.binding),
        AUTH_TIMEOUT_MS,
        "auth",
        slot.abort.signal,
      );
      this.assertCurrent(slot);
      await this.assertBindingStillConfigured(slot);
      this.assertCurrent(slot);
      const context: LiveAdapterContext = {
        callId: slot.callId,
        binding: slot.binding,
        provider: result.provider,
        auth: result.auth as LiveResolvedAuth,
        signal: slot.abort.signal,
        onEvent: (event) => this.onAdapterEvent(slot, event),
      };
      slot.adapter = this.deps.createAdapter(context);
      if (slot.bridge) {
        await this.withDeadline(slot.bridge.ready, CONNECT_TIMEOUT_MS, "media", slot.abort.signal);
        this.assertCurrent(slot);
      }
      const connected = await this.withDeadline(
        slot.adapter.connect(slot.binding.adapterId === "codex-live" ? { offerSdp } : undefined),
        CONNECT_TIMEOUT_MS,
        "handshake",
        slot.abort.signal,
      );
      this.assertCurrent(slot);
      if (slot.phase === "negotiating") transition(slot, "connecting");
      if (slot.adapter.mediaKind === "pcm" && !slot.desiredMuted) {
        const nextEpoch = slot.captureEpoch + 1;
        await slot.bridge?.setMuted(false, nextEpoch);
        slot.captureEpoch = nextEpoch;
        slot.muted = false;
        await slot.adapter.setInputMuted?.(false);
      }
      this.publish(slot);
      return { ...(connected.answerSdp ? { answerSdp: connected.answerSdp } : {}), revision: slot.revision };
    } catch (error) {
      if (slot.abort.signal.aborted && !(error && typeof error === "object" && "errorCode" in error)) {
        throw liveError("LIVE_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(totalTimer);
    }
  }

  private async assertBindingStillConfigured(slot: Slot): Promise<void> {
    if (!slot.binding) throw liveError("LIVE_STALE_CALL");
    const snapshot = await this.readSettings();
    this.assertCurrent(slot);
    const binding = snapshot.value.bindings.find((candidate) => candidate.id === slot.binding?.id);
    if (snapshot.invalid || !snapshot.value.enabled || !binding || fingerprint(binding) !== fingerprint(slot.binding)) throw liveError("LIVE_SETTINGS_IN_USE");
    if (snapshot.revision !== slot.settingsRevision) {
      const current = snapshot.value.bindings.find((candidate) => candidate.id === slot.binding?.id);
      if (!current || fingerprint(current) !== fingerprint(slot.binding)) throw liveError("LIVE_SETTINGS_IN_USE");
    }
  }

  private onInput(slot: Slot, bytes: Uint8Array, epoch: number): void {
    if (this.current !== slot || slot.phase !== "connected" || slot.muted || slot.desiredMuted || epoch !== slot.captureEpoch || !slot.adapter?.sendInputPcm) return;
    try { slot.adapter.sendInputPcm(bytes); }
    catch (error) { void this.failAndCleanup(slot, error, "media"); }
  }

  private onAdapterEvent(slot: Slot, event: LiveWireEvent): void {
    if (this.current !== slot || slot.abort.signal.aborted) return;
    switch (event.kind) {
      case "ready":
        if (slot.phase === "connecting") this.publish(slot);
        return;
      case "audio":
        if (!slot.bridge || slot.phase === "closing" || slot.phase === "failed") return;
        try {
          slot.bridge.sendOutput({ bytes: event.bytes, playbackEpoch: slot.playbackEpoch, ...(event.responseId ? { responseId: event.responseId } : {}), ...(event.itemId ? { itemId: event.itemId } : {}), ...(event.contentIndex !== undefined ? { contentIndex: event.contentIndex } : {}) });
        } catch (error) { void this.failAndCleanup(slot, error, "playback"); }
        return;
      case "transcript":
        this.pushTranscript(slot, event);
        return;
      case "activity":
        if (event.userSpeaking !== undefined) slot.userSpeaking = event.userSpeaking;
        if (event.assistantSpeaking !== undefined) slot.assistantSpeaking = event.assistantSpeaking;
        this.publish(slot);
        return;
      case "interrupted":
        slot.playbackEpoch += 1;
        if (slot.bridge) {
          void slot.bridge.interrupt().then((cursors) => {
            if (this.current !== slot) return;
            return slot.adapter?.interrupt?.(cursors);
          }).catch((error: unknown) => this.failAndCleanup(slot, error, "playback"));
        }
        slot.assistantSpeaking = false;
        this.publish(slot);
        return;
      case "delegation":
        if (slot.binding?.adapterId !== "codex-live") {
          void slot.adapter?.rejectDelegation?.({ callId: slot.callId, delegationId: event.delegationId });
          slot.notice = { code: "LIVE_EXECUTION_NOT_CONNECTED", retriable: false };
          this.publish(slot);
        }
        return;
      case "tool-call-cancelled":
        // Live providers have no local tool execution path in this release.
        // The adapter validates cancellations so a later tool-capable profile
        // cannot accidentally leave work running without adding a new parser.
        return;
      case "error":
        if (event.code === "LIVE_EXECUTION_NOT_CONNECTED") {
          slot.notice = { code: event.code, retriable: false };
          this.publish(slot);
        } else void this.failAndCleanup(slot, liveError(event.code), "protocol");
        return;
      case "turn-complete":
        slot.assistantSpeaking = false;
        this.publish(slot);
        return;
      case "closed":
        if (slot.phase !== "closing") void this.failAndCleanup(slot, liveError("LIVE_NETWORK_ERROR"), "connection");
        return;
    }
  }

  private pushTranscript(slot: Slot, event: Extract<LiveWireEvent, { kind: "transcript" }>): void {
    const text = event.text.slice(0, 16_384);
    if (!text) return;
    const key = `${event.role}\u0000${event.id.slice(0, 256)}`;
    const bytes = Buffer.byteLength(text, "utf8");
    const priorBytes = slot.transcriptLengths.get(key) ?? 0;
    while (
      (!slot.transcriptLengths.has(key) && slot.transcriptLengths.size >= MAX_TRANSCRIPT_SEGMENTS) ||
      [...slot.transcriptLengths.values()].reduce((sum, size) => sum + size, 0) - priorBytes + bytes > MAX_TRANSCRIPT_BYTES
    ) {
      const oldest = slot.transcriptLengths.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      slot.transcriptLengths.delete(oldest);
    }
    slot.transcriptLengths.set(key, bytes);
    this.deps.sendTranscript(slot.owner, {
      callId: slot.callId,
      segment: { id: event.id.slice(0, 256), role: event.role, text, final: event.final, timestamp: this.now() },
    });
  }

  private async endSlot(slot: Slot, reason: LiveEndReason, ownerGone = false): Promise<void> {
    if (slot.phase === "ended" || slot.phase === "failed") return;
    if (slot.phase !== "closing") transition(slot, "closing");
    slot.muted = true;
    slot.desiredMuted = true;
    this.publish(slot);
    slot.abort.abort(new Error(reason));
    this.clearTimers(slot);
    if (!ownerGone && this.deps.ownerAlive(slot.owner)) {
      slot.mediaRelease = "pending";
      this.publish(slot);
      this.deps.sendControl(slot.owner, { callId: slot.callId, kind: "release-media" });
      await this.withDeadline(slot.mediaReleased, 1_000, "cleanup").catch(() => undefined);
    } else {
      this.confirmMediaReleased(slot);
    }
    const adapterClose = slot.adapter?.close(reason) ?? Promise.resolve();
    slot.bridge?.close();
    await this.withDeadline(adapterClose, 1_000, "cleanup").catch(() => undefined);
    for (const pending of slot.pendingControls.values()) clearTimeout(pending.timer);
    slot.pendingControls.clear();
    slot.releaseBackgroundLease?.();
    slot.releaseBackgroundLease = null;
    if (slot.mediaRelease === "confirmed") {
      slot.releaseMicrophone?.();
      slot.releaseMicrophone = null;
    } else {
      this.quarantine = { owner: slot.owner, releaseMicrophone: slot.releaseMicrophone };
      slot.releaseMicrophone = null;
      slot.mediaRelease = "unconfirmed";
      slot.error = { code: "LIVE_MEDIA_RELEASE_UNCONFIRMED", stage: "cleanup", retriable: false };
    }
    transition(slot, slot.error ? "failed" : "ended");
    this.publish(slot);
    this.terminal = this.toView(slot);
    if (this.current === slot) this.current = null;
  }

  private async failAndCleanup(slot: Slot, error: unknown, stage: string): Promise<void> {
    if (this.current !== slot) return;
    if (!slot.error) slot.error = { ...errorCode(error), stage };
    await this.endSlot(slot, slot.error.code === "LIVE_TIMEOUT" ? "timeout" : slot.error.code === "LIVE_AUDIO_BACKPRESSURE" ? "audio-backpressure" : "network-error");
  }

  private confirmMediaReleased(slot: Slot): void {
    slot.microphoneActive = false;
    slot.mediaRelease = "confirmed";
    slot.resolveMediaReleased?.();
    slot.resolveMediaReleased = null;
  }

  private startCallTimers(slot: Slot): void {
    if (!slot.maxDurationTimer) {
      slot.maxDurationTimer = setTimeout(() => {
        if (this.current === slot) void this.failAndCleanup(slot, liveError("LIVE_TIMEOUT"), "connection");
      }, MAX_CALL_MS);
    }
    if (slot.reservationTimer) clearTimeout(slot.reservationTimer);
    slot.reservationTimer = undefined;
  }

  private armHeartbeat(slot: Slot): void {
    if (slot.heartbeatTimer) clearTimeout(slot.heartbeatTimer);
    slot.heartbeatTimer = setTimeout(() => {
      if (this.current !== slot || slot.phase === "closing") return;
      if (this.now() - slot.heartbeatAt >= OWNER_LEASE_MS) {
        void this.failAndCleanup(slot, liveError("LIVE_TIMEOUT"), "owner");
        return;
      }
      this.armHeartbeat(slot);
    }, OWNER_HEARTBEAT_MS);
  }

  private async readSettings(): Promise<SettingsSnapshot> {
    const raw = await this.deps.loadSettings();
    const parsed = liveVoiceFromSettings(raw);
    const nextFingerprint = fingerprint(parsed.value);
    if (!this.settingsSnapshot) {
      this.settingsSnapshot = { value: parsed.value, invalid: parsed.invalid, fingerprint: nextFingerprint, revision: 1 };
    } else if (this.settingsSnapshot.fingerprint !== nextFingerprint || this.settingsSnapshot.invalid !== parsed.invalid) {
      this.settingsSnapshot = { value: parsed.value, invalid: parsed.invalid, fingerprint: nextFingerprint, revision: this.settingsSnapshot.revision + 1 };
    }
    return this.settingsSnapshot;
  }

  private providerMatches(binding: LiveBinding, provider: { enabled: boolean; authKind: string; vendorKey: string; apiStyle?: string; baseUrl?: string }): boolean {
    if (!provider.enabled) return false;
    if (binding.adapterId === "codex-live") return provider.authKind === OAUTH_AUTH_KIND && provider.vendorKey === "openai-codex";
    if (provider.authKind === OAUTH_AUTH_KIND) return false;
    if (binding.adapterId === "gemini-live") return provider.vendorKey === "google" && provider.apiStyle === "google_generative_ai";
    return Boolean(provider.baseUrl);
  }

  private async withDeadline<T>(promise: Promise<T>, timeoutMs: number, stage: string, signal?: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Live ${stage} stage timed out`), { errorCode: "LIVE_TIMEOUT" })), timeoutMs);
    });
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      abortListener = () => reject(Object.assign(new Error("Live call was cancelled"), { errorCode: "LIVE_STALE_CALL" }));
      if (signal.aborted) abortListener();
      else signal.addEventListener("abort", abortListener, { once: true });
    });
    try { return await Promise.race([promise, timeout, aborted]); }
    finally {
      if (timer) clearTimeout(timer);
      if (abortListener && signal) signal.removeEventListener("abort", abortListener);
    }
  }

  private makeSlot(owner: LiveOwner, request: LivePrepareRequest): Slot {
    let resolveMediaReleased: (() => void) | null = null;
    const mediaReleased = new Promise<void>((resolve) => { resolveMediaReleased = resolve; });
    return {
      callId: randomUUID(),
      requestId: request.requestId,
      requestedBindingId: request.bindingId,
      owner: { ...owner },
      binding: null,
      settingsRevision: request.expectedSettingsRevision,
      phase: "preparing",
      revision: 0,
      abort: new AbortController(),
      desiredMuted: request.initialMuted,
      muted: true,
      captureEpoch: 0,
      playbackEpoch: 0,
      microphoneActive: false,
      mediaRelease: "confirmed",
      mediaReleased,
      resolveMediaReleased,
      userSpeaking: false,
      assistantSpeaking: false,
      adapter: null,
      bridge: null,
      releaseMicrophone: null,
      releaseBackgroundLease: null,
      heartbeatAt: this.now(),
      delegationInstructions: new Map(),
      pendingControls: new Map(),
      transcriptLengths: new Map(),
    };
  }

  private requireCurrent(owner: LiveOwner, callId: string, allowClosing = false): Slot {
    const slot = this.current;
    if (!slot || slot.callId !== callId) throw liveError("LIVE_STALE_CALL");
    if (ownerKey(slot.owner) !== ownerKey(owner)) throw liveError("LIVE_INVALID_OWNER");
    if (!allowClosing && (slot.phase === "closing" || slot.phase === "ended" || slot.phase === "failed")) throw liveError("LIVE_STALE_CALL");
    return slot;
  }

  private assertCurrent(slot: Slot): void {
    if (this.current !== slot || slot.abort.signal.aborted) throw liveError("LIVE_STALE_CALL");
  }

  private toView(slot: Slot): LiveCallView {
    return {
      callId: slot.callId,
      revision: slot.revision,
      bindingId: slot.binding?.id ?? "",
      adapterId: slot.binding?.adapterId ?? "codex-live",
      phase: slot.phase,
      muted: slot.muted,
      microphoneActive: slot.microphoneActive,
      userSpeaking: slot.userSpeaking,
      assistantSpeaking: slot.assistantSpeaking,
      ...(slot.connectedAt ? { connectedAt: slot.connectedAt } : {}),
      ...(slot.playbackBlocked !== undefined ? { playbackBlocked: slot.playbackBlocked } : {}),
      mediaRelease: slot.mediaRelease,
      ...(slot.error ? { error: slot.error } : {}),
      ...(slot.notice ? { notice: slot.notice } : {}),
    };
  }

  private publish(slot: Slot): void {
    slot.revision += 1;
    if (this.current === slot) {
      try { this.deps.sendView(slot.owner, this.toView(slot)); } catch { /* The lifecycle watcher closes a disappeared owner. */ }
    }
  }

  private clearTimers(slot: Slot): void {
    for (const timer of [slot.reservationTimer, slot.heartbeatTimer, slot.maxDurationTimer]) if (timer) clearTimeout(timer);
  }

  private trimRequests(): void {
    while (this.requests.size > MAX_CALLS_PER_OWNER_REQUEST_CACHE) {
      const first = this.requests.keys().next().value;
      if (first === undefined) return;
      if (this.current && first.endsWith(`:${this.current.requestId}`)) return;
      this.requests.delete(first);
    }
  }

  private pruneTombstones(): void {
    const now = this.now();
    for (const [key, expiresAt] of this.cancellationTombstones) if (expiresAt <= now) this.cancellationTombstones.delete(key);
    while (this.cancellationTombstones.size > 128) {
      const first = this.cancellationTombstones.keys().next().value;
      if (first === undefined) return;
      this.cancellationTombstones.delete(first);
    }
  }
}

function validatePrepareRequest(request: LivePrepareRequest): void {
  if (!request || typeof request !== "object" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId) || typeof request.bindingId !== "string" || request.bindingId.length > 256 || !Number.isSafeInteger(request.expectedSettingsRevision) || typeof request.initialMuted !== "boolean") {
    throw liveError("LIVE_PROTOCOL_ERROR");
  }
}

function liveError(code: string): Error {
  return Object.assign(new Error(code), { errorCode: code });
}
