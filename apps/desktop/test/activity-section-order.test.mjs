import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import test, { after, mock } from "node:test";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)), configFile: false, logLevel: "silent",
  server: { middlewareMode: true, hmr: false, ws: false }, esbuild: { jsx: "automatic" },
  appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: [
    { find: /^@pi-desktop\/shared$/, replacement: fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url)) },
    { find: /^@pi-desktop\/i18n$/, replacement: fileURLToPath(new URL("../../../packages/i18n/src/index.ts", import.meta.url)) },
  ] },
});
after(() => server.close());
const { ACTIVITY_SECTION_IDS, applyVisibleActivitySectionOrder, dragActivitySectionOrder, isDefaultActivitySectionOrder,
  mergeActivitySectionOrder, stepActivitySection } = await server.ssrLoadModule("/src/features/chat/activity/activity-section-order.ts");
const { createActivitySectionOrderStore } = await server.ssrLoadModule("/src/features/chat/activity/use-activity-section-order.ts");

const DEFAULT = ["goals", "plans", "todos", "teamTasks", "live", "server", "environment", "context", "artifacts", "skills", "changes"];
const STORAGE_KEY = "pi-desktop:activity-section-order:v1";

const fakeStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
};

test("the default section order puts goals and plans first, servers right after live status, the workspace sections next and changes last", () => {
  assert.deepEqual([...ACTIVITY_SECTION_IDS], DEFAULT);
  assert.equal(isDefaultActivitySectionOrder(DEFAULT), true);
  assert.equal(isDefaultActivitySectionOrder(["plans", "goals", ...DEFAULT.slice(2)]), false);
  assert.equal(isDefaultActivitySectionOrder(DEFAULT.slice(1)), false);
});

test("a stored order that is missing, unreadable or empty falls back to the default order", () => {
  for (const stored of [undefined, null, "nope", 7, {}, []]) assert.deepEqual(mergeActivitySectionOrder(stored), DEFAULT, String(stored));
});

test("a complete stored order is kept exactly as chosen", () => {
  const reversed = [...DEFAULT].reverse();
  assert.deepEqual(mergeActivitySectionOrder(reversed), reversed);
});

test("a section the stored order never saw lands right after its nearest default predecessor", () => {
  // "live" sits after "plans" by default, "server" and the workspace sections follow it, so a release that adds them keeps
  // the rest of the chosen order intact; "changes" follows "skills".
  assert.deepEqual(mergeActivitySectionOrder(["artifacts", "goals", "plans", "skills"]),
    ["artifacts", "goals", "plans", "todos", "teamTasks", "live", "server", "environment", "context", "skills", "changes"]);
  // The first default section has no predecessor and goes first.
  assert.deepEqual(mergeActivitySectionOrder(["plans", "live", "environment", "context", "artifacts", "skills", "changes"]), DEFAULT);
});

test("an order saved before the workspace sections existed keeps its sequence and gains them beside their default neighbours", () => {
  assert.deepEqual(mergeActivitySectionOrder(["live", "goals", "plans", "artifacts", "skills"]),
    ["live", "server", "environment", "context", "goals", "plans", "todos", "teamTasks", "artifacts", "skills", "changes"]);
  assert.deepEqual(mergeActivitySectionOrder(["goals", "plans", "live", "artifacts", "skills"]), DEFAULT);
});

test("an order saved before Servers existed gains it right after live status wherever live status was moved", () => {
  assert.deepEqual(mergeActivitySectionOrder(["environment", "goals", "plans", "live", "context", "artifacts", "skills", "changes"]),
    ["environment", "goals", "plans", "todos", "teamTasks", "live", "server", "context", "artifacts", "skills", "changes"]);
  assert.deepEqual(mergeActivitySectionOrder(["live", "changes", "skills", "artifacts", "context", "environment", "plans", "goals"]),
    ["live", "server", "changes", "skills", "artifacts", "context", "environment", "plans", "todos", "teamTasks", "goals"]);
});

test("unknown and repeated ids are dropped while the first occurrence keeps its place", () => {
  const merged = mergeActivitySectionOrder(["live", "bogus", "live", 42, "goals"]);
  assert.deepEqual(merged, ["live", "server", "environment", "context", "artifacts", "skills", "changes", "goals", "plans", "todos", "teamTasks"]);
  assert.deepEqual([...merged].sort(), [...DEFAULT].sort());
});

test("a new visible order is written into the visible sections' own slots and hidden sections keep theirs", () => {
  assert.deepEqual(applyVisibleActivitySectionOrder(DEFAULT, ["skills", "plans", "live"]),
    ["goals", "skills", "todos", "teamTasks", "plans", "server", "environment", "context", "artifacts", "live", "changes"]);
  assert.deepEqual(applyVisibleActivitySectionOrder(DEFAULT, DEFAULT), DEFAULT);
  const full = ["live", "goals", "plans", "server", "environment", "context", "artifacts", "skills", "changes"];
  assert.deepEqual(applyVisibleActivitySectionOrder(full, ["plans", "live"]),
    ["plans", "goals", "live", "server", "environment", "context", "artifacts", "skills", "changes"]);
});

