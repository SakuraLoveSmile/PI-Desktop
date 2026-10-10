import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { analyzeSources, bootstrapEvidenceFailures, compareBudget, INITIAL_SOURCE_REVISION, inspectBootstrapEvidence, run, RUNTIME_TEST_LIMIT, runtimeLineFailures } from "../check-test-quality.mjs";

const testPath = "apps/desktop/test/example.test.mjs";
const fixtureTest = `import assert from 'node:assert/strict';
import { readFile as read } from 'node:fs/promises';
import test from 'node:test';
const fixture = await read(new URL('./fixtures/sample.ts', import.meta.url), 'utf8');
test('fixture contract', () => assert.match(fixture, /hello/));`;
const sourceTest = fixtureTest.replace("./fixtures/sample.ts", "../src/example.ts");
const baseline = (files) => ({ version: 1, initialSourceRevision: INITIAL_SOURCE_REVISION, maxRuntimeTestLines: RUNTIME_TEST_LIMIT, files });

test("fixture reads remain allowed and literal source/CSS paths count", () => {
  assert.deepEqual(analyzeSources({ [testPath]: fixtureTest }), {});
  for (const path of ["../src/example.ts", "../src/styles/example.css", "../electron/main/example.ts"]) {
    const metrics = analyzeSources({ [testPath]: fixtureTest.replace("./fixtures/sample.ts", path) });
    assert.equal(metrics[testPath].assertions, 1);
    assert.equal(metrics[testPath].cases, 1);
  }
});

test("a fixture read is not tainted by unrelated source reads in the same module", () => {
  const text = sourceTest.replace("test('fixture contract'", "const anotherFixture = await read(new URL('./fixtures/sample.ts', import.meta.url), 'utf8');\ntest('fixture contract'").replace("assert.match(fixture", "assert.match(anotherFixture");
  assert.deepEqual(analyzeSources({ [testPath]: text }), {});
});

test("same-named variables in separate cases preserve their own provenance", () => {
  const text = `import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import test from 'node:test';
    test('source', async () => { const text = await readFile(new URL('../src/example.ts', import.meta.url), 'utf8'); assert.match(text, /hello/); });
    test('fixture', async () => { const text = await readFile(new URL('./fixtures/example.ts', import.meta.url), 'utf8'); assert.match(text, /hello/); });`;
  assert.equal(analyzeSources({ [testPath]: text })[testPath].assertions, 1);
  assert.equal(analyzeSources({ [testPath]: text })[testPath].cases, 1);
});

test("source-reading helpers propagate across named imports, aliases and reexports", () => {
  const files = {
    "apps/desktop/test/helpers/read.mjs": `import {readFile} from 'node:fs/promises'; export function readSource() { return readFile(new URL('../../src/example.ts', import.meta.url), 'utf8'); }`,
    "apps/desktop/test/helpers/index.mjs": `export {readSource} from './read.mjs';`,
    [testPath]: `import {readSource as get} from './helpers/index.mjs'; import assert from 'node:assert/strict'; import test from 'node:test'; const body = await get(); test('markup', () => { const sliced = body.slice(2); assert.match(sliced, /button/); });`,
  };
  assert.equal(analyzeSources(files)[testPath].assertions, 1);
});

test("default fs imports and aliased assertions cannot add source checks", () => {
  const body = `import fs from 'node:fs'; import check from 'node:assert/strict'; const text = fs.readFileSync(new URL('../src/example.ts', import.meta.url), 'utf8'); check.match(text, /hello/);`;
  assert.equal(analyzeSources({ [testPath]: body })[testPath].assertions, 1);
  assert.equal(analyzeSources({ [testPath]: body.replace("import check from", "import {match as check} from").replace("check.match(", "check(") })[testPath].assertions, 1);
});

test("local reader and callable aliases retain source provenance without tainting fixtures", () => {
  const text = `import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import test from 'node:test';
    const read = readFile;
    const anotherRead = read;
    let assignedRead; assignedRead = anotherRead;
    const readSource = () => assignedRead(new URL('../src/example.ts', import.meta.url), 'utf8');
    const sourceAlias = readSource;
    const source = await sourceAlias();
    const fixture = await assignedRead(new URL('./fixtures/example.ts', import.meta.url), 'utf8');
    test('source', () => assert.match(source, /hello/));
    test('fixture', () => assert.match(fixture, /hello/));`;
  const metrics = analyzeSources({ [testPath]: text });
  assert.equal(metrics[testPath].assertions, 1);
  assert.equal(metrics[testPath].cases, 1);
  assert.ok(compareBudget(metrics, baseline({}), undefined, {}).some((failure) => failure.includes("new or expanded")));
});

