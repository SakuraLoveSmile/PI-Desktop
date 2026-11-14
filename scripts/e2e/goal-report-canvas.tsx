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
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = 1_700_000_000_000;
const steps = ["需求澄清与技术选型", "三视角并行规划", "方案综合与批准", "实现（35 个文件）", "独立验证 + 浏览器 E2E", "三维度代码评审", "批量修复", "Spec 符合性审计 + 最终取证"];
// Two turns of 20 and 6 minutes with a 2h40m wait for the user between them: 26 minutes of work in a 3h06m span.
function report(): GoalReport {
  const resumedAt = T0 + 3 * HOUR;
  return {
    schemaVersion: 2, reportId: "reference-report", sessionId: "reference-session", executionId: "reference-execution", proposalId: "reference-proposal", turnId: "reference-turn",
    goal: { title: "基础用户管理系统", markdown: "# Approved Goal\nDeliver the user management system." },
    execution: { status: "completed", startedAt: T0, completedAt: resumedAt + 6 * MINUTE, timingSource: "turn" }, integrity: { kind: "structured" }, verdict: "met", closure: "agent_verified",
    segments: [{ turnId: "turn-1", startedAt: T0, endedAt: T0 + 20 * MINUTE }, { turnId: "turn-2", startedAt: resumedAt }],
    blocks: [{ at: T0 + 20 * MINUTE, reasons: [{ code: "verdict_partial" }] }],
    deliveryContext: { sourceLabel: "FastAPI + SQLite + JWT", revisionLabel: "工作区 /workspace/example-project" },
    summary: "按已批准 Spec 从零构建的分层用户管理 REST API，覆盖全部需求并通过逐项符合性审计。\n\n系统提供用户核心数据模型（ID / 用户名 / 邮箱 / 密码哈希 / 状态 / 时间戳）、注册与登录（JWT）认证、用户增删改查、Pydantic 数据校验与统一错误处理。采用单向分层架构（api → services → models/db → core），密码用 Argon2id 哈希，JWT 显式算法白名单，响应模型白名单确保密码哈希绝不外泄。",
    metrics: [{ label: "单元测试", value: "159 通过", evidenceRefs: ["unit"] }, { label: "覆盖率", value: "93%", evidenceRefs: ["coverage"] }, { label: "Ruff Lint", value: "0 告警", evidenceRefs: ["lint"] }, { label: "API 端点", value: "10 个" }, { label: "浏览器 E2E", value: "11/11", evidenceRefs: ["browser"] }],
    steps: steps.map((title, index) => ({ id: String(index + 1), title, status: "completed", detail: ["确认 FastAPI + SQLite + REST API + JWT，绿地项目", "简洁可维护性 / 性能可扩展性 / 最小改动低风险，三名研究分析师并行探索环境并各自产出完整方案", "以清晰分层为骨架，吸收数据层性能实践与最小风险控制，剔除异步栈/Repository/Alembic 等过度设计", "分层 core / db / models / schemas / services / api，单向依赖"][index] ?? "已记录的研究、验证与修复步骤。" })),
    files: [{ path: "core/config.py", group: "配置与安全", changeType: "created", attribution: "direct", detail: "Settings 与领域异常" }, { path: "services/very_long_user_service_filename_that_must_remain_readable.py", group: "业务逻辑", changeType: "modified", attribution: "subagent", detail: "注册、认证与 CRUD" }],
    checks: [{ id: "unit-check", label: "单元测试", command: "uv run pytest -q", result: "passed", disposition: "executed", exitCode: 0, detail: "159 passed（视觉夹具）", evidenceRefs: ["unit"] }, { id: "not-run", label: "生产部署", command: "deploy --production", result: "inconclusive", disposition: "not_run", detail: "不在本次授权范围内" }],
    criteria: [{ id: "criterion", text: "提供基础用户管理 API", verdict: "met", explanation: "模型说明与记录的验证分开呈现", evidenceRefs: ["unit"] }],
    checkObservations: [{ checkId: "unit-check", result: "passed", evidenceIds: ["unit"], command: "uv run pytest -q", exitCode: 0 }, { checkId: "coverage", result: "passed", evidenceIds: ["coverage"] }, { checkId: "lint", result: "passed", evidenceIds: ["lint"] }, { checkId: "browser", result: "passed", evidenceIds: ["browser"] }],
    evidences: [
      { id: "unit", kind: "tool_result", refId: "unit-call", summary: "受控视觉夹具中的记录" },
      { id: "unknown", kind: "file", refId: "README.md", summary: "历史记录没有解析结果，不能认定已验证" },
      { id: "file-ref", kind: "file", refId: "src/main.py", summary: "文件引用，主机没有可核对的记录库" },
      { id: "tool-gone", kind: "tool_result", refId: "call-gone", summary: "找不到记录的工具结果" },
    ],
    evidenceResolution: [...["unit", "coverage", "lint", "browser"].map(evidenceId => ({ evidenceId, state: "recorded" as const })), { evidenceId: "file-ref", state: "unresolved" as const, detail: "Evidence reference was not found in recorded session history." }, { evidenceId: "tool-gone", state: "unresolved" as const, detail: "Evidence reference was not found in recorded session history." }],
    screenshots: [{ id: "screen", evidenceRef: "unit", caption: "完整截图：不得裁切内容" }, { id: "missing-screen", evidenceRef: "unknown", caption: "未提供的截图资产" }],
    assets: [], limitations: ["基础系统的已知边界；不代表已经生产上线。"],
    nextSteps: ["用户体验并确认交付：重点核对注册、登录、改密三条主流程，并在测试环境用真实邮箱域名各走一遍，确认错误提示、限流和密码强度规则都符合预期后再回复验收结论。", "补充生产环境的部署配置与回滚预案", "为登录接口增加速率限制", "评估是否需要邮箱验证流程", "把密码强度规则写进项目约定"],
    conclusion: "研究与验证结果已记录，最终验收由用户确认。",
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
const queryAll = <T extends Element = HTMLElement>(selector: string) => [...host.querySelectorAll<T>(selector)];
const fullFold = () => query<HTMLDetailsElement>('[data-testid="goal-report-full"]')!;
const keyMetrics = () => queryAll(".goal-report-key-metric");
const nextRows = () => queryAll<HTMLButtonElement>(".goal-report-next-row");
const errors: string[] = [];
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));

