import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { FsEntry, FsReadResult } from "@pi-desktop/shared";

/**
 * Read-only workspace file access for the work panel files tab
 * (ADR 0019). User-initiated UI browsing bypasses host-core tool
 * permissions on purpose, but stays inside the workspace root and honors
 * the default ignore subset of 15-workspace-ignore-rules.
 */

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "target",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
]);

export const MAX_TEXT_BYTES = 512 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Resolve `rel` inside `root`, rejecting absolute inputs and `..` escapes.
 * Returns the absolute path or null when the input leaves the root.
 */
export function resolveWithinRoot(root: string, rel: string): string | null {
  if (!root) return null;
  const cleanRel = String(rel ?? "").replace(/^[/\\]+/, "");
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, cleanRel);
  if (target === rootAbs) return rootAbs;
  if (!target.startsWith(rootAbs + sep)) return null;
  return target;
}

function pathIsWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** Resolve an existing path and its root through links before containment. */
async function resolveRealPathWithinRoot(
  root: string,
  rel: string,
): Promise<string | null> {
  const lexical = resolveWithinRoot(root, rel);
  if (!lexical) return null;
  try {
    const [rootReal, targetReal] = await Promise.all([
      realpath(resolve(root)),
      realpath(lexical),
    ]);
    return pathIsWithin(rootReal, targetReal) ? targetReal : null;
  } catch {
    return null;
  }
}

export function isIgnoredName(name: string): boolean {
  return IGNORED_NAMES.has(name);
}

export async function listDir(root: string, rel: string): Promise<FsEntry[]> {
  const dir = await resolveRealPathWithinRoot(root, rel);
  if (!dir) throw new Error("path escapes workspace root");
  const dirents = await readdir(dir, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const dirent of dirents) {
    if (isIgnoredName(dirent.name)) continue;
    let kind: FsEntry["kind"];
    let size = 0;
    if (dirent.isDirectory()) {
      kind = "dir";
    } else if (dirent.isFile()) {
      kind = "file";
      try {
        size = (await stat(join(dir, dirent.name))).size;
      } catch {
        size = 0;
      }
    } else if (dirent.isSymbolicLink()) {
      // Broken links and links whose real target leaves the workspace are
      // omitted. The same real-path check runs again when opening the entry.
      try {
        const target = await resolveRealPathWithinRoot(
          root,
          rel ? `${rel}/${dirent.name}` : dirent.name,
        );
        if (!target) continue;
        const info = await stat(target);
        kind = info.isDirectory() ? "dir" : "file";
        size = info.isFile() ? info.size : 0;
      } catch {
        continue;
      }
    } else {
      continue;
    }
    entries.push({ name: dirent.name, kind, size });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

function looksBinary(buffer: Buffer): boolean {
  const probe = buffer.subarray(0, Math.min(buffer.length, 8000));
  for (const byte of probe) {
    if (byte === 0) return true;
  }
  return false;
}

export async function readWorkspaceFile(
  root: string,
  rel: string,
): Promise<FsReadResult> {
  const target = await resolveRealPathWithinRoot(root, rel);
  if (!target) throw new Error("path escapes workspace root");
  const info = await stat(target);
  if (!info.isFile()) throw new Error("not a file");

  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const imageMime = IMAGE_MIME[ext];
  if (imageMime) {
    if (info.size > MAX_IMAGE_BYTES) {
      return { kind: "tooLarge", size: info.size };
    }
    const buffer = await readFile(target);
    return {
      kind: "image",
      dataUrl: `data:${imageMime};base64,${buffer.toString("base64")}`,
      size: info.size,
    };
  }

  if (info.size > MAX_TEXT_BYTES) {
    return { kind: "tooLarge", size: info.size };
  }
  const buffer = await readFile(target);
  if (looksBinary(buffer)) {
    return { kind: "binary", size: info.size };
  }
  return { kind: "text", content: buffer.toString("utf8"), size: info.size };
}
