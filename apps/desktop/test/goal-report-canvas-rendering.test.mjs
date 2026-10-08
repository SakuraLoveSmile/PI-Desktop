import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const report = {
  goal: { title: "Delivery of a user system", contractPath: "spec/user-system.md" },
  execution: { status: "completed", startedAt: 1000, completedAt: 74000, timingSource: "turn" },
  integrity: { kind: "structured" },
  verdict: "partial",
  summary: "A **real** layered service with `SQLite`.",
  deliveryContext: { sourceLabel: "Local checkout", targetVersion: "0.15.7", revisionLabel: "abc123" },
  metrics: Array.from({ length: 8 }, (_, index) => ({
    label: `Metric ${index}`, value: `${index}/8 passed`, evidenceRefs: [index === 0 ? "ev-pass" : "ev-missing"],
  })),
  steps: [{ id: "step", title: "Build the service", status: "completed", detail: "Do not hide this explanation" }],
  files: [{ path: "app/services/users.py", group: "Service", changeType: "created", attribution: "subagent", detail: "User registration" }],
  criteria: [{ id: "criterion", text: "A functioning API", verdict: "partial", evidenceRefs: ["ev-pass"] }],
  checks: [{ id: "check", label: "Unit tests", command: "pytest -q", result: "passed", exitCode: 0, disposition: "executed", detail: "Model claim", evidenceRefs: ["ev-pass"] }],
  checkObservations: [{ checkId: "check", result: "failed", command: "pytest -q", exitCode: 1, evidenceIds: ["ev-pass"], detail: "The Host observed a failure" }],
  evidences: [{ id: "ev-missing", kind: "tool_result", refId: "call-1", summary: "An unconfirmed reference" }],
  evidenceResolution: [],
  screenshots: [],
  limitations: ["Not deployed"], nextSteps: ["Review locally"], conclusion: "Pending user acceptance",
};

async function withDocument(work) {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { GoalReportDocument } = await server.ssrLoadModule("/src/components/workpanel/goal-report/GoalReportDocument.tsx");
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const render = (value = report, extra = {}) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
      createElement(GoalReportDocument, { report: value, assetUrls: {}, assetLoading: {}, assetErrors: {}, onPreview() {}, ...extra })));
    await work(render);
  } finally { await server.close(); }
}

test("completion document exposes all eight intact metrics without a hidden overflow group", async () => {
  await withDocument((render) => {
    const html = render();
    assert.equal((html.match(/class="goal-report-metric-value"/g) ?? []).length, 8);
    assert.doesNotMatch(html, /<details/);
    assert.match(html, /7\/8 passed/);
    assert.match(html, /Local checkout/);
    assert.match(html, /abc123/);
  });
});

test("document follows the report reading sequence with a timeline and semantic file/check tables", async () => {
  await withDocument((render) => {
    const html = render();
    assert.match(html, /<ol class="goal-report-steps-list"/);
    assert.match(html, /<th[^>]*scope="col"/);
    for (const value of ["Service", "User registration", "Unit tests", "Model claim", "The Host observed a failure", "Not deployed", "Review locally", "Pending user acceptance"]) {
      assert.ok(html.includes(value), `preserve ${value}`);
    }
    const sections = ["header", "summary", "steps", "files", "evidence", "conclusion"];
    const positions = sections.map((section) => html.indexOf(`data-testid="goal-report-${section}"`));
    assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])));
  });
});

test("missing Host resolution remains unknown and a contradictory Host check never becomes success", async () => {
  await withDocument((render) => {
    const html = render();
    assert.match(html, /data-resolution="unknown"/);
    assert.doesNotMatch(html, /res-recorded/);
    assert.match(html, /is-contradiction/);
    assert.match(html, /data-tone="error"/);
    assert.match(html, /data-tone="neutral"/);
  });
});