test("exported arrow and function-expression readers propagate through module aliases", () => {
  for (const functionBody of [
    `() => read(new URL('../../src/example.ts', import.meta.url), 'utf8')`,
    `async () => { return await read(new URL('../../src/example.ts', import.meta.url), 'utf8'); }`,
    `function() { return read(new URL('../../src/example.ts', import.meta.url), 'utf8'); }`,
  ]) {
    const files = {
      "apps/desktop/test/helpers/read.mjs": `import {readFile} from 'node:fs/promises'; const read = readFile; export const readSource = ${functionBody}; export const readAlias = readSource; export const readFixture = () => read(new URL('../fixtures/example.ts', import.meta.url), 'utf8');`,
      "apps/desktop/test/helpers/index.mjs": `export {readAlias as readText, readFixture} from './read.mjs';`,
      [testPath]: `import {readText as get, readFixture} from './helpers/index.mjs'; import assert from 'node:assert/strict'; import test from 'node:test'; const text = await get(); const fixture = await readFixture(); test('source', () => assert.match(text, /hello/)); test('fixture', () => assert.match(fixture, /hello/));`,
    };
    const metrics = analyzeSources(files);
    assert.equal(metrics[testPath].assertions, 1);
    assert.equal(metrics[testPath].cases, 1);
    assert.ok(compareBudget(metrics, baseline({}), undefined, {}).some((failure) => failure.includes("new or expanded")));
  }
});

test("shadowed source callable aliases do not mark unrelated fixture-producing functions", () => {
  const text = `import assert from 'node:assert/strict'; import {readFile} from 'node:fs/promises'; import test from 'node:test';
    const get = () => readFile(new URL('../src/example.ts', import.meta.url), 'utf8');
    test('source', async () => { const text = await get(); assert.match(text, /hello/); });
    test('fixture', async () => { const get = () => readFile(new URL('./fixtures/example.ts', import.meta.url), 'utf8'); const text = await get(); assert.match(text, /hello/); });`;
  const metrics = analyzeSources({ [testPath]: text });
  assert.equal(metrics[testPath].assertions, 1);
  assert.equal(metrics[testPath].cases, 1);
});

test("new files, additional cases, and swapped assertions cannot spend retired budget", () => {
  const original = analyzeSources({ [testPath]: sourceTest });
  assert.deepEqual(compareBudget(original, baseline(original), baseline(original)), []);
  for (const files of [
    { [testPath]: sourceTest, "apps/desktop/test/new.test.mjs": sourceTest },
    { [testPath]: `${sourceTest}\ntest('new', () => assert.match(fixture, /more/));` },
    { [testPath]: sourceTest.replace("/hello/", "/replacement/") },
  ]) {
    assert.ok(compareBudget(analyzeSources(files), baseline(original), baseline(original)).some((failure) => failure.includes("new or expanded")));
  }
});

test("baseline growth and policy changes are rejected even when current metrics match", () => {
  const original = analyzeSources({ [testPath]: sourceTest });
  const increased = analyzeSources({ [testPath]: `${sourceTest}\ntest('new', () => assert.match(fixture, /more/));` });
  assert.ok(compareBudget(increased, baseline(increased), baseline(original)).some((failure) => failure.includes("baseline was expanded")));
  assert.ok(compareBudget(original, { ...baseline(original), maxRuntimeTestLines: 1000 }, baseline(original)).length > 0);
  assert.ok(compareBudget(increased, baseline(increased), undefined, original).some((failure) => failure.includes("baseline was expanded")));
  assert.ok(compareBudget(original, { ...baseline(original), initialSourceRevision: "f".repeat(40) }, baseline(original)).some((failure) => failure.includes("Initial source revision was changed")));
  assert.ok(compareBudget(original, { ...baseline(original), initialSourceRevision: "f".repeat(40) }, undefined, original).some((failure) => failure.includes("Invalid immutable")));
});

test("bootstrap requires an available pre-governance ancestor and never resets removed baselines", () => {
  const evidence = { initialExists: true, headContainsInitial: true, snapshotContainsBaseline: false, basePreviouslyIntroducedBaseline: false, allHeadIntroductionsFollowInitial: true };
  assert.deepEqual(bootstrapEvidenceFailures(evidence), []);
  for (const invalid of [
    { initialExists: false }, { headContainsInitial: false },
    { snapshotContainsBaseline: true }, { basePreviouslyIntroducedBaseline: true },
    { allHeadIntroductionsFollowInitial: false },
  ]) assert.equal(bootstrapEvidenceFailures({ ...evidence, ...invalid }).length, 1);
});

test("retirement must lower its checked-in baseline and cannot reclaim deleted allowances", () => {
  const original = analyzeSources({ [testPath]: sourceTest });
  assert.deepEqual(compareBudget({}, baseline({}), baseline(original)), []);
  assert.ok(compareBudget({}, baseline(original), baseline(original)).some((failure) => failure.includes("remove retired")));
  assert.ok(compareBudget(original, baseline(original), baseline({})).some((failure) => failure.includes("expanded")));
});

test("runtime domain tests and helpers share an 800-line maximum", () => {
  for (const path of ["packages/agent-runtime/src/runtime.test.ts", "packages/agent-runtime/src/runtime-tests/goals.test.ts", "packages/agent-runtime/src/runtime-tests/runtime-test-harness.ts"]) {
    assert.deepEqual(runtimeLineFailures({ [path]: "line\n".repeat(800) }), []);
    assert.equal(runtimeLineFailures({ [path]: "line\n".repeat(801) }).length, 1);
  }
  assert.deepEqual(runtimeLineFailures({ "packages/agent-runtime/src/runtime.ts": "line\n".repeat(801) }), []);
});

