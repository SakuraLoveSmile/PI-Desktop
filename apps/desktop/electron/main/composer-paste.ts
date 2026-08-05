import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type {
  ComposerPasteFile,
  ComposerPastedFile,
} from "@pi-desktop/shared";

const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/tiff": ".tiff",
  "image/webp": ".webp",
  "text/csv": ".csv",
  "text/html": ".html",
  "text/plain": ".txt",
  "application/json": ".json",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
};

function bytesOf(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error("clipboard file data is invalid");
}

function fileNameOf(name: unknown, mimeType: string, index: number): string {
  const normalized = typeof name === "string" ? name.replaceAll("\\", "/") : "";
  const leaf = basename(normalized)
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+$/, "");
  const fallback = `pasted-file-${index + 1}`;
  const candidate = leaf || fallback;
  const extension = MIME_EXTENSIONS[mimeType] ?? ".bin";
  return extname(candidate) ? candidate : `${candidate}${extension}`;
}

/**
 * Materialize renderer clipboard bytes in the session scratch directory.
 * Names are reduced to leaf names and every output receives a unique prefix,
 * so renderer-provided metadata cannot escape or overwrite another paste.
 */
export async function saveComposerPasteFiles(
  dataDir: string,
  sessionId: string,
  files: ComposerPasteFile[],
): Promise<ComposerPastedFile[]> {
  if (!SAFE_SESSION_ID.test(sessionId)) {
    throw new Error("invalid session id");
  }
  if (!Array.isArray(files) || files.length === 0) return [];
  if (files.length > MAX_FILES) {
    throw new Error(`too many pasted files (maximum ${MAX_FILES})`);
  }

  let totalBytes = 0;
  const prepared = files.map((file, index) => {
    if (!file || typeof file !== "object") {
      throw new Error("clipboard file is invalid");
    }
    const bytes = bytesOf(file.data);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`pasted file is too large (maximum ${MAX_FILE_BYTES} bytes)`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`pasted files are too large (maximum ${MAX_TOTAL_BYTES} bytes)`);
    }
    const mimeType =
      typeof file.mimeType === "string" && file.mimeType.trim()
        ? file.mimeType.trim().toLowerCase()
        : "application/octet-stream";
    return {
      bytes,
      mimeType,
      name: fileNameOf(file.name, mimeType, index),
    };
  });

  const root = join(dataDir, "scratch", sessionId, "pasted");
  await mkdir(root, { recursive: true });
  return Promise.all(
    prepared.map(async ({ bytes, mimeType, name }) => {
      const outputName = `pasted-${randomUUID()}-${name}`;
      const path = join(root, outputName);
      await writeFile(path, bytes, { flag: "wx" });
      return { path, name: outputName, mimeType, size: bytes.byteLength };
    }),
  );
}
