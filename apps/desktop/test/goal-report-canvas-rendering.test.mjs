import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const MINUTE = 60_000;
const T0 = 1_700_000_000_000;

const report = {
  reportId: "report-1",
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
    const { GoalReportNextStepsList } = await server.ssrLoadModule("/src/components/workpanel/goal-report/GoalReportNextSteps.tsx");
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    const wrap = (node) => renderToStaticMarkup(createElement(I18nextProvider, { i18n }, node));
    const render = (value = report, extra = {}) => wrap(
      createElement(GoalReportDocument, { report: value, assetUrls: {}, assetLoading: {}, assetErrors: {}, onPreview() {}, ...extra }));
    const renderNext = (props) => wrap(createElement(GoalReportNextStepsList, props));
    await work(render, renderNext);
  } finally { await server.close(); }
}

const count = (html, pattern) => (html.match(pattern) ?? []).length;
const hostLineOf = (html) => html.match(/data-testid="goal-report-host-line">([\s\S]*?)<\/ul>/)?.[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "";
const inOrder = (html, testIds) => {
  const positions = testIds.map((id) => html.indexOf(`data-testid="${id}"`));
  return positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));
};

test("first screen is the goal title, the result and the next steps above one closed fold", async () => {
  await withDocument((render) => {
    const html = render();
    assert.match(html, /<h1 class="goal-report-title">Delivery of a user system<\/h1>/);
    assert.match(html, /<article class="goal-report-body-cap" aria-label="Delivery completion report">/);
    assert.ok(inOrder(html, ["goal-report-header", "goal-report-result", "goal-report-next-steps", "goal-report-full"]));
    assert.match(html, /<details class="goal-report-fold is-main" data-testid="goal-report-full">/);
    assert.doesNotMatch(html, /<details[^>]* open/);
    assert.match(html, /Local checkout/);
    assert.match(html, /abc123/);
    // Three metrics before the fold, the rest only inside it.
    assert.equal(count(html, /class="goal-report-key-metric"/g), 3);
    const fold = html.indexOf('data-testid="goal-report-full"');
    assert.ok(html.indexOf("Metric 2") < fold && html.indexOf("Metric 3") > fold);
  });
});

test("the full report keeps every section reachable in reading order, including all eight intact metrics", async () => {
  await withDocument((render) => {
    const html = render();
    assert.ok(inOrder(html, ["goal-report-full", "goal-report-fold-summary", "goal-report-fold-changes", "goal-report-fold-criteria",
      "goal-report-fold-metrics", "goal-report-fold-boundaries", "goal-report-fold-details"]));
    assert.equal(count(html, /class="goal-report-metric"/g), 8);
    assert.match(html, /7\/8 passed/);
    assert.match(html, /<ol class="goal-report-steps-list"/);
    assert.match(html, /<th[^>]*scope="col"/);
    for (const value of ["Service", "User registration", "Unit tests", "Model claim", "The Host observed a failure", "Not deployed", "Review locally", "Pending user acceptance", "Do not hide this explanation"]) {
      assert.ok(html.includes(value), `preserve ${value}`);
    }
    assert.match(html, /<summary class="goal-report-fold-summary">/);
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
    assert.match(hostLineOf(html), /Host disagrees on 1/);
  });
});

test("fallback, interrupted and empty reports retain honest states without manufactured metrics, folds or duration", async () => {
  await withDocument((render) => {
    const html = render({ ...report,
      execution: { status: "interrupted", startedAt: 1000, completedAt: 74000, timingSource: "unavailable" },
      integrity: { kind: "fallback", truncationNotice: "Incomplete history" },
      verdict: "unknown", summary: "", metrics: [], steps: [], files: [], checks: [], criteria: [], evidences: [],
      limitations: [], nextSteps: [], conclusion: undefined, deliveryContext: undefined,
    });
    assert.match(html, /goal-report-fallback-notice/);
    assert.match(html, /Incomplete history/);
    assert.match(html, /class="goal-report-pill status-interrupted"/);
    assert.match(html, /status-interrupted/);
    assert.match(html, /integrity-fallback/);
    assert.match(html, /verdict-unknown/);
    assert.doesNotMatch(html, /goal-report-key-metric|goal-report-metric|goal-report-step-item|goal-report-check-row/);
    assert.doesNotMatch(html, /goal-report-next-steps|goal-report-host-line|goal-report-conclusion-line/);
    assert.doesNotMatch(html, /data-testid="goal-report-fold-(summary|changes|criteria|metrics|boundaries|gallery)"/);
    assert.match(html, /data-testid="goal-report-fold-details"/);
    assert.doesNotMatch(html, /1m 13s|Active/);
    assert.doesNotMatch(html, /Self-reported by the model/);
  });
});

