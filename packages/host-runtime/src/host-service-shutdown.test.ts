import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { HostProcess } from "./host-process.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    pid: 123, exitCode: null, killed: false, kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
  const host = new HostProcess({ binaryPath: "/fixture/host", dataDir: "/fixture/data", onStderr: () => {} });
  return { child, host };
}

it("lets service TERM escalation and reaping finish before forcing Host shutdown", async () => {
  vi.useFakeTimers();
  const { child, host } = fixture();
  const disposed = host.dispose();
  expect(child.stdin.writableEnded).toBe(true);
  await vi.advanceTimersByTimeAsync(6_500);
  expect(child.kill).not.toHaveBeenCalled();
  child.emit("exit", 0, null);
  await disposed;
  expect(child.kill).not.toHaveBeenCalled();
});

it("still bounds an unresponsive Host and shares duplicate disposal", async () => {
  vi.useFakeTimers();
  const { child, host } = fixture();
  const first = host.dispose();
  const duplicate = host.dispose();
  await vi.advanceTimersByTimeAsync(8_000);
  expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  child.emit("exit", null, "SIGKILL");
  await Promise.all([first, duplicate]);
  expect(child.kill).toHaveBeenCalledTimes(1);
});
