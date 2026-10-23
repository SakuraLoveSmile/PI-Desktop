#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function requireCloudPackageBuild(env = process.env) {
  if (env.GITHUB_ACTIONS === "true" && env.RUNNER_ENVIRONMENT === "github-hosted") return;
  throw new Error(
    "Installer packaging runs only on GitHub-hosted Actions runners. " +
      "Start a candidate build with: gh workflow run release.yml --ref main -f sign_macos=false. " +
      "Daily development remains available with pnpm dev. " +
      "See docs/spec/06-delivery/06-release-runbook.md.",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCloudPackageBuild();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
