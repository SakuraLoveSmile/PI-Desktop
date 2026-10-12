import { app, BrowserWindow, ipcMain } from "electron";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { Host, resolveHostBinary } from "./host.mjs";
import { registerSessionActivityIpc } from "../../apps/desktop/electron/main/ipc/session-activity-ipc.ts";

const scratch = process.argv[2];
app.setPath("userData", join(scratch, "profile"));
const host = new Host(resolveHostBinary(), join(scratch, "host-data"));
app.on("window-all-closed", () => app.quit());
app.whenReady().then(async () => {
 let window;
 try {
  await host.start();
  const { session } = await host.call("session.create", {});
  const { turnId } = await host.call("session.beginTurn", { sessionId: session.id });
  const append = (message) => host.call("session.appendMessage", { sessionId: session.id, turnId, message: { createdAt: "2026-10-10T00:00:00Z", ...message } });
  await append({ id: "old-write", role: "tool", content: "PRIVATE OUTPUT", toolName: "Write", toolStatus: "success", toolArgs: { path: "/isolated/old-result.txt", content: "PRIVATE CONTENT" } });
  const task = (status) => ({ id: "old-task", role: "tool", content: `Task ${status}`, toolName: "Task", toolCallId: "old-task", toolStatus: "success", toolArgs: { agent: "Historical reviewer", task: "Review old canonical history" }, toolResult: { details: { delegationId: "old-delegate", status, startedAt: 10, ...(status === "completed" ? { completedAt: 20 } : {}) } } });
  await append(task("running"));
  await append(task("completed"));
  await append({ id: "old-source", role: "assistant", content: "PRIVATE SEARCH", hostedSearch: { rounds: [{ sources: [{ url: "https://example.com/old-reference", title: "Old reference" }] }] } });
  for (let n = 0; n < 65; n++) await append({ id: `tail-${n}`, role: "tool", content: "Written", toolName: "Write", toolStatus: "success", toolArgs: { path: `/isolated/new/file-${n}.txt` } });
  const { session: tail } = await host.call("session.get", { id: session.id, messageLimit: 5 });
  assert.equal(tail.messages.length, 5);
  assert.ok(tail.messages.every((message) => message.id.startsWith("tail-")));
  const offsets = [];
  registerSessionActivityIpc({
    getHost: () => ({ call: (method, params) => { if (method === "sessionActivity.get") offsets.push(params.offset); return host.call(method, params); } }),
    handle: (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
      assert.equal(event.sender, window.webContents);
      try { return { ok: true, data: await handler(...args) }; }
      catch (error) { return { ok: false, error: { code: error.errorCode ?? "PROBE_RPC_ERROR", message: error.message } }; }
    }),
  });
  window = new BrowserWindow({ width: 400, height: 900, show: false, webPreferences: { preload: join(scratch, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => console.error(event.message));
  await window.loadFile(join(scratch, "index.html"));
  const result = await window.webContents.executeJavaScript(`globalThis.sessionActivityHistoryProbe(${JSON.stringify(tail)})`);
  assert.deepEqual(offsets, [0, 50], "production renderer reader drains both real IPC/Host pages");
  if (process.env.PI_SESSION_ACTIVITY_HISTORY_SCREENSHOT) {
    const screenshot = process.env.PI_SESSION_ACTIVITY_HISTORY_SCREENSHOT;
    await writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(() => {
      const output = [...document.querySelectorAll('[data-activity-group="outputs"] [data-activity-id]')]
        .find(element => element.textContent.includes('old-result.txt'));
      output.scrollIntoView({ block: 'center' });
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    await writeFile(screenshot.replace(/\.png$/, "") + "-historical-artifacts.png", (await window.webContents.capturePage()).toPNG());
  }
  console.log("SESSION_ACTIVITY_HISTORY_PROBE " + JSON.stringify({ ...result, loadedMessages: tail.messages.length, hostOutputCount: 66, offsets }));
  await host.stop();
  app.quit();
 } catch (error) {
  console.error("SESSION_ACTIVITY_HISTORY_PROBE " + JSON.stringify({ ok: false, error: error.stack ?? String(error) }));
  await host.stop();
  app.exit(1);
 }
});
