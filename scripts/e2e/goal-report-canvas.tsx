import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import type { GoalReport, GoalReportChangedEvent } from "@pi-desktop/shared";
import { GoalReportTab } from "../../apps/desktop/src/components/workpanel/GoalReportTab";
import { api } from "../../apps/desktop/src/lib/api";
import "../../apps/desktop/src/styles/tokens.css";
import "../../apps/desktop/src/styles/base.css";
import "../../apps/desktop/src/styles/messages.css";
import "../../apps/desktop/src/styles/ui-kit.css";
import "../../apps/desktop/src/styles/goal-report.css";

const i18n = createInstance();
const i18nReady = i18n.init({ lng: "zh-CN", resources: { "zh-CN": { translation: catalogs["zh-CN"] } } });
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function until(test: () => boolean, message: string) {
  const deadline = performance.now() + 6000;
  while (!test()) { if (performance.now() >= deadline) throw new Error(message); await frame(); }
  await frame();
}
const steps = ["需求澄清与技术选型", "三视角并行规划", "方案综合与批准", "实现（35 个文件）", "独立验证 + 浏览器 E2E", "三维度代码评审", "批量修复", "Spec 符合性审计 + 最终取证"];
function report(): GoalReport {
  return {
    schemaVersion: 1, reportId: "reference-report", sessionId: "reference-session", executionId: "reference-execution", proposalId: "reference-proposal", turnId: "reference-turn",
    goal: { title: "基础用户管理系统", markdown: "# Approved Goal\nDeliver the user management system." },
    execution: { status: "completed", startedAt: 1000, completedAt: 121000, timingSource: "turn" }, integrity: { kind: "structured" }, verdict: "met",
    deliveryContext: { sourceLabel: "FastAPI + SQLite + JWT", revisionLabel: "工作区 /Users/sakurasep/Documents/Code/Test/测试" },
    summary: "按已批准 Spec 从零构建的分层用户管理 REST API，覆盖全部需求并通过逐项符合性审计。\n\n系统提供用户核心数据模型（ID / 用户名 / 邮箱 / 密码哈希 / 状态 / 时间戳）、注册与登录（JWT）认证、用户增删改查、Pydantic 数据校验与统一错误处理。采用单向分层架构（api → services → models/db → core），密码用 Argon2id 哈希，JWT 显式算法白名单，响应模型白名单确保密码哈希绝不外泄。",
    metrics: [{ label: "单元测试", value: "159 通过", evidenceRefs: ["unit"] }, { label: "覆盖率", value: "93%", evidenceRefs: ["coverage"] }, { label: "Ruff Lint", value: "0 告警", evidenceRefs: ["lint"] }, { label: "API 端点", value: "10 个" }, { label: "浏览器 E2E", value: "11/11", evidenceRefs: ["browser"] }],
    steps: steps.map((title, index) => ({ id: String(index + 1), title, status: "completed", detail: ["确认 FastAPI + SQLite + REST API + JWT，绿地项目", "简洁可维护性 / 性能可扩展性 / 最小改动低风险，三名研究分析师并行探索环境并各自产出完整方案", "以清晰分层为骨架，吸收数据层性能实践与最小风险控制，剔除异步栈/Repository/Alembic 等过度设计", "分层 core / db / models / schemas / services / api，单向依赖"][index] ?? "已记录的研究、验证与修复步骤。" })),
    files: [{ path: "core/config.py", group: "配置与安全", changeType: "created", attribution: "direct", detail: "Settings 与领域异常" }, { path: "services/very_long_user_service_filename_that_must_remain_readable.py", group: "业务逻辑", changeType: "modified", attribution: "subagent", detail: "注册、认证与 CRUD" }],
    checks: [{ id: "unit-check", label: "单元测试", command: "uv run pytest -q", result: "passed", disposition: "executed", exitCode: 0, detail: "159 passed（视觉夹具）", evidenceRefs: ["unit"] }, { id: "not-run", label: "生产部署", command: "deploy --production", result: "inconclusive", disposition: "not_run", detail: "不在本次授权范围内" }],
    criteria: [{ id: "criterion", text: "提供基础用户管理 API", verdict: "met", explanation: "模型说明与记录的验证分开呈现", evidenceRefs: ["unit"] }],
    checkObservations: [{ checkId: "unit-check", result: "passed", evidenceIds: ["unit"], command: "uv run pytest -q", exitCode: 0 }, { checkId: "coverage", result: "passed", evidenceIds: ["coverage"] }, { checkId: "lint", result: "passed", evidenceIds: ["lint"] }, { checkId: "browser", result: "passed", evidenceIds: ["browser"] }],
    evidences: [{ id: "unit", kind: "tool_result", refId: "unit-call", summary: "受控视觉夹具中的记录" }, { id: "unknown", kind: "file", refId: "README.md", summary: "历史记录没有解析结果，不能认定已验证" }],
    evidenceResolution: ["unit", "coverage", "lint", "browser"].map(evidenceId => ({ evidenceId, state: "recorded" })),
    screenshots: [{ id: "screen", evidenceRef: "unit", caption: "完整截图：不得裁切内容" }, { id: "missing-screen", evidenceRef: "unknown", caption: "未提供的截图资产" }],
    assets: [], limitations: ["基础系统的已知边界；不代表已经生产上线。"], nextSteps: ["用户体验并确认交付。"], conclusion: "研究与验证结果已记录，最终验收由用户确认。",
  };
}