test("gallery retains full assets, readable captions, localized controls and loading/error states inside its fold", async () => {
  await withDocument((render) => {
    const screenshots = ["ready", "loading", "error", "absent"].map((id) => ({ id, evidenceRef: `ev-${id}`, caption: `Caption ${id}` }));
    const html = render({ ...report, screenshots }, {
      assetUrls: { ready: "blob:fixture-image" }, assetLoading: { loading: true }, assetErrors: { error: "Internal detail" },
    });
    assert.ok(inOrder(html, ["goal-report-fold-details", "goal-report-fold-gallery"]));
    assert.match(html, /src="blob:fixture-image"/);
    assert.match(html, /alt="Caption ready"/);
    assert.match(html, /aria-label="View image"/);
    assert.match(html, /Loading asset/);
    assert.match(html, /Asset unavailable/);
    assert.match(html, /Asset was not captured/);
    assert.doesNotMatch(html, /Internal detail/);
    assert.equal(count(html, /<figure/g), 4);
  });
});

test("metric success requires linked Host evidence and unresolved evidence stays distinct from unknown", async () => {
  await withDocument((render) => {
    const html = render({ ...report,
      checkObservations: [{ checkId: "check", result: "passed", evidenceIds: ["ev-pass"] }],
      evidenceResolution: [{ evidenceId: "ev-pass", state: "recorded" }, { evidenceId: "ev-missing", state: "unresolved", detail: "No owning record" }],
    });
    assert.equal(count(html, /class="goal-report-metric" data-tone="success"/g), 1);
    assert.equal(count(html, /class="goal-report-metric" data-tone="neutral"/g), 7);
    assert.equal(count(html, /class="goal-report-key-metric" data-tone="success"/g), 1);
    assert.equal(count(html, /class="goal-report-key-metric" data-tone="neutral"/g), 2);
    assert.match(html, /data-resolution="unresolved"/);
    assert.match(html, /No owning record/);
    assert.doesNotMatch(html, /data-resolution="unknown"|res-recorded/);
    const notObserved = render({ ...report, checkObservations: [] });
    assert.equal(count(notObserved, /class="goal-report-metric" data-tone="neutral"/g), 8);
    assert.match(notObserved, /Not observed by host/);
    assert.match(hostLineOf(notObserved), /Host did not observe the checks/);
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

test("duration is the active working time across a wait, never the wall-clock span", async () => {
  await withDocument((render) => {
    // Two turns of 20 and 6 minutes separated by a 2h 40m wait for the user.
    const resumedAt = T0 + 3 * 60 * MINUTE;
    const html = render({ ...report,
      execution: { status: "completed", startedAt: T0, completedAt: resumedAt + 6 * MINUTE, timingSource: "turn" },
      segments: [
        { turnId: "turn-1", startedAt: T0, endedAt: T0 + 20 * MINUTE },
        { turnId: "turn-2", startedAt: resumedAt },
      ],
      blocks: [{ at: T0 + 20 * MINUTE, reasons: [{ code: "verdict_partial" }] }],
    });
    assert.match(hostLineOf(html), /Active 26m/);
    assert.doesNotMatch(hostLineOf(html), /3h 06m/);
    assert.doesNotMatch(html, /goal-report-badge time/);
    assert.match(hostLineOf(html), /Blocked 1×, then continued/);
    // The wait is explained where the execution record lives, not passed off as work.
    assert.match(html, /Total 3h 06m · active 26m · waiting 2h 40m/);
  });
});

test("a report without segments falls back to the wall-clock span and an unavailable timing source shows none", async () => {
  await withDocument((render) => {
    const bare = { ...report, segments: undefined, blocks: undefined };
    assert.match(hostLineOf(render({ ...bare, execution: { status: "completed", startedAt: T0, completedAt: T0 + 90_000, timingSource: "turn" } })), /Active 1m 30s/);
    assert.doesNotMatch(hostLineOf(render({ ...bare, execution: { status: "completed", startedAt: T0, completedAt: T0 + 90_000, timingSource: "unavailable" } })), /Active/);
  });
});

test("the verdict reads as self-reported only for structured reports and notices lead for the others", async () => {
  await withDocument((render) => {
    const structured = render();
    assert.match(structured, /Self-reported by the model/);
    assert.match(structured, /class="goal-report-pill verdict-partial"/);
    assert.doesNotMatch(structured, /goal-report-fallback-notice|goal-report-user-accepted-notice/);
    const fallback = render({ ...report, integrity: { kind: "fallback" } });
    assert.match(fallback, /goal-report-fallback-notice/);
    assert.doesNotMatch(fallback, /Self-reported by the model/);
    const accepted = render({ ...report, closure: "user_accepted", blocks: [{ at: T0, reasons: [{ code: "verdict_partial" }] }] });
    assert.match(accepted, /goal-report-user-accepted-notice/);
    assert.doesNotMatch(accepted, /Self-reported by the model/);
    assert.match(hostLineOf(accepted), /Blocked 1×/);
    assert.doesNotMatch(hostLineOf(accepted), /then continued/);
  });
});

test("a conclusion is shown only when the report carries one and long metric values keep their full text", async () => {
  await withDocument((render) => {
    assert.match(render(), /<p class="goal-report-conclusion-line">Pending user acceptance<\/p>/);
    assert.doesNotMatch(render({ ...report, conclusion: undefined }), /goal-report-conclusion-line/);
    const long = "a very long measured value that must stay readable in the metric tooltip and the full report";
    const html = render({ ...report, metrics: [{ label: "Latency", value: long }] });
    assert.equal(count(html, new RegExp(long, "g")), 3); // title attribute, clamped cell, full-report metric
  });
});

test("next steps preview three rows, reveal the rest on demand and point at the limitations", async () => {
  await withDocument((render, renderNext) => {
    const steps = ["Review locally", "Run the migration", "Rotate the key", "Archive the logs", "Tag the release"];
    const common = { steps, limitations: 2, openRows: new Set(), onToggleAll() {}, onToggleRow() {} };
    const collapsed = renderNext({ ...common, showAll: false });
    assert.equal(count(collapsed, /class="goal-report-next-row"/g), 3);
    assert.match(collapsed, /aria-expanded="false"><span class="is-clamped">Review locally<\/span>/);
    assert.doesNotMatch(collapsed, /Archive the logs|Tag the release/);
    assert.match(collapsed, /5 suggestions/);
    assert.match(collapsed, /<button type="button" class="goal-report-link-btn" aria-expanded="false">Show 2 more<\/button>/);
    assert.match(collapsed, /2 known limitations are in the full report/);

    const expanded = renderNext({ ...common, showAll: true, openRows: new Set([1]) });
    assert.equal(count(expanded, /class="goal-report-next-row"/g), 5);
    assert.match(expanded, /aria-expanded="true"><span>Run the migration<\/span>/);
    assert.match(expanded, /aria-expanded="true">Show fewer<\/button>/);

    // Up to three steps need no reveal control; a lone limitation reads in the singular.
    const few = renderNext({ ...common, steps: steps.slice(0, 2), limitations: 1, showAll: false });
    assert.doesNotMatch(few, /goal-report-link-btn/);
    assert.match(few, /1 known limitation is in the full report/);
    assert.doesNotMatch(renderNext({ ...common, steps: steps.slice(0, 2), limitations: 0, showAll: false }), /known limitation/);

    // The document wires the same block, and omits it when the model suggested nothing.
    assert.match(render({ ...report, nextSteps: steps }), /Show 2 more/);
    const none = render({ ...report, nextSteps: [] });
    assert.doesNotMatch(none, /data-testid="goal-report-next-steps"/);
    assert.match(hostLineOf(none), /1 known limitation is in the full report/);
    assert.doesNotMatch(hostLineOf(render()), /known limitation/);
  });
});

test("an unresolved file reference is neutral while other unresolved or unknown evidence keeps its warning", async () => {
  await withDocument((render) => {
    const evidences = [
      { id: "f1", kind: "file", refId: "src/a.ts", summary: "A file reference" },
      { id: "t1", kind: "tool_result", refId: "call-1", summary: "A tool result" },
      { id: "f2", kind: "file", refId: "src/b.ts", summary: "Never resolved by the Host" },
    ];
    const html = render({ ...report, evidences, evidenceResolution: [
      { evidenceId: "f1", state: "unresolved", detail: "Not found in recorded history" },
      { evidenceId: "t1", state: "unresolved", detail: "No owning record" },
    ] });
    const card = (id) => html.match(new RegExp(`<article[^>]*data-resolution="[a-z]+"[^>]*>(?:(?!</article>)[\\s\\S])*?#${id}[\\s\\S]*?</article>`))?.[0] ?? "";
    assert.match(card("f1"), /goal-report-evidence-card res-untracked" data-resolution="unresolved"/);
    assert.match(card("f1"), /File reference · not checked by the host/);
    assert.doesNotMatch(card("f1"), /res-unresolved|Evidence unresolved/);
    assert.match(card("t1"), /res-unresolved/);
    assert.match(card("t1"), /Evidence unresolved/);
    // No resolution at all is still unknown, even for a file.
    assert.match(card("f2"), /data-resolution="unknown"/);
    assert.match(card("f2"), /Evidence resolution unknown/);
  });
});
