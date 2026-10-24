/** Mounted preference settings with explicit isolated preload edges only. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";

const root = repositoryRoot();
const temp = await mkdtemp(join(tmpdir(), "pi-settings-preferences-"));
const { build } = createRequire(new URL("../packages/agent-runtime/package.json", import.meta.url))("esbuild");
try {
  await build({
    entryPoints: [join(root, "apps/desktop/test/fixtures/settings-preferences.jsx")],
    outfile: join(temp, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src"),
      "@pi-desktop/shared": join(root, "packages/shared/src"),
      "@pi-desktop/voice-runtime/live": join(root, "packages/voice-runtime/src/live/index.ts"),
    },
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
    plugins: [{ name: "fixture-worklet-url", setup(builder) {
      builder.onResolve({ filter: /pcm-worklet\.js\?url$/ }, (args) => ({ path: args.path, namespace: "fixture-url" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-url" }, () => ({ contents: 'export default "/pcm-worklet.js";', loader: "js" }));
    } }],
  });
  await writeFile(join(temp, "index.html"), '<div id="root"></div><script type="module" src="fixture.js"></script>');
  await writeFile(join(temp, "runner.cjs"), `
const { app, BrowserWindow } = require("electron");
app.setPath("userData", ${JSON.stringify(join(temp, "profile"))});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  win.webContents.on("console-message", (event) => console.error(event.message));
  win.webContents.session.setPermissionRequestHandler((_w, _p, callback) => callback(false));
  win.webContents.session.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith("file:") }));
  try {
    await win.loadFile(${JSON.stringify(join(temp, "index.html"))});
    console.log(await win.webContents.executeJavaScript("window.runTests()"));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "runner.cjs")], { env, stdio: "inherit" });
  const timeout = setTimeout(() => child.kill(), 30_000);
  const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
  clearTimeout(timeout);
  assert.equal(code, 0, "Mounted preferences interaction regression");
} finally {
  await rm(temp, { recursive: true, force: true });
}
