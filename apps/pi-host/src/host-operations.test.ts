import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RacpError } from "@pi-desktop/agent-host";
import { RuntimeService, type LaunchResolver, type RuntimeHostLink, type RuntimeSidecarLink } from "@pi-desktop/host-runtime";
import { ErrorCodes } from "@pi-desktop/shared";

import { createHostOperations } from "./host-operations.js";

class ObservedRuntimeService extends RuntimeService {
  nextOperationLabel: "retry" | "turn" | null = null;
  operationCalls: string[] = [];
  operationStarts: string[] = [];

  override withSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const label = this.nextOperationLabel ?? "turn";
    this.operationCalls.push(label);
    return super.withSessionOperation(sessionId, async () => {
      this.operationStarts.push(label);
      return operation();
    });
  }
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function runSessionOperation<T>(_sessionId: string, operation: () => Promise<T>): Promise<T> {
  return operation();
}

function fakeHost(calls: Array<{ method: string; params: unknown }>, projectPath: string) {
  const sessions = new Map<string, Record<string, unknown>>([["s1", { id: "s1", title: "One", mode: "agent", permissionMode: "ask", projectPath }]]);
  let turnCount = 0;
  return {
    async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, params });
      switch (method) {
        case "settings.get":
          return {} as T;
        case "session.list":
          return { sessions: [...sessions.values()] } as T;
        case "session.get":
          return { session: sessions.get(String(params.id)) ?? null } as T;
        case "session.create": {
          const created = { id: "s2", title: params.title ?? "New", mode: params.mode ?? "agent", permissionMode: "ask", projectPath: params.projectPath };
          sessions.set("s2", created);
          return { session: created } as T;
        }
        case "session.configure": {
          const current = sessions.get(String(params.id));
          if (!current) throw Object.assign(new Error("session not found"), { errorCode: "NOT_FOUND" });
          const next = { ...current, ...(params.permissionMode ? { permissionMode: params.permissionMode } : {}), mode: params.mode };
          sessions.set(String(params.id), next);
          return { session: next } as T;
        }
        case "session.rename":
        case "session.delete":
          return { ok: true } as T;
        case "session.beginTurn":
          turnCount += 1;
          return { turnId: `turn-${turnCount}` } as T;
        case "session.appendMessage":
          return { ok: true } as T;
        case "projects.list":
          return { projects: [{ id: 7, path: projectPath, name: "proj" }] } as T;
        case "projects.create":
          return { project: { id: 8, path: params.path, name: "app" } } as T;
        case "goalReports.markFailed":
          return { report: {} } as T;
        case "goalReports.get":
          return { report: {} } as T;
        case "goalReports.list":
          return { reports: [] } as T;
        case "goalReports.retry":
          return { report: {} } as T;
        default:
          throw new Error(`unexpected ${method}`);
      }
    },
  };
}

function objectParams(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function runtimeFixture(
  calls: Array<{ method: string; params: unknown }>,
  projectPath: string,
  options: {
    beforeLaunch?: () => Promise<void>;
    flushPersistence?: () => Promise<{ pending: number; failed: string[] }>;
  } = {},
) {
  const host = fakeHost(calls, projectPath);
  const runtimeHost: RuntimeHostLink = {
    call: <T>(method: string, params?: unknown) => host.call<T>(method, objectParams(params)),
    isAvailable: () => true,
    onNotification: () => () => undefined,
    onExit: () => () => undefined,
  };
  const sidecar: RuntimeSidecarLink = {
    async call<T>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params: objectParams(params) });
      if (method === "agent.prompt") {
        return { accepted: true, turnId: objectParams(params).turnId } as T;
      }
      throw new Error(`unexpected sidecar call ${method}`);
    },
    onNotification: () => () => undefined,
    onExit: () => () => undefined,
    setProjectInstructionRoot: () => undefined,
    clearProjectInstructionRoot: () => undefined,
    clearVendorAuthBindings: () => undefined,
  };
  const launch: LaunchResolver = {
    async resolve(sessionId) {
      await options.beforeLaunch?.();
      return {
        providerId: "p1",
        modelId: "m1",
        projectPath,
        sidecarParams: {
          sessionId,
          mode: "agent",
          provider: { id: "p1", name: "P1", modelId: "m1", apiKey: "", supportsReasoning: false, supportedThinkingLevels: ["off"] },
        },
      };
    },
  };
  const service = new ObservedRuntimeService({
    getHost: () => runtimeHost,
    getSidecar: () => sidecar,
    launch,
    log: () => undefined,
  });
  const runtime = {
    compact: service.compact.bind(service),
    isBusy: service.isBusy.bind(service),
    withSessionOperation: service.withSessionOperation.bind(service),
    flushPersistence: options.flushPersistence ?? service.flushPersistence.bind(service),
  };
  return { host, runtime, service };
}

