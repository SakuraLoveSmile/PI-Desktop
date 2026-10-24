import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../../../scripts/verify-macos-release.sh", import.meta.url));
const product = "Pi-Desktop-Plus.app";
const host = "Contents/Resources/bin/pi-desktop-host-core";

async function fixture(t, { nativeCodesign = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pi-release-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const release = join(root, "release with spaces");
  const app = join(release, "mac-arm64", product);
  const bin = join(root, "bin");
  const log = join(root, "commands.jsonl");
  await mkdir(join(app, "Contents/Resources/bin"), { recursive: true });
  await mkdir(join(app, "Contents/_CodeSignature"));
  await mkdir(bin);
  await writeFile(join(app, host), "fixture");
  await writeFile(join(app, "Contents/_CodeSignature/CodeResources"), "fixture seal");
  await writeFile(join(release, "Pi-Desktop-Plus-arm64.dmg"), "fixture DMG");
  await writeFile(join(release, "Pi-Desktop-Plus-arm64-mac.zip"), "fixture ZIP");
  const preamble = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PI_COMMAND_LOG, JSON.stringify({ command: path.basename(process.argv[1]), args }) + '\\n');
`;
  const commands = {
    codesign: `
const target = args.at(-1);
const stage = target.includes('/zip/') ? 'zip' : target.includes('/dmg/') ? 'dmg' : 'loose';
const kind = target.endsWith('pi-desktop-host-core') ? 'host' : 'app';
if (process.env.PI_FAIL_SIGNATURE === stage + ':' + kind) {
  console.error('invalid signature: ' + target);
  process.exit(41);
}
`,
    ditto: `
if (process.env.PI_FAIL_ARCHIVE === 'zip') process.exit(42);
const target = path.join(args.at(-1), ${JSON.stringify(product)});
fs.cpSync(process.env.PI_FIXTURE_APP, target, { recursive: true });
if (process.env.PI_MISSING_SEAL === 'zip') fs.rmSync(path.join(target, 'Contents/_CodeSignature'), { recursive: true });
`,
    hdiutil: `
if (args[0] === 'attach') {
  if (process.env.PI_FAIL_ARCHIVE === 'dmg') process.exit(43);
  const mount = args[args.indexOf('-mountpoint') + 1];
  const target = path.join(mount, ${JSON.stringify(product)});
  fs.cpSync(process.env.PI_FIXTURE_APP, target, { recursive: true });
  if (process.env.PI_MISSING_SEAL === 'dmg') fs.rmSync(path.join(target, 'Contents/_CodeSignature'), { recursive: true });
} else if (args[0] === 'detach') {
  if (process.env.PI_FAIL_DETACH === 'true') process.exit(44);
} else process.exit(45);
`,
    spctl: "process.exit(46);",
    xcrun: "process.exit(47);",
  };
  for (const [name, body] of Object.entries(commands)) {
    if (nativeCodesign && name === "codesign") continue;
    await writeFile(join(bin, name), preamble + body);
    await chmod(join(bin, name), 0o755);
  }
  function run(extra = {}) {
    return spawnSync("bash", [script, "--integrity-only", release], {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, MAC_SIGNING_IDENTITY: "", APPLE_TEAM_ID: "",
        PATH: `${bin}:${process.env.PATH}`, TMPDIR: root,
        PI_COMMAND_LOG: log, PI_FIXTURE_APP: app, ...extra },
    });
  }
  async function calls() {
    return (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(JSON.parse);
  }
  return { root, release, app, run, calls };
}

test("integrity-only verifies the loose, ZIP and read-only DMG apps and their Hosts without Apple credentials", async t => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = await f.calls();
  const signatures = calls.filter(call => call.command === "codesign");
  assert.equal(signatures.length, 6);
  for (let i = 0; i < signatures.length; i += 2) {
    assert.deepEqual(signatures[i].args.slice(0, -1), ["--verify", "--deep", "--strict", "--verbose=2"]);
    assert.deepEqual(signatures[i + 1].args, ["--verify", "--strict", "--verbose=2", join(signatures[i].args.at(-1), host)]);
  }
  assert.equal(signatures[0].args.at(-1), f.app);
  const archive = calls.find(call => call.command === "ditto");
  assert.deepEqual(archive.args.slice(0, 2), ["-x", "-k"]);
  const attach = calls.find(call => call.command === "hdiutil" && call.args[0] === "attach");
  assert.deepEqual(attach.args.slice(0, 4), ["attach", "-readonly", "-nobrowse", "-mountpoint"]);
  assert.deepEqual(calls.at(-1), { command: "hdiutil", args: ["detach", attach.args[4]] });
  await assert.rejects(readFile(join(attach.args[4], product, host)), { code: "ENOENT" });
  assert(calls.every(call => !["spctl", "xcrun"].includes(call.command)));
});

test("any app or Host signature failure blocks integrity verification and detaches a mounted DMG", async t => {
  for (const stage of ["loose", "zip", "dmg"]) {
    for (const kind of ["app", "host"]) {
      await t.test(`${stage}:${kind}`, async t => {
        const f = await fixture(t);
        const result = f.run({ PI_FAIL_SIGNATURE: `${stage}:${kind}` });
        assert.equal(result.status, 41, result.stdout + result.stderr);
        assert.match(result.stderr, /invalid signature/);
        const calls = await f.calls();
        assert.equal(calls.some(call => call.command === "hdiutil" && call.args[0] === "detach"), stage === "dmg");
      });
    }
  }
});

test("missing resource seals are rejected in every distributed app", async t => {
  for (const stage of ["loose", "zip", "dmg"]) {
    await t.test(stage, async t => {
      const f = await fixture(t);
      if (stage === "loose") await rm(join(f.app, "Contents/_CodeSignature"), { recursive: true });
      const result = f.run({ PI_MISSING_SEAL: stage });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /missing app resource seal/);
    });
  }
});

test("missing Host or distribution assets fail closed", async t => {
  for (const missing of [host, "dmg", "zip"]) {
    await t.test(missing, async t => {
      const f = await fixture(t);
      await rm(missing === host ? join(f.app, host) : join(f.release,
        missing === "dmg" ? "Pi-Desktop-Plus-arm64.dmg" : "Pi-Desktop-Plus-arm64-mac.zip"));
      const result = f.run();
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, missing === host ? /missing host-core/ : /expected exactly one/);
    });
  }
});

test("archive failures and detach failures block success", async t => {
  for (const failure of ["zip", "dmg", "detach"]) {
    await t.test(failure, async t => {
      const f = await fixture(t);
      const result = f.run(failure === "detach" ? { PI_FAIL_DETACH: "true" } : { PI_FAIL_ARCHIVE: failure });
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      if (failure === "detach") assert.match(result.stderr, /unable to detach DMG; retained/);
    });
  }
});

test("native codesign accepts a sealed fixture and rejects resource tampering", { skip: process.platform !== "darwin" }, async t => {
  const f = await fixture(t, { nativeCodesign: true });
  await rm(join(f.app, "Contents/_CodeSignature"), { recursive: true });
  await mkdir(join(f.app, "Contents/MacOS"));
  await copyFile("/usr/bin/true", join(f.app, "Contents/MacOS/fixture"));
  await copyFile("/usr/bin/true", join(f.app, host));
  await writeFile(join(f.app, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>test.pi.release-integrity</string>
<key>CFBundleExecutable</key><string>fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
</dict></plist>`);
  const resource = join(f.app, "Contents/Resources/sealed.txt");
  await writeFile(resource, "original");
  for (const target of [join(f.app, host), f.app]) {
    const signed = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", "--options", "runtime", target], { encoding: "utf8" });
    assert.equal(signed.status, 0, signed.stderr);
  }
  const valid = f.run();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
  await writeFile(resource, "tampered");
  const invalid = f.run();
  assert.notEqual(invalid.status, 0, invalid.stdout + invalid.stderr);
  assert.match(invalid.stderr, /sealed resource is missing or invalid|file modified/);
});
