import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const styles = await loadStyles();
const [composerSource, footerSource, inspectorSource] = await Promise.all([
  readFile(
    new URL("../src/components/Composer.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/features/chat/composer/ComposerUsageFooter.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/components/ContextUsageInspector.tsx", import.meta.url),
    "utf8",
  ),
]);

test("Composer mounts ComposerUsageFooter directly under composer-shell", () => {
  assert.match(
    composerSource,
    /<ComposerUsageFooter\s+\{\.\.\.composerContextUsage\}\s*\/>/,
  );
  // Ensure it is placed outside/after the composer-shell div
  const shellIndex = composerSource.indexOf("className={`composer-shell");
  const footerIndex = composerSource.indexOf("<ComposerUsageFooter");
  assert.ok(shellIndex > 0, "composer-shell exists");
  assert.ok(footerIndex > shellIndex, "footer is rendered after composer-shell");
});

test("ComposerUsageFooter renders 4 metrics and supports variant='footer'", () => {
  // Speed, Total, Cache, and Context
  assert.match(footerSource, /composer-usage-speed/);
  assert.match(footerSource, /composer-usage-total/);
  assert.match(footerSource, /composer-usage-cache/);
  assert.match(footerSource, /<ContextUsageInspector[\s\S]*variant="footer"/);

  // Accessible unavailable labels used when metrics are undefined
  assert.match(footerSource, /chat\.usageThroughputUnavailableLabel/);
  assert.match(footerSource, /chat\.usageTurnTotalUnavailableLabel/);
  assert.match(footerSource, /chat\.usageCacheRateUnavailableLabel/);

  // Inspector handles variant="footer" trigger
  assert.match(inspectorSource, /variant\s*===\s*"footer"/);
  assert.match(inspectorSource, /composer-usage-context-btn/);
});

test("composer-usage-footer CSS is defined with flexible wrapping and theme tokens", () => {
  assert.match(styles, /\.composer-usage-footer\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(styles, /\.composer-usage-footer\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(styles, /\.composer-usage-btn:hover\s*\.composer-usage-value\s*\{/);
  assert.match(
    styles,
    /\.composer-usage-context\[data-level="critical"\]\s*\.composer-usage-value\s*\{[\s\S]*?var\(--ds-danger\);/,
  );
});