describe("pi-host operations over host-core", () => {
  it("maps sessions, creates under a project id, and refuses configuration while busy", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-host-ops-")));
    dirs.push(root);
    const calls: Array<{ method: string; params: unknown }> = [];
    let busy = false;
    const operations = createHostOperations({
      getHost: () => fakeHost(calls, root),
      runtime: { compact: async () => ({ accepted: true }), isBusy: () => busy, withSessionOperation: runSessionOperation, flushPersistence: async () => ({ pending: 0, failed: [] }) },
      browseRoot: root,
    });
    const listed = await operations.sessions.list();
    expect(listed[0]).toMatchObject({ id: "s1", workspaceLabel: root.split("/").pop() });
    const created = await operations.sessions.create({ title: "T", projectId: "7", permissionMode: "auto" }, { subject: "d", roles: ["owner"] });
    expect(created.permissionMode).toBe("auto");
    expect(calls.find((call) => call.method === "session.create")?.params).toMatchObject({ projectPath: root });
    await expect(operations.sessions.create({ projectId: "99" }, { subject: "d", roles: ["owner"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    busy = true;
    await expect(operations.sessions.configure("s1", { mode: "plan" })).rejects.toMatchObject({ code: "CONFLICT" });
    busy = false;
    expect((await operations.sessions.configure("s1", { permissionMode: "accept-edits" })).permissionMode).toBe("accept-edits");
  });

  it("registers only existing directories and browses inside the root only", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-host-ops-")));
    dirs.push(root);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "work", "app"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    const operations = createHostOperations({ getHost: () => fakeHost([], root), runtime: { compact: async () => ({ accepted: true }), isBusy: () => false, withSessionOperation: runSessionOperation, flushPersistence: async () => ({ pending: 0, failed: [] }) }, browseRoot: root });
    const registered = await operations.projects.register(join(root, "work", "app"));
    expect(registered).toMatchObject({ id: "8", label: "app" });
    await expect(operations.projects.register(join(root, "missing"))).rejects.toMatchObject({ code: "REMOTE_PATH_NOT_FOUND" });
    await expect(operations.projects.register("relative/path")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    const top = await operations.projects.browse();
    expect(top.entries.map((entry) => entry.name)).toEqual(["work"]);
    expect(top.parent).toBeUndefined();
    const nested = await operations.projects.browse(join(root, "work"));
    expect(nested.entries.map((entry) => entry.name)).toEqual(["app"]);
    expect(nested.parent).toBeDefined();
    await expect(operations.projects.browse("/")).rejects.toMatchObject({ code: "REMOTE_PATH_FORBIDDEN" });
  });

  it("serves workspace reads against the session root and refuses escapes", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-host-ops-")));
    dirs.push(root);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(root, "README.md"), "hello", "utf8");
    const operations = createHostOperations({ getHost: () => fakeHost([], root), runtime: { compact: async () => ({ accepted: true }), isBusy: () => false, withSessionOperation: runSessionOperation, flushPersistence: async () => ({ pending: 0, failed: [] }) } });
    expect((await operations.workspace.list("s1", "")).entries.map((entry) => entry.name)).toEqual(["README.md"]);
    expect(await operations.workspace.read("s1", "README.md")).toMatchObject({ kind: "text", content: "hello" });
    await expect(operations.workspace.read("s1", "../../etc/passwd")).rejects.toMatchObject({ code: "REMOTE_PATH_FORBIDDEN" });
    await expect(operations.workspace.read("s1", "nope.txt")).rejects.toMatchObject({ code: "REMOTE_PATH_FORBIDDEN" });
    await expect(operations.workspace.list("s9", "")).rejects.toBeInstanceOf(RacpError);
    const diff = await operations.workspace.diff("s1");
    expect(diff.repo).toBe(false);
  });

  it("reads and retries reports only after the persistence barrier", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-host-ops-")));
    dirs.push(root);
    const calls: Array<{ method: string; params: unknown }> = [];
    let barrier = { pending: 0, failed: [] as string[] };
    const operations = createHostOperations({
      getHost: () => fakeHost(calls, root),
      runtime: { compact: async () => ({ accepted: true }), isBusy: () => false, withSessionOperation: runSessionOperation, flushPersistence: async () => barrier },
    });
    await operations.goalReports?.get({ sessionId: "s1", reportId: "report-1" });
    await operations.goalReports?.list("s1");
    barrier = { pending: 0, failed: ["HOST_UNAVAILABLE"] };
    await expect(operations.goalReports?.retry("s1", "execution-1")).rejects.toMatchObject({ code: ErrorCodes.REPORT_PERSISTENCE_BARRIER_FAILED });
    expect(calls.map((call) => call.method)).toEqual(["goalReports.get", "goalReports.list", "goalReports.markFailed"]);
    expect(calls.at(-1)?.params).toEqual({
      sessionId: "s1",
      executionId: "execution-1",
      errorCode: ErrorCodes.REPORT_PERSISTENCE_BARRIER_FAILED,
    });
    barrier = { pending: 0, failed: [] };
    await operations.goalReports?.retry("s1", "execution-1");
    expect(calls.at(-1)?.method).toBe("goalReports.retry");
  });

  it("holds the session operation lock across the persistence barrier and report finalization", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-host-ops-")));
    dirs.push(root);
    const calls: Array<{ method: string; params: unknown }> = [];
    const barrierEntered = deferred();
    const releaseBarrier = deferred();
    const { host, runtime, service } = runtimeFixture(calls, root, {
      flushPersistence: async () => {
        barrierEntered.resolve();
        await releaseBarrier.promise;
        return { pending: 0, failed: [] };
      },
    });
    const operations = createHostOperations({
      getHost: () => host,
      runtime,
    });
    const reports = operations.goalReports;
    if (!reports) throw new Error("Goal Report operations unavailable");

    service.nextOperationLabel = "retry";
    const retry = reports.retry("s1", "execution-1");
    service.nextOperationLabel = null;
    await barrierEntered.promise;
    expect(service.operationCalls).toEqual(["retry"]);
    expect(service.operationStarts).toEqual(["retry"]);
    const prompt = service.prompt({ sessionId: "s1", content: "next turn" });
    await Promise.resolve();
    expect(service.operationCalls).toEqual(["retry", "turn"]);
    expect(service.operationStarts).toEqual(["retry"]);
    releaseBarrier.resolve();

    await expect(retry).resolves.toBeDefined();
    await expect(prompt).resolves.toMatchObject({ turnId: "turn-1" });
    expect(service.operationStarts).toEqual(["retry", "turn"]);
    const finalized = calls.findIndex((call) => call.method === "goalReports.retry");
    const admitted = calls.findIndex((call) => call.method === "session.beginTurn");
    expect(finalized).toBeGreaterThanOrEqual(0);
    expect(admitted).toBeGreaterThan(finalized);
    await service.dispose();
  });

  it("rechecks busy state after a turn admission already owns the session lock", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "pi-host-ops-")));
    dirs.push(root);
    const calls: Array<{ method: string; params: unknown }> = [];
    const launchEntered = deferred();
    const releaseLaunch = deferred();
    let barrierCalls = 0;
    const { host, runtime, service } = runtimeFixture(calls, root, {
      beforeLaunch: async () => {
        launchEntered.resolve();
        await releaseLaunch.promise;
      },
      flushPersistence: async () => {
        barrierCalls += 1;
        return { pending: 0, failed: [] };
      },
    });
    const operations = createHostOperations({
      getHost: () => host,
      runtime,
    });
    const reports = operations.goalReports;
    if (!reports) throw new Error("Goal Report operations unavailable");

    const prompt = service.prompt({ sessionId: "s1", content: "first turn" });
    await launchEntered.promise;
    expect(service.isBusy("s1")).toBe(false);
    const retry = reports.retry("s1", "execution-1");
    releaseLaunch.resolve();

    await expect(prompt).resolves.toMatchObject({ turnId: "turn-1" });
    await expect(retry).rejects.toMatchObject({ code: "CONFLICT" });
    expect(barrierCalls).toBe(0);
    expect(calls.some((call) => call.method === "goalReports.retry")).toBe(false);
    await service.dispose();
  });
});
