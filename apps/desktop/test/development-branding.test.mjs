import { readMainSource, readMainModule } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const devScriptUrl = new URL(
  "../../../scripts/dev-electron.mjs",
  import.meta.url,
);

const mainSource = await readMainSource();
const mainIndexSource = await readMainModule("index.ts");
const brandingSource = await readMainModule("bootstrap/app-lifecycle.ts");
const windowSource = await readMainModule("bootstrap/window.ts");
const startupSource = await readMainModule("bootstrap/startup.ts");
const iconScriptSource = await readFile(
  new URL("../../../scripts/make-icon.py", import.meta.url),
  "utf8",
);
const devScriptSource = await readFile(
  devScriptUrl,
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const protocolSource = await readFile(
  new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
  "utf8",
);
const windowsIcon = await readFile(
  new URL("../build/icon.ico", import.meta.url),
);

test("Windows runtime registers the canonical native application identity", () => {
  const appId = protocolSource.match(/APP_ID = "([^"]+)"/)?.[1];
  assert.equal(appId, packageJson.build.appId);
  assert.ok(startupSource.includes("app.whenReady()"), "main process readiness hook");
  assert.match(mainIndexSource, /app\.setName\(APP_NAME\)/);
  assert.match(
    mainIndexSource,
    /process\.platform === "win32"[\s\S]*app\.setAppUserModelId\(APP_ID\)/,
  );
});

test("Windows packages pin PI-Desktop executable and shortcut names", () => {
  assert.equal(packageJson.build.win.executableName, "Pi-Desktop-Plus");
  assert.equal(packageJson.build.nsis.shortcutName, "Pi-Desktop-Plus");
});

test("Windows packages and windows use the canonical PI-Desktop icon", () => {
  assert.equal(packageJson.build.win.icon, "build/icon.ico");
  assert.deepEqual(
    packageJson.build.win.extraResources.find((resource) => resource.to === "app-icon.ico"),
    {
      from: "build/icon.ico",
      to: "app-icon.ico",
    },
  );
  assert.deepEqual([...windowsIcon.subarray(0, 4)], [0, 0, 1, 0]);
  assert.ok(windowsIcon.readUInt16LE(4) >= 4, "ICO must contain multiple sizes");
  assert.match(iconScriptSource, /windows_icon = BUILD \/ "icon\.ico"/);
  assert.match(iconScriptSource, /format="ICO"/);
  assert.match(windowSource, /function windowsIconPath\(\)/);
  assert.match(windowSource, /app\.isPackaged\s*\n?\s*\?\s*process\.resourcesPath/);
  assert.match(windowSource, /app-icon\.ico/);
  assert.match(windowSource, /icon: windowsIconPath\(\)/);
});

test("Linux packages align the desktop entry with the Wayland app identity", () => {
  assert.equal(packageJson.desktopName, "pi-desktop-plus.desktop");
  assert.equal(packageJson.build.linux.syncDesktopName, true);
});

test("macOS development uses the canonical PI-Desktop Dock icon", () => {
  assert.match(
    brandingSource,
    /process\.platform !== "darwin" \|\| !isDevelopmentBuild \|\| !app\.dock/,
  );
  assert.match(
    brandingSource,
    /join\(app\.getAppPath\(\), "build", "icon_1024\.png"\)/,
  );
  assert.match(brandingSource, /nativeImage\.createFromPath\(iconPath\)/);
  assert.match(brandingSource, /if \(icon\.isEmpty\(\)\)/);
  assert.match(brandingSource, /app\.dock\.setIcon\(icon\)/);
  // Branding is the first thing readiness does, after the only statement that
  // may precede it: the bail for a launch that lost the single-instance lock
  // and must not touch the running app's Dock tile.
  assert.match(
    startupSource,
    /if \(!hasSingleInstanceLock\) return;\s+applyDevelopmentBranding\(\);/,
  );
});

test("macOS icon derivation preserves the canonical renderer asset", () => {
  assert.match(iconScriptSource, /SOURCE = BUILD \/ "icon_1024\.png"/);
  assert.match(iconScriptSource, /with Image\.open\(SOURCE\) as source/);
  assert.doesNotMatch(
    iconScriptSource,
    /\.save\(BUILD \/ "icon_1024\.png"\)/,
  );
});

