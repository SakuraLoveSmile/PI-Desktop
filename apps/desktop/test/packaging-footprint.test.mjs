import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const viteConfigSource = await readFile(
  new URL("../electron.vite.config.ts", import.meta.url),
  "utf8",
);

test("packaging installs only native PTY and updater runtime dependencies", () => {
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    "electron-updater",
    "node-pty",
  ]);

  for (const dependency of [
    "@pi-desktop/agent-runtime",
    "@pi-desktop/i18n",
    "@pi-desktop/plugin-sdk",
    "@pi-desktop/shared",
    "mermaid",
    "react",
    "shiki",
  ]) {
    assert.ok(
      packageJson.devDependencies[dependency],
      `${dependency} must be available for bundling without shipping its package tree`,
    );
  }
});

test("main bundles JavaScript dependencies and externalizes only runtime modules", () => {
  assert.doesNotMatch(viteConfigSource, /externalizeDepsPlugin\s*\(/);
  assert.match(
    viteConfigSource,
    /external:\s*\["electron-updater",\s*"node-pty"\]/,
  );
});

test("packaging keeps only shipped locales and excludes non-runtime artifacts", () => {
  assert.deepEqual(packageJson.build.electronLanguages, [
    "en-US",
    "zh-CN",
    // electron-builder uses underscore locale directories in macOS bundles.
    "zh_CN",
  ]);
  assert.ok(packageJson.build.files.includes("!**/*.map"));
  assert.ok(
    packageJson.build.files.includes(
      "!**/node_modules/*/{test,tests,__tests__,powered-test,example,examples}/**",
    ),
  );
  assert.ok(
    packageJson.build.files.includes(
      "!**/node_modules/**/*.{test,spec}.{js,cjs,mjs}",
    ),
  );
  assert.ok(
    packageJson.build.files.includes(
      "!**/node_modules/node-pty/{deps,prebuilds,scripts,src,typings}/**",
    ),
  );
  assert.ok(
    packageJson.build.files.includes(
      "!**/node_modules/node-addon-api/tools/**",
    ),
  );
  assert.ok(
    packageJson.build.files.includes(
      "!**/node_modules/node-addon-api/*.{c,gyp,gypi,h,js,json}",
    ),
  );
  assert.ok(
    packageJson.build.files.includes(
      "!**/node_modules/node-addon-api/README.md",
    ),
  );
  assert.ok(
    !packageJson.build.files.includes("!**/node_modules/node-addon-api/**"),
    "node-addon-api license must not be removed with its build-only files",
  );
  assert.ok(
    packageJson.build.files.every(
      (pattern) => !/LICENSE|NOTICE|\*\.md/.test(pattern),
    ),
    "third-party license and notice files must remain packageable",
  );
  assert.deepEqual(packageJson.build.extraResources, [
    {
      from: "../../packages/agent-runtime/dist-bundle",
      to: "agent-runtime",
    },
    {
      from: "node_modules/node-pty/deps/winpty/LICENSE",
      to: "licenses/node-pty-winpty.LICENSE",
    },
  ]);
});

test("node-pty unpacks native payloads without unpacking its full source tree", () => {
  assert.deepEqual(packageJson.build.asar, { smartUnpack: false });
  assert.deepEqual(packageJson.build.asarUnpack, [
    "**/node_modules/node-pty/build/{Release,Debug}/**",
  ]);
});
