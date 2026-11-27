#!/usr/bin/env node
/** Real React/Chromium regression for E2E-083's stable completed activity groups. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { cp, mkdtemp, readFile, rm, writeFile , readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./e2e/boot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(
  join(root, "packages/agent-runtime/package.json"),
);
const { build } = require("esbuild");
const { electronBinary } = resolveElectronBinary(root);
const preview = process.env.PI_COMPOSER_PREVIEW === "1";
const temp = await mkdtemp(join(tmpdir(), "pi-transcript-render-"));
try {
  await build({
    entryPoints: [join(root, "scripts/e2e/transcript-render.tsx")],
    outfile: join(temp, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
    // Styles are outside the render-count contract; component and hook code is real.
    loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl", ".gif": "dataurl" },
    alias: {
      "@pi-desktop/i18n": join(root, "packages/i18n/src/index.ts"),
      // The fixture lives outside the desktop package; use its React instance.
      react: join(root, "apps/desktop/node_modules/react"),
      "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
    },
    nodePaths: [join(root, "apps/desktop/node_modules")],
    plugins: [
      {
        name: "local-url-assets",
        setup(build) {
          // Composer imports the dormant voice worklet via Vite's ?url form.
          // Preserve a real local asset URL; this fixture never activates voice.
          build.onResolve({ filter: /\?url$/ }, ({ path, resolveDir }) => ({
            path: join(resolveDir, path.slice(0, -4)), namespace: "local-url-asset",
          }));
          build.onLoad({ filter: /.*/, namespace: "local-url-asset" }, async ({ path }) => ({
            contents: await readFile(path), loader: "file",
          }));
        },
      },
      {
        name: "count-activity-group-renders",
        setup(build) {
          build.onLoad(
            { filter: /[/\\]ActivityGroup\.tsx$/ },
            async ({ path }) => {
              const source = await readFile(path, "utf8");
              const marker = "}: ActivityGroupProps) {";
              assert.equal(
                source.split(marker).length,
                2,
                "ActivityGroup instrumentation boundary changed",
              );
              return {
                contents: source.replace(
                  marker,
                  `${marker}\n  (globalThis.__activityGroupRenders ??= []).push(items[0]?.message.id);`,
                ),
                loader: "tsx",
              };
            },
          );
        },
      },
    ],
  });
  // The runtime-status scenario measures real geometry, so the page needs the
  // app's built stylesheet: the Tailwind reset, the design tokens (the
  // indicator's own type scale), and the transcript layers live there.
  const renderer = join(root, "apps/desktop/out/renderer");
  const appHtml = await readFile(join(renderer, "index.html"), "utf8");
  const css = [...appHtml.matchAll(/href="([^" ]+\.css)"/g)].map(
    (match) => match[1],
  );
  // Lazy route CSS is not linked by index.html; load the actual activity chunk.
  for (const asset of await readdir(join(renderer, "assets"))) {
    if (!asset.endsWith(".css")) continue;
    const body = await readFile(join(renderer, "assets", asset), "utf8");
    const path = `./assets/${asset}`;
    if ((body.includes(".scheduled-instruction-input") || body.includes(".session-activity-rail{") || body.includes(".session-quick-notes{") || body.includes(".subagent-detail-header{") || body.includes(".session-skill-suggestions{")) && !css.includes(path)) css.push(path);
  }
  assert(
    css.length,
    "Build the app with pnpm build:js before running this check",
  );
  await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
  // The scenario measures a rule that only exists in the built stylesheet, so a
  // stale build must fail loudly instead of passing against an older CSS file.
  const laneSource = await readFile(
    join(root, "apps/desktop/src/styles/chat-shell.css"),
    "utf8",
  );
  // Comments inside the rule describe intent; only its declarations are compared.
  const laneRule = laneSource
    .match(/\.transcript-runtime-status \{([\s\S]*?)\}/)?.[1]
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert(
    laneRule,
    "chat-shell.css declares no .transcript-runtime-status rule",
  );
  const builtCss = (
    await Promise.all(css.map((path) => readFile(join(renderer, path), "utf8")))
  )
    .join("\n")
    .replace(/\s+/g, "");
  const builtRule = builtCss.match(
    /\.transcript-runtime-status\{([^}]*)\}/,
  )?.[1];
  assert(
    builtRule,
    "the built stylesheet predates the runtime status lane; build with pnpm build:js",
  );
  // The scenario measures a rule that lives in the built stylesheet, so the two
  // copies have to agree: a build still carrying a declaration the source has
  // dropped (or missing one the source added) must fail here rather than pass a
  // geometry check against CSS that no longer describes the source.
  const declarations = (rule) =>
    new Set(rule.replace(/\s+/g, "").split(";").filter(Boolean));
  const sourceDeclarations = declarations(laneRule);
  const builtDeclarations = declarations(builtRule);
  const drift = [
    ...[...builtDeclarations].filter((value) => !sourceDeclarations.has(value)),
    ...[...sourceDeclarations].filter((value) => !builtDeclarations.has(value)),
  ];
  assert(
    drift.length === 0,
    `the built stylesheet is stale (${drift.join(", ")}); build with pnpm build:js`,
  );
  await writeFile(
    join(temp, "index.html"),
    `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:"><title>${preview ? "PI-Desktop · Design preview (sample data)" : "Transcript render regression"}</title>${css
      .map((path) => `<link rel="stylesheet" href="${path}">`)
      .join("")}<script src="renderer.js"></script>`,
  );
  await writeFile(
    join(temp, "main.cjs"),
    `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.on("window-all-closed", () => app.quit());
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1200, height: 850, title: "PI-Desktop · Isolated design preview", show: false, webPreferences: { offscreen: process.env.PI_COMPOSER_PREVIEW !== "1", sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await window.loadFile(path.join(__dirname, "index.html"));
    await window.webContents.executeJavaScript("window.addEventListener('error', event => console.error(event.error?.stack ?? event.message)); window.addEventListener('unhandledrejection', event => console.error(event.reason?.stack ?? String(event.reason)));");
    const result = await window.webContents.executeJavaScript("(async () => { console.info('TRANSCRIPT_STAGE render'); const render = await globalThis.transcriptRenderProbe(); console.info('TRANSCRIPT_STAGE runtime-slot'); const slot = await globalThis.transcriptRuntimeSlotProbe(); console.info('TRANSCRIPT_STAGE smooth-text'); const smoothText = await globalThis.smoothTextThrottleProbe(); console.info('TRANSCRIPT_STAGE long-history'); const longHistory = await globalThis.transcriptLongHistoryProbe(); console.info('TRANSCRIPT_STAGE render-complete'); return { ...render, runtimeSlot: slot, smoothText, longHistory, ok: render.ok && slot.ok && smoothText.ok && longHistory.ok }; })()");
    console.error("TRANSCRIPT_STAGE context-overflow");
    const contextOverflowRecovery = await require(${JSON.stringify(join(root, "scripts/e2e/context-overflow-recovery.cjs"))})(window);
    console.error("TRANSCRIPT_STAGE activity-rail");
    result.activityRail = await window.webContents.executeJavaScript("globalThis.sessionActivityRailProbe()");
    result.ok = result.ok && result.activityRail.ok;
    console.error("TRANSCRIPT_STAGE activity-workspace");
    result.activityWorkspace = await window.webContents.executeJavaScript("globalThis.sessionActivityWorkspaceProbe()");
    if (!result.activityWorkspace.ok) throw new Error(result.activityWorkspace.error);
    result.ok = result.ok && result.activityWorkspace.ok;
    console.error("TRANSCRIPT_STAGE activity-servers");
    result.activityServers = await window.webContents.executeJavaScript("globalThis.sessionActivityServersProbe()");
    if (!result.activityServers.ok) throw new Error(result.activityServers.error);
    result.ok = result.ok && result.activityServers.ok;
    console.error("TRANSCRIPT_STAGE activity-summary");
    result.activitySummary = await window.webContents.executeJavaScript("globalThis.sessionActivitySummaryProbe()");
    if (!result.activitySummary.ok) throw new Error(result.activitySummary.error);
    result.ok = result.ok && result.activitySummary.ok;
    console.error("TRANSCRIPT_STAGE readability");
    const readability = await window.webContents.executeJavaScript("globalThis.transcriptReadabilityProbe()");
    result.readability = readability;
    result.ok = result.ok && readability.ok;
    if (process.env.PI_TRANSCRIPT_SCREENSHOT) {
      await require("node:fs/promises").writeFile(process.env.PI_TRANSCRIPT_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    await window.webContents.executeJavaScript("globalThis.cleanupReadabilityProbe()");
    console.error("TRANSCRIPT_STAGE activity-integration");
    result.activityIntegration = await window.webContents.executeJavaScript("globalThis.sessionActivityIntegrationProbe().catch(error => ({ ok: false, error: error?.stack ?? String(error) }))");
    if (!result.activityIntegration.ok) throw new Error(result.activityIntegration.error);
    result.ok = result.ok && result.activityIntegration.ok;
    if (process.env.PI_SESSION_ACTIVITY_SCREENSHOT) {
      await require("node:fs/promises").writeFile(process.env.PI_SESSION_ACTIVITY_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    if (process.env.PI_SESSION_ACTIVITY_LIGHT_SCREENSHOT) {
      const theme = await window.webContents.executeJavaScript("document.documentElement.getAttribute('data-theme')");
      await window.webContents.executeJavaScript("document.documentElement.setAttribute('data-theme', 'light'); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await window.webContents.executeJavaScript("Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)).then(() => undefined)");
      await require("node:fs/promises").writeFile(process.env.PI_SESSION_ACTIVITY_LIGHT_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(theme === null ? "document.documentElement.removeAttribute('data-theme')" : "document.documentElement.setAttribute('data-theme', " + JSON.stringify(theme) + ")");
    }
    if (process.env.PI_SESSION_ACTIVITY_ARTIFACTS_SCREENSHOT) {
      await window.webContents.executeJavaScript("(() => { const rail = document.querySelector('.session-pane[data-visible=true] .session-activity-rail'); const scroll = rail?.closest('.session-activity-scroll, .session-pane-activity'); if (scroll) scroll.scrollTop = scroll.scrollHeight; })(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      await window.webContents.executeJavaScript("Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)).then(() => undefined)");
      await require("node:fs/promises").writeFile(process.env.PI_SESSION_ACTIVITY_ARTIFACTS_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
    }
    if (process.env.PI_COMPOSER_SCREENSHOT_DIR) {
      const fs = require("node:fs/promises");
      await fs.mkdir(process.env.PI_COMPOSER_SCREENSHOT_DIR, { recursive: true });
      for (const scene of ["default", "profile", "models", "subagent", "narrow", "context", "outputs", "skills-list", "skills", "project-menu", "location-menu", "branch-menu", "worktree-create"]) {
        const sceneResult = await window.webContents.executeJavaScript("globalThis.composerDesignScene(" + JSON.stringify(scene) + ").then(() => ({ ok: true })).catch(error => ({ ok: false, error: error?.stack ?? String(error) }))");
        if (!sceneResult.ok) throw new Error("Composer screenshot scene " + scene + ": " + sceneResult.error);
        if (scene === "skills") {
          const point = await window.webContents.executeJavaScript("(() => { const rect = document.querySelector('.session-pane[data-visible=true] .session-skill-suggestions-toggle').getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()");
          window.webContents.sendInputEvent({ type: "mouseMove", ...point });
          // The heading is one whole-row toggle: hover washes the row from its left bleed to the count control, not just the label.
          const wholeRowHover = await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { const pane = document.querySelector('.session-pane[data-visible=true]'); const toggle = pane.querySelector('.session-skill-suggestions-toggle'); const style = getComputedStyle(toggle); const box = toggle.getBoundingClientRect(); const row = toggle.closest('.session-activity-heading').getBoundingClientRect(); const count = pane.querySelector('.session-skill-suggestions-count').getBoundingClientRect(); resolve(style.backgroundColor !== 'rgba(0, 0, 0, 0)' && box.left <= row.left - 7 && count.left - box.right <= 8); })))");
          if (!wholeRowHover) throw new Error("Suggestion header does not highlight as one whole row on hover");
        }
        await fs.writeFile(path.join(process.env.PI_COMPOSER_SCREENSHOT_DIR, "composer-" + scene + ".png"), (await window.webContents.capturePage()).toPNG());
      }
      await window.webContents.executeJavaScript("globalThis.composerDesignScene('default')");
    }
    if (process.env.PI_ACTIVITY_SCREENSHOT_DIR) {
      const fs = require("node:fs/promises");
      await fs.mkdir(process.env.PI_ACTIVITY_SCREENSHOT_DIR, { recursive: true });
      for (const scene of ["inline-dark", "inline-light", "docked-dark", "docked-light", "button-dark", "button-light"]) {
        const sceneResult = await window.webContents.executeJavaScript("globalThis.activityPlacementScene(" + JSON.stringify(scene) + ").then(() => ({ ok: true })).catch(error => ({ ok: false, error: error?.stack ?? String(error) }))");
        if (!sceneResult.ok) throw new Error("Activity screenshot scene " + scene + ": " + sceneResult.error);
        await fs.writeFile(path.join(process.env.PI_ACTIVITY_SCREENSHOT_DIR, "activity-" + scene + ".png"), (await window.webContents.capturePage()).toPNG());
      }
      await window.webContents.executeJavaScript("globalThis.activityPlacementScene('inline-dark')");
    }
    if (process.env.PI_COMPOSER_PREVIEW !== "1") {
      await window.webContents.executeJavaScript("globalThis.cleanupSessionActivityIntegrationProbe()");
    }
    result.contextOverflowRecovery = contextOverflowRecovery;
    result.ok = result.ok && contextOverflowRecovery.ok;
    console.log("TRANSCRIPT_RENDER_PROBE " + JSON.stringify(result));
    if (process.env.PI_COMPOSER_PREVIEW === "1") {
      await window.webContents.executeJavaScript("globalThis.enableResponsiveComposerPreview()");
      window.show();
      window.focus();
      console.log("COMPOSER_PREVIEW_READY " + JSON.stringify({ profile: app.getPath("userData"), syntheticData: true, connectedHost: false }));
    } else {
      app.quit();
    }
  } catch (error) {
    console.error("TRANSCRIPT_RENDER_PROBE " + JSON.stringify({ ok: false, error: error?.stack ?? String(error) }));
    app.exit(1);
  }
});
`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [join(temp, "main.cjs")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output += data;
      if (preview) process.stdout.write(data);
    });
  const timeout = preview ? undefined : setTimeout(() => child.kill("SIGKILL"), 45_000);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const line = output
    .split(/\r?\n/)
    .find((line) => line.startsWith("TRANSCRIPT_RENDER_PROBE "));
  assert(
    line,
    `renderer returned no probe result (exit=${code}): ${output.slice(-2000)}`,
  );
  const result = JSON.parse(line.slice("TRANSCRIPT_RENDER_PROBE ".length));
  console.log("TRANSCRIPT_RENDER_PROBE " + JSON.stringify(result));
  assert.equal(code, 0, output.slice(-6000));
  assert.equal(result.ok, true);
  // The merged result above already carries the geometry snapshots; this turns
  // a failed scenario into a message that names the checks that failed.
  // check can be read from the scenario output alone.
  assert.equal(
    result.runtimeSlot?.ok,
    true,
    `runtime status slot scenario failed: ${JSON.stringify(result.runtimeSlot?.failures)}`,
  );
  assert.equal(
    result.smoothText?.ok,
    true,
    `smooth text cadence scenario failed: ${JSON.stringify(result.smoothText)}`,
  );
  assert.equal(
    result.contextOverflowRecovery?.ok,
    true,
    `context overflow recovery scenario failed: ${JSON.stringify(result.contextOverflowRecovery)}`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
