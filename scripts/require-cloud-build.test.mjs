import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { requireCloudPackageBuild } from "./require-cloud-build.mjs";

test("packaging requires a GitHub-hosted runner", () => {
  for (const env of [{}, { CI: "true" }, { GITHUB_ACTIONS: "true" },
    { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" }]) {
    assert.throws(() => requireCloudPackageBuild(env), /GitHub-hosted Actions/);
  }
  assert.doesNotThrow(() => requireCloudPackageBuild({
    GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
  }));
});

test("direct packaging entry points stop before invoking build tools locally", () => {
  const env = { ...process.env, GITHUB_ACTIONS: "false", RUNNER_ENVIRONMENT: "" };
  for (const name of ["require-cloud-build.mjs", "build-desktop-release.mjs", "package-macos-identity.mjs"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(name, import.meta.url))], {
      env, encoding: "utf8", timeout: 5000,
    });
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(result.stderr, /Installer packaging runs only on GitHub-hosted Actions/);
    assert.match(result.stderr, /gh workflow run release.yml/);
  }
});
