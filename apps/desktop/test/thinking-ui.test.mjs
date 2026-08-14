import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

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
// Agent/Plan mode remains owned by the left-of-input Composer chip; the
// conversation top bar only hosts the model picker and window actions.
const topbarSource = await readFile(
  new URL("../src/components/ConversationTopbar.tsx", import.meta.url),
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
const stylesSource = await loadStyles();

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

test("Composer owns the mode chip and the top bar keeps only model selection", () => {
  const leftToolbar = composerSource.slice(
    composerSource.indexOf('<div className="composer-left">'),
    composerSource.indexOf('<div className="composer-right">'),
  );
  const modeControl = leftToolbar.indexOf(
    'className="icon-btn mode-chip composer-mode-chip"',
  );
  const thinkingControl = leftToolbar.indexOf('className="composer-thinking"');
  const permissionControl = leftToolbar.indexOf('className="composer-permission"');

  assert.ok(modeControl >= 0);
  assert.ok(thinkingControl >= 0);
  assert.ok(modeControl < thinkingControl);
  assert.ok(permissionControl > thinkingControl);
  assert.match(topbarSource, /<ModelSelect \/>/);
  assert.doesNotMatch(topbarSource, /ct-mode|ct-mode-btn|configureActiveSession/);
  assert.doesNotMatch(stylesSource, /\.conversation-topbar \.ct-mode/);
  assert.match(
    leftToolbar,
    /thinkingProvider\?\.supportsReasoning\s*&&\s*availableThinkingLevels\.length/,
  );
  assert.match(leftToolbar, /composer-thinking-menu/);
});

test("conversation topbar keeps only the concise task title visible", () => {
  assert.doesNotMatch(topbarSource, /IconFolder|IconChevronRight/);
  assert.doesNotMatch(topbarSource, /className="ct-project"/);
  assert.doesNotMatch(topbarSource, /className="ct-title-chevron"/);
  assert.match(topbarSource, /className="ct-title"/);
  assert.match(topbarSource, /role="status"/);
  assert.match(stylesSource, /\.conversation-topbar \.ct-title-wrap[\s\S]*?align-items: center/);
  assert.match(
    stylesSource,
    /\.conversation-topbar \.ct-title[\s\S]*?font-size: var\(--text-base\)/,
  );
  assert.match(
    stylesSource,
    /\.conversation-topbar \.ct-running\s*\{[\s\S]*?width: 18px[\s\S]*?height: 18px/,
  );
  assert.match(
    stylesSource,
    /\.conversation-topbar \.ct-running-dot[\s\S]*?background: var\(--ds-warning\)/,
  );
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
  // Composer owns both the reasoning-level guard and its session write.
  assert.match(
    composerSource,
    /const thinkingLevel = thinkingLevelForProvider\(\s*thinkingProvider,\s*configuredThinkingLevel,\s*\)/,
  );
  assert.match(composerSource, /thinkingLevel:\s*level/);
});

test("new sessions default to the strongest level of a reasoning model", () => {
  const materializeSource =
    storeSource.match(
      /export async function materializeDraftSession[\s\S]*?\n  return sessionId;\n}\n/,
    )?.[0] ?? "";
  assert.ok(
    materializeSource.length > 0,
    "materializeDraftSession implementation not found",
  );
  assert.match(materializeSource, /defaultProvider\?\.supportsReasoning/);
  assert.match(materializeSource, /highestSupportedThinkingLevel\(/);
  assert.match(
    materializeSource,
    /thinkingLevel:[\s\S]*?defaultThinkingLevel/,
  );
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

test("expanded assistant activity rails collapse their disclosures", () => {
  assert.match(
    transcriptSource,
    /function DisclosureCollapseRail\([\s\S]*?className="disclosure-collapse-rail"[\s\S]*?aria-label=\{label\}[\s\S]*?onClick=\{onCollapse\}/,
  );
  assert.match(
    transcriptSource,
    /className="tool-row-body"[\s\S]*?<DisclosureCollapseRail[\s\S]*?onCollapse=\{\(\) => setOpen\(false\)\}/,
  );
  assert.match(
    transcriptSource,
    /className="tool-activity-body"[\s\S]*?<DisclosureCollapseRail[\s\S]*?onCollapse=\{\(\) => setOpen\(false\)\}/,
  );
  assert.match(
    stylesSource,
    /\.disclosure-collapse-rail\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*16px;[\s\S]*?cursor:\s*pointer;/,
  );
  assert.match(stylesSource, /\.disclosure-collapse-rail:focus-visible\s*\{/);
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
