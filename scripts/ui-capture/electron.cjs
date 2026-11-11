/** Standalone fixture shell: no production Main, Host, provider, or user profile. */
const { app, BrowserWindow, nativeImage } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { isFixtureRequest } = require("./network.cjs");

const bundle = process.env.PI_UI_CAPTURE_BUNDLE;
const output = process.env.PI_UI_CAPTURE_OUTPUT;
const config = JSON.parse(readFileSync(join(bundle, "scenes.json"), "utf8"));
const failures = [];
const images = [];
app.setPath("userData", app.commandLine.getSwitchValue("user-data-dir"));
app.setPath("crashDumps", join(output, "crashes"));
app.commandLine.appendSwitch("force-device-scale-factor", String(config.settings.deviceScaleFactor));
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
app.commandLine.appendSwitch("lang", config.settings.locale);
// The scene loop, rather than closing an individual fixture, owns app shutdown.
app.on("window-all-closed", () => {});
app.on("child-process-gone", (_event, details) => {
  if (!["clean-exit", "killed"].includes(details.reason)) failures.push(`Native ${details.type}: ${details.reason} (${details.exitCode})`);
});

app.whenReady().then(async () => {
  const environment = { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    deviceScaleFactor: config.settings.deviceScaleFactor, fontsByScene: {} };
  try {
    for (const scene of config.scenes) {
      const stage = value => console.log(`UI_CAPTURE_STAGE ${scene.id} ${value}`);
      const window = new BrowserWindow({ show: false, frame: false, useContentSize: true,
        width: config.settings.viewport.width, height: config.settings.viewport.height,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
          backgroundThrottling: false, partition: `ui-fixture-${scene.id}`, preload: join(bundle, "preload.cjs") } });
      const contents = window.webContents;
      contents.session.webRequest.onBeforeRequest((details, callback) => {
        const allowed = isFixtureRequest(details.url, bundle);
        if (!allowed) failures.push(`Blocked non-fixture request in ${scene.id}`);
        callback({ cancel: !allowed });
      });
      contents.setWindowOpenHandler(() => { failures.push(`Unexpected window in ${scene.id}`); return { action: "deny" }; });
      contents.on("will-navigate", event => { event.preventDefault(); failures.push(`Unexpected navigation in ${scene.id}`); });
      contents.on("render-process-gone", (_event, details) => failures.push(`Renderer ${scene.id}: ${details.reason}`));
      contents.on("console-message", event => { if (event.level === "error") console.error(event.message); });
      try {
        stage("loading");
        await window.loadFile(join(bundle, "index.html"));
        // CDP captures at the emulated DPR; capturePage uses the physical Retina scale.
        contents.debugger.attach("1.3");
        await contents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          ...config.settings.viewport, deviceScaleFactor: config.settings.deviceScaleFactor,
          mobile: false, screenWidth: config.settings.viewport.width, screenHeight: config.settings.viewport.height,
        });
        stage("viewport-ready");
        await contents.insertCSS("input, textarea, [contenteditable] { caret-color: transparent !important; }");
        const result = await contents.executeJavaScript(`globalThis.uiCaptureShow(${JSON.stringify(scene.id)})`);
        if (result?.id !== scene.id) throw new Error(`Wrong ready scene: ${scene.id}`);
        stage("content-ready");
        const metrics = await contents.executeJavaScript(`(async () => {
          await document.fonts.ready;
          await Promise.all([...document.images].map(async image => { await image.decode(); }));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          for (const animation of document.getAnimations()) {
            if (animation.effect?.getComputedTiming().iterations === Infinity) {
              animation.pause(); animation.currentTime = 0;
            } else animation.finish();
          }
          return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
            motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
            locale: document.documentElement.lang, theme: document.documentElement.dataset.theme,
            platform: document.documentElement.dataset.platform,
            now: Date.now(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            bodyFont: getComputedStyle(document.body).fontFamily,
            fonts: [...document.fonts].map(font => [font.family, font.style, font.weight, font.status].join('|')).sort() };
        })()`);
        const expected = config.settings;
        if (metrics.width !== expected.viewport.width || metrics.height !== expected.viewport.height ||
          metrics.dpr !== expected.deviceScaleFactor || !metrics.motion || metrics.locale !== expected.locale ||
          metrics.theme !== expected.theme || metrics.platform !== process.platform || metrics.now !== Date.parse(expected.now) || metrics.timezone !== expected.timezone) {
          throw new Error(`Capture environment differs from scene contract: ${JSON.stringify(metrics)}`);
        }
        stage("assets-ready");
        await contents.executeJavaScript("globalThis.uiCaptureValidate()");
        const { data } = await contents.debugger.sendCommand("Page.captureScreenshot", {
          format: "png", fromSurface: true, captureBeyondViewport: false,
        });
        const png = Buffer.from(data, "base64");
        const screenshot = nativeImage.createFromBuffer(png);
        await contents.executeJavaScript("globalThis.uiCaptureValidate()");
        const size = screenshot.getSize();
        if (screenshot.isEmpty() || size.width !== expected.viewport.width || size.height !== expected.viewport.height) throw new Error(`Empty or wrong-sized screenshot: ${scene.id}`);
        if (failures.length) throw new Error(failures.join("; "));
        environment.fontsByScene[scene.id] = { bodyFont: metrics.bodyFont, fonts: metrics.fonts };
        writeFileSync(join(output, scene.file), png);
        images.push({ id: scene.id, file: scene.file, width: size.width, height: size.height });
        console.log(`UI_CAPTURE_SCENE ${scene.id}`);
      } finally {
        if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
        if (!window.isDestroyed()) window.destroy();
      }
    }
    if (failures.length) throw new Error(failures.join("; "));
    writeFileSync(join(output, "capture-result.json"), JSON.stringify({ ok: true, environment, images }));
    app.quit();
  } catch (error) {
    writeFileSync(join(output, "capture-result.json"), JSON.stringify({ ok: false, environment, images, failures, error: String(error) }));
    console.error(error); app.exit(1);
  }
});