const listeners = new Set<(event: GoalReportChangedEvent) => void>();
const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 180;
const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#276c97"; ctx.fillRect(0, 0, 360, 180); ctx.fillStyle = "#ffffff"; ctx.font = "18px sans-serif"; ctx.fillText("FULL EVIDENCE SCREENSHOT", 20, 90);
const png = canvas.toDataURL("image/png").split(",")[1]!;
let current = report();
let failed = false;
let getCount = 0;
let retryCount = 0;
let resolveFirst!: () => void;
const initialRead = new Promise<void>(resolve => { resolveFirst = resolve; });
api.getGoalReport = async (input) => {
  assert(input.sessionId === current.sessionId && input.executionId === current.executionId, "report read loses scoped identity");
  getCount++;
  if (getCount === 1) await initialRead;
  return failed ? { state: "failed", report: null, detail: "Controlled failed read" } : { state: "ready", report: current };
};
api.onGoalReportChanged = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
api.getGoalReportAsset = async (input) => {
  assert(input.sessionId === current.sessionId && input.executionId === current.executionId, "image read loses scoped identity");
  return input.screenshotId === "screen" ? { state: "ready", dataBase64: png, mimeType: "image/png", offset: 0, length: atob(png).length, totalBytes: atob(png).length, eof: true } : { state: "unavailable", detail: "Controlled unavailable asset" };
};
api.retryGoalReport = async () => {
  retryCount++; failed = false;
  return { report: { reportId: current.reportId, sessionId: current.sessionId, executionId: current.executionId, proposalId: current.proposalId, status: "ready", executionStatus: "completed", verdict: current.verdict, integrity: "structured", summary: current.summary, goalTitle: current.goal.title, createdAt: 1000, completedAt: 121000 } };
};
const host = document.createElement("main"); document.body.append(host);
host.style.cssText = "position:fixed;inset:0;display:flex;min-width:0";
const root = createRoot(host);
const mount = () => flushSync(() => root.render(createElement(I18nextProvider, { i18n }, createElement(GoalReportTab, { sessionId: current.sessionId, executionId: current.executionId }))));
const change = () => listeners.forEach(listener => listener({ proposalId: current.proposalId, sessionId: current.sessionId, executionId: current.executionId, reportId: current.reportId, status: "ready", integrity: current.integrity.kind, verdict: current.verdict }));
const query = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const metricValues = () => [...host.querySelectorAll<HTMLElement>(".goal-report-metric-value")];
const errors: string[] = [];
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));

