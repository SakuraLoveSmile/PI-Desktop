/**
 * Issue #831: a launch that never receives its initial state left the window on
 * the boot surface forever. These tests cover the watchdog's own bounds (they
 * are the contract that keeps a slow boot from being called a failure), its
 * timer ownership, the diagnostics report behind the copy action, and the
 * wiring that puts the recovery surface in front of the user.
 */
import { readAppSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_RPC_TIMEOUT_MS } from "@pi-desktop/shared";
import {
  STARTUP_SLOW_HINT_MS,
  STARTUP_STALLED_MS,
  buildStartupDiagnostics,
  createStartupWatchdog,
  startupPhaseFor,
} from "../src/lib/startup-watchdog.ts";
import { loadStyles } from "./helpers/styles.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  shell,
  recovery,
  apiSource,
  mainIpc,
  protocol,
  css,
  english,
  chinese,
  traditional,
] = await Promise.all([
  readAppSource(),
  read("../src/components/StartupRecovery.tsx"),
  read("../src/lib/api.ts"),
  read("../electron/main/ipc/app-ipc.ts"),
  read("../../../packages/shared/src/protocol.ts"),
  loadStyles(),
  read("../../../packages/i18n/src/locales/en/index.ts"),
  read("../../../packages/i18n/src/locales/zh-CN/index.ts"),
  read("../../../packages/i18n/src/locales/zh-TW/index.ts"),
]);

/** Deterministic scheduler so the watchdog is tested without a real clock. */
function fakeScheduler() {
  const pending = new Map();
  let sequence = 0;
  return {
    scheduler: {
      setTimeout: (handler, ms) => {
        sequence += 1;
        pending.set(sequence, { handler, ms });
        return sequence;
      },
      clearTimeout: (handle) => {
        pending.delete(handle);
      },
    },
    armed: () => pending.size,
    fire: (ms) => {
      for (const [handle, entry] of [...pending]) {
        if (entry.ms !== ms) continue;
        pending.delete(handle);
        entry.handler();
      }
    },
  };
}

test("a boot is only slow after the hint, and only stalled after the ceiling", () => {
  assert.equal(STARTUP_SLOW_HINT_MS, 30_000);
  assert.equal(STARTUP_STALLED_MS, 180_000);
  assert.equal(startupPhaseFor(0), "starting");
  assert.equal(startupPhaseFor(STARTUP_SLOW_HINT_MS - 1), "starting");
  assert.equal(startupPhaseFor(STARTUP_SLOW_HINT_MS), "slow");
  assert.equal(startupPhaseFor(STARTUP_STALLED_MS - 1), "slow");
  assert.equal(startupPhaseFor(STARTUP_STALLED_MS), "stalled");
  assert.equal(startupPhaseFor(9_999_999), "stalled");
});

test("the stalled bound outlives every startup read that can fail on its own", () => {
  // A renderer startup read that never settles rejects only at the shared RPC
  // ceiling. Declaring the boot stalled before that would turn a slow but
  // successful launch into an error screen, so the bound has to stay above it.
  assert.ok(
    STARTUP_STALLED_MS > DEFAULT_RPC_TIMEOUT_MS,
    `stalled bound ${STARTUP_STALLED_MS} must exceed the RPC ceiling ${DEFAULT_RPC_TIMEOUT_MS}`,
  );
  assert.ok(STARTUP_SLOW_HINT_MS < DEFAULT_RPC_TIMEOUT_MS);
});

test("the watchdog announces each bound once, in order", () => {
  const fake = fakeScheduler();
  const phases = [];
  const watchdog = createStartupWatchdog({
    onPhase: (phase) => phases.push(phase),
    scheduler: fake.scheduler,
  });

  watchdog.start();
  assert.equal(fake.armed(), 2);
  // Arming is not a phase: nothing is published until a bound actually passes.
  assert.deepEqual(phases, []);

  fake.fire(STARTUP_SLOW_HINT_MS);
  assert.deepEqual(phases, ["slow"]);
  fake.fire(STARTUP_STALLED_MS);
  assert.deepEqual(phases, ["slow", "stalled"]);
});