// WCAG contrast of a node's text against the nearest opaque surface; hex-based report inks only.
const channels = (value: string) => {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const [r, g, b, a] = match[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
  return { r: r!, g: g!, b: b!, a: a ?? 1 };
};
const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const linear = (channel: number) => { const unit = channel / 255; return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const contrast = (node: Element) => {
  const ink = channels(getComputedStyle(node).color);
  assert(ink, "contrast probe needs an rgb text colour");
  let surface = { r: 255, g: 255, b: 255, a: 1 };
  for (let el: Element | null = node; el; el = el.parentElement) {
    const candidate = channels(getComputedStyle(el).backgroundColor);
    if (candidate && candidate.a > 0.99) { surface = candidate; break; }
  }
  const [bright, dark] = [luminance(ink), luminance(surface)].sort((left, right) => right - left);
  return (bright! + 0.05) / (dark! + 0.05);
};
const setFolds = async (open: boolean) => {
  const folds = queryAll<HTMLDetailsElement>("details.goal-report-fold");
  for (const fold of open ? folds : [...folds].reverse()) {
    if (fold.open !== open) fold.querySelector<HTMLElement>(":scope > summary")!.click();
    assert(fold.open === open, "a fold must follow its summary");
  }
  await frame();
};

declare global {
  var goalReportCanvasProbe: () => Promise<unknown>;
  var goalReportCanvasSetWidth: (width: number, theme: string) => Promise<unknown>;
  var goalReportCanvasSetFolds: (open: boolean) => Promise<void>;
  var goalReportCanvasCleanup: () => void;
}
globalThis.goalReportCanvasSetFolds = setFolds;
globalThis.goalReportCanvasSetWidth = async (width, theme) => {
  host.style.width = `${width}px`; host.style.right = "auto";
  document.documentElement.setAttribute("data-theme", theme);
  await frame(); await frame();
  const cap = query<HTMLElement>(".goal-report-body-cap")!;
  const open = fullFold().open;
  assert(getComputedStyle(query(".goal-report-tab")!).backgroundColor !== "rgba(0, 0, 0, 0)", "report background must resolve in both themes");
  assert(cap.getBoundingClientRect().width <= width + 1, "report extends outside its container");
  assert(query(".goal-report-scroll")!.scrollWidth <= width + 1, "only inner tables may scroll horizontally");
  const metrics = keyMetrics();
  assert(metrics.length === 3 && metrics.every(metric => metric.offsetHeight > 0), "the first screen shows exactly three metrics");
  const title = getComputedStyle(query(".goal-report-title")!);
  assert(title.fontSize === "16px" && title.fontWeight === "590", "goal title must use the report title type");
  const blockTitle = getComputedStyle(query(".goal-report-block-title")!);
  assert(blockTitle.fontSize === "12px" && blockTitle.fontWeight === "590", "block heading must use the report block type");
  const value = getComputedStyle(metrics[0]!.querySelector("dd")!);
  assert(value.fontSize === "15px" && value.whiteSpace === "nowrap" && value.textOverflow === "ellipsis", "first-screen metric values stay on one line");
  assert(getComputedStyle(metrics[0]!).display === (width >= 600 ? "grid" : "block"), "metric rows switch to label-and-value rows only on a wide panel");
  assert(getComputedStyle(query(".goal-report-key-metrics")!).borderTopLeftRadius === "8px", "metric tiles use the callout radius");
  if (open) assert(getComputedStyle(query<HTMLElement>(".goal-report-table-wrap")!).borderTopStyle === "solid", "table frame must resolve in both themes");
  else {
    const shown = queryAll(".goal-report-metric, .goal-report-table-wrap, .goal-report-steps-list").filter(node => node.checkVisibility());
    assert(shown.length === 0, `folded content must not be rendered: ${shown.map(node => `${node.className}:${node.offsetHeight}`).join(", ")}`);
    const foldTop = Math.round(fullFold().getBoundingClientRect().top - cap.getBoundingClientRect().top);
    if (width <= 400) assert(foldTop < 760, `the full-report fold must stay on the first screen (top ${foldTop}px at ${width}px)`);
  }
  const pill = contrast(query(".goal-report-pill.verdict-met")!);
  const warn = contrast(query('.goal-report-host-line li[data-tone="warn"]')!);
  assert(pill >= 4.5 && warn >= 4.5, `status inks need 4.5:1 contrast (pill ${pill.toFixed(2)}, warning ${warn.toFixed(2)}) in ${theme}`);
  return { width, theme, open, rows: getComputedStyle(metrics[0]!).display, pill: Number(pill.toFixed(2)), warn: Number(warn.toFixed(2)), background: getComputedStyle(query(".goal-report-tab")!).backgroundColor };
};
globalThis.goalReportCanvasProbe = async () => {
  await i18nReady;
  document.documentElement.setAttribute("data-theme", "dark");
  mount();
  assert(!query('[data-testid="goal-report-tab"]'), "loading must not fabricate a ready report");
  resolveFirst();
  await until(() => !!query('[data-testid="goal-report-tab"]'), "ready report loads");
  await until(() => !!query<HTMLImageElement>(".goal-report-gallery-img")?.naturalWidth, "chunked blob image loads");
  assert(queryAll<HTMLDetailsElement>("details.goal-report-fold").every(fold => !fold.open), "every fold starts closed");
  assert(query("h1.goal-report-title")?.textContent === "基础用户管理系统", "the first screen is titled with the goal");
  const result = query('[data-testid="goal-report-result"]')!.textContent ?? "";
  assert(result.includes("已达成") && result.includes("模型自述") && result.includes("159 通过") && result.includes("研究与验证结果已记录"), "result block states the verdict, the model's own note, the metrics and the conclusion");
  assert(!result.includes("API 端点"), "only three metrics may reach the first screen");
  const hostLine = query('[data-testid="goal-report-host-line"]')!.textContent ?? "";
  assert(hostLine.includes("活跃 26m") && hostLine.includes("受阻 1 次后继续") && !hostLine.includes("3h 06m"), "duration is active time, not the wall-clock span: " + hostLine);
  assert(hostLine.includes("1 项未运行") && hostLine.includes("主机核验 1/1"), "host line separates what never ran from what the Host verified: " + hostLine);
  assert(!query(".goal-report-badge.time"), "the wall-clock duration badge is gone");
  const layouts = [];
  for (const theme of ["dark", "light"]) for (const width of [1040, 782, 320]) layouts.push(await globalThis.goalReportCanvasSetWidth(width, theme));

  // Next steps: a long step clamps to two lines and opens on click; the rest appears on demand.
  await globalThis.goalReportCanvasSetWidth(320, "dark");
  assert(nextRows().length === 3, "next steps preview shows three rows");
  const firstText = nextRows()[0]!.querySelector<HTMLElement>("span")!;
  assert(firstText.classList.contains("is-clamped") && firstText.scrollHeight > firstText.clientHeight + 1, "a long next step is clamped to two lines");
  const clampedHeight = firstText.getBoundingClientRect().height;
  nextRows()[0]!.click(); await frame();
  assert(nextRows()[0]!.getAttribute("aria-expanded") === "true" && nextRows()[0]!.querySelector<HTMLElement>("span")!.getBoundingClientRect().height > clampedHeight + 4, "clicking a row shows the whole step");
  const more = query<HTMLButtonElement>(".goal-report-link-btn")!;
  assert(more.textContent === "另有 2 条" && more.getAttribute("aria-expanded") === "false", "a reveal control counts the hidden steps");
  more.click(); await frame();
  assert(nextRows().length === 5 && more.getAttribute("aria-expanded") === "true" && more.textContent === "收起", "the remaining steps appear inline");
  more.click(); await frame();
  assert(nextRows().length === 3, "show fewer returns to the preview");
  assert(query(".goal-report-next-note")?.textContent === "已知限制 1 条，在完整报告里", "the limitations are pointed at, not listed");

  // Folds: closed by default, native toggling, reading order inside.
  fullFold().querySelector<HTMLElement>(":scope > summary")!.click(); await frame();
  assert(fullFold().open, "the full-report summary opens the fold");
  await setFolds(true);
  const ids = ["goal-report-header", "goal-report-result", "goal-report-next-steps", "goal-report-full", "goal-report-fold-summary", "goal-report-fold-changes", "goal-report-fold-criteria", "goal-report-fold-metrics", "goal-report-fold-boundaries", "goal-report-fold-details", "goal-report-fold-gallery"];
  const nodes = ids.map(id => query(`[data-testid="${id}"]`));
  assert(nodes.every((node, index) => node && (index === 0 || nodes[index - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)), "report section order: result, next steps, then the full-report folds");
  assert(queryAll(".goal-report-metric").length === 5 && query('[data-testid="goal-report-fold-metrics"]')?.querySelector(".goal-report-metric-value")?.textContent === "159 通过", "the metrics fold lists all five metrics, including the three above");
  assert(query('ol.goal-report-steps-list'), "key steps need a semantic vertical timeline");
  assert(query('[data-testid="goal-report-files"] table') && query('[data-testid="goal-report-checks"] table'), "delivery and checks need semantic compact tables");
  assert(host.textContent?.includes("业务逻辑") && host.textContent?.includes("生产部署"), "optional v1 grouping and check labels must render");
  const record = query('[data-testid="goal-report-execution-timeline"]')!.textContent ?? "";
  assert(record.includes("共 3h 06m · 活跃 26m · 等待 2h 40m"), "the wait is explained in the execution record: " + record);
  const card = (id: string) => queryAll(".goal-report-evidence-card").find(node => node.textContent?.includes(`#${id}`))!;
  assert(card("unknown").textContent?.includes("未知"), "missing Host resolution must remain unknown");
  assert(card("file-ref").classList.contains("res-untracked") && card("file-ref").textContent?.includes("文件引用 · 主机不核验") && card("file-ref").dataset.resolution === "unresolved", "an unresolved file reference is shown neutrally");
  assert(card("tool-gone").classList.contains("res-unresolved") && card("tool-gone").textContent?.includes("证据尚未解决"), "an unresolved tool result keeps its warning");
  const badgeInk = (id: string) => getComputedStyle(card(id).querySelector(".goal-report-evidence-res-badge")!).color;
  assert(badgeInk("file-ref") !== badgeInk("tool-gone"), "neutral and warning badges must differ");
  for (const theme of ["dark", "light"]) for (const width of [782, 320]) layouts.push(await globalThis.goalReportCanvasSetWidth(width, theme));
  const image = query<HTMLImageElement>(".goal-report-gallery-img")!;
  assert(Math.abs(image.getBoundingClientRect().width / image.getBoundingClientRect().height - 2) < 0.05, "evidence screenshot must preserve its complete aspect ratio");
  (query<HTMLButtonElement>(".goal-report-gallery-zoom-btn") ?? image).click();
  await until(() => !!query('[data-testid="goal-report-image-modal"]'), "full screenshot preview opens");
  query<HTMLButtonElement>(".goal-report-image-modal-close")!.click();
  await until(() => !query('[data-testid="goal-report-image-modal"]'), "full screenshot preview closes");

  current = { ...report(), integrity: { kind: "fallback", missingFields: ["checks"] }, verdict: "partial", checkObservations: [{ checkId: "unit-check", result: "failed", exitCode: 1, evidenceIds: ["unit"] }] };
  change();
  await until(() => !!query('[data-testid="goal-report-fallback-notice"]') && !!query(".is-contradiction"), "fallback and Host contradiction remain explicit");
  assert(!(query('[data-testid="goal-report-result"]')?.textContent ?? "").includes("模型自述"), "a fallback report is not presented as the model's own assessment");
  assert((query('[data-testid="goal-report-host-line"]')?.textContent ?? "").includes("与主机不一致"), "a Host conflict reaches the first screen");
  assert(contrast(query(".goal-report-pill.verdict-partial")!) >= 4.5, "the warning pill keeps 4.5:1 contrast");
  failed = true; change();
  await until(() => !!query('[data-testid="goal-report-retry-btn"]'), "failed read exposes retry");
  query<HTMLButtonElement>('[data-testid="goal-report-retry-btn"]')!.click();
  await until(() => retryCount === 1 && !!query('[data-testid="goal-report-tab"]'), "retry only reloads the report");
  current = report(); change();
  await until(() => !query('[data-testid="goal-report-fallback-notice"]'), "structured report restored");
  await setFolds(false);
  await globalThis.goalReportCanvasSetWidth(782, "dark");
  assert(errors.length === 0, "renderer errors: " + errors.join("; "));
  return { ok: true, layouts, getCount, retryCount, report: "real GoalReportTab reading a bounded v2 visual fixture; no real provider or user profile" };
};
globalThis.goalReportCanvasCleanup = () => root.unmount();
