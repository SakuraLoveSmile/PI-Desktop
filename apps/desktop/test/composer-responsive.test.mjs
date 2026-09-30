import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const styles = await loadStyles();
const [toolbarSource, modelPickerSource, footerSource] = await Promise.all([
  readFile(
    new URL("../src/features/chat/composer/ComposerToolbar.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/features/chat/composer/ComposerModelPicker.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/features/chat/composer/ComposerUsageFooter.tsx", import.meta.url),
    "utf8",
  ),
]);
const composerSource = `${toolbarSource}\n${modelPickerSource}\n${footerSource}`;

test("narrow composer containers progressively simplify the model controls", () => {
  assert.match(
    styles,
    /\.composer-stack\s*\{[\s\S]*?container-type:\s*inline-size;[\s\S]*?container-name:\s*composer-stack;/,
  );
  assert.match(styles, /\.composer-left,\s*\.composer-right\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(styles, /\.composer-model-thinking\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(
    styles,
    /@container composer-stack \(max-width: 560px\)[\s\S]*?\.composer-model-thinking-dot,[\s\S]*?\.composer-model-thinking-level[\s\S]*?display:\s*none;/,
  );
  assert.match(
    styles,
    /@container composer-stack \(max-width: 480px\)[\s\S]*?\.composer-model-thinking-model\s*\{[\s\S]*?max-width:\s*96px;/,
  );
  assert.match(
    styles,
    /@container composer-stack \(max-width: 450px\)[\s\S]*?\.composer-model-thinking-chip[\s\S]*?width:\s*32px;/,
  );
  assert.match(
    styles,
    /\.composer-model-thinking-model,\s*\.composer-model-thinking-chevron\s*\{[\s\S]*?display:\s*none;/,
  );
});


test("responsive rules preserve the semantic model trigger and action controls", () => {
  assert.match(composerSource, /className=\{`icon-btn composer-model-thinking-chip/);
  assert.match(composerSource, /ariaLabel=\{`\$\{t\("chat\.model"\)\}: \$\{modelLabel\}\./);
  assert.match(composerSource, /className=\"composer-model-thinking-chevron\"/);
  assert.match(composerSource, /ContextUsageInspector/);
  assert.match(composerSource, /className=\{`icon-btn icon-btn-square composer-enhance-btn/);
  assert.match(composerSource, /className="send-btn"/);
  assert.match(composerSource, /className="stop-btn"/);
});

test("composer toolbar applies dense control row with tight left cluster and right-anchored actions", () => {
  assert.match(
    styles,
    /\.composer-toolbar\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*8px;/,
  );
  assert.match(
    styles,
    /\.composer-left\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*4px;[\s\S]*?flex:\s*0 1 auto;/,
  );
  assert.match(
    styles,
    /\.composer-right\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*4px;[\s\S]*?flex:\s*0 0 auto;[\s\S]*?margin-left:\s*auto;/,
  );
  assert.match(
    styles,
    /\.composer-profile-chip\s*\{[\s\S]*?width:\s*auto !important;[\s\S]*?max-width:\s*130px;[\s\S]*?padding:\s*0 8px !important;[\s\S]*?gap:\s*4px !important;/,
  );
  assert.match(
    styles,
    /\.composer-contract-chip\s*\{[\s\S]*?width:\s*auto !important;[\s\S]*?max-width:\s*110px;[\s\S]*?padding:\s*0 8px !important;[\s\S]*?gap:\s*4px !important;/,
  );
});
