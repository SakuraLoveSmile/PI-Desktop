import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { candidateIdentity, root } from "../e2e-suite-runtime.mjs";

export const receiptPath = join(root, ".review-evidence/build-candidate.json");

export function candidateTargetDirectory(directory, overlay, configuredTarget) {
  return resolve(directory, overlay && configuredTarget ? configuredTarget : "target");
}

/** Complete worktree-local Desktop dependency build, without package-manager mutation. */
export function directOverlayBuildPlan(targetDir) {
  assert.equal(typeof targetDir, "string", "Receipt must identify the complete candidate build target");
  assert.equal(resolve(targetDir), targetDir, "Receipt must identify the complete candidate build absolute target");
  return [
    ...["shared", "i18n", "plugin-sdk", "agent-host", "agent-runtime", "host-runtime", "racp", "voice-runtime", "plugin-devkit"]
      .map(name => ({ command: "node_modules/.bin/tsc", args: [name === "voice-runtime" ? "--build" : "-p", `packages/${name}/tsconfig.json`], cwd: "." })),
    { command: "node_modules/.bin/electron-vite", args: ["build"], cwd: "apps/desktop" },
    { command: "cargo", args: ["build", "--locked", "-p", "host-core", "--target-dir", targetDir], cwd: "." },
  ];
}

export async function sourceIdentity(directory = root) {
  const identity = await candidateIdentity(directory);
  // Executable hashes are recorded separately; the source identity uses the
  // existing dirty-candidate inventory, including untracked source and links.
  return { head: identity.head, baseMain: identity.baseMain,
    workspaceDiffSha256: identity.workspaceDiffSha256 };
}

export async function artifactIdentity(hostBinary, directory = root) {
  const files = new Map();
  async function visit(path) {
    const entry = await lstat(path);
    if (entry.isDirectory()) {
      const names = (await readdir(path)).sort();
      assert.ok(names.length, `Empty candidate artifact directory: ${path}`);
      for (const name of names) await visit(join(path, name));
    } else if (entry.isFile()) {
      files.set(relative(directory, path), createHash("sha256").update(await readFile(path)).digest("hex"));
    } else if (entry.isSymbolicLink()) {
      files.set(relative(directory, path), `symlink:${await readlink(path)}`);
      // Hash the selected target too: changing it cannot pass by keeping a link.
      files.set(`${relative(directory, path)}:target`, createHash("sha256").update(await readFile(path)).digest("hex"));
    } else throw new Error(`Unsupported candidate artifact: ${path}`);
  }
  await visit(resolve(hostBinary));
  for (const name of ["shared", "agent-runtime", "agent-host", "host-runtime"]) {
    await visit(join(directory, "packages", name, "dist"));
  }
  await visit(join(directory, "apps/desktop/out"));
  return Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)));
}

export async function verifyBuildReceipt(hostBinary, { directory = root, path = receiptPath, expected } = {}) {
  const receipt = JSON.parse(await readFile(path, "utf8"));
  assert.equal(receipt.version, 1, "Unsupported candidate build receipt");
  assert.ok(receipt.buildMode === undefined || receipt.buildMode === "direct-overlay", "Unsupported candidate build mode");
  const commands = receipt.buildMode === "direct-overlay" ? directOverlayBuildPlan(receipt.cargoTargetDir)
    : ["pnpm build:js", "cargo build --locked -p host-core"];
  assert.deepEqual(receipt.commands, commands, "Receipt must identify the complete candidate build");
  if (receipt.buildMode === "direct-overlay") {
    assert.equal(resolve(hostBinary), join(receipt.cargoTargetDir, "debug", process.platform === "win32"
      ? "pi-desktop-host-core.exe" : "pi-desktop-host-core"), "Receipt must identify the complete candidate build Host target");
  }
  assert.equal(receipt.hostBinary, resolve(hostBinary), "Receipt must match the selected Host binary");
  assert.deepEqual(await sourceIdentity(directory), receipt.source, "Candidate source/base changed since build; rebuild the candidate receipt");
  assert.deepEqual(await artifactIdentity(hostBinary, directory), receipt.artifacts, "Candidate artifacts changed since build; rebuild the candidate receipt");
  if (expected) assert.deepEqual(receipt, expected, "Candidate receipt changed during E2E");
  return receipt;
}
