#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Use the already provisioned compiler, not another parser dependency.
const require = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const ts = require("typescript");
export const BASELINE_PATH = "scripts/test-quality-baseline.json";
export const RUNTIME_TEST_LIMIT = 800;
export const INITIAL_SOURCE_REVISION = "c9b2aad7496048f64d94c2b135389f72a52d93da";
const extensions = new Set([".mjs", ".js", ".ts", ".tsx", ".jsx"]);
const sourceExtensions = new Set([...extensions, ".css", ".rs"]);

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function isTest(path) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function sourcePath(value, file, root) {
  if (typeof value !== "string" || !value.includes("/")) return false;
  const path = /^(?:apps|packages|crates|scripts)\//.test(value) ? value : relative(root, resolve(dirname(resolve(root, file)), value)).replaceAll("\\", "/");
  if (/(?:^|\/)(?:test|tests|fixtures|node_modules)(?:\/|$)/.test(path)) return false;
  return /^(?:apps|packages|crates|scripts)\//.test(path) &&
    (/(?:^|\/)(?:src|electron)(?:\/|$)/.test(path) || sourceExtensions.has(extname(path)));
}

/** Static source provenance. Fixture reads and imported executable functions
 * are not source-text assertions. Helpers that aggregate source directories
 * propagate provenance through local imports and re-exports. */
