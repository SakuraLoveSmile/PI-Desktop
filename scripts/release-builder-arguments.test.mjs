import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Windows packaging forwards explicit update channel and architecture to every format", { skip: process.platform === "win32" }, t => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-builder-args-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const pnpm = join(scratch, "pnpm");
  const log = join(scratch, "calls.jsonl");
  writeFileSync(pnpm, `#!${process.execPath}\nrequire('fs').appendFileSync(process.env.PI_BUILDER_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  chmodSync(pnpm, 0o755);
  execFileSync(process.execPath, [fileURLToPath(new URL("./build-desktop-release.mjs", import.meta.url)),
    "win", "--", "--x64", "-c.publish.channel=beta"], {
    env: { ...process.env, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
      PATH: `${scratch}${delimiter}${process.env.PATH}`, PI_BUILDER_LOG: log },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls.map(args => args[3]), ["nsis", "zip", "portable"]);
  for (const args of calls) {
    assert(args.includes("--x64"));
    assert(args.includes("-c.publish.channel=beta"));
    assert(!args.includes("--"), "a separator must not hide flags from electron-builder");
    assert.deepEqual(args.slice(4, 6), ["--publish", "never"]);
  }
});

test("installed builder merges the channel override into the GitHub publish array", async () => {
  const desktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
  const builder = createRequire(desktop.resolve("electron-builder/package.json"));
  const { getConfig } = builder("app-builder-lib/out/util/config/config.js");
  const root = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
  const config = await getConfig(root, null, { publish: { channel: "beta" } });
  assert.equal(config.publish[0].provider, "github");
  assert.equal(config.publish[0].channel, "beta");
  assert.equal(config.publish[0].owner, "SakuraLoveSmile");
  assert.equal(config.publish[0].repo, "PI-Desktop");
});

test("Linux packaging forwards explicit update channel and architecture past the pnpm separator", { skip: process.platform === "win32" }, t => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-linux-builder-args-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const pnpm = join(scratch, "pnpm");
  const log = join(scratch, "calls.jsonl");
  writeFileSync(pnpm, `#!${process.execPath}\nrequire('fs').appendFileSync(process.env.PI_BUILDER_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  chmodSync(pnpm, 0o755);
  execFileSync(process.execPath, [fileURLToPath(new URL("./build-desktop-release.mjs", import.meta.url)),
    "linux", "--", "--arm64", "-c.publish.channel=beta"], {
    env: { ...process.env, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
      PATH: `${scratch}${delimiter}${process.env.PATH}`, PI_BUILDER_LOG: log },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls, [["exec", "electron-builder", "--linux", "--publish", "never", "--arm64", "-c.publish.channel=beta"]]);
});
