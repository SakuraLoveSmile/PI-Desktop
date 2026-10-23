import { execFileSync } from "node:child_process";

export function createReleaseTag(root, version) {
  const git = (...args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const tag = `v${version}`;
  if (git("status", "--porcelain", "--untracked-files=no")) {
    throw new Error("Commit or preserve tracked changes before tagging; release tags never commit changes.");
  }
  const committedVersion = JSON.parse(git("show", "HEAD:apps/desktop/package.json")).version;
  if (committedVersion !== version) {
    throw new Error(`HEAD has app version ${committedVersion}, not ${version}. Merge version preparation into main first.`);
  }
  if (git("tag", "--list", tag)) throw new Error(`Tag ${tag} already exists locally.`);
  try {
    git("fetch", "--no-tags", "origin", "main");
  } catch {
    throw new Error("Cannot fetch origin/main; no release tag was created. Restore remote access and verify the source again.");
  }
  try {
    git("merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD");
  } catch {
    throw new Error("HEAD has not been merged into origin/main; no release tag was created.");
  }
  let remoteTags;
  try {
    remoteTags = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`);
  } catch {
    throw new Error("Cannot verify remote tag absence; no release tag was created.");
  }
  if (remoteTags) throw new Error(`Tag ${tag} already exists on origin.`);
  const source = git("rev-parse", "HEAD");
  git("tag", "-a", tag, "-m", `Release ${tag}`, source);
  return { tag, source };
}
