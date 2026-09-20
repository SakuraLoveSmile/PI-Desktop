/**
 * Local crash-dump collection for the Electron main process.
 *
 * Electron ships Crashpad, so `crashReporter.start()` needs no native
 * dependency. Dumps stay on this machine — nothing is uploaded — and this
 * module only describes what is already on disk plus the marker of the last
 * scan, so a crash from a previous run becomes one durable log line instead of
 * staying invisible.
 *
 * Crashpad nests dumps under subdirectories of `app.getPath("crashDumps")`
 * (for example `reports/`), so the scan walks a bounded depth instead of
 * assuming a flat directory: a flat readdir finds zero dumps and the feature
 * would be silently useless.
 *
 * Crashes of the host-core / sidecar children are out of scope here: main
 * supervises and restarts those processes (see `runtime/lifecycle.ts`) and
 * their stderr already lands in the `host` / `agent` log channels.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";

/** Crashpad uses one nesting level; three leaves room without a full walk. */
const MAX_DUMP_SCAN_DEPTH = 3;

/** Marker file, beside the other best-effort main-process state JSON. */
export const CRASH_DUMP_MARKER_FILE = "crash-dumps.json";

export type CrashDumpSummary = {
  /** Directory that was scanned. */
  directory: string;
  /** Every `*.dmp` file found at or below `directory`. */
  dumpCount: number;
  /** Dumps strictly newer than the caller's marker mtime. */
  newDumpCount: number;
  /** Newest mtime across every dump found, or null when there is none. */
  newestMtimeMs: number | null;
};

function collectDumpPaths(directory: string, depth: number, found: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // Crashpad has not created the directory yet: no crash has been observed.
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) collectDumpPaths(path, depth - 1, found);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dmp")) {
      found.push(path);
    }
  }
}

/**
 * Describe the dumps below `directory`, and how many of them are newer than
 * `sinceMtimeMs` (the previous launch's marker; null reports every dump).
 * Filesystem races stay benign: a dump removed between list and stat is not a
 * dump for this scan, and a directory that does not exist is an empty scan.
 */
export function describeCrashDumps(
  directory: string,
  sinceMtimeMs: number | null = null,
): CrashDumpSummary {
  const found: string[] = [];
  collectDumpPaths(directory, MAX_DUMP_SCAN_DEPTH, found);
  let newDumpCount = 0;
  let newestMtimeMs: number | null = null;
  for (const path of found) {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue; // removed between readdir and stat; not a dump this scan
    }
    if (sinceMtimeMs === null || mtimeMs > sinceMtimeMs) newDumpCount += 1;
    if (newestMtimeMs === null || mtimeMs > newestMtimeMs) newestMtimeMs = mtimeMs;
  }
  return { directory, dumpCount: found.length, newDumpCount, newestMtimeMs };
}

export type CrashDumpMarker = { newestMtimeMs: number };

/** Read the previous scan's marker; missing or malformed reads as "unset". */
export function readCrashDumpMarker(dataDir: string): CrashDumpMarker | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(dataDir, CRASH_DUMP_MARKER_FILE), "utf8"),
    ) as { newestMtimeMs?: unknown };
    const newestMtimeMs = Number(raw?.newestMtimeMs);
    return Number.isFinite(newestMtimeMs) ? { newestMtimeMs } : null;
  } catch {
    return null;
  }
}

/**
 * Persist the newest mtime a scan saw, so the next launch reports only dumps
 * from crashes after this one. Best-effort, like the other main-process state
 * files: failing to write the marker repeats a log line on the next launch,
 * which is better than turning a diagnostic into a boot failure.
 */
export function writeCrashDumpMarker(dataDir: string, newestMtimeMs: number): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, CRASH_DUMP_MARKER_FILE),
      JSON.stringify({ newestMtimeMs }),
      "utf8",
    );
  } catch {
    // best-effort persistence
  }
}
