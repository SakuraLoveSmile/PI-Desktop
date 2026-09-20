import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  CRASH_DUMP_MARKER_FILE,
  describeCrashDumps,
  readCrashDumpMarker,
  writeCrashDumpMarker,
} from "../electron/main/crash-report.ts";
import { readMainModule } from "./helpers/source-contracts.mjs";

/**
 * Crash collection has two halves: the pure scan/marker pair below, exercised
 * against real files in a temp directory, and the main-process wiring that runs
 * it at startup, held to the properties a behavior test cannot observe without
 * Electron (local-only reporter, diagnostics log surface, marker store).
 */
const startupSource = await readMainModule("bootstrap/startup.ts");
const mainIndexSource = await readMainModule("index.ts");

const parentDir = mkdtempSync(join(tmpdir(), "pi-desktop-crash-report-"));
test.after(() => {
  rmSync(parentDir, { recursive: true, force: true });
});

/** Whole-second mtimes keep the assertions filesystem-precision independent. */
const SECOND = 1_000;
const BASE_MS = 1_700_000_000_000;

function makeDump(path, mtimeMs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "minidump");
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs));
}

function storedMarkerMtime(dataDir) {
  return readCrashDumpMarker(dataDir)?.newestMtimeMs ?? null;
}

test("a crashDumps directory that does not exist yet reports nothing", () => {
  const summary = describeCrashDumps(join(parentDir, "never-created"));
  assert.deepEqual(summary, {
    directory: join(parentDir, "never-created"),
    dumpCount: 0,
    newDumpCount: 0,
    newestMtimeMs: null,
  });
});

test("dumps are found under Crashpad's nested reports/ layout, and only .dmp files", () => {
  const root = join(parentDir, "crashDumps");
  makeDump(join(root, "reports", "older.dmp"), BASE_MS);
  makeDump(join(root, "reports", "newer.DMP"), BASE_MS + 60 * SECOND);
  makeDump(join(root, "crash.dmp"), BASE_MS + 30 * SECOND);
  // Not dumps: metadata beside the minidump, a directory ending in .dmp, and an
  // unrelated file.
  makeDump(join(root, "reports", "older.meta"), BASE_MS);
  mkdirSync(join(root, "decoy.dmp"), { recursive: true });
  writeFileSync(join(root, "notes.txt"), "not a dump");

  const summary = describeCrashDumps(root);
  assert.equal(summary.dumpCount, 3);
  assert.equal(summary.newDumpCount, 3);
  assert.equal(summary.newestMtimeMs, BASE_MS + 60 * SECOND);
});

test("a crash is reported once: the marker suppresses the repeat on the next launch", () => {
  const root = join(parentDir, "marker-scan");
  const dataDir = join(parentDir, "marker-scan-data");
  makeDump(join(root, "reports", "crashed-last-run.dmp"), BASE_MS);
  makeDump(join(root, "reports", "crashed-before-that.dmp"), BASE_MS - 120 * SECOND);
  assert.equal(readCrashDumpMarker(dataDir), null);

  // First launch: both dumps are new, so startup reports them and records the
  // newest mtime it saw.
  const firstScan = describeCrashDumps(root, storedMarkerMtime(dataDir));
  assert.equal(firstScan.dumpCount, 2);
  assert.equal(firstScan.newDumpCount, 2);
  writeCrashDumpMarker(dataDir, firstScan.newestMtimeMs);

  // Second launch: the same dumps are still on disk, but none is new.
  const secondScan = describeCrashDumps(root, storedMarkerMtime(dataDir));
  assert.equal(secondScan.dumpCount, 2);
  assert.equal(secondScan.newDumpCount, 0);

  // A later crash is reported again, on the launch after it.
  makeDump(join(root, "reports", "crashed-again.dmp"), BASE_MS + 360 * SECOND);
  const afterNewCrash = describeCrashDumps(root, storedMarkerMtime(dataDir));
  assert.equal(afterNewCrash.newDumpCount, 1);
  assert.equal(afterNewCrash.newestMtimeMs, BASE_MS + 360 * SECOND);
});

test("the marker round-trips through the data-dir JSON store", () => {
  const dataDir = join(parentDir, "data");
  assert.equal(readCrashDumpMarker(dataDir), null);

  writeCrashDumpMarker(dataDir, BASE_MS);
  assert.deepEqual(readCrashDumpMarker(dataDir), { newestMtimeMs: BASE_MS });
  assert.equal(CRASH_DUMP_MARKER_FILE, "crash-dumps.json");

  writeFileSync(join(dataDir, CRASH_DUMP_MARKER_FILE), "{ not json");
  assert.equal(readCrashDumpMarker(dataDir), null);
  writeFileSync(join(dataDir, CRASH_DUMP_MARKER_FILE), JSON.stringify({ newestMtimeMs: "x" }));
  assert.equal(readCrashDumpMarker(dataDir), null);
});

test("startup starts Crashpad local-only, before ready", () => {
  assert.match(startupSource, /crashReporter\.start\(\{\s*uploadToServer: false,/);
  assert.match(startupSource, /productName: APP_NAME/);
  const startAt = startupSource.indexOf("crashReporter.start(");
  assert.ok(startAt > 0, "startup must start the crash reporter");
  assert.ok(
    startAt < startupSource.indexOf("app.whenReady()"),
    "the reporter must start before the app is ready",
  );
  // One installation point: the composition root does not start it again.
  assert.doesNotMatch(mainIndexSource, /crashReporter\.start/);
});

test("startup reports new crash dumps under diagnostics and advances the marker", () => {
  assert.match(
    startupSource,
    /describeCrashDumps\(app\.getPath\("crashDumps"\), crashDumpMarker\)/,
  );
  assert.match(startupSource, /readCrashDumpMarker\(dataDir\)/);
  assert.match(
    startupSource,
    /logger\.app\(\s*"diagnostics",\s*"error",\s*"crash dumps found from a previous run"/,
  );
  // Only dumps newer than the marker are reported: one crash is one log line.
  assert.match(startupSource, /if \(crashDumps\.newDumpCount > 0\) \{/);
  assert.match(startupSource, /writeCrashDumpMarker\(dataDir, crashDumps\.newestMtimeMs\)/);
  // With no dumps at all there is no mtime to record.
  assert.match(startupSource, /crashDumps\.newestMtimeMs !== null/);
  // A failure to report is a warning; it never blocks the first window.
  assert.match(
    startupSource,
    /logger\.app\(\s*"diagnostics",\s*"warn",\s*"crash dump report failed"/,
  );
});