test("CLI compares the edited baseline to Git base and refuses self-blessing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-quality-gate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "apps/desktop/test"), { recursive: true });
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, testPath), sourceTest);
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init");
  git("add", testPath);
  writeFileSync(join(root, "scripts/test-quality-baseline.json"), JSON.stringify(baseline(analyzeSources({ [testPath]: sourceTest }, root))));
  git("add", "scripts/test-quality-baseline.json");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture baseline");
  assert.equal(run(root, ["--base", "HEAD", "--write-baseline"]), 0);
  const old = readFileSync(join(root, "scripts/test-quality-baseline.json"), "utf8");
  const increased = `${sourceTest}\ntest('extra', () => assert.match(fixture, /bad/));`;
  writeFileSync(join(root, testPath), increased);
  assert.throws(() => run(root, ["--base", "HEAD", "--write-baseline"]), /baseline was expanded/);
  writeFileSync(join(root, "scripts/test-quality-baseline.json"), JSON.stringify(baseline(analyzeSources({ [testPath]: increased }, root))));
  assert.equal(run(root, ["--base", "HEAD"]), 1);
  writeFileSync(join(root, testPath), sourceTest);
  writeFileSync(join(root, "scripts/test-quality-baseline.json"), JSON.stringify({ ...baseline(analyzeSources({ [testPath]: sourceTest }, root)), initialSourceRevision: "f".repeat(40) }));
  assert.equal(run(root, ["--base", "HEAD"]), 1);
  assert.throws(() => run(root, ["--base", "HEAD", "--write-baseline"]), /Invalid immutable/);
  writeFileSync(join(root, "scripts/test-quality-baseline.json"), old);
  assert.equal(run(root, ["--base", "HEAD"]), 0);
});

test("Git bootstrap sees baseline add/delete history even on a merged branch with an unchanged final tree", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-quality-bootstrap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "readme.md"), "trusted snapshot\n");
  git("add", "readme.md");
  git("commit", "-m", "trusted pre-governance snapshot");
  const initial = git("rev-parse", "HEAD");
  assert.deepEqual(bootstrapEvidenceFailures(inspectBootstrapEvidence(root, initial, initial)), []);
  assert.ok(bootstrapEvidenceFailures(inspectBootstrapEvidence(root, initial, "f".repeat(40))).length > 0);
  git("switch", "-c", "governance-history");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts/test-quality-baseline.json"), "{}\n");
  git("add", "scripts/test-quality-baseline.json");
  git("commit", "-m", "introduce baseline");
  const introduced = git("rev-parse", "HEAD");
  assert.ok(bootstrapEvidenceFailures(inspectBootstrapEvidence(root, initial, introduced)).some((failure) => failure.includes("precede baseline introduction")));
  rmSync(join(root, "scripts/test-quality-baseline.json"));
  git("add", "scripts/test-quality-baseline.json");
  git("commit", "-m", "remove baseline");
  git("switch", "main");
  git("merge", "--no-ff", "governance-history", "-m", "merge history without a baseline tree entry");
  const evidence = inspectBootstrapEvidence(root, "HEAD", initial);
  assert.equal(evidence.basePreviouslyIntroducedBaseline, true);
  assert.equal(evidence.allHeadIntroductionsFollowInitial, true);
  assert.ok(bootstrapEvidenceFailures(evidence).some((failure) => failure.includes("deletion cannot reset")));
});

test("Git bootstrap includes a baseline introduced only by a merge resolution", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-quality-merge-bootstrap-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "readme.md"), "trusted snapshot\n");
  git("add", "readme.md");
  git("commit", "-m", "trusted snapshot");
  const initial = git("rev-parse", "HEAD");
  git("switch", "-c", "side");
  writeFileSync(join(root, "side.md"), "side\n");
  git("add", "side.md");
  git("commit", "-m", "side work");
  git("switch", "main");
  writeFileSync(join(root, "main.md"), "main\n");
  git("add", "main.md");
  git("commit", "-m", "main work");
  git("merge", "--no-commit", "--no-ff", "side");
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, "scripts/test-quality-baseline.json"), "{}\n");
  git("add", "scripts/test-quality-baseline.json");
  git("commit", "-m", "introduce baseline during merge resolution");
  rmSync(join(root, "scripts/test-quality-baseline.json"));
  git("add", "scripts/test-quality-baseline.json");
  git("commit", "-m", "remove baseline after merge");
  const evidence = inspectBootstrapEvidence(root, "HEAD", initial);
  assert.equal(evidence.basePreviouslyIntroducedBaseline, true);
  assert.equal(evidence.allHeadIntroductionsFollowInitial, true);
  assert.ok(bootstrapEvidenceFailures(evidence).some((failure) => failure.includes("deletion cannot reset")));
});
