import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadStyles } from "./helpers/styles.mjs";

// The non-English catalogs import the English one through a `.js` specifier
// that only exists as `.ts` on disk, so they load through the shared hooks.
const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { en } = await import("../../../packages/i18n/src/locales/en/index.ts");
const { zhCN } = await import("../../../packages/i18n/src/locales/zh-CN/index.ts");
const { zhTW } = await import("../../../packages/i18n/src/locales/zh-TW/index.ts");
const { de } = await import("../../../packages/i18n/src/locales/de/index.ts");
const { es } = await import("../../../packages/i18n/src/locales/es/index.ts");
const { fr } = await import("../../../packages/i18n/src/locales/fr/index.ts");
const { ko } = await import("../../../packages/i18n/src/locales/ko/index.ts");
const { ptBR } = await import("../../../packages/i18n/src/locales/pt-BR/index.ts");
const { tr } = await import("../../../packages/i18n/src/locales/tr/index.ts");

/**
 * The Agent > MCP page owns one block that is not an installed server: the
 * desktop's own loopback control endpoint (ADR 0203). These contracts keep it a
 * machine setting — one strip with one switch above the level groups — instead of
 * a row that can be filtered, moved, renamed, deleted, or OAuth-authorized.
 */
const catalogs = { en, "zh-CN": zhCN, "zh-TW": zhTW, de, es, fr, ko, "pt-BR": ptBR, tr };
const read = (path) => readFileSync(join(here, path), "utf8");
const mcp = read("../src/components/settings/AgentMcpPage.tsx");
const api = read("../src/lib/api.ts");
const styles = await loadStyles();

/** The renderer, the toggle handler, and the client methods, as separate units. */
function blockBetween(start, end) {
  const from = mcp.indexOf(start);
  const to = mcp.indexOf(end, from);
  assert.ok(from !== -1, `${start} should be present`);
  assert.ok(to > from, `${start} should end before ${end}`);
  return mcp.slice(from, to);
}

const controlBlock = () => blockBetween("const renderControlEndpoint", "const showGlobal");
const controlToggle = () => blockBetween("const toggleControl = async", "const [filter, setFilter");
const client = () => api.slice(api.indexOf("mcpControlGet:"), api.indexOf("// --- Skill market"));

test("the endpoint is one strip inside the single panel, above the level groups", () => {
  assert.equal(mcp.match(/<CapabilityToolbar/g)?.length, 1);
  assert.equal(mcp.match(/<CapabilityPanel/g)?.length, 1);
  const panel = mcp.indexOf("<CapabilityPanel");
  const rendered = mcp.indexOf("{renderControlEndpoint()}");
  const globalGroup = mcp.indexOf('label={t("settings.globalLevel")}');
  const searchBranch = mcp.indexOf("counts.all === 0 && search.trim()");
  assert.ok(
    panel !== -1 && rendered > panel && globalGroup > rendered,
    "the strip renders inside the panel, above the global group",
  );
  // Filtering and the search-empty branch never take it away: it holds no server,
  // no project, and nothing the level filter or the search field can narrow.
  assert.ok(searchBranch > rendered, "the strip is outside the search-empty branch");
  assert.match(mcp, /^ {8}\{renderControlEndpoint\(\)\}$/m);
});