test("fallback, interrupted and empty reports retain honest states without manufactured metrics or duration", async () => {
  await withDocument((render) => {
    const html = render({ ...report,
      execution: { status: "interrupted", startedAt: 1000, completedAt: 74000, timingSource: "unavailable" },
      integrity: { kind: "fallback", truncationNotice: "Incomplete history" },
      verdict: "unknown", summary: "", metrics: [], steps: [], files: [], checks: [], criteria: [], evidences: [],
      limitations: [], nextSteps: [], deliveryContext: undefined,
    });
    assert.match(html, /goal-report-fallback-notice/);
    assert.match(html, /Incomplete history/);
    assert.match(html, /status-interrupted/);
    assert.match(html, /integrity-fallback/);
    assert.match(html, /verdict-unknown/);
    assert.doesNotMatch(html, /goal-report-metric-value|goal-report-step-item|goal-report-check-row/);
    assert.doesNotMatch(html, /1m 13s/);
  });
});

test("gallery retains full assets, readable captions, localized controls and loading/error states", async () => {
  await withDocument((render) => {
    const screenshots = ["ready", "loading", "error", "absent"].map((id) => ({ id, evidenceRef: `ev-${id}`, caption: `Caption ${id}` }));
    const html = render({ ...report, screenshots }, {
      assetUrls: { ready: "blob:fixture-image" }, assetLoading: { loading: true }, assetErrors: { error: "Internal detail" },
    });
    assert.match(html, /src="blob:fixture-image"/);
    assert.match(html, /alt="Caption ready"/);
    assert.match(html, /aria-label="View image"/);
    assert.match(html, /Loading asset/);
    assert.match(html, /Asset unavailable/);
    assert.match(html, /Asset was not captured/);
    assert.doesNotMatch(html, /Internal detail/);
    assert.equal((html.match(/<figure/g) ?? []).length, 4);
  });
});

test("metric success requires linked Host evidence and unresolved evidence stays distinct from unknown", async () => {
  await withDocument((render) => {
    const html = render({ ...report,
      checkObservations: [{ checkId: "check", result: "passed", evidenceIds: ["ev-pass"] }],
      evidenceResolution: [{ evidenceId: "ev-pass", state: "recorded" }, { evidenceId: "ev-missing", state: "unresolved", detail: "No owning record" }],
    });
    assert.equal((html.match(/data-tone="success"/g) ?? []).length, 1);
    assert.equal((html.match(/data-tone="neutral"/g) ?? []).length, 7);
    assert.match(html, /data-resolution="unresolved"/);
    assert.match(html, /No owning record/);
    assert.doesNotMatch(html, /data-resolution="unknown"|res-recorded/);
    const notObserved = render({ ...report, checkObservations: [] });
    assert.equal((notObserved.match(/data-tone="neutral"/g) ?? []).length, 8);
    assert.match(notObserved, /Not observed by host/);
  });
});

test("passed Host checks do not promote unresolved metric references to success", async () => {
  await withDocument((render) => {
    const mixedEvidence = {
      ...report,
      metrics: [{ label: "Tests", value: "159 passed", evidenceRefs: ["ev-bogus"] }],
      checkObservations: [{ checkId: "check", result: "passed", evidenceIds: ["ev-real", "ev-bogus"] }],
      evidenceResolution: [{ evidenceId: "ev-real", state: "recorded" }, { evidenceId: "ev-bogus", state: "unresolved" }],
    };
    assert.match(render(mixedEvidence), /data-tone="neutral"/);
    assert.doesNotMatch(render(mixedEvidence), /data-tone="success"/);
    // A partly resolved metric and legacy missing resolutions are also neutral.
    assert.match(render({ ...mixedEvidence, metrics: [{ ...mixedEvidence.metrics[0], evidenceRefs: ["ev-real", "ev-bogus"] }] }), /data-tone="neutral"/);
    assert.match(render({ ...mixedEvidence, evidenceResolution: [] }), /data-tone="neutral"/);
  });
});
