#!/usr/bin/env node
// Build and attest one request candidate using the provisioned host environment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { root } from "../e2e-suite-runtime.mjs";
import { artifactIdentity, candidateTargetDirectory, directOverlayBuildPlan, receiptPath, sourceIdentity } from "./build-candidate-receipt.mjs";

const overlay = process.argv.length === 3 && process.argv[2] === "--overlay";
assert.ok(process.argv.length === 2 || overlay, "Usage: node scripts/e2e/build-candidate.mjs [--overlay]");
const targetDir = candidateTargetDirectory(root, overlay, process.env.CARGO_TARGET_DIR);
const hostBinary = join(targetDir, "debug", process.platform === "win32" ? "pi-desktop-host-core.exe" : "pi-desktop-host-core");
await mkdir(dirname(receiptPath), { recursive: true });
// A failed/replaced build must never leave an earlier attestation usable.
await rm(receiptPath, { force: true });
const source = await sourceIdentity();
const startedAt = new Date().toISOString();
async function run(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: "inherit" });
  const status = await new Promise((yes, no) => {
    child.once("error", no);
    child.once("exit", (code, signal) => yes({ code, signal }));
  });
  assert.equal(status.code, 0, `${command} failed (${status.code ?? status.signal})`);
}
const commands = overlay ? directOverlayBuildPlan(targetDir) : ["pnpm build:js", "cargo build --locked -p host-core"];
if (overlay) {
  for (const step of commands) await run(step.command.startsWith("node_modules/") ? join(root, step.command) : step.command,
    step.args, resolve(root, step.cwd));
} else {
  await run("pnpm", ["build:js"]);
  await run("cargo", ["build", "--locked", "-p", "host-core", "--target-dir", targetDir]);
}
if (process.env.PI_DESKTOP_HOST_BIN) {
  assert.equal(await realpath(resolve(process.env.PI_DESKTOP_HOST_BIN)), await realpath(hostBinary),
    "PI_DESKTOP_HOST_BIN must select the Host just built in the selected target directory");
}
assert.deepEqual(await sourceIdentity(), source, "Source/base changed during build; no receipt is valid");
const receipt = { version: 1, source, hostBinary: resolve(process.env.PI_DESKTOP_HOST_BIN ?? hostBinary),
  commands, ...(overlay ? { buildMode: "direct-overlay", cargoTargetDir: targetDir } : {}), startedAt,
  completedAt: new Date().toISOString(), artifacts: await artifactIdentity(resolve(process.env.PI_DESKTOP_HOST_BIN ?? hostBinary)) };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(`Candidate build receipt: ${receiptPath}`);
