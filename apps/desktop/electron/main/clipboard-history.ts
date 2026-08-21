import { createHash } from "node:crypto";

import type { ClipboardHistoryEntry } from "@pi-desktop/plugin-sdk";

export const CLIPBOARD_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CLIPBOARD_HISTORY_MAX_TEXT_BYTES = 100 * 1024;
export const CLIPBOARD_HISTORY_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const CLIPBOARD_HISTORY_MAX_ENTRIES = 500;
export const CLIPBOARD_HISTORY_MAX_BYTES = 256 * 1024 * 1024;
export const CLIPBOARD_HISTORY_POLL_INTERVAL_MS = 500;

export type ClipboardCapture =
  | { type: "text"; text: string }
  | {
      type: "image";
      format: "png" | "jpeg" | "webp";
      data: Uint8Array;
      width: number;
      height: number;
    };

export type ClipboardHistoryReader = () => Promise<ClipboardCapture | null>;

export type ClipboardHistoryOptions = {
  read: ClipboardHistoryReader;
  now?: () => number;
  pollIntervalMs?: number;
};

type StoredEntry = ClipboardHistoryEntry & { signature: string };

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function contentBytes(capture: ClipboardCapture): number {
  return capture.type === "text" ? byteLength(capture.text) : capture.data.byteLength;
}

function signatureFor(capture: ClipboardCapture): string {
  const hash = createHash("sha256");
  hash.update(capture.type);
  if (capture.type === "text") {
    hash.update(capture.text, "utf8");
  } else {
    hash.update(capture.format);
    hash.update(capture.data);
  }
  return hash.digest("hex");
}

function cloneEntry(entry: StoredEntry): ClipboardHistoryEntry {
  if (entry.type === "text") {
    return {
      type: "text",
      text: entry.text,
      capturedAt: entry.capturedAt,
    };
  }
  return {
    type: "image",
    format: entry.format,
    data: entry.data.slice(),
    width: entry.width,
    height: entry.height,
    capturedAt: entry.capturedAt,
  };
}

/**
 * Owns the host's in-memory clipboard history. Electron does not expose a
 * cross-platform clipboard-changed event, so the host samples the clipboard
 * while it is running. The first sample establishes a baseline and is not
 * treated as a copy that happened before the app started.
 */
export class ClipboardHistory {
  private readonly read: ClipboardHistoryReader;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private entries: StoredEntry[] = [];
  private totalBytes = 0;
  private lastSignature: string | null = null;
  private lastRecordedSignature: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(options: ClipboardHistoryOptions) {
    this.read = options.read;
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? CLIPBOARD_HISTORY_POLL_INTERVAL_MS;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    const initial = await this.read();
    this.lastSignature = initial ? signatureFor(initial) : null;
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sample once; exposed for deterministic host tests. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const capture = await this.read();
      if (capture) this.recordCapture(capture);
      else {
        this.lastSignature = null;
        this.lastRecordedSignature = null;
      }
    } finally {
      this.polling = false;
    }
  }

  recordText(text: string, capturedAt = new Date(this.now()).toISOString()): void {
    this.recordCapture({ type: "text", text }, capturedAt, true);
  }

  recordImage(
    image: Omit<Extract<ClipboardCapture, { type: "image" }>, "type">,
    capturedAt = new Date(this.now()).toISOString(),
  ): void {
    this.recordCapture({ type: "image", ...image }, capturedAt, true);
  }

  getHistory(): ClipboardHistoryEntry[] {
    this.prune();
    return this.entries.map(cloneEntry);
  }

  private recordCapture(
    capture: ClipboardCapture,
    capturedAt = new Date(this.now()).toISOString(),
    force = false,
  ): void {
    const signature = signatureFor(capture);
    const repeated = signature === this.lastSignature;
    this.lastSignature = signature;

    if (repeated && !force) {
      if (this.lastRecordedSignature === signature && this.entries[0]) {
        this.entries[0] = { ...this.entries[0], capturedAt };
      }
      return;
    }

    if (
      force &&
      this.lastRecordedSignature === signature &&
      this.entries[0]?.signature === signature
    ) {
      this.entries[0] = { ...this.entries[0], capturedAt };
      return;
    }

    this.lastRecordedSignature = null;
    const size = contentBytes(capture);
    const maxBytes = capture.type === "text"
      ? CLIPBOARD_HISTORY_MAX_TEXT_BYTES
      : CLIPBOARD_HISTORY_MAX_IMAGE_BYTES;
    if (size === 0 || size > maxBytes) return;

    const entry: StoredEntry = capture.type === "text"
      ? { type: "text", text: capture.text, capturedAt, signature }
      : {
          type: "image",
          format: capture.format,
          data: capture.data.slice(),
          width: capture.width,
          height: capture.height,
          capturedAt,
          signature,
        };
    this.entries.unshift(entry);
    this.totalBytes += size;
    this.lastRecordedSignature = signature;
    this.prune();
  }

  private prune(): void {
    const cutoff = this.now() - CLIPBOARD_HISTORY_RETENTION_MS;
    this.entries = this.entries.filter((entry) => {
      if (Date.parse(entry.capturedAt) >= cutoff) return true;
      this.totalBytes -= contentBytes(entry);
      return false;
    });

    while (
      this.entries.length > CLIPBOARD_HISTORY_MAX_ENTRIES ||
      this.totalBytes > CLIPBOARD_HISTORY_MAX_BYTES
    ) {
      const removed = this.entries.pop();
      if (!removed) break;
      this.totalBytes -= contentBytes(removed);
    }
    this.totalBytes = Math.max(0, this.totalBytes);
  }
}
