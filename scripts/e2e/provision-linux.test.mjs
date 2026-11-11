import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diagnoseUbuntuNetwork, officialUbuntuMirrors, provisionLinux } from "./provision-linux.mjs";

const azure = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n";
const archive = "https://archive.ubuntu.com/ubuntu/\tpriority:2\n";
const security = "https://security.ubuntu.com/ubuntu/\tpriority:3\n";
const source = azure + archive + security;

async function fixture(t, { input = source, failCommand, failDiagnostics = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pi-e2e-provision-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "apt-mirrors.txt");
  await writeFile(path, input);
  const commands = [];
  const reports = [];
  let diagnosticCalls = 0;
  const boundary = {
    readMirrors: () => readFile(path, "utf8"),
    writeMirrors: text => writeFile(path, text),
    run: async (command, args) => {
      commands.push({ command, args });
      if (args[1] === failCommand) throw new Error(`Controlled ${failCommand} failure`);
    },
    report: text => reports.push(text),
    diagnose: async () => {
      diagnosticCalls++;
      if (failDiagnostics) throw new Error("Controlled diagnostics failure");
    },
  };
  return { path, commands, reports, run: () => provisionLinux(boundary),
    diagnosticCalls: () => diagnosticCalls };
}

test("removes only the Azure mirror while preserving HTTPS bytes and priorities", () => {
  for (const spacing of ["\t", "  "]) {
    const official = (archive + security).replaceAll("\t", spacing);
    assert.equal(officialUbuntuMirrors(azure + official), official);
  }
});

test("unexpected source lists are rejected before any mutation or command", async t => {
  for (const input of ["", archive + security, source + "https://other.invalid/\tpriority:4\n",
    source.replace("https://archive.", "http://archive."), source.replace("priority:2", "priority:1"),
    azure + security + archive, source.replace("azure.archive.ubuntu.com", "other.invalid")]) {
    const current = await fixture(t, { input });
    await assert.rejects(current.run(), /Unexpected Ubuntu mirror list/);
    assert.equal(await readFile(current.path, "utf8"), input);
    assert.deepEqual(current.commands, []);
    assert.deepEqual(current.reports, []);
  }
});

test("strict index update precedes the unchanged packages and Electron sandbox configuration", async t => {
  const current = await fixture(t);
  await current.run();
  assert.equal(await readFile(current.path, "utf8"), archive + security);
  assert.deepEqual(current.commands, [
    { command: "sudo", args: ["apt-get", "update", "--error-on=any"] },
    { command: "sudo", args: ["apt-get", "install", "-y", "xvfb", "openbox", "libnss3",
      "libatk-bridge2.0-0t64", "libgtk-3-0t64", "libgbm1", "libasound2t64", "openssl", "zip", "fonts-noto-cjk"] },
    { command: "sudo", args: ["sysctl", "-w", "kernel.apparmor_restrict_unprivileged_userns=0"] },
  ]);
  assert.deepEqual(current.reports, [`Ubuntu fixture mirrors:\n${archive + security}`]);
  assert.equal(current.diagnosticCalls(), 0);
});

test("index acquisition failure stops before package installation", async t => {
  const current = await fixture(t, { failCommand: "update" });
  await assert.rejects(current.run(), /Controlled update failure/);
  assert.equal(await readFile(current.path, "utf8"), archive + security);
  assert.deepEqual(current.commands, [{ command: "sudo", args: ["apt-get", "update", "--error-on=any"] }]);
  assert.equal(current.diagnosticCalls(), 1);
});

test("diagnostic failure is visible and preserves the original index error", async t => {
  const current = await fixture(t, { failCommand: "update", failDiagnostics: true });
  await assert.rejects(current.run(), /Controlled update failure/);
  assert.equal(current.commands.length, 1);
  assert.equal(current.diagnosticCalls(), 1);
  assert(current.reports.includes("Ubuntu network diagnostics failed: Controlled diagnostics failure"));
});

test("network diagnostics collect public DNS and HTTPS evidence without a privileged command", async () => {
  const calls = [];
  const reports = [];
  await diagnoseUbuntuNetwork({
    probe: async (command, args) => {
      calls.push({ command, args });
      return { code: command === "getent" ? 2 : 6, stdout: "", stderr: "Controlled resolution failure" };
    },
    report: text => reports.push(text),
  });
  assert.deepEqual(calls.filter(call => call.command === "getent").map(call => call.args), [
    ["ahostsv4", "archive.ubuntu.com"], ["ahostsv4", "security.ubuntu.com"],
    ["ahostsv4", "packages.microsoft.com"],
  ]);
  const requests = calls.filter(call => call.command === "curl");
  assert.deepEqual(requests.map(call => call.args.at(-1)), [
    "https://archive.ubuntu.com/ubuntu/dists/noble/InRelease",
    "https://security.ubuntu.com/ubuntu/dists/noble/InRelease",
  ]);
  for (const { args } of requests) {
    assert(args.includes("--fail"));
    assert.equal(args.includes("--insecure"), false);
    assert.equal(args.includes("--retry"), false);
  }
  assert.equal(calls.every(call => ["getent", "curl"].includes(call.command)), true);
  assert.equal(reports.length, 5);
  assert(reports.every(line => line.includes("Controlled resolution failure")));
});

test("package installation failure stops before sandbox configuration", async t => {
  const current = await fixture(t, { failCommand: "install" });
  await assert.rejects(current.run(), /Controlled install failure/);
  assert.equal(current.commands.length, 2);
  assert.equal(current.commands[1].args[1], "install");
});

test("the executable refuses local execution before reading privileged files", () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL("./provision-linux.mjs", import.meta.url))], {
    env: { GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "github-hosted" }, encoding: "utf8",
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /requires a GitHub-hosted Linux runner/);
});
