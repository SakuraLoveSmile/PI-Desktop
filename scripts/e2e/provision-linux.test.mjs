import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { officialUbuntuMirrors, provisionLinux } from "./provision-linux.mjs";

const azure = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n";
const archive = "https://archive.ubuntu.com/ubuntu/\tpriority:2\n";
const security = "https://security.ubuntu.com/ubuntu/\tpriority:3\n";
const source = azure + archive + security;

async function fixture(t, { input = source, failCommand } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "pi-e2e-provision-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "apt-mirrors.txt");
  await writeFile(path, input);
  const commands = [];
  const reports = [];
  const boundary = {
    readMirrors: () => readFile(path, "utf8"),
    writeMirrors: text => writeFile(path, text),
    run: async (command, args) => {
      commands.push({ command, args });
      if (args[1] === failCommand) throw new Error(`Controlled ${failCommand} failure`);
    },
    report: text => reports.push(text),
  };
  return { path, commands, reports, run: () => provisionLinux(boundary) };
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
});

test("index acquisition failure stops before package installation", async t => {
  const current = await fixture(t, { failCommand: "update" });
  await assert.rejects(current.run(), /Controlled update failure/);
  assert.equal(await readFile(current.path, "utf8"), archive + security);
  assert.deepEqual(current.commands, [{ command: "sudo", args: ["apt-get", "update", "--error-on=any"] }]);
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
