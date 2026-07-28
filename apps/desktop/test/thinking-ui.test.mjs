import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composerSource = await readFile(
  new URL("../src/components/Composer.tsx", import.meta.url),
  "utf8",
);
const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/components/ChatSurface.tsx", import.meta.url),
  "utf8",
);
const mainSource = await readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);
const storeSource = await readFile(
  new URL("../src/stores/app-store.ts", import.meta.url),
  "utf8",
);
// Provider thinking config lives in the provider settings components, not the
// settings page shell.
const settingsSource = (
  await Promise.all(
    [
      "../src/components/settings/ProvidersSection.tsx",
      "../src/components/settings/ProviderDialog.tsx",
      "../src/components/settings/provider-form.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  )
).join("\n");
const stylesSource = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);

test("composer exposes the runtime thinking level order and provider filtering", () => {
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.match(composerSource, new RegExp(`"${level}"`));
  }
  assert.match(composerSource, /supportedThinkingLevels/);
  assert.match(composerSource, /supportsReasoning/);
  assert.match(composerSource, /thinkingLevelForProvider/);
  assert.match(composerSource, /thinkingLevel:\s*level/);
  assert.match(composerSource, /composer-thinking-list/);
  assert.doesNotMatch(stylesSource, /\.composer-thinking-levels/);
  assert.doesNotMatch(stylesSource, /\.composer-thinking-level\b/);
  assert.match(
    stylesSource,
    /\.composer-model-menu\.composer-thinking-menu\s*\{[\s\S]*?width:\s*auto;[\s\S]*?max-width:\s*min\(160px,\s*calc\(100vw - 24px\)\);/,
  );
  const thinkingControlSource = composerSource.slice(
    composerSource.indexOf('<div className="composer-thinking"'),
    composerSource.indexOf('<div className="composer-permission"'),
  );
  assert.doesNotMatch(thinkingControlSource, /permissionInherit|"inherit"/);
  assert.match(composerSource, /availableThinkingLevels/);
});

test("reasoning-capable models show thinking immediately after the mode control", () => {
  const leftToolbar = composerSource.slice(
    composerSource.indexOf('<div className="composer-left">'),
    composerSource.indexOf('<div className="composer-right">'),
  );
  const modeControl = leftToolbar.indexOf('className="icon-btn mode-chip"');
  const thinkingControl = leftToolbar.indexOf('className="composer-thinking"');
  const permissionControl = leftToolbar.indexOf('className="composer-permission"');

  assert.ok(modeControl >= 0);
  assert.ok(thinkingControl > modeControl);
  assert.ok(permissionControl > thinkingControl);
  assert.match(
    leftToolbar,
    /thinkingProvider\?\.supportsReasoning\s*&&\s*availableThinkingLevels\.length/,
  );
  assert.match(leftToolbar, /composer-thinking-menu/);
});

test("model menus do not expose desktop-owned reasoning overrides", () => {
  assert.doesNotMatch(composerSource, /canEnableThinkingOverride/);
  assert.doesNotMatch(composerSource, /chat\.thinkingEnable/);
  assert.doesNotMatch(composerSource, /supportsReasoning:\s*true/);
});

test("switching to a provider without reasoning resets the session level", () => {
  assert.match(
    composerSource,
    /if\s*\(!provider\?\.supportsReasoning\)\s*return\s*"off"/,
  );
  assert.match(composerSource, /thinkingLevel:\s*thinkingLevelForProvider\(/);
});

test("new sessions default to the strongest level of a reasoning model", () => {
  const newSessionSource =
    storeSource.match(/newSession: async[\s\S]*?\n  forkSession:/)?.[0] ?? "";
  assert.match(newSessionSource, /defaultProvider\?\.supportsReasoning/);
  assert.match(newSessionSource, /highestSupportedThinkingLevel\(/);
  assert.match(newSessionSource, /thinkingLevel:\s*defaultThinkingLevel/);
});

test("main resolves reasoning from each session's exact selected model", () => {
  assert.match(mainSource, /function enrichSession/);
  assert.match(mainSource, /modelId:\s*session\.modelId/);
  assert.match(mainSource, /sessions:\s*result\.sessions\.map/);
  assert.match(mainSource, /enrichProvider\(provider, modelId\)/);
  // Discovered models are stamped with reasoning capability per model id.
  assert.match(mainSource, /thinking\.supportsReasoning/);
  assert.match(mainSource, /capabilities\.add\("reasoning"\)/);
  assert.match(mainSource, /capabilities\.delete\("reasoning"\)/);
});

test("transcript keeps assistant thinking in a separate disclosure", () => {
  assert.match(transcriptSource, /tool-row thinking/);
  assert.match(transcriptSource, /className="tool-row-header"/);
  assert.match(transcriptSource, /aria-expanded=\{open\}/);
  assert.match(transcriptSource, /aria-hidden=\{!open\}/);
  assert.match(transcriptSource, /inert=\{!open\}/);
  assert.match(transcriptSource, /IconSparkles/);
  assert.match(transcriptSource, /messageThinking as thinkingText/);
  assert.match(transcriptSource, /thinking-prose[\s\S]*?Markdown source=\{text\}/);
  assert.match(transcriptSource, /CopyButton text=\{content\}/);
  assert.match(transcriptSource, /messageThinking as thinkingText/);
  assert.match(transcriptSource, /onlyThinking = items\.every/);
  assert.match(stylesSource, /\.thinking-prose/);
});

test("thinking-only assistant streams open the transcript surface", () => {
  assert.match(appSource, /typeof message\.thinking === "string"/);
  assert.match(appSource, /hasContent \|\| hasThinking/);
});

test("provider settings do not override pi-owned model parameters", () => {
  assert.doesNotMatch(settingsSource, /thinkingMode/);
  assert.doesNotMatch(settingsSource, /supportedThinkingLevels/);
  assert.doesNotMatch(settingsSource, /contextWindow/);
  assert.doesNotMatch(settingsSource, /maxOutputTokens/);
  assert.doesNotMatch(settingsSource, /temperature/);
});

test("main forwards the complete pi model record to the sidecar", () => {
  assert.match(mainSource, /resolvePiModelConfig/);
  assert.match(mainSource, /\.\.\.\(modelConfig \? \{ modelConfig \} : \{\}\)/);
  assert.doesNotMatch(mainSource, /modelCompat/);
});
