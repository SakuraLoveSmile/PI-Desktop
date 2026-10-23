import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

// The old local signing lane was retired in favor of GitHub-hosted Actions.
// Cloud signing/notarization behavior is covered by release-preflight,
// macos-release-verification, refresh-macos-release-metadata and watchdog tests.
test("the retired local release lane refuses execution before invoking build or signing tools", async t => {
  const root = await mkdtemp(join(tmpdir(), "pi-retired-macos-lane-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const script = join(root, "release-macos.sh");
  const log = join(root, "tool-calls.log");
  await mkdir(bin);
  await cp(new URL("../../../scripts/release-macos.sh", import.meta.url), script);
  for (const name of ["cargo", "pnpm", "electron-builder", "codesign", "xcrun", "security"]) {
    const path = join(bin, name);
    await writeFile(path, `#!/bin/sh\nprintf '%s\\n' '${name}' >> "$PI_RETIRED_TOOL_LOG"\nexit 99\n`);
    await chmod(path, 0o755);
  }
  for (const GITHUB_ACTIONS of ["false", "true"]) {
    const result = spawnSync("bash", [script], {
      cwd: root, encoding: "utf8", timeout: 5000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, GITHUB_ACTIONS,
        RUNNER_ENVIRONMENT: "github-hosted", PI_RETIRED_TOOL_LOG: log },
    });
    assert.equal(result.status, 1, result.stderr);
    assert(result.stderr.includes("The standalone macOS release lane has been retired."));
    assert(result.stderr.includes("gh workflow run release.yml --ref main -f sign_macos=false"));
    assert(result.stderr.includes("06-release-runbook.md"));
  }
  await assert.rejects(readFile(log), { code: "ENOENT" }, "no product tool was started");
});
