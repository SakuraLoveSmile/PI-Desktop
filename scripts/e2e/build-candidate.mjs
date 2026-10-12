#!/usr/bin/env node
// Build and attest one request candidate using the provisioned host environment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { root } from "../e2e-suite-runtime.mjs";
import { artifactIdentity, receiptPath, sourceIdentity } from "./build-candidate-receipt.mjs";

assert.equal(process.argv.length, 2, "Usage: node scripts/e2e/build-candidate.mjs");
const hostBinary = join(root, "target/debug", process.platform === "win32" ? "pi-desktop-host-core.exe" : "pi-desktop-host-core");
await mkdir(dirname(receiptPath), { recursive: true });
// A failed/replaced build must never leave an earlier attestation usable.
await rm(receiptPath, { force: true });
const source = await sourceIdentity();
const startedAt = new Date().toISOString();
async function run(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit" });
  const status = await new Promise((yes, no) => {
    child.once("error", no);
    child.once("exit", (code, signal) => yes({ code, signal }));
  });
  assert.equal(status.code, 0, `${command} failed (${status.code ?? status.signal})`);
}
await run("pnpm", ["build:js"]);
await run("cargo", ["build", "--locked", "-p", "host-core", "--target-dir", join(root, "target")]);
if (process.env.PI_DESKTOP_HOST_BIN) {
  assert.equal(await realpath(resolve(process.env.PI_DESKTOP_HOST_BIN)), await realpath(hostBinary),
    "PI_DESKTOP_HOST_BIN must select the Host just built in target/debug");
}
assert.deepEqual(await sourceIdentity(), source, "Source/base changed during build; no receipt is valid");
const receipt = { version: 1, source, hostBinary: resolve(process.env.PI_DESKTOP_HOST_BIN ?? hostBinary),
  commands: ["pnpm build:js", "cargo build --locked -p host-core"], startedAt,
  completedAt: new Date().toISOString(), artifacts: await artifactIdentity(resolve(process.env.PI_DESKTOP_HOST_BIN ?? hostBinary)) };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(`Candidate build receipt: ${receiptPath}`);