declare global {
  var goalReportCanvasProbe: () => Promise<unknown>;
  var goalReportCanvasSetWidth: (width: number, theme: string) => Promise<unknown>;
  var goalReportCanvasCleanup: () => void;
}
globalThis.goalReportCanvasSetWidth = async (width, theme) => {
  host.style.width = `${width}px`; host.style.right = "auto";
  document.documentElement.setAttribute("data-theme", theme);
  await frame(); await frame();
  const cap = query<HTMLElement>(".goal-report-body-cap")!;
  const grid = query<HTMLElement>(".goal-report-metrics-grid")!;
  const values = metricValues();
  assert(getComputedStyle(query(".goal-report-tab")!).backgroundColor !== "rgba(0, 0, 0, 0)", "report background must resolve in both themes");
  assert(cap.getBoundingClientRect().width <= width + 1, "report extends outside its container");
  assert(values.length === 5 && values.every(value => value.offsetHeight > 0), "all five metrics must be visible");
  assert(!query(".goal-report-more-metrics"), "metrics must not hide behind collapsed details");
  assert(getComputedStyle(values[0]!).fontSize === "18px", "metric value must match Canvas typography");
  assert(getComputedStyle(query<HTMLElement>(".goal-report-section-title")!).fontSize === "18px", "section heading must match Canvas typography");
  assert(getComputedStyle(query<HTMLElement>(".goal-report-section-title")!).fontWeight === "700", "section heading must retain the reference weight");
  assert(getComputedStyle(query<HTMLElement>(".goal-report-table-wrap")!).borderTopStyle === "solid", "table frame must resolve in both themes");
  assert(getComputedStyle(grid).gap === "12px", "metric grid must use the reference gap");
  if (width === 782) assert(values[4]!.getBoundingClientRect().top > values[0]!.getBoundingClientRect().top, "five metrics must form the reference four-plus-one layout");
  assert(query(".goal-report-scroll")!.scrollWidth <= width + 1, "only inner tables may scroll horizontally");
  return { width, theme, columns: getComputedStyle(grid).gridTemplateColumns, background: getComputedStyle(query(".goal-report-tab")!).backgroundColor };
};
globalThis.goalReportCanvasProbe = async () => {
  await i18nReady;
  document.documentElement.setAttribute("data-theme", "dark");
  mount();
  assert(!query('[data-testid="goal-report-tab"]'), "loading must not fabricate a ready report");
  resolveFirst();
  await until(() => !!query('[data-testid="goal-report-tab"]'), "ready report loads");
  await until(() => !!query<HTMLImageElement>(".goal-report-gallery-img")?.naturalWidth, "chunked blob image loads");
  const layouts = [];
  for (const theme of ["dark", "light"]) for (const width of [1040, 782, 320]) layouts.push(await globalThis.goalReportCanvasSetWidth(width, theme));
  const order = [...host.querySelectorAll<HTMLElement>('[data-testid^="goal-report-"]')].map(node => node.dataset.testid);
  assert(order.indexOf("goal-report-summary") < order.indexOf("goal-report-steps") && order.indexOf("goal-report-steps") < order.indexOf("goal-report-files"), "report section order differs from the supplied source");
  assert(query('ol.goal-report-steps-list'), "key steps need a semantic vertical timeline");
  assert(query('[data-testid="goal-report-files"] table') && query('[data-testid="goal-report-evidence"] table'), "delivery and checks need semantic compact tables");
  assert(host.textContent?.includes("业务逻辑") && host.textContent?.includes("生产部署"), "optional v1 grouping and check labels must render");
  const unknown = [...host.querySelectorAll<HTMLElement>(".goal-report-evidence-card")].find(node => node.textContent?.includes("unknown"));
  assert(unknown?.textContent?.includes("未知"), "missing Host resolution must remain unknown");
  const image = query<HTMLImageElement>(".goal-report-gallery-img")!;
  assert(Math.abs(image.getBoundingClientRect().width / image.getBoundingClientRect().height - 2) < 0.05, "evidence screenshot must preserve its complete aspect ratio");
  (query<HTMLButtonElement>(".goal-report-gallery-zoom-btn") ?? image).click();
  await until(() => !!query('[data-testid="goal-report-image-modal"]'), "full screenshot preview opens");
  query<HTMLButtonElement>(".goal-report-image-modal-close")!.click();
  await until(() => !query('[data-testid="goal-report-image-modal"]'), "full screenshot preview closes");
  current = { ...report(), integrity: { kind: "fallback", missingFields: ["checks"] }, verdict: "partial", checkObservations: [{ checkId: "unit-check", result: "failed", exitCode: 1, evidenceIds: ["unit"] }] };
  change();
  await until(() => !!query('[data-testid="goal-report-fallback-notice"]') && !!query(".is-contradiction"), "fallback and Host contradiction remain explicit");
  failed = true; change();
  await until(() => !!query('[data-testid="goal-report-retry-btn"]'), "failed read exposes retry");
  query<HTMLButtonElement>('[data-testid="goal-report-retry-btn"]')!.click();
  await until(() => retryCount === 1 && !!query('[data-testid="goal-report-tab"]'), "retry only reloads the report");
  current = report(); change();
  await until(() => !query('[data-testid="goal-report-fallback-notice"]'), "structured report restored");
  await globalThis.goalReportCanvasSetWidth(782, "dark");
  assert(errors.length === 0, "renderer errors: " + errors.join("; "));
  return { ok: true, layouts, getCount, retryCount, report: "real GoalReportTab reading a bounded v1 visual fixture; no real provider or user profile" };
};
globalThis.goalReportCanvasCleanup = () => root.unmount();
