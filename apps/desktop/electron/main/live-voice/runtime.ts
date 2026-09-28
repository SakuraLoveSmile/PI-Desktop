import { net, type BrowserWindow, type WebContents } from "electron";
import { IPC, type AppSettings } from "@pi-desktop/shared";
import type { VendorOAuth } from "../oauth";
import type { HostProcess } from "../host-process";
import { LiveCallService } from "./call-service";
import { LiveAuthResolver } from "./auth-resolver";
import { createLivePcmBridge } from "./audio-port";
import { createCodexAdapter } from "./codex-adapter";
import { createGeminiAdapter } from "./gemini-adapter";
import { createOpenAIRealtimeAdapter } from "./openai-realtime-adapter";
import { liveOwnerFrame } from "./owner";
import { assertLiveHttpsEndpoint } from "./websocket-transport";
import type { MicrophoneLeaseRegistry } from "./microphone-lease";
import type { LiveOwner } from "./call-service";

type BackgroundLease = { webContents: WebContents; previous: boolean; count: number };

export function createLiveCallService(input: {
  getHost: () => HostProcess | null;
  getMainWindow: () => BrowserWindow | null;
  vendorOAuth: Pick<VendorOAuth, "resolveAuth">;
  microphoneLeases: MicrophoneLeaseRegistry;
}): LiveCallService {
  const backgroundLeases = new Map<number, BackgroundLease>();
  const authResolver = new LiveAuthResolver({
    callHost: <T,>(method: string, params?: unknown): Promise<T> => {
      const host = input.getHost();
      if (!host) return Promise.reject(Object.assign(new Error("host unavailable"), { errorCode: "LIVE_PROVIDER_NOT_FOUND" }));
      return host.call<T>(method, params);
    },
    vendorOAuth: input.vendorOAuth,
  });

  return new LiveCallService({
    loadSettings: async () => {
      const host = input.getHost();
      if (!host) throw Object.assign(new Error("host unavailable"), { errorCode: "LIVE_PROVIDER_NOT_FOUND" });
      return host.call<AppSettings>("settings.get");
    },
    authResolver,
    createAdapter: (context) => {
      switch (context.binding.adapterId) {
        case "codex-live":
          return createCodexAdapter(context, {
            fetchImpl: (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init),
            assertEndpoint: (url) => assertLiveHttpsEndpoint(url, "third-party"),
          });
        case "gemini-live":
          return createGeminiAdapter(context);
        case "openai-realtime":
          return createOpenAIRealtimeAdapter(context);
      }
    },
    createPcmBridge: (bridgeInput) => {
      const frame = liveOwnerFrame(input.getMainWindow(), bridgeInput.owner);
      if (!frame) throw Object.assign(new Error("Live Voice owner frame is unavailable"), { errorCode: "LIVE_INVALID_OWNER" });
      return createLivePcmBridge({
        ...bridgeInput,
        ownerFrame: frame,
      });
    },
    sendView: (owner, view) => sendToOwner(input.getMainWindow(), owner, IPC.event.liveVoiceChanged, view),
    sendControl: (owner, event) => sendToOwner(input.getMainWindow(), owner, IPC.event.liveVoiceControl, event),
    sendTranscript: (owner, event) => sendToOwner(input.getMainWindow(), owner, IPC.event.liveVoiceTranscript, event),
    ownerAlive: (owner) => liveOwnerFrame(input.getMainWindow(), owner) !== null,
    acquireMicrophone: (callId) => input.microphoneLeases.acquire("live", callId),
    acquireBackgroundThrottlingLease: (callId) => acquireBackgroundLease(input.getMainWindow(), callId, backgroundLeases),
  });
}

function sendToOwner(window: BrowserWindow | null, owner: LiveOwner, channel: string, payload: unknown): void {
  const frame = liveOwnerFrame(window, owner);
  if (!frame || !window || window.isDestroyed()) return;
  frame.send(channel, payload);
}

function acquireBackgroundLease(
  window: BrowserWindow | null,
  _callId: string,
  leases: Map<number, BackgroundLease>,
): () => void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    throw Object.assign(new Error("Live Voice owner window is unavailable"), { errorCode: "LIVE_INVALID_OWNER" });
  }
  const contents = window.webContents;
  let lease = leases.get(contents.id);
  if (!lease) {
    const previous = contents.getBackgroundThrottling();
    lease = { webContents: contents, previous, count: 0 };
    leases.set(contents.id, lease);
    contents.setBackgroundThrottling(false);
  }
  lease.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = leases.get(contents.id);
    if (current !== lease) return;
    current.count -= 1;
    if (current.count > 0) return;
    leases.delete(contents.id);
    if (!contents.isDestroyed()) contents.setBackgroundThrottling(current.previous);
  };
}