test("the endpoint is not a server row and has no move, delete, or OAuth action", () => {
  const block = controlBlock();
  assert.match(block, /className="agent-mcp-scope" role="presentation"/);
  assert.match(block, /toggleControl\(/);
  for (const forbidden of [
    /<CapabilityRow\b/,
    /CapabilityRowMenu/,
    /agent-capability-badge is-level/,
    /setMcpServerEnabled|upsertMcpServer|removeMcpServer|transferMcpServer|testMcpServer/,
    /startMcpOAuth|IconKey|IconTrash|IconPencil|IconArrowUpDown/,
    /selectedProjectPath|targetLevel/,
  ]) {
    assert.doesNotMatch(block, forbidden);
  }
  // It is a machine setting, so it reads and writes its own channels only.
  assert.doesNotMatch(client(), /IPC\.invoke\.mcp(?:List|SetEnabled|Transfer|Remove|Test)\b/);
});

test("a launch argument owns the value, so the switch is shown disabled", () => {
  const block = controlBlock();
  assert.match(block, /const override = control\?\.source === "environment"/);
  assert.match(block, /disabled=\{override\}/);
  assert.match(block, /settings\.mcpControl\.envControlled/);
  assert.match(block, /settings\.mcpControl\.thisMachine/);
});

test("a failed start shows the host's reason and a retry that starts again", () => {
  const block = controlBlock();
  // `error` is the host's own sentence, not an object, and a host that never
  // answered is a different failure from a start the host says it could not do.
  assert.match(block, /const hostError = control\?\.error \?\? null/);
  assert.match(block, /const unreachable = controlReadError/);
  assert.doesNotMatch(block, /error\?\.message/);
  // Colored as a failure only while nothing listens and the value says it should.
  assert.match(block, /const failed = !running && hostError !== null && \(enabled \|\| !override\)/);
  assert.match(block, /role="alert"/);
  assert.match(block, /t\("settings\.mcpControl\.failed"\)/);
  assert.match(block, /\{running \? \(|failed \|\| unknown \? null : \(/);
  // A read this window could not complete is reported as such, never as a start
  // that failed, and it says which call it could not read.
  assert.match(block, /const unknown = !control && unreachable !== null/);
  assert.match(block, /t\("settings\.mcpControl\.unavailable"\)/);
  assert.match(block, /settings\.mcpControl\.unreachable", \{ message: unreachable \}/);
  // Retry belongs to a start that failed while the value still says "on" — which
  // includes a launch argument waiting for a start it could not complete. A
  // refused or rolled-back request shows its reason without a button that
  // cannot fix it, so the button is never gated on the override.
  assert.match(block, /const canRetry = enabled && !running && hostError !== null/);
  assert.match(block, /\{canRetry \? \(/);
  assert.match(block, /onClick=\{\(\) => void toggleControl\(true\)\}/);
  const retry = block.slice(
    block.indexOf("{canRetry ? ("),
    block.indexOf(") : null}", block.indexOf("{canRetry ? (")),
  );
  assert.match(retry, /t\("settings\.mcpControl\.retry"\)/);
  assert.doesNotMatch(retry, /disabled/);
});

test("the switch reports the state the host reached instead of flipping optimistically", () => {
  const block = controlBlock();
  const toggle = controlToggle();
  assert.match(toggle, /const next = await api\.mcpControlSet\(enabled\)/);
  assert.match(toggle, /setControl\(next\)/);
  assert.doesNotMatch(toggle, /patchRow/);
  assert.doesNotMatch(toggle, /setControl\(\{/);
  // A start that failed on a taken port answers `ok: true` with a non-null
  // `error`, so the failure path reads the reply instead of waiting for a
  // rejected promise; only a refused call (bad params, no lifecycle) throws.
  assert.match(toggle, /if \(next\.error\) \{/);
  assert.match(toggle, /showToast\(next\.error, \{ variant: "error" \}\)/);
  // A rejected call proves nothing about the host, so the page re-reads it.
  assert.match(toggle, /catch[\s\S]*?await readControl\(\)/);
  assert.match(mcp, /setControl\(await api\.mcpControlGet\(\)\)/);
  // The switch shows the effective value, so a saved "on" whose start failed
  // stays on beside the failure state and its retry.
  assert.match(block, /const enabled = Boolean\(control\?\.enabled\)/);
  assert.match(block, /checked=\{enabled\}/);
  assert.match(block, /onChange=\{\(\) => void toggleControl\(!enabled\)\}/);
});

test("the strip names its three states and says what turning it off means", () => {
  const block = controlBlock();
  assert.match(block, /t\("settings\.mcpControl\.reading"\)/);
  assert.match(block, /t\("settings\.mcpControl\.on"\)/);
  assert.match(block, /t\("settings\.mcpControl\.off"\)/);
  assert.match(block, /is-status is-ready/);
  assert.match(block, /is-status is-failed/);
  assert.match(block, /agent-capability-status-dot/);
  assert.match(block, /settings\.mcpControl\.onHint[\s\S]*?settings\.mcpControl\.offHint/);
  assert.equal(zhCN.settings.mcpControl.offHint, "关闭后调度台会断开；已运行会话继续。");
  assert.match(en.settings.mcpControl.offHint, /disconnects the control plane/);
  assert.match(en.settings.mcpControl.offHint, /already running continue/);
});

test("the connection path is copyable and the token never reaches the renderer", () => {
  const block = controlBlock();
  assert.match(block, /<code title=\{connectionFile\}>\{connectionFile\}<\/code>/);
  assert.match(block, /settings\.mcpControl\.connectionFile/);
  // No token, no manifest dump, and no copy affordance for either.
  assert.doesNotMatch(mcp, /token/i);
  assert.doesNotMatch(block, /clipboard|navigator\./);
  assert.doesNotMatch(client(), /token|connectionInfo/i);
  assert.match(client(), /mcpControlGet: \(\) => invoke<McpControlStatus>\(IPC\.invoke\.mcpControlGet\)/);
  assert.match(
    client(),
    /mcpControlSet: \(enabled: boolean\) =>\s*invoke<McpControlStatus>\(IPC\.invoke\.mcpControlSet, \{ enabled \}\)/,
  );
});

test("every shipped locale carries the endpoint copy the page asks for", () => {
  const keys = new Set();
  for (const match of mcp.matchAll(/"(settings\.mcpControl\.[A-Za-z0-9_]+)"/g)) {
    keys.add(match[1].split(".").at(-1));
  }
  const expected = [...keys].sort();
  assert.ok(
    expected.length >= 14,
    `the page should ask for the endpoint copy, got ${expected.length}`,
  );
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const control = catalog.settings?.mcpControl;
    assert.ok(control, `${locale} is missing settings.mcpControl`);
    assert.deepEqual(Object.keys(control).sort(), expected, `${locale} keys`);
    for (const [name, value] of Object.entries(control)) {
      assert.equal(typeof value, "string", `${locale}.${name} should be a string`);
      assert.ok(value.trim().length > 0, `${locale}.${name} should not be empty`);
    }
  }
});

test("the strip is built from stylesheet surfaces that already exist", () => {
  for (const rule of [
    /\.agent-mcp-scope\s*\{/,
    /\.agent-mcp-scope-copy\s*\{/,
    /\.agent-mcp-scope-label\s*\{/,
    /\.agent-mcp-scope-hint\s*\{/,
    /\.agent-capability-row-title\s*\{/,
    /\.agent-capability-meta\s*\{/,
    /\.agent-capability-status-dot\s*\{/,
    /\.agent-capability-badge\.is-ready\s*\{/,
    /\.agent-capability-badge\.is-failed\s*\{/,
  ]) {
    assert.match(styles, rule);
  }
  // `code` opts back into selection, which is what makes the path copyable
  // without a copy button of its own.
  assert.match(styles, /pre,\s*code\s*\{[\s\S]{0,160}?user-select:\s*text/);
});
