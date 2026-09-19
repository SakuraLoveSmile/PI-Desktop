/**
 * Settings ▸ Remote Hosts page contract.
 *
 * Guards the compact inventory + Add (SSH/Pair) + Experimental layout: no
 * instructional copy, both add modes stay mounted behind `hidden`, and the
 * unscheduled rows toast unavailability without calling IPC.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { loadStylesSync } from "./helpers/styles.mjs";

const page = readFileSync(
  new URL("../src/components/settings/RemoteHostsPage.tsx", import.meta.url),
  "utf8",
);
const styles = loadStylesSync();

function cssRule(selector) {
  const from = styles.indexOf(`\n${selector} {`);
  assert.ok(from >= 0, `${selector} rule missing`);
  return styles.slice(from, styles.indexOf("}", from));
}

test("remote hosts is an inventory plus one SSH/Pair add form", () => {
  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-controls={`remote-host-add-panel-\$\{mode\}`}/);
  assert.match(page, /id={`remote-host-add-panel-\$\{mode\}`}|id="remote-host-add-panel-ssh"/);
  assert.match(page, /hidden=\{addMode !== "ssh"\}/);
  assert.match(page, /hidden=\{addMode !== "pair"\}/);
  assert.match(page, /api\.bootstrapRemoteHost\(/);
  assert.match(page, /api\.pairRemoteHost\(/);
  assert.match(page, /api\.listRemoteHosts\(/);
  assert.match(page, /api\.removeRemoteHost\(/);

  assert.match(cssRule(".settings-remote-host-add-panel[hidden]"), /display:\s*none/);
  assert.match(cssRule(".settings-remote-host-card"), /background:\s*var\(--ds-tile\)/);
  assert.match(cssRule(".settings-remote-host-name"), /font-size:\s*var\(--text-md-plus\)/);
});

test("remote hosts omits instructional copy", () => {
  assert.doesNotMatch(page, /role="note"/);
  assert.doesNotMatch(page, /settings-row-desc/);
  assert.doesNotMatch(page, /hint=\{/);
  assert.doesNotMatch(page, /settings\.remoteHosts\.(overview|sshBody|pairBody|emptyBody)/);
  assert.doesNotMatch(page, /<SettingsCard title=\{t\("settings\.remoteHosts\.listTitle"\)\}/);
});

test("experimental remote-host rows stay local and unavailable", () => {
  assert.match(page, /EXPERIMENTAL_FEATURES/);
  assert.match(page, /settings\.remoteHosts\.experimentalLan/);
  assert.match(page, /settings\.remoteHosts\.experimentalGateway/);
  assert.match(page, /settings\.remoteHosts\.experimentalMessaging/);
  assert.match(page, /settings\.remoteHosts\.experimentalWsl/);
  assert.match(page, /settings\.remoteHosts\.experimentalExpose/);
  assert.match(page, /aria-disabled="true"/);
  assert.match(page, /experimentalUnavailable/);
  assert.doesNotMatch(page, /api\.\w*[Ee]xperimental/);
  assert.match(
    cssRule('.settings-toggle[aria-disabled="true"]'),
    /cursor:\s*not-allowed/,
  );
});