test("a visible order that does not match the stored sections changes nothing", () => {
  for (const visible of [["live", "live"], ["live", "bogus"], ["live", "goals", "plans", "live"]]) {
    const next = applyVisibleActivitySectionOrder(DEFAULT, visible);
    assert.deepEqual(next, DEFAULT, visible.join());
    assert.notEqual(next, DEFAULT);
  }
});

test("keyboard steps swap one neighbour, stop at the edges and never change the input", () => {
  const input = Object.freeze([...DEFAULT]);
  assert.deepEqual(stepActivitySection(input, "live", -1), ["goals", "plans", "todos", "live", "teamTasks", "server", "environment", "context", "artifacts", "skills", "changes"]);
  assert.deepEqual(stepActivitySection(input, "live", 1), ["goals", "plans", "todos", "teamTasks", "server", "live", "environment", "context", "artifacts", "skills", "changes"]);
  assert.deepEqual(stepActivitySection(input, "skills", 1), ["goals", "plans", "todos", "teamTasks", "live", "server", "environment", "context", "artifacts", "changes", "skills"]);
  assert.equal(stepActivitySection(input, "goals", -1), null);
  assert.equal(stepActivitySection(input, "changes", 1), null);
  assert.equal(stepActivitySection(input, "bogus", 1), null);
});

test("dragging lands the section before the first other section whose midpoint is below the pointer", () => {
  const rects = [{ id: "goals", top: 0, height: 100 }, { id: "plans", top: 110, height: 100 }, { id: "live", top: 220, height: 100 }];
  const order = ["goals", "plans", "live"];
  assert.deepEqual(dragActivitySectionOrder(order, "goals", 250, rects), ["plans", "goals", "live"]);
  assert.deepEqual(dragActivitySectionOrder(order, "goals", 400, rects), ["plans", "live", "goals"]);
  assert.deepEqual(dragActivitySectionOrder(order, "live", -5, rects), ["live", "goals", "plans"]);
  // A pointer that stays over the section's own slot is not a move.
  assert.deepEqual(dragActivitySectionOrder(order, "plans", 160, rects), order);
  assert.deepEqual(order, ["goals", "plans", "live"]);
});

test("the store reads a saved order, merges it with the default and persists changes once", () => {
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify(["live", "goals", "plans", "artifacts", "skills"]) });
  const store = createActivitySectionOrderStore(() => storage);
  assert.deepEqual([...store.get()], ["live", "server", "environment", "context", "goals", "plans", "todos", "teamTasks", "artifacts", "skills", "changes"]);
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  const chosen = ["plans", "live", "goals", "server", "environment", "context", "artifacts", "skills", "changes"];
  store.set(chosen);
  assert.equal(notified, 1);
  assert.deepEqual(JSON.parse(storage.values.get(STORAGE_KEY)), chosen);
  store.set(chosen);
  assert.equal(notified, 1, "an unchanged order is not a change");
  unsubscribe();
  store.set(DEFAULT);
  assert.equal(notified, 1, "an unsubscribed listener stays quiet");
});

test("returning to the default order removes the saved entry, so reset leaves nothing behind", () => {
  const storage = fakeStorage();
  const store = createActivitySectionOrderStore(() => storage);
  store.set(["skills", "goals", "plans", "live", "artifacts", "server", "environment", "context", "changes"]);
  assert.equal(storage.values.has(STORAGE_KEY), true);
  store.reset();
  assert.deepEqual([...store.get()], DEFAULT);
  assert.equal(storage.values.has(STORAGE_KEY), false);
});

test("an unreadable saved value falls back to the default order and the failure stays visible", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const store = createActivitySectionOrderStore(() => fakeStorage({ [STORAGE_KEY]: "{not json" }));
    assert.deepEqual([...store.get()], DEFAULT);
    assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [["Activity section order could not be read", "SyntaxError"]]);
  } finally { warn.mock.restore(); }
});

test("a storage that refuses writes keeps the order for this session and reports only the error name", () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const storage = { getItem: () => null, setItem() { throw new DOMException("quota is full: secret-detail", "QuotaExceededError"); }, removeItem() {} };
    const store = createActivitySectionOrderStore(() => storage);
    let notified = 0;
    store.subscribe(() => { notified += 1; });
    const chosen = ["plans", "goals", "live", "server", "environment", "context", "artifacts", "skills", "changes"];
    store.set(chosen);
    assert.deepEqual([...store.get()], chosen);
    assert.equal(notified, 1);
    assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [["Activity section order could not be saved", "QuotaExceededError"]]);
  } finally { warn.mock.restore(); }
});

test("the store works in memory when the browser exposes no storage", () => {
  const store = createActivitySectionOrderStore(() => undefined);
  assert.deepEqual([...store.get()], DEFAULT);
  const chosen = ["live", "goals", "plans", "server", "environment", "context", "artifacts", "skills", "changes"];
  store.set(chosen);
  assert.deepEqual([...store.get()], chosen);
});
