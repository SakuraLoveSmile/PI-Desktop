import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractScenarioIds, generateScenarioIndex } from "./scenario-index.mjs";

test("scenario extraction follows executable calls and constant ids, ignoring comments and document strings", () => {
  const ids = extractScenarioIds(`
    // E2E-DOC-unimplemented must not imply executable coverage.
    const prose = 'E2E-PROSE-unused';
    const id = 'E2E-CI-restart';
    record(id, true);
    test('E2E-UI-user-path: click and reopen', () => {});
    console.log('PASS E2E-RPC-isolated');
    console.log('SKIP E2E-LIVE-paid');
  `).map(item => item.id);
  assert.deepEqual(ids, ["E2E-CI-restart", "E2E-UI-user-path", "E2E-RPC-isolated"]);
});

test("same executable inventory generates both locales and detects stale/deleted scenarios", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-scenario-test-"));
  try {
    for (const path of ["scripts/e2e", "apps/desktop/test", "packages/agent-runtime/src", "packages/shared/src", "packages/host-runtime/src", "docs/spec/06-delivery", "docs/zh-CN/spec/06-delivery"]) await mkdir(join(directory, path), { recursive: true });
    await writeFile(join(directory, "scripts/e2e-probe.mjs"), "record('E2E-PROBE-live-contract', true);\n");
    await writeFile(join(directory, "scripts/e2e-suite-catalog.json"), JSON.stringify({ families: ["sessions"], suites: [{ id: "probe", family: "sessions", tier: "nightly", script: "scripts/e2e-probe.mjs", safety: "Isolated fixture." }] }));
    assert.deepEqual(await generateScenarioIndex({ directory }), { suites: 1, scenarios: 1 });
    await generateScenarioIndex({ directory, check: true });
    const en = await readFile(join(directory, "docs/spec/06-delivery/08-scenario-index.md"), "utf8");
    const zh = await readFile(join(directory, "docs/zh-CN/spec/06-delivery/08-scenario-index.md"), "utf8");
    assert.ok(en.includes("E2E-PROBE-live-contract")); assert.ok(zh.includes("E2E-PROBE-live-contract"));
    assert.ok(en.includes("scripts/e2e-probe.mjs#L1"));
    assert.equal(en.includes("undefined"), false, "generated source labels must omit absent suite metadata");
    assert.equal(zh.includes("undefined"), false, "both locale indexes share the source-link contract");
    await writeFile(join(directory, "scripts/e2e-probe.mjs"), "record('E2E-PROBE-replacement', true);\n");
    await assert.rejects(generateScenarioIndex({ directory, check: true }), /Scenario index drift/);
    await generateScenarioIndex({ directory });
    const replaced = await readFile(join(directory, "docs/spec/06-delivery/08-scenario-index.md"), "utf8");
    assert.ok(replaced.includes("E2E-PROBE-replacement")); assert.equal(replaced.includes("E2E-PROBE-live-contract"), false);
    await writeFile(join(directory, "scripts/e2e-orphan.mjs"), "console.log('PASS fixture');");
    await assert.rejects(generateScenarioIndex({ directory, check: true }), /Unclassified/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