export function analyzeSources(files, root = process.cwd()) {
  const modules = new Map();
  for (const [path, text] of Object.entries(files)) {
    const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
      ts.getScriptKindFromFileName(path));
    modules.set(path, { ast, names: new Set(), calls: new Set(), callBindings: new Set(), readerBindings: new Set(), imports: [], exports: [], reads: new Set(), assertions: new Set(["assert"]), matchAssertions: new Set(), sourcePaths: false });
  }
  // Bind local identifiers by scope: a fixture named `text` in one case must
  // not inherit another case's source variable also named `text`.
  const options = { allowJs: true, noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options, true);
  host.getCurrentDirectory = () => root;
  host.getSourceFile = (path) => modules.get(path)?.ast ?? modules.get(relative(root, path).replaceAll("\\", "/"))?.ast;
  const checker = ts.createProgram([...modules.keys()], options, host).getTypeChecker();
  const binding = (node) => checker.getSymbolAtLocation(node) ?? node.text;
  const modulePath = (path, specifier) => {
    const target = relative(root, resolve(dirname(resolve(root, path)), specifier)).replaceAll("\\", "/");
    return [target, `${target}.mjs`, `${target}.ts`, `${target}/index.mjs`].find((candidate) => modules.has(candidate));
  };
  for (const [path, state] of modules) {
    visit(state.ast, (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const bindings = node.importClause?.namedBindings;
        const defaultName = node.importClause?.name?.text;
        if (defaultName && /^node:fs(?:\/promises)?$/.test(specifier)) {
          state.reads.add(`${defaultName}.readFile`);
          state.reads.add(`${defaultName}.readFileSync`);
        }
        if (defaultName && /^node:assert(?:\/strict)?$/.test(specifier)) state.assertions.add(defaultName);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            const name = (binding.propertyName ?? binding.name).text;
            if (/^node:fs(?:\/promises)?$/.test(specifier) && ["readFile", "readFileSync"].includes(name)) {
              state.reads.add(binding.name.text);
              state.readerBindings.add(checker.getSymbolAtLocation(binding.name) ?? binding.name.text);
            }
            if (/^node:assert(?:\/strict)?$/.test(specifier) && ["match", "doesNotMatch"].includes(name)) state.matchAssertions.add(binding.name.text);
            state.imports.push({ local: binding.name.text, binding: checker.getSymbolAtLocation(binding.name) ?? binding.name.text, imported: name, target: modulePath(path, specifier) });
          }
        } else if (bindings && ts.isNamespaceImport(bindings) && /^node:fs(?:\/promises)?$/.test(specifier)) {
          state.reads.add(`${bindings.name.text}.readFile`);
          state.reads.add(`${bindings.name.text}.readFileSync`);
        } else if (bindings && ts.isNamespaceImport(bindings) && /^node:assert(?:\/strict)?$/.test(specifier)) {
          state.assertions.add(bindings.name.text);
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = modulePath(path, node.moduleSpecifier.text);
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const binding of node.exportClause.elements) state.exports.push({ local: binding.name.text, imported: (binding.propertyName ?? binding.name).text, target });
        }
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          !ts.isImportDeclaration(node.parent) && sourcePath(node.text, path, root)) state.sourcePaths = true;
      if (ts.isTemplateExpression(node) && sourcePath(`${node.head.text}file.ts`, path, root)) state.sourcePaths = true;
    });
  }
  const flagged = (node, state, path) => {
    if (!node) return false;
    if (ts.isIdentifier(node)) return state.names.has(binding(node));
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(state.ast);
      if (ts.isIdentifier(node.expression) ? state.readerBindings.has(binding(node.expression)) : state.reads.has(callee)) {
        const argument = node.arguments[0];
        let literal;
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) literal = argument.text;
        if (argument && ts.isNewExpression(argument) && argument.expression.getText(state.ast) === "URL" && argument.arguments?.[0] && ts.isStringLiteral(argument.arguments[0])) literal = argument.arguments[0].text;
        // A concrete fixture path overrides unrelated source paths in the module.
        return literal !== undefined ? sourcePath(literal, path, root) : state.sourcePaths || flagged(argument, state, path);
      }
      if (ts.isIdentifier(node.expression) ? state.callBindings.has(binding(node.expression)) : state.calls.has(callee)) return true;
    }
    // Imports are code dependencies, not read source text.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return false;
    let result = false;
    ts.forEachChild(node, (child) => { if (flagged(child, state, path)) result = true; });
    return result;
  };
  let changed = true;
  while (changed) {
    changed = false;
    const add = (set, value) => { if (!set.has(value)) { set.add(value); changed = true; } };
    for (const [path, state] of modules) {
      for (const imported of [...state.imports, ...state.exports]) {
        if (modules.get(imported.target)?.calls.has(imported.imported)) {
          add(state.calls, imported.local);
          if (imported.binding) add(state.callBindings, imported.binding);
        }
      }
      const alias = (name, initializer) => {
        if (!ts.isIdentifier(name) || !initializer) return;
        const reader = ts.isIdentifier(initializer) ? state.readerBindings.has(binding(initializer)) : state.reads.has(initializer.getText(state.ast));
        if (reader) add(state.readerBindings, binding(name));
        const callable = ts.isIdentifier(initializer) ? state.callBindings.has(binding(initializer)) :
          (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && flagged(initializer.body, state, path);
        if (callable) {
          add(state.callBindings, binding(name));
          add(state.calls, name.text);
        }
      };
      visit(state.ast, (node) => {
        if (ts.isVariableDeclaration(node)) {
          alias(node.name, node.initializer);
          if (flagged(node.initializer, state, path)) visit(node.name, (name) => { if (ts.isIdentifier(name)) add(state.names, binding(name)); });
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
          alias(node.left, node.right);
          if (flagged(node.right, state, path)) add(state.names, binding(node.left));
        }
        if (ts.isFunctionDeclaration(node) && node.name && flagged(node.body, state, path)) {
          add(state.calls, node.name.text);
          add(state.callBindings, binding(node.name));
        }
      });
    }
  }
  const result = {};
  for (const [path, state] of modules) {
    if (!isTest(path)) continue;
    const signatures = [];
    const cases = new Set();
    visit(state.ast, (node) => {
      if (!ts.isCallExpression(node)) return;
      const callee = node.expression;
      const member = ts.isPropertyAccessExpression(callee) ? callee : undefined;
      const method = member?.name.text;
      const assertion = (state.matchAssertions.has(callee.getText(state.ast)) ||
        member && ["match", "doesNotMatch"].includes(method) && state.assertions.has(member.expression.getText(state.ast))) && flagged(node.arguments[0], state, path);
      const extraction = member && ["match", "matchAll", "search"].includes(method) && flagged(member.expression, state, path);
      const regexTest = ["test", "exec"].includes(method) && flagged(node.arguments[0], state, path);
      if (!assertion && !extraction && !regexTest) return;
      let current = node.parent;
      let caseName = "<module>";
      while (current) {
        if (ts.isCallExpression(current) && /^(?:test|it)(?:\.|$)/.test(current.expression.getText(state.ast))) {
          caseName = current.arguments[0]?.getText(state.ast) ?? "<unnamed>";
          break;
        }
        current = current.parent;
      }
      cases.add(caseName);
      const signature = createHash("sha256").update(`${caseName}\n${node.getText(state.ast).replace(/\s+/g, " ")}`).digest("hex").slice(0, 20);
      signatures.push(signature);
    });
    if (signatures.length) result[path] = { assertions: signatures.length, cases: cases.size, signatures: signatures.sort() };
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function subset(current, previous) {
  const available = new Map();
  for (const value of previous) available.set(value, (available.get(value) ?? 0) + 1);
  return current.every((value) => {
    const count = available.get(value) ?? 0;
    available.set(value, count - 1);
    return count > 0;
  });
}

export function compareBudget(current, baseline, baseBaseline, baseMetrics) {
  const failures = [];
  if (baseline.version !== 1 || baseline.maxRuntimeTestLines !== RUNTIME_TEST_LIMIT) failures.push("Invalid baseline version or runtime line budget");
  if (baseline.initialSourceRevision !== INITIAL_SOURCE_REVISION) failures.push("Invalid immutable initial source revision");
  const ceiling = baseBaseline?.files ?? baseMetrics;
  if (baseBaseline && (baseBaseline.version !== baseline.version || baseBaseline.maxRuntimeTestLines !== baseline.maxRuntimeTestLines)) failures.push("Baseline policy was changed against the base revision");
  if (baseBaseline && baseBaseline.initialSourceRevision !== baseline.initialSourceRevision) failures.push("Initial source revision was changed against the base revision");
  for (const [path, budget] of Object.entries(baseline.files)) {
    const old = ceiling?.[path];
    if (!old || budget.assertions > old.assertions || budget.cases > old.cases || !subset(budget.signatures, old.signatures)) failures.push(`${path}: baseline was expanded against base`);
    if (budget.assertions !== budget.signatures.length || budget.cases < 1 || !Number.isInteger(budget.cases)) failures.push(`${path}: invalid baseline metrics`);
  }
  for (const [path, metric] of Object.entries(current)) {
    const budget = baseline.files[path];
    if (!budget || metric.assertions > budget.assertions || metric.cases > budget.cases || !subset(metric.signatures, budget.signatures)) failures.push(`${path}: new or expanded source/CSS regex assertions; use behavior tests`);
    // Keep the checked-in inventory exact so retired allowances cannot be reused.
    if (budget && (metric.assertions !== budget.assertions || metric.cases !== budget.cases || !subset(budget.signatures, metric.signatures))) failures.push(`${path}: lower the baseline to match retired assertions`);
  }
  for (const path of Object.keys(baseline.files)) if (!current[path]) failures.push(`${path}: remove retired baseline entry`);
  return failures;
}

export function runtimeLineFailures(files) {
  return Object.entries(files).flatMap(([path, text]) => {
    if (path !== "packages/agent-runtime/src/runtime.test.ts" && !/^packages\/agent-runtime\/src\/runtime-tests\/.*\.ts$/.test(path)) return [];
    const lines = text.split("\n").length - Number(text.endsWith("\n"));
    return lines > RUNTIME_TEST_LIMIT ? [`${path}: ${lines} lines exceeds ${RUNTIME_TEST_LIMIT}; split by domain`] : [];
  });
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function introducedBaselines(root, revision) {
  return [...new Set(git(root, ["log", "--full-history", "--diff-merges=separate", "--no-patch", "--format=%H", "--diff-filter=A", revision, "--", BASELINE_PATH]).trim().split("\n").filter(Boolean))];
}

function isAncestor(root, ancestor, descendant) {
  try {
    git(root, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

/** Bootstrap may only use the recorded pre-governance snapshot. Once a base
 * carries a baseline, ordinary ratcheting needs no historical anchor object. */
export function bootstrapEvidenceFailures(evidence) {
  const failures = [];
  if (!evidence.initialExists) failures.push("Initial source revision is unavailable");
  if (!evidence.headContainsInitial) failures.push("Initial source revision must be an ancestor of HEAD during bootstrap");
  if (evidence.snapshotContainsBaseline) failures.push("Initial source snapshot must precede baseline introduction");
  if (evidence.basePreviouslyIntroducedBaseline) failures.push("Base history already introduced a baseline; deletion cannot reset the ratchet");
  if (!evidence.allHeadIntroductionsFollowInitial) failures.push("Initial source revision must precede every reachable baseline introduction");
  return failures;
}

export function inspectBootstrapEvidence(root, base, initialRevision) {
  let initialExists = false;
  try {
    initialExists = git(root, ["rev-parse", "--verify", `${initialRevision}^{commit}`]).trim() === initialRevision;
  } catch (error) {
    if (error.status !== 128) throw error;
  }
  return {
    initialExists,
    headContainsInitial: initialExists && isAncestor(root, initialRevision, "HEAD"),
    snapshotContainsBaseline: initialExists && Boolean(git(root, ["ls-tree", "--name-only", initialRevision, BASELINE_PATH]).trim()),
    basePreviouslyIntroducedBaseline: introducedBaselines(root, base).length > 0,
    allHeadIntroductionsFollowInitial: initialExists && introducedBaselines(root, "HEAD").every((revision) => initialRevision !== revision && isAncestor(root, initialRevision, revision)),
  };
}

export function collectFiles(root, revision) {
  const paths = git(root, revision ? ["ls-tree", "-r", "--name-only", revision] : ["ls-files", "-co", "--exclude-standard"]);
  return Object.fromEntries([...new Set(paths.trim().split("\n"))].filter((path) => extensions.has(extname(path)) && /(?:\/test(?:s)?\/|\/runtime-tests\/|\.(?:test|spec)\.)/.test(path) && !/(?:\/fixtures\/|\/node_modules\/)/.test(path)).flatMap((path) => {
    if (!revision && !existsSync(resolve(root, path))) return [];
    return [[path, revision ? git(root, ["show", `${revision}:${path}`]) : readFileSync(resolve(root, path), "utf8")]];
  }));
}

export function run(root, args = process.argv.slice(2)) {
  const baseFlag = args.indexOf("--base");
  const base = baseFlag >= 0 ? args[baseFlag + 1] : process.env.TEST_QUALITY_BASE || "origin/main";
  if (!base) throw new Error("--base requires a revision");
  git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  const files = collectFiles(root);
  const metrics = analyzeSources(files, root);
  let baseBaseline;
  if (git(root, ["ls-tree", "--name-only", base, BASELINE_PATH]).trim()) baseBaseline = JSON.parse(git(root, ["show", `${base}:${BASELINE_PATH}`]));
  let bootstrapMetrics;
  if (!baseBaseline) {
    const failures = bootstrapEvidenceFailures(inspectBootstrapEvidence(root, base, INITIAL_SOURCE_REVISION));
    if (failures.length) throw new Error(failures.join("\n"));
    bootstrapMetrics = analyzeSources(collectFiles(root, INITIAL_SOURCE_REVISION), root);
  }
  const baselinePath = resolve(root, BASELINE_PATH);
  if (args.includes("--write-baseline")) {
    const initialSourceRevision = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")).initialSourceRevision ?? INITIAL_SOURCE_REVISION : INITIAL_SOURCE_REVISION;
    const next = { version: 1, initialSourceRevision, maxRuntimeTestLines: RUNTIME_TEST_LIMIT, files: metrics };
    const failures = compareBudget(metrics, next, baseBaseline, bootstrapMetrics);
    if (failures.length) throw new Error(failures.join("\n"));
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const failures = [...compareBudget(metrics, baseline, baseBaseline, bootstrapMetrics), ...runtimeLineFailures(files)];
  const total = Object.values(metrics).reduce((sum, metric) => sum + metric.assertions, 0);
  console.log(`Source/CSS regex budget: ${Object.keys(metrics).length} files, ${total} syntax-level assertions/extractions; runtime test limit ${RUNTIME_TEST_LIMIT} lines.`);
  for (const failure of failures) console.error(failure);
  return failures.length ? 1 : 0;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(process.cwd()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
