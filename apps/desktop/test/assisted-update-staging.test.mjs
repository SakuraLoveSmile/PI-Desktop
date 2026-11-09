import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MACHO, fakeToolRunner } from "./helpers/assisted-fakes.mjs";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const { stageUpdate, parseMachOArchitectures, compareStableVersions } = await import(
  "../electron/main/assisted-update/staging.ts"
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "assisted-staging-"));
  const stagingDir = join(root, ".pi-desktop-plus-update-job-aaaa-0001");
  const input = {
    zipPath: join(root, "update.zip"),
    stagingDir,
    running: { bundleId: "cn.sakura.pi-desktop", version: "0.16.0" },
    offeredVersion: "0.16.1",
    arch: "arm64",
  };
  return { root, stagingDir, input };
}

async function exists(path) {
  return stat(path).then(() => true, () => false);
}

test("a matching update is staged next to the installed app", async () => {
  const { root, stagingDir, input } = await fixture();
  const tools = fakeToolRunner();
  const { stagedApp } = await stageUpdate(input, tools.run);
  assert.equal(stagedApp, join(stagingDir, "Pi-Desktop-Plus.app"));
  assert.deepEqual(
    tools.calls.map((call) => call[0]),
    ["ditto", "plutil", "codesign", "xattr"],
  );
  assert.deepEqual(tools.calls[0].slice(1, 3), ["-x", "-k"]);
  assert.deepEqual(tools.calls[2].slice(1), ["--verify", "--deep", "--strict", stagedApp]);
  await rm(root, { recursive: true });
});

test("archive clutter that macOS adds is ignored", async () => {
  const { root, input } = await fixture();
  const tools = fakeToolRunner({ entries: ["Pi-Desktop-Plus.app", "__MACOSX/", ".DS_Store"] });
  await stageUpdate(input, tools.run);
  await rm(root, { recursive: true });
});

const refusals = [
  ["an archive that cannot be extracted", { dittoCode: 1 }, "extract-failed"],
  ["an archive with no application", { entries: [] }, "layout"],
  ["an archive with two applications", { entries: ["A.app", "B.app"] }, "layout"],
  ["an archive with a stray file next to the app", { entries: ["Pi-Desktop-Plus.app", "README.txt"] }, "layout"],
  ["an app that is really a file", { entries: ["Pi-Desktop-Plus.app.zip", "x"] }, "layout"],
  ["a different application", { bundleId: "com.example.other" }, "identity"],
  ["a version other than the offered one", { version: "0.16.2" }, "version"],
  ["the running version again", { version: "0.16.0" }, "version"],
  ["an older version", { version: "0.15.9" }, "version"],
  ["an unreadable Info.plist", { plutilCode: 1 }, "layout"],
  ["a non-JSON Info.plist", { plutilOutput: "not json" }, "layout"],
  ["an executable name with a path", { executable: "../evil" }, "layout"],
  ["an executable for the wrong CPU", { exe: MACHO.x64 }, "arch"],
  ["a missing executable", { exe: null }, "layout"],
  ["a broken seal", { codesignCode: 1 }, "signature"],
  ["a quarantined bundle", { quarantined: true }, "quarantine"],
  ["attributes that cannot be read", { xattrFailure: true }, "quarantine"],
];
for (const [label, options, code] of refusals) {
  test(`refuses ${label} and removes the staging directory`, async () => {
    const { root, stagingDir, input } = await fixture();
    const tools = fakeToolRunner(options);
    await assert.rejects(() => stageUpdate(input, tools.run), { code });
    assert.equal(await exists(stagingDir), false);
    assert.deepEqual(await readdir(root), []);
    await rm(root, { recursive: true });
  });
}

test("a staging directory that already exists is never reused", async () => {
  const { root, input } = await fixture();
  await stageUpdate(input, fakeToolRunner().run);
  await assert.rejects(() => stageUpdate(input, fakeToolRunner().run), { code: "EEXIST" });
  await rm(root, { recursive: true });
});

test("Mach-O headers are read for thin and universal executables", () => {
  assert.deepEqual(parseMachOArchitectures(MACHO.arm64), ["arm64"]);
  assert.deepEqual(parseMachOArchitectures(MACHO.x64), ["x64"]);
  const fat = Buffer.alloc(8 + 20 * 2);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8);
  fat.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(parseMachOArchitectures(fat), ["x64", "arm64"]);
  const fat64 = Buffer.alloc(8 + 32);
  fat64.writeUInt32BE(0xcafebabf, 0);
  fat64.writeUInt32BE(1, 4);
  fat64.writeUInt32BE(0x0100000c, 8);
  assert.deepEqual(parseMachOArchitectures(fat64), ["arm64"]);
  assert.deepEqual(parseMachOArchitectures(Buffer.from("#!/bin/sh\n")), []);
  assert.deepEqual(parseMachOArchitectures(Buffer.alloc(3)), []);
  const lying = Buffer.alloc(16);
  lying.writeUInt32BE(0xcafebabe, 0);
  lying.writeUInt32BE(1000, 4);
  assert.deepEqual(parseMachOArchitectures(lying), [], "a count beyond the header is not trusted");
});

test("stable versions compare numerically and anything else is never newer", () => {
  assert.equal(compareStableVersions("0.16.1", "0.16.0"), 1);
  assert.equal(compareStableVersions("0.16.0", "0.16.0"), 0);
  assert.equal(compareStableVersions("0.9.9", "0.10.0"), -1);
  assert.equal(compareStableVersions("1.0.0", "0.99.99"), 1);
  for (const bad of ["", "1", "1.2", "1.2.3.4", "1.2.3-rc.1", "v1.2.3", "a.b.c"]) {
    assert.equal(compareStableVersions(bad, "0.0.1"), -1, bad);
    assert.equal(compareStableVersions("9.9.9", bad), -1, bad);
  }
});