test("stopping the watchdog disarms both bounds and silences late phases", () => {
  const fake = fakeScheduler();
  const phases = [];
  const watchdog = createStartupWatchdog({
    onPhase: (phase) => phases.push(phase),
    scheduler: fake.scheduler,
  });

  watchdog.start();
  watchdog.stop();
  assert.equal(fake.armed(), 0);
  // A timer that already fired before `stop` must not publish either.
  fake.fire(STARTUP_SLOW_HINT_MS);
  fake.fire(STARTUP_STALLED_MS);
  assert.deepEqual(phases, []);

  // Idempotent, and a stopped watchdog cannot be restarted.
  watchdog.stop();
  watchdog.start();
  assert.equal(fake.armed(), 0);
});

test("re-arming an already-armed watchdog does not double its bounds", () => {
  const fake = fakeScheduler();
  const phases = [];
  const watchdog = createStartupWatchdog({
    onPhase: (phase) => phases.push(phase),
    scheduler: fake.scheduler,
  });

  watchdog.start();
  watchdog.start();
  assert.equal(fake.armed(), 2);
  fake.fire(STARTUP_SLOW_HINT_MS);
  assert.deepEqual(phases, ["slow"]);
});

test("the diagnostics report states what the renderer already knows", () => {
  const report = buildStartupDiagnostics({
    phase: "stalled",
    elapsedMs: 181_400,
    platform: "darwin",
    locale: "zh-CN",
    appVersion: "0.15.2",
    error: "host RPC timeout: settings.get",
    downComponent: "host",
    downMessage: "HOST_UNAVAILABLE",
  });

  assert.match(report, /^PI-Desktop startup diagnostics\n/);
  assert.match(report, /phase: stalled/);
  assert.match(report, /waited: 181s/);
  assert.match(report, /platform: darwin/);
  assert.match(report, /locale: zh-CN/);
  assert.match(report, /app version: 0\.15\.2/);
  assert.match(report, /last startup error: host RPC timeout: settings\.get/);
  assert.match(report, /reported down: host \(HOST_UNAVAILABLE\)/);
});

