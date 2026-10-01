import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(relative, imports) {
  const file = new URL(relative, import.meta.url);
  const { outputText } = ts.transpileModule(await readFile(file, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
    fileName: file.pathname,
  });
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unexpected import: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

function createHookHarness() {
  let current;
  const cell = () => {
    const index = current.cursor++;
    return [current.hooks, index];
  };
  const sameDependencies = (a, b) => a?.length === b?.length &&
    a.every((dependency, index) => Object.is(dependency, b[index]));
  const memo = (factory, dependencies) => {
    const [hooks, index] = cell();
    const existing = hooks[index];
    if (!existing || !sameDependencies(existing.dependencies, dependencies)) {
      hooks[index] = { value: factory(), dependencies };
    }
    return hooks[index].value;
  };
  return {
    react: {
      useMemo: memo,
      useCallback(callback, dependencies) {
        return memo(() => callback, dependencies);
      },
      useSyncExternalStore(subscribe, getSnapshot) {
        const [hooks, index] = cell();
        const existing = hooks[index] ?? { subscribe: null, cleanup: null };
        if (existing.subscribe !== subscribe) {
          existing.cleanup?.();
          existing.subscribe = subscribe;
          existing.cleanup = subscribe(() => { existing.snapshot = getSnapshot(); });
        }
        existing.snapshot = getSnapshot();
        hooks[index] = existing;
        return existing.snapshot;
      },
    },
    render(component, hook, props) {
      current = component;
      component.cursor = 0;
      try {
        component.value = hook(...props);
        return component.value;
      } finally {
        current = null;
      }
    },
    createComponent() { return { hooks: [], cursor: 0, value: undefined }; },
    unmount(component) {
      for (const hook of component.hooks) hook?.cleanup?.();
      component.hooks = [];
    },
  };
}

test("a disabled hook reuses the current shared reader after idle eviction", async () => {
  let eventSubscriptions = 0;
  let hostSubscriptions = 0;
  const api = {
    getTeamSnapshot: async (teamSessionId) => ({
      teamSessionId,
      revision: 1,
      paused: false,
      members: [],
      tasks: [],
      readiness: { ready: true, issues: [] },
      scopeOverlaps: [],
      leadPhase: "idle",
      queuedMessageCount: 0,
      review: null,
      decision: null,
    }),
    onTeamChanged: () => { eventSubscriptions += 1; return () => {}; },
    onHostStatus: () => { hostSubscriptions += 1; return () => {}; },
  };
  const runtime = await load("../src/stores/runtime/team-runtime.ts", {});
  const harness = createHookHarness();
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  const { useTeamSnapshot } = await load("../src/hooks/useTeamSnapshot.ts", {
    react: harness.react,
    "../lib/api": { api },
    "../stores/app-store": { useAppStore: { getState: () => ({ refreshSessions: async () => undefined }) } },
    "../stores/runtime/team-runtime": runtime,
  });

  const originalConsumer = harness.createComponent();
  harness.render(originalConsumer, useTeamSnapshot, ["team-a", { enabled: true }]);
  assert.equal(eventSubscriptions, 1);

  harness.render(originalConsumer, useTeamSnapshot, ["team-a", { enabled: false }]);
  await new Promise((resolve) => setImmediate(resolve));

  const newConsumer = harness.createComponent();
  harness.render(newConsumer, useTeamSnapshot, ["team-a", { enabled: true }]);
  assert.equal(eventSubscriptions, 2, "the idle reader was evicted and replaced once");
  harness.render(originalConsumer, useTeamSnapshot, ["team-a", { enabled: true }]);
  assert.equal(eventSubscriptions, 2, "reenabling joins the replacement reader already used by another consumer");
  assert.equal(hostSubscriptions, 2, "only one Host listener exists for each reader lifecycle");

  harness.unmount(originalConsumer);
  harness.unmount(newConsumer);
});
