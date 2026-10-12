import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { artifactIdentity, sourceIdentity, verifyBuildReceipt } from "./e2e/build-candidate-receipt.mjs";

test("a build receipt rejects changed source, artifacts, base or receipt during acceptance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-build-receipt-"));
  try {
    const config = join(directory, "git-config");
    await writeFile(config, "");
    const git = args => execFileSync("git", args, { cwd: directory,
      env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: "1" } });
    git(["init", "--quiet", "--initial-branch=main"]);
    await writeFile(join(directory, ".gitignore"), "target/\npackages/*/dist/\napps/desktop/out/\n.review-evidence/\ngit-config\n");
    await writeFile(join(directory, "source.ts"), "export const version = 1;\n");
    git(["add", "."]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
      "commit", "--quiet", "-m", "Disposable candidate fixture"]);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const hostBinary = join(directory, "target/debug/host");
    for (const path of [hostBinary, "packages/shared/dist/index.js", "packages/agent-runtime/dist/runtime.js",
      "packages/agent-host/dist/agent-host.js", "packages/host-runtime/dist/host-process.js", "apps/desktop/out/main/index.js"]) {
      const file = path === hostBinary ? path : join(directory, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "built fixture\n");
    }
    const path = join(directory, ".review-evidence/build-candidate.json");
    await mkdir(dirname(path), { recursive: true });
    const receipt = { version: 1, commands: ["pnpm build:js", "cargo build --locked -p host-core"], hostBinary,
      source: await sourceIdentity(directory), artifacts: await artifactIdentity(hostBinary, directory) };
    await writeFile(path, JSON.stringify(receipt));
    const options = { directory, path };
    const start = await verifyBuildReceipt(hostBinary, options);
    assert.deepEqual(start, receipt);
    await verifyBuildReceipt(hostBinary, { ...options, expected: start });
    await writeFile(join(directory, "source.ts"), "export const version = 2;\n");
    await assert.rejects(verifyBuildReceipt(hostBinary, options), /source\/base changed/);
    await writeFile(join(directory, "source.ts"), "export const version = 1;\n");
    await writeFile(hostBinary, "stale or replaced binary\n");
    await assert.rejects(verifyBuildReceipt(hostBinary, options), /artifacts changed/);
    await writeFile(hostBinary, "built fixture\n");
    const runtime = join(directory, "packages/agent-runtime/dist/extra.js");
    await writeFile(runtime, "unrecorded output\n");
    await assert.rejects(verifyBuildReceipt(hostBinary, options), /artifacts changed/);
    await rm(runtime);
    await writeFile(path, JSON.stringify({ ...receipt, completedAt: "replaced while running" }));
    await assert.rejects(verifyBuildReceipt(hostBinary, { ...options, expected: start }), /receipt changed during E2E/);
    await writeFile(path, JSON.stringify(receipt));
    const head = git(["rev-parse", "HEAD"]).toString().trim();
    const otherBase = git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
      "commit-tree", `${head}^{tree}`, "-m", "New remote base"]).toString().trim();
    git(["update-ref", "refs/remotes/origin/main", otherBase]);
    await assert.rejects(verifyBuildReceipt(hostBinary, options), /source\/base changed/);
    assert.equal((await readFile(path, "utf8")), JSON.stringify(receipt), "verification does not rewrite evidence");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
