import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadCatalog, root } from "./e2e-suite-runtime.mjs";

const require = createRequire(new URL("../packages/agent-runtime/package.json", import.meta.url));
const ts = require("typescript");
const idPattern = /\bE2E-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g;
const recordedCalls = new Set(["record", "pass", "test", "it", "withScenario", "runScenario", "scenario", "check"]);

/** Extract ids from executable call arguments, never Markdown or source comments. */
export function extractScenarioIds(source, filename = "fixture.ts") {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true,
    extname(filename) === ".tsx" || extname(filename) === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const constants = new Map();
  function literal(node) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) return constants.get(node.text);
    if (ts.isParenthesizedExpression(node)) return literal(node.expression);
    return undefined;
  }
  function findConstants(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = literal(node.initializer);
      if (value !== undefined) constants.set(node.name.text, value);
    }
    ts.forEachChild(node, findConstants);
  }
  findConstants(tree);
  const found = new Map();
  function add(value, node) {
    if (!value) return;
    for (const id of value.match(idPattern) ?? []) {
      if (id.endsWith("-")) continue;
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      if (!found.has(id)) found.set(id, line);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (recordedCalls.has(name)) for (const arg of node.arguments.slice(0, 2)) add(literal(arg), arg);
      // A static PASS log is a result marker, unlike arbitrary source strings.
      if (ts.isPropertyAccessExpression(callee) && callee.expression.getText(tree) === "console" && name === "log") {
        const value = node.arguments[0] && literal(node.arguments[0]);
        if (value?.startsWith("PASS ")) add(value, node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...found].map(([id, line]) => ({ id, line }));
}

async function executableFiles(directory) {
  const result = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (["node_modules", "dist", "dist-bundle", "out", ".cache"].includes(entry.name)) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (/\.(?:[cm]?js|tsx?)$/.test(entry.name)) result.push(child);
    }
  }
  for (const path of ["scripts/e2e", "apps/desktop/test", "packages/agent-runtime/src", "packages/shared/src", "packages/host-runtime/src"]) await walk(join(directory, path));
  for (const entry of await readdir(join(directory, "scripts"))) if (/^(?:e2e-.*|test-.*)\.mjs$/.test(entry)) result.push(join(directory, "scripts", entry));
  // Product sources cannot contribute ids unless they are executable tests.
  return result.filter(path => path.includes("/scripts/") || /\.test\.[cm]?[jt]sx?$/.test(path));
}

export async function buildScenarioIndex(directory = root) {
  const catalog = await loadCatalog(directory);
  const ids = new Map();
  for (const file of (await executableFiles(directory)).sort()) {
    const source = await readFile(file, "utf8");
    for (const item of extractScenarioIds(source, file)) {
      const refs = ids.get(item.id) ?? [];
      refs.push({ path: relative(directory, file).replaceAll("\\", "/"), line: item.line });
      ids.set(item.id, refs);
    }
  }
  // Explicit annotations cover dynamically assembled result ids in real suites.
  for (const entry of catalog.suites) for (const id of entry.scenarioIds ?? []) {
    if (!/^E2E-[\w.-]+$/.test(id)) throw new Error(`Invalid annotated scenario id: ${id}`);
    const refs = ids.get(id) ?? [];
    refs.push({ path: "scripts/e2e-suite-catalog.json", suite: entry.id });
    ids.set(id, refs);
  }
  return { catalog, scenarios: [...ids].sort(([a], [b]) => a.localeCompare(b)).map(([id, sources]) => ({ id, sources })) };
}

function sourceLink(source) {
  const line = source.line ? `#L${source.line}` : "";
  const labelSuffix = source.line ? `:${source.line}` : source.suite ? ` (${source.suite})` : "";
  return `[${source.path}${labelSuffix}](https://github.com/SakuraLoveSmile/PI-Desktop/blob/main/${source.path}${line})`;
}

export function renderScenarioIndex(index, locale = "en") {
  const chinese = locale === "zh-CN";
  const lines = [chinese ? "# Executable Scenario Index / 可执行场景索引" : "# Executable Scenario Index", "", "<!-- Generated by scripts/generate-scenario-index.mjs. Do not edit. -->", ""];
  if (chinese) lines.push("> 此索引与英文版本由同一可执行源码生成。[英文源规格](/spec/06-delivery/08-scenario-index)", "");
  lines.push(chinese ? "IDs come from executable result/test calls and annotated dynamic suites. 文档型验收条件不强制分配 ID。列表不表示本次运行通过；真实服务和设备项需明确授权。" : "IDs come from executable result/test calls and annotated dynamic suites. Documentation-only acceptance cases need no ID. This index is inventory, not a passing test result; real-provider and device cases require explicit authorization.", "", "## Suite ownership", "", "| Suite | Family | Tier | Executable | Boundary / excluded coverage |", "| --- | --- | --- | --- | --- |");
  for (const entry of index.catalog.suites) lines.push(`| ${entry.id} | ${entry.family} | ${entry.tier} | ${sourceLink({ path: entry.script })} ${entry.args?.join(" ") ?? ""} | ${entry.safety} ${entry.excludedCoverage?.length ? `Excluded: ${entry.excludedCoverage.join(", ")}.` : ""} |`);
  lines.push("", "## Executable IDs", "", "| Scenario | Test / result sources |", "| --- | --- |");
  for (const item of index.scenarios) lines.push(`| ${item.id} | ${item.sources.map(sourceLink).join("; ")} |`);
  return lines.join("\n") + "\n";
}

export async function generateScenarioIndex({ directory = root, check = false } = {}) {
  const index = await buildScenarioIndex(directory);
  for (const [locale, path] of [["en", "docs/spec/06-delivery/08-scenario-index.md"], ["zh-CN", "docs/zh-CN/spec/06-delivery/08-scenario-index.md"]]) {
    const output = renderScenarioIndex(index, locale);
    if (check) {
      const current = await readFile(join(directory, path), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (current !== output) throw new Error(`Scenario index drift: ${path}; run node scripts/generate-scenario-index.mjs`);
    } else await writeFile(join(directory, path), output);
  }
  return { suites: index.catalog.suites.length, scenarios: index.scenarios.length };
}
