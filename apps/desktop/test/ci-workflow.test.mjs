import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  ciWorkflowSource,
  releaseWorkflowSource,
  desktopPackageSource,
  linuxPackageWorkflowSource,
  mirrorToCnbWorkflowSource,
  agentRuntimePackageSource,
  i18nPackageSource,
  pluginSdkPackageSource,
  sharedPackageSource,
  releaseMacScriptSource,
] = await Promise.all([
  read("../../../.github/workflows/ci.yml"),
  read("../../../.github/workflows/release.yml"),
  read("../package.json"),
  read("../../../.github/workflows/linux-package.yml"),
  read("../../../.github/workflows/mirror-to-cnb.yml"),
  read("../../../packages/agent-runtime/package.json"),
  read("../../../packages/i18n/package.json"),
  read("../../../packages/plugin-sdk/package.json"),
  read("../../../packages/shared/package.json"),
  read("../../../scripts/release-macos.sh"),
]);

// Parse executable workflow configuration; release domain behavior is exercised
// in scripts/release-preflight, release-assets and publish-release tests.
const desktopRequire = createRequire(new URL("../package.json", import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve("electron-builder/package.json"));
const { load } = builderRequire("js-yaml");
const releaseWorkflow = load(releaseWorkflowSource);
const ciWorkflow = load(ciWorkflowSource);
const recoveryWorkflow = load(await read("../../../.github/workflows/recover-release-publication.yml"));
const releaseStep = (name) => releaseWorkflow.jobs.build.steps.find(step => step.name === name);

test("publication recovery is main-only and downloads the original pinned artifact with isolated write permission", () => {
  assert.deepEqual(Object.keys(recoveryWorkflow.on), ["workflow_dispatch"]);
  assert.equal(recoveryWorkflow.on.workflow_dispatch.inputs.release_run_id.type, "string");
  assert.equal(recoveryWorkflow.on.workflow_dispatch.inputs.release_run_id.required, true);
  assert.deepEqual(recoveryWorkflow.permissions, { contents: "read", actions: "read" });
  const { metadata, publish } = recoveryWorkflow.jobs;
  assert.equal(metadata.if, "github.ref == 'refs/heads/main'");
  assert.equal(publish.needs, "metadata");
  assert.deepEqual(publish.permissions, { contents: "write", actions: "read" });
  assert.deepEqual(publish.concurrency, {
    group: "release-refs/tags/${{ needs.metadata.outputs.tag }}", "cancel-in-progress": false,
  });
  for (const job of [metadata, publish]) {
    assert.equal(job["runs-on"], "ubuntu-latest");
    const checkout = job.steps.find(step => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, "${{ github.sha }}");
  }
  const verify = metadata.steps.find(step => step.id === "verify");
  assert.equal(verify.env.RELEASE_RUN_ID, "${{ inputs.release_run_id }}");
  assert.equal(verify.env.ALLOW_UNSIGNED_MACOS_RELEASE, "${{ vars.ALLOW_UNSIGNED_MACOS_RELEASE || 'false' }}");
  assert.equal(verify.run, 'node scripts/recover-release-publication.mjs --run-id "$RELEASE_RUN_ID"');
  const download = publish.steps.find(step => step.uses?.startsWith("actions/download-artifact@"));
  assert.deepEqual(download.with, {
    "artifact-ids": "${{ needs.metadata.outputs.artifact_id }}", "run-id": "${{ needs.metadata.outputs.run_id }}",
    "github-token": "${{ github.token }}", path: "dist", "merge-multiple": true,
  });
  const recover = publish.steps.at(-1);
  assert.equal(recover.env.ALLOW_UNSIGNED_MACOS_RELEASE, "${{ needs.metadata.outputs.allow_unsigned_macos }}");
  assert.equal(recover.env.RELEASE_ARTIFACT_ID, "${{ needs.metadata.outputs.artifact_id }}");
  assert.equal(recover.run, 'node scripts/recover-release-publication.mjs --run-id "$RELEASE_RUN_ID" --artifact-id "$RELEASE_ARTIFACT_ID" --directory dist');
});

test("CI skips documentation-only pushes and pull requests", () => {
  assert.equal(
    (ciWorkflowSource.match(/- 'docs\/\*\*'/g) ?? []).length,
    2,
    "docs path is ignored by push and pull_request triggers",
  );
  assert.equal(
    (ciWorkflowSource.match(/- '\*\*\/\*\.md'/g) ?? []).length,
    2,
    "Markdown files are ignored by push and pull_request triggers",
  );
  assert.match(ciWorkflowSource, /^  workflow_dispatch:/m);
});

test("CI does not typecheck workspace dependencies twice", () => {
  for (const source of [
    agentRuntimePackageSource,
    i18nPackageSource,
    pluginSdkPackageSource,
    sharedPackageSource,
  ]) {
    assert.match(JSON.parse(source).scripts.build, /^tsc\b/);
  }

  assert.match(
    ciWorkflowSource,
    /run: pnpm --filter @pi-desktop\/desktop typecheck/,
  );
  assert.doesNotMatch(ciWorkflowSource, /run: pnpm typecheck/);
});

test("release validates one pinned candidate before starting verification", () => {
  const { metadata, verify, build } = releaseWorkflow.jobs;
  assert.equal(metadata.steps.find(step => step.id === "preflight").run, "node scripts/release-preflight.mjs");
  assert.equal(verify.needs, "metadata");
  assert.deepEqual(build.needs, ["metadata", "verify"]);
  // Exact tag/version, source identity, main ancestry and signing refusal are
  // tested with real isolated Git repositories in release-preflight.test.mjs.
});

test("unsigned release permission is pinned and forwarded through verification and publication", () => {
  const { metadata, aggregate, publish } = releaseWorkflow.jobs;
  const preflight = metadata.steps.find(step => step.id === "preflight");
  assert.equal(preflight.env.ALLOW_UNSIGNED_MACOS_RELEASE,
    "${{ vars.ALLOW_UNSIGNED_MACOS_RELEASE || 'false' }}");
  assert.equal(metadata.outputs.allow_unsigned_macos, "${{ steps.preflight.outputs.allow_unsigned_macos }}");
  const aggregateStep = aggregate.steps.find(step => step.name === "Verify macOS arm64 artifacts, feed and checksums");
  assert.equal(aggregateStep.env.ALLOW_UNSIGNED_MACOS_RELEASE, "${{ needs.metadata.outputs.allow_unsigned_macos }}");
  assert(aggregateStep.run.includes('--allow-unsigned-macos "$ALLOW_UNSIGNED_MACOS_RELEASE"'));
  const publishStep = publish.steps.find(step => step.name === "Create draft, verify remote assets, then publish");
  assert.equal(publishStep.env.ALLOW_UNSIGNED_MACOS_RELEASE, "${{ needs.metadata.outputs.allow_unsigned_macos }}");
  assert.equal(publish.if, "needs.metadata.outputs.kind == 'release'");
});

test("release preparation overlaps independent work and avoids duplicate builds", () => {
  assert.match(
    releaseWorkflowSource,
    /cargo build --release --locked -p host-core &/,
  );
  assert.match(releaseWorkflowSource, /wait "\$host_build_pid"/);
  assert.match(
    releaseWorkflowSource,
    /pnpm --filter '@pi-desktop\/desktop\^\.\.\.' --fail-if-no-match build/,
  );
  // The full JS build belongs to the verify gate; the build matrix only
  // builds the desktop app's workspace dependencies.
  const buildJob = releaseWorkflowSource.match(/^  build:\n[\s\S]*?(?=^  publish:)/m)?.[0];
  assert.ok(buildJob, "release build job is missing");
  assert.doesNotMatch(buildJob, /run: pnpm build:js/);
});

test("release builds are gated on the CI checks and least-privilege permissions", () => {
  assert.deepEqual(releaseWorkflow.permissions, { contents: "read" });
  assert.equal(releaseWorkflow.jobs.verify.uses, "./.github/workflows/ci.yml");
  assert.deepEqual(releaseWorkflow.jobs.build.needs, ["metadata", "verify"]);
  assert.deepEqual(releaseWorkflow.jobs.publish.needs, ["metadata", "aggregate"]);
  assert.deepEqual(releaseWorkflow.jobs.publish.permissions, { contents: "write" });
  const runs = ciWorkflow.jobs.js.steps.map(step => step.run);
  for (const command of ["pnpm build:js", "pnpm --filter @pi-desktop/desktop typecheck", "pnpm lint", "pnpm -r --if-present test"]) {
    assert(runs.includes(command), `shared CI must run ${command}`);
  }
  assert(ciWorkflow.jobs.rust.steps.some(step => step.run === "cargo test -p host-core --locked"));
  assert.equal(ciWorkflow.jobs["e2e-smoke"].uses, "./.github/workflows/e2e-run.yml");
});

test("release artifacts bypass redundant Actions compression", () => {
  assert.match(
    releaseWorkflowSource,
    /uses: actions\/upload-artifact@v7[\s\S]*?compression-level: 0/,
  );
});

test("manual Linux package validation covers the RPM desktop identity", () => {
  assert.match(linuxPackageWorkflowSource, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.match(linuxPackageWorkflowSource, /runs-on: ubuntu-22\.04/);
  assert.match(
    linuxPackageWorkflowSource,
    /run: pnpm --filter @pi-desktop\/desktop run dist:linux -- --x64/,
  );
  assert.match(
    linuxPackageWorkflowSource,
    /name: Install RPM inspection tools[\s\S]*apt-get install[\s\S]*cpio rpm/,
  );
  assert.match(
    linuxPackageWorkflowSource,
    /find apps\/desktop\/release[\s\S]*-name '\*\.rpm'/,
  );
  assert.match(linuxPackageWorkflowSource, /rpm -qpl "\$rpm_package"/);
  assert.match(linuxPackageWorkflowSource, /build-id/);
  assert.match(
    linuxPackageWorkflowSource,
    /usr\/share\/applications\/pi-desktop-plus\.desktop/,
  );
  assert.match(linuxPackageWorkflowSource, /Icon=pi-desktop-plus/);
  assert.match(linuxPackageWorkflowSource, /StartupWMClass=pi-desktop-plus/);
  assert.match(
    linuxPackageWorkflowSource,
    /uses: actions\/upload-artifact@v7[\s\S]*path: apps\/desktop\/release\/\*\.rpm/,
  );
});

test("release builds only native macOS arm64 and aggregates only that artifact", () => {
  assert.deepEqual(releaseWorkflow.jobs.build.strategy.matrix.include, [
    { name: "macOS arm64", os: "macos-15", arch: "arm64", runner_arch: "arm64", artifact: "mac-arm64", platform: "macos" },
  ]);
  assert.equal(releaseStep("Verify native runner architecture").if, "matrix.runner_arch");
  assert.equal(releaseWorkflow.jobs["pi-host-bundle"], undefined);
  const aggregate = releaseWorkflow.jobs.aggregate;
  assert.deepEqual(aggregate.needs, ["metadata", "build"]);
  const downloads = aggregate.steps.filter(step => step.uses?.startsWith("actions/download-artifact@"));
  assert.deepEqual(downloads.map(step => step.with), [
    { name: "dist-mac-arm64", path: "artifacts/dist-mac-arm64" },
  ]);
  const upload = releaseStep("Upload artifacts");
  assert.equal(upload.with.name, "dist-${{ matrix.artifact }}");
  assert.deepEqual(upload.with.path.trim().split("\n"), [
    "apps/desktop/release/*.dmg", "apps/desktop/release/*.zip",
    "apps/desktop/release/*.blockmap",
    "apps/desktop/release/${{ needs.metadata.outputs.channel }}-mac-${{ matrix.arch }}.yml",
  ]);
  // The aggregation fixture proves this complete arm64-only bundle is valid
  // and rejects extra platform groups, missing artifacts and invalid hashes.
});

test("the Linux package config lets the workflow choose the architecture", () => {
  const build = JSON.parse(desktopPackageSource).build;
  // electron-builder prefers a target's configured arch list over the CLI
  // `--x64`/`--arm64` flag, so pinning both here would make each Linux lane
  // build the other architecture around its own native host-core.
  for (const entry of build.linux.target) {
    assert.equal(
      entry.arch,
      undefined,
      `linux target ${entry.target} must not pin an arch`,
    );
  }
  assert.match(
    build.linux.artifactName,
    /-linux-\$\{arch\}\.\$\{ext\}$/,
    "the AppImage name carries its architecture",
  );
  assert.equal(
    build.deb.artifactName,
    "pi-desktop-plus_${version}_${arch}.${ext}",
  );
  assert.equal(
    build.rpm.artifactName,
    "pi-desktop-plus-${version}-${arch}.${ext}",
  );
});

test("macOS release artifacts retain architecture-labelled names and a canonical feed", () => {
  const config = JSON.parse(desktopPackageSource).build;
  assert.equal(config.mac.artifactName, "Pi-Desktop-Plus-${version}-${arch}-mac.${ext}");
  assert.equal(config.dmg.artifactName, "Pi-Desktop-Plus-${version}-${arch}.${ext}");
  assert.equal(releaseStep("Disambiguate macOS update metadata").run,
    'mv "apps/desktop/release/${RELEASE_CHANNEL}-mac.yml" "apps/desktop/release/${RELEASE_CHANNEL}-mac-${{ matrix.arch }}.yml"');
  // release-assets.test.mjs verifies every final file hash and size before
  // exposing the canonical feed used by existing macOS updater clients.
});

test("macOS release signing is required on tag pushes", () => {
  assert.equal(releaseWorkflow.on.workflow_dispatch.inputs.sign_macos.default, false);
  assert.equal(releaseWorkflow.on.workflow_dispatch.inputs.sign_macos.type, "boolean");
  assert.equal(releaseWorkflow.jobs.build.env.MACOS_SIGN_RELEASE, "${{ needs.metadata.outputs.signed_macos }}");
  assert(releaseStep("Package signed and notarized macOS installer").run.includes("-c.mac.forceCodeSigning=true"),
    "the cloud signing command must require a valid signing identity");
  // release-preflight.test.mjs proves tags require signing by default, explicit
  // unsigned opt-in preserves main/tag checks, and requested signing needs secrets.

  const unsignedBlock = releaseWorkflowSource.match(
    /- name: Package unsigned macOS installer[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  assert.ok(unsignedBlock, "unsigned macOS debug package step is missing");
  assert.match(unsignedBlock, /env\.MACOS_SIGN_RELEASE != 'true'/);
  assert.match(unsignedBlock, /CSC_IDENTITY_AUTO_DISCOVERY:\s*'false'/);
  assert.doesNotMatch(unsignedBlock, /CSC_LINK:|CSC_KEY_PASSWORD:|APPLE_/);
  assert.doesNotMatch(unsignedBlock, /forceCodeSigning|notarize/);

  assert.match(
    releaseWorkflowSource,
    /Require macOS signing and notarization secrets[\s\S]*?Missing GitHub Actions secrets for macOS signing/,
  );
  assert.match(releaseWorkflowSource, /MAC_SIGNING_IDENTITY/);

  const signedBlock = releaseWorkflowSource.match(
    /- name: Package signed and notarized macOS installer[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  assert.ok(signedBlock, "signed macOS package step is missing");
  assert.match(signedBlock, /env\.MACOS_SIGN_RELEASE == 'true'/);
  for (const secret of [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ]) {
    assert.match(signedBlock, new RegExp(`${secret}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}`));
  }
  // electron-builder throws InvalidConfigurationError when an identity name
  // keeps the "Developer ID Application:" prefix, so CSC_NAME carries the bare
  // common name and the CLI must not pass -c.mac.identity.
  assert.match(signedBlock, /CSC_NAME: \$\{\{ secrets\.MAC_SIGNING_IDENTITY \}\}/);
  assert.doesNotMatch(signedBlock, /-c\.mac\.identity=/);
  assert.doesNotMatch(signedBlock, /CSC_NAME: "Developer ID Application:/);
  assert.match(signedBlock, /-c\.mac\.notarize=true/);
  // The single "signing PI-Desktop.app" line electron-builder prints does not
  // tell walking, per-file codesign, silent retries, and the Apple
  // notarization wait apart; the signing trace and the watchdog carry the rest.
  assert.match(
    signedBlock,
    /DEBUG: "electron-osx-sign\*,electron-notarize\*"/,
  );
  // builder-util's `executing` debug line prints every spawned command with a
  // stem list that does not cover `security set-key-partition-list -k <p12
  // password>`, so electron-builder's namespace is deliberately excluded.
  assert.doesNotMatch(signedBlock, /DEBUG: ".*electron-builder.*"/);
  assert.match(signedBlock, /PI_SIGNING_TIMEOUT_SECONDS: "1800"/);
  assert.match(signedBlock, /PI_SIGNING_STALL_SECONDS: "300"/);
  assert.match(
    signedBlock,
    /node scripts\/macos-signing-watchdog\.mjs \\\n\s+--label "dist:mac-\$\{\{ matrix\.arch \}\}" \\\n\s+-- pnpm --filter @pi-desktop\/desktop run dist:mac/,
    "the signed macOS packaging phase runs under the signing watchdog",
  );
  // electron-builder notarizes only the .app; the DMG needs its own
  // submission before the ticket can be stapled (error 65 otherwise).
  const dmgBlock = releaseWorkflowSource.match(
    /- name: Notarize and staple the macOS DMG[\s\S]*?(?=\n      - name:)/,
  )?.[0];
  assert.ok(dmgBlock, "DMG notarization step is missing");
  assert.match(dmgBlock, /env\.MACOS_SIGN_RELEASE == 'true'/);
  for (const secret of [
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ]) {
    assert.match(
      dmgBlock,
      new RegExp(`${secret}:\\s*\\$\\{\\{\\s*secrets\\.${secret}\\s*\\}\\}`),
    );
  }
  assert.match(
    dmgBlock,
    /node scripts\/macos-signing-watchdog\.mjs[\s\S]*?-- scripts\/notarize-and-staple-macos-release-dmg\.sh apps\/desktop\/release/,
    "the DMG notarization wait runs under the signing watchdog",
  );
  assert.match(dmgBlock, /PI_SIGNING_TIMEOUT_SECONDS: "1200"/);
  assert.match(
    releaseWorkflowSource,
    /- name: Analyze the packaged macOS app bundle[\s\S]*?if: matrix\.platform == 'macos'[\s\S]*?continue-on-error: true[\s\S]*?run: node scripts\/macos-bundle-inventory\.mjs apps\/desktop\/release/,
    "the packaged macOS bundle is measured, without failing a release",
  );
  assert.match(
    releaseWorkflowSource,
    /Notarize and staple the macOS DMG[\s\S]*?if: matrix\.platform == 'macos' && env\.MACOS_SIGN_RELEASE == 'true'[\s\S]*?Verify signed and notarized macOS installer/,
  );
  assert.doesNotMatch(releaseWorkflowSource, /scripts\/staple-macos-release-dmg\.sh/);
});

// The standalone local lane was retired. macos-release-lane.test.mjs now proves
// it rejects execution before any build/sign/notarization tool is invoked.

test("both macOS lanes only reference scripts that exist", async () => {
  const referenced = new Set();
  for (const source of [releaseMacScriptSource, releaseWorkflowSource]) {
    for (const match of source.matchAll(/(?<![\w./-])scripts\/[A-Za-z0-9._-]+\.(?:sh|mjs)/g)) {
      referenced.add(match[0]);
    }
  }
  assert.ok(referenced.size >= 6, "the macOS lanes reference their scripts");
  const missing = [];
  for (const relPath of referenced) {
    try {
      await access(new URL(`../../../${relPath}`, import.meta.url));
    } catch {
      missing.push(relPath);
    }
  }
  assert.deepEqual(missing, []);
});

test("GitHub releases trigger the CNB mirror pipeline with a JSON payload", () => {
  assert.match(
    mirrorToCnbWorkflowSource,
    /release:\s+types:\s+\[published, edited\]/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /workflow_dispatch:\s+inputs:\s+tag:/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /if: github\.repository == 'vastsa\/PI-Desktop'/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /CNB_MIRROR_TOKEN: \$\{\{\s*secrets\.CNB_MIRROR_TOKEN\s*\}\}/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /Missing repository secret CNB_MIRROR_TOKEN/,
  );
  assert.match(
    mirrorToCnbWorkflowSource,
    /https:\/\/api\.cnb\.cool\/aixk\/Pi-Desktop\/-\/build\/start/,
  );
  assert.match(mirrorToCnbWorkflowSource, /event: "api_trigger_mirror"/);
  assert.match(mirrorToCnbWorkflowSource, /env: \{ MIRROR_TAGS: \$tag \}/);
  assert.match(mirrorToCnbWorkflowSource, /jq -n --arg tag "\$MIRROR_TAG"/);
  assert.match(mirrorToCnbWorkflowSource, /curl --fail-with-body/);
  assert.doesNotMatch(
    mirrorToCnbWorkflowSource,
    /-d ".*github\.event\.release\.tag_name/,
    "JSON payload must not interpolate the release tag through YAML string escaping",
  );
});