test("the diagnostics report degrades to explicit unknowns, never to silence", () => {
  const report = buildStartupDiagnostics({
    phase: "slow",
    elapsedMs: 30_400,
    platform: "win32",
  });

  assert.match(report, /waited: 30s/);
  assert.match(report, /locale: unknown/);
  assert.match(report, /app version: unknown/);
  assert.match(report, /last startup error: none/);
  assert.match(report, /reported down: none/);
  // Nothing the user did not already see: no paths, no session or token data.
  assert.doesNotMatch(report, /\/(Users|home)\//);
});

test("the recovery surface stays operable with no backend at all", () => {
  assert.match(recovery, /data-testid="startup-recovery"/);
  assert.match(recovery, /role="alertdialog"/);
  assert.match(recovery, /aria-labelledby="startup-recovery-title"/);
  assert.match(recovery, /aria-describedby="startup-recovery-body"/);
  // Retry, logs, diagnostics and quit: every action is renderer-local or main-only.
  assert.match(recovery, /onClick=\{onRetry\}/);
  assert.match(recovery, /api\.openLogs\(\)/);
  assert.match(recovery, /navigator\.clipboard\.writeText\(report\)/);
  assert.match(recovery, /api\.quitApp\(\)/);
  // The stalled state offers the retry; the slow state must not, because the
  // startup it is waiting for is still in flight.
  assert.match(recovery, /\{stalled && \(/);
  assert.match(recovery, /t\("errors\.action\.retry"\)/);
  assert.match(recovery, /t\("status\.openLogs"\)/);
  assert.match(recovery, /t\("tray\.quit"\)/);
  // A copy that fails still says so instead of looking like a dead button.
  assert.match(recovery, /setCopyState\("failed"\)/);
  assert.match(recovery, /startup\.diagnosticsCopied/);
  assert.match(recovery, /startup\.diagnosticsFailed/);
  // The version read is bounded: a wedged bridge must not hang the action.
  assert.match(recovery, /Promise\.race\(/);
});

test("the shell watches the wait and renders the recovery surface", () => {
  assert.match(shell, /import \{ useStartupWatchdog \} from "\.\/useStartupWatchdog"/);
  assert.match(shell, /useStartupWatchdog\(ready\)/);
  assert.match(shell, /import \{ StartupRecovery \} from "\.\.\/\.\.\/components\/StartupRecovery"/);
  assert.match(shell, /<StartupRecovery[\s\S]*onRetry=\{retryStartup\}/);
  assert.match(shell, /startupPhase !== "starting"/);
  // Exactly one boot surface is mounted: the splash yields to the recovery.
  assert.match(shell, /const splash = showSplash && startupPhase === "starting"/);
  // Window controls are the only ones Windows/Linux have; they must be there
  // while the recovery surface owns the window.
  assert.match(shell, /\{\(ready \|\| startupPhase !== "starting"\) && !showSplash \? \(/);
  assert.match(shell, /startupWaitedMs/);
});

test("the watchdog hook owns its timers and keeps the wait alive on retry", () => {
  const hook = shell.match(/useStartupWatchdog\.ts[\s\S]*$/)?.[0] ?? shell;
  assert.match(hook, /return \(\) => watchdog\.stop\(\)/);
  assert.match(hook, /setAttempt\(\(current\) => current \+ 1\)/);
  // A boot that does finish must clear the phase, or the surface would outlive
  // the data it was covering.
  assert.match(hook, /if \(ready\) \{\n\s+setPhase\("starting"\);/);
  assert.match(hook, /void useAppStore\.getState\(\)\.bootstrap\(\)/);
});

test("quitting from the recovery surface is main-process owned", () => {
  assert.match(protocol, /appQuit: "pi-desktop\/app\/quit"/);
  assert.match(mainIpc, /handle\(IPC\.invoke\.appQuit, async \(\) => \{\n\s+app\.quit\(\);/);
  assert.match(mainIpc, /^import \{ app, BrowserWindow \} from "electron";/m);
  assert.match(apiSource, /quitApp: \(\) => invoke<\{ ok: boolean \}>\(IPC\.invoke\.appQuit\)/);
});

test("the recovery surface layers above the splash and below the window controls", () => {
  assert.match(css, /\.startup-recovery \{[\s\S]*position: fixed;[\s\S]*inset: 0;/);
  assert.match(css, /\.app-shell > \.startup-splash \{\n\s+z-index: 1300;/);
  assert.match(css, /\.startup-recovery \{[\s\S]*z-index: 1400;/);
  assert.match(
    css,
    /\.app-shell:has\(> \.startup-recovery\) > \.window-controls \{\n\s+z-index: 1500;/,
  );
  assert.match(css, /\.startup-recovery-actions \{[\s\S]*flex-wrap: wrap;/);
  // The surface is draggable like the splash, but its controls are not.
  assert.match(css, /\.startup-recovery \{[\s\S]*-webkit-app-region: drag;/);
  assert.match(css, /\.startup-recovery-card \{[\s\S]*-webkit-app-region: no-drag;/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.startup-recovery \{/);
});

test("the recovery copy is catalog-backed in every mirrored locale", () => {
  for (const [name, catalog] of [
    ["en", english],
    ["zh-CN", chinese],
    ["zh-TW", traditional],
  ]) {
    for (const key of [
      "slowTitle",
      "slowBody",
      "stalledTitle",
      "stalledBody",
      "copyDiagnostics",
      "diagnosticsCopied",
      "diagnosticsFailed",
    ]) {
      assert.match(catalog, new RegExp(`${key}:`), `${name} is missing startup.${key}`);
    }
  }
  assert.match(english, /stalledTitle: "PI-Desktop couldn't finish starting"/);
  assert.match(chinese, /stalledTitle: "PI-Desktop 未能完成启动"/);
  // User-facing copy: the local service is never called a host or a backend.
  const startupDomain = english.match(/\n  startup: \{[\s\S]*?\n  \},/)?.[0] ?? "";
  assert.ok(startupDomain.length > 0, "the English startup domain was not found");
  assert.doesNotMatch(startupDomain, /host|backend|sidecar|renderer/i);
  assert.match(startupDomain, /local service/);
});
