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
  releaseAsarScriptSource,
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
  read("../../../scripts/export-linux-asar.mjs"),
]);

// Parse executable workflow configuration; release domain behavior is exercised
// in scripts/release-preflight, release-assets and publish-release tests.
const desktopRequire = createRequire(new URL("../package.json", import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve("electron-builder/package.json"));
const { load } = builderRequire("js-yaml");
const releaseWorkflow = load(releaseWorkflowSource);
const ciWorkflow = load(ciWorkflowSource);
const releaseStep = (name) => releaseWorkflow.jobs.build.steps.find(step => step.name === name);

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
  const { metadata, verify, build, "pi-host-bundle": host } = releaseWorkflow.jobs;
  assert.equal(metadata.steps.find(step => step.id === "preflight").run, "node scripts/release-preflight.mjs");
  assert.equal(verify.needs, "metadata");
  for (const job of [build, host]) assert.deepEqual(job.needs, ["metadata", "verify"]);
  // Exact tag/version, source identity, main ancestry and signing refusal are
  // tested with real isolated Git repositories in release-preflight.test.mjs.
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

test("release workflow publishes the Linux ASAR beside installers", () => {
  assert.match(
    releaseWorkflowSource,
    /if: matrix\.platform == 'linux'[\s\S]*?node scripts\/export-linux-asar\.mjs --arch \$\{\{ matrix\.arch \}\}/,
  );
  assert.match(releaseWorkflowSource, /apps\/desktop\/release\/\*\.asar/);
  assert.match(
    releaseAsarScriptSource,
    /linuxUnpackedDirName\(releaseArch\)\}\/resources\/app\.asar/,
  );
  assert.match(
    releaseAsarScriptSource,
    /Pi-Desktop-Plus-\$\{releaseVersion\}-linux-\$\{releaseArch\}\.asar/,
  );
});

test("the release matrix ships native Linux x64 and arm64 lanes", () => {
  const lanes = releaseWorkflow.jobs.build.strategy.matrix.include.filter(row => row.platform === "linux");
  assert.deepEqual(lanes.map(({ arch, os, runner_arch, artifact, feed }) => ({ arch, os, runner_arch, artifact, feed })), [
    { arch: "x64", os: "ubuntu-22.04", runner_arch: "x86_64", artifact: "linux-x64", feed: "linux.yml" },
    { arch: "arm64", os: "ubuntu-22.04-arm", runner_arch: "aarch64", artifact: "linux-arm64", feed: "linux-arm64.yml" },
  ]);
  assert.equal(releaseStep("Verify native runner architecture").if, "matrix.runner_arch");
  assert.deepEqual(releaseWorkflow.jobs["pi-host-bundle"].strategy.matrix.include,
    lanes.map(({ arch, os, runner_arch }) => ({ arch, os, runner_arch })));
  // Architecture-specific feed names, missing lanes and checksum integrity are
  // exercised by the complete input fixture in release-assets.test.mjs.
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

test("release matrix packages both native macOS architectures", () => {
  const lanes = releaseWorkflow.jobs.build.strategy.matrix.include.filter(row => row.platform === "macos");
  assert.deepEqual(lanes.map(({ arch, os, runner_arch }) => ({ arch, os, runner_arch })), [
    { arch: "arm64", os: "macos-15", runner_arch: "arm64" },
    { arch: "x64", os: "macos-15-intel", runner_arch: "x86_64" },
  ]);
  const config = JSON.parse(desktopPackageSource).build;
  assert.equal(config.mac.artifactName, "Pi-Desktop-Plus-${version}-${arch}-mac.${ext}");
  assert.equal(config.dmg.artifactName, "Pi-Desktop-Plus-${version}-${arch}.${ext}");
  assert.equal(releaseStep("Package installers (${{ matrix.dist }})").if, "matrix.platform != 'macos'");
  assert.equal(releaseStep("Disambiguate macOS update metadata").run,
    'mv "apps/desktop/release/${RELEASE_CHANNEL}-mac.yml" "apps/desktop/release/${RELEASE_CHANNEL}-mac-${{ matrix.arch }}.yml"');
  // release-assets.test.mjs rejects wrong/missing architecture artifacts and
  // merges both macOS feeds only after checking every final file hash and size.
});

test("macOS release signing is required on tag pushes", () => {
  assert.equal(releaseWorkflow.on.workflow_dispatch.inputs.sign_macos.default, false);
  assert.equal(releaseWorkflow.on.workflow_dispatch.inputs.sign_macos.type, "boolean");
  assert.equal(releaseWorkflow.jobs.build.env.MACOS_SIGN_RELEASE, "${{ needs.metadata.outputs.signed_macos }}");
  assert(releaseStep("Package signed and notarized macOS installer").run.includes("-c.mac.forceCodeSigning=true"),
    "the cloud signing command must require a valid signing identity");
  // release-preflight.test.mjs proves that tags require signing even when the
  // manual input is false, and that unsigned candidates require no secrets.

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

test("macOS signing instrumentation stays out of the Windows and Linux lanes", () => {
  const instrumentation =
    /macos-signing-watchdog|macos-signing-diagnostics|macos-bundle-inventory/;
  const stepBlock = (name) =>
    releaseWorkflowSource.match(new RegExp(`- name: ${name}[^]*?(?=\\n      - name:)`))?.[0] ??
    "";
  assert.doesNotMatch(stepBlock("Package installers"), instrumentation);
  assert.doesNotMatch(stepBlock("Verify Linux host-core glibc floor"), instrumentation);
  assert.doesNotMatch(stepBlock("Export Linux ASAR release asset"), instrumentation);
  // The unsigned macOS debug lane reports its bundle size but must not gain a
  // signing identity, notarization, or publishing behaviour.
  const unsignedBlock = stepBlock("Package unsigned macOS installer");
  assert.ok(unsignedBlock, "unsigned macOS debug package step is missing");
  assert.doesNotMatch(unsignedBlock, instrumentation);
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
