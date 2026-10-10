import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { loadStyles } from "./helpers/styles.mjs";

const styles = await loadStyles();
const [composerSource, footerSource, inspectorSource, compactionSource] = await Promise.all([
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
  readFile(
    new URL("../src/components/ContextCompactionAction.tsx", import.meta.url),
    "utf8",
  ),
]);

const { outputText } = ts.transpileModule(compactionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const compactionModule = { exports: {} };
let actionState;
const useActionStore = (selector) => selector(actionState);
useActionStore.getState = () => actionState;
const actionImports = {
  "react/jsx-runtime": jsxRuntime,
  "react-i18next": { useTranslation: () => ({ t: (key) => key }) },
  "../stores/app-store": { useAppStore: useActionStore },
  "./ui": { Button: () => null },
};
new Function("require", "exports", "module", outputText)(
  (id) => {
    assert.ok(Object.hasOwn(actionImports, id), `unmocked dependency: ${id}`);
    return actionImports[id];
  }, compactionModule.exports, compactionModule,
);
const { canCompactContext, ContextCompactionAction } = compactionModule.exports;

const idleSessionState = () => ({
  activeSessionId: "session-1",
  sessions: [{ id: "session-1", source: "desktop" }],
  isRunning: false,
  runningSessions: {},
  pendingPermissions: {},
  pendingAsks: {},
  pendingPlans: {},
  planCheckpoints: {},
});

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

test("ComposerUsageFooter consolidates all statistics in the context inspector", () => {
  assert.doesNotMatch(footerSource, /composer-usage-(speed|total|cache)/);
  assert.match(footerSource, /<ContextUsageInspector[\s\S]*variant="footer"/);
  assert.match(inspectorSource, /chat\.usageThroughputLabel/);
  assert.match(inspectorSource, /chat\.usageTurnTotal/);
  assert.match(inspectorSource, /chat\.usageCacheRateUnavailableLabel/);
  assert.match(inspectorSource, /variant === "footer" \? usageTokenTotal\(turnUsage\)/);
});

test("footer context meter fills the same used/remaining figure as its percentage", () => {
  assert.match(inspectorSource, /composer-usage-context-track[\s\S]*?role="progressbar"[\s\S]*?aria-valuenow=\{display.percent\}/);
  assert.match(inspectorSource, /composer-usage-context-fill[\s\S]*?display.ratio \* 100/);
  assert.match(inspectorSource, /context-inspector-occupancy-fill[\s\S]*?context.usedRatio \* 100/);
  assert.match(inspectorSource, /ContextCompactionAction[\s\S]*?sessionId=\{openedSessionId.current\}/);
  assert.match(compactionSource, /useAppStore.getState\(\)[\s\S]*?canCompactContext\(state, sessionId, hasUsage\)[\s\S]*?state.compactContext\(\)/);
});

test("footer popover aligns with its trigger inside the composer reading column", () => {
  assert.match(inspectorSource, /variant === "footer"\s*\? trigger\.closest\("\.composer-stack"\)\?\.getBoundingClientRect\(\)/);
  assert.match(inspectorSource, /left: variant === "footer"\s*\? triggerRect.right - popoverRect.width\s*: triggerRect.left/);
  assert.match(inspectorSource, /const composer = variant === "footer"\s*\? triggerRef.current\?\.closest\("\.composer-stack"\)/);
  assert.match(inspectorSource, /if \(pane\) observer.observe\(pane\)/);
  assert.match(inspectorSource, /if \(composer\) observer.observe\(composer\)/);
  assert.match(inspectorSource, /\}, \[variant\]\)/);
});

test("compaction requires collected usage and the same idle desktop session", () => {
  const state = idleSessionState();
  assert.equal(canCompactContext(state, "session-1", true), true);
  assert.equal(canCompactContext(state, "session-1", false), false);
  assert.equal(canCompactContext(state, undefined, true), false);
  assert.equal(canCompactContext({ ...state, activeSessionId: "session-2" }, "session-1", true), false);
  assert.equal(canCompactContext({ ...state, sessions: [] }, "session-1", true), false);
  assert.equal(canCompactContext({ ...state, isRunning: true }, "session-1", true), false);
  assert.equal(canCompactContext({ ...state, runningSessions: { "session-1": true } }, "session-1", true), false);
});

test("compaction cannot control imported, remote, read-only, or team member sessions", () => {
  for (const fields of [
    { source: "pi-native" }, { source: "remote" },
    { readOnlyReason: "imported" }, { capabilities: { canPrompt: false } },
    { team: { role: "member" } },
  ]) {
    const state = idleSessionState();
    state.sessions[0] = { ...state.sessions[0], ...fields };
    assert.equal(canCompactContext(state, "session-1", true), false, JSON.stringify(fields));
  }
  for (const sessionId of ["remote:session-1", "native-pi:session-1"]) {
    const state = idleSessionState();
    state.activeSessionId = sessionId;
    state.sessions[0].id = sessionId;
    assert.equal(canCompactContext(state, sessionId, true), false);
  }
});

test("compaction waits for permission, question, and plan approval decisions", () => {
  for (const queue of ["pendingPermissions", "pendingAsks"]) {
    const state = idleSessionState();
    state[queue] = { "session-1": [{ requestId: "decision" }] };
    assert.equal(canCompactContext(state, "session-1", true), false, queue);
  }
  for (const queue of ["pendingPlans", "planCheckpoints"]) {
    const state = idleSessionState();
    state[queue] = { "session-1": { status: "pending" } };
    assert.equal(canCompactContext(state, "session-1", true), false, queue);
    state[queue]["session-1"].status = "approved";
    assert.equal(canCompactContext(state, "session-1", true), true, queue);
  }
});

test("the compaction button rechecks session state before starting the existing workflow", () => {
  const compacted = [];
  let closed = false;
  actionState = {
    ...idleSessionState(),
    compactContext: () => {
      compacted.push(actionState.activeSessionId);
      actionState.isRunning = true;
    },
  };
  const button = ContextCompactionAction({
    sessionId: "session-1", hasUsage: true, onStarted: () => { closed = true; },
  });
  assert.equal(button.props.disabled, false);
  actionState.activeSessionId = "session-2";
  button.props.onClick();
  assert.deepEqual(compacted, []);
  assert.equal(closed, false);
  actionState.activeSessionId = "session-1";
  button.props.onClick();
  assert.deepEqual(compacted, ["session-1"]);
  assert.equal(closed, true);
  button.props.onClick();
  assert.deepEqual(compacted, ["session-1"], "a second click cannot start a duplicate run");
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