test("macOS development launches from a branded host bundle", () => {
  assert.equal(packageJson.scripts.dev, "node ../../scripts/dev-electron.mjs");
  assert.match(devScriptSource, /process\.platform === "darwin"/);
  assert.match(devScriptSource, /PI_DESKTOP_DEV: "1"/);
  assert.match(devScriptSource, /ELECTRON_EXEC_PATH/);
  assert.match(devScriptSource, /CFBundleDisplayName", APP_NAME/);
  assert.match(devScriptSource, /CFBundleName", APP_NAME/);
  assert.match(devScriptSource, /CFBundleExecutable", APP_NAME/);
  assert.match(devScriptSource, /CFBundleIconFile", "icon\.icns"/);
  assert.match(
    devScriptSource,
    /copyFileSync\(iconPath, join\(resources, "icon\.icns"\)\)/,
  );
  assert.match(devScriptSource, /verbatimSymlinks: true/);
  assert.match(devScriptSource, /join\(ROOT, "\.cache", "electron-dev"\)/);
  assert.doesNotMatch(devScriptSource, /node_modules.*Info\.plist/);
});

test(
  "development launcher can be imported without starting Electron",
  async () => {
    const launcher = await import(devScriptUrl.href);
    assert.equal(typeof launcher.prepareMacDevelopmentBundle, "function");
  },
);

test("macOS development cache identity cannot reuse the old v3 bundle", () => {
  assert.match(devScriptSource, /const BRANDING_SCHEMA = "v4"/);
  assert.match(devScriptSource, /\$\{APP_NAME\}-\$\{DEV_BUNDLE_ID\}-\$\{BRANDING_SCHEMA\}/);
  assert.match(devScriptSource, /const DEV_BUNDLE_ID = "cn\.sakura\.pi-desktop\.dev"/);
});

test(
  "macOS development bundle rewrites native identity and reuses its cache",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-desktop-dev-bundle-"));
    const sourceBundle = join(root, "Electron.app");
    const contents = join(sourceBundle, "Contents");
    const macos = join(contents, "MacOS");
    const resources = join(contents, "Resources");
    const executable = join(macos, "Electron");
    const iconPath = join(root, "source.icns");
    const cacheRoot = join(root, "cache");

    try {
      await mkdir(macos, { recursive: true });
      await mkdir(resources, { recursive: true });
      await writeFile(executable, "electron-host");
      await writeFile(iconPath, "canonical-icon");
      await writeFile(
        join(contents, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleExecutable</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.github.Electron</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
</dict></plist>`,
      );

      // A populated cache from the old branding schema must remain untouched
      // and must not satisfy the new Plus cache lookup.
      const iconHash = createHash("sha256")
        .update(await readFile(iconPath))
        .digest("hex")
        .slice(0, 12);
      const oldCacheRoot = join(cacheRoot, `test-version-${iconHash}-v3`);
      const oldExecutable = join(
        oldCacheRoot,
        "PI-Desktop.app",
        "Contents",
        "MacOS",
        "PI-Desktop",
      );
      await mkdir(join(oldCacheRoot, "PI-Desktop.app", "Contents", "MacOS"), {
        recursive: true,
      });
      await writeFile(oldExecutable, "old-cache-sentinel");
      await writeFile(join(oldCacheRoot, "ready.json"), '{"electronVersion":"test-version"}\n');

      const { prepareMacDevelopmentBundle } = await import(devScriptUrl.href);
      const options = {
        electronExecutable: executable,
        electronVersion: "test-version",
        iconPath,
        cacheRoot,
        sign: false,
      };
      const brandedExecutable = prepareMacDevelopmentBundle(options);
      const brandedContents = join(
        brandedExecutable,
        "..",
        "..",
      );
      const plist = await readFile(join(brandedContents, "Info.plist"), "utf8");

      assert.equal(await readFile(brandedExecutable, "utf8"), "electron-host");
      assert.equal(
        await readFile(join(brandedContents, "Resources", "icon.icns"), "utf8"),
        "canonical-icon",
      );
      assert.match(plist, /<string>Pi-Desktop-Plus<\/string>/);
      assert.match(plist, /<string>cn\.sakura\.pi-desktop\.dev<\/string>/);
      assert.equal(await readFile(oldExecutable, "utf8"), "old-cache-sentinel");
      assert.equal(prepareMacDevelopmentBundle(options), brandedExecutable);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
