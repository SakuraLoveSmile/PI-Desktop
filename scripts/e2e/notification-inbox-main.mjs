// Isolated Electron/SQLite fixture. Production notification IPC and shell badge
// execute unchanged; no native notification is shown and no provider is called.
import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { Host } from "./host.mjs";
import { IPC } from "../../packages/shared/src/index.ts";
import { registerNotificationIpc } from "../../apps/desktop/electron/main/ipc/notification-ipc.ts";
import { createTaskbarUnreadBadge } from "../../apps/desktop/electron/main/taskbar-unread-badge.ts";

const [fixtureDir, hostBinary] = process.argv.slice(2);
app.setPath("userData", join(fixtureDir, "profile"));
let host, win, badge, watchdog, seeded;
const handlers = new Map();
const routes = new Map([
  [IPC.invoke.sessionGet, "session.get"],
  [IPC.invoke.sessionList, "session.list"],
  [IPC.invoke.plansPending, "plans.pending"],
  [IPC.invoke.goalReportList, "goalReports.list"],
]);
async function stop(code) {
  clearTimeout(watchdog);
  await host?.stop();
  app.setBadgeCount(0);
  app.exit(code);
}
app.whenReady().then(async () => {
  try {
    host = new Host(hostBinary, join(fixtureDir, "host-data"));
    await host.start();
    win = new BrowserWindow({ show: false, width: 620, height: 640,
      webPreferences: { preload: join(fixtureDir, "preload.cjs"), sandbox: true,
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on("console-message", (event) => console.error(event.message));
    badge = createTaskbarUnreadBadge({ getHost: () => host, getMainWindow: () => win,
      isQuitting: () => false, logger: { app: (...args) => console.error(...args) } });
    registerNotificationIpc({ registrar: { handle: (channel, handler) => handlers.set(channel, handler) },
      getHost: () => host, getMainWindow: () => win, getViewingSessionId: () => null,
      setViewingSessionId: () => {}, sendToRenderer: (channel, payload) => win.webContents.send(channel, payload) });
    ipcMain.handle("fixture:invoke", async (_event, channel, input) => {
      try {
        let data;
        if (handlers.has(channel)) data = await handlers.get(channel)(input);
        else if (channel === IPC.invoke.pendingInteractive) data = { asks: [], permissions: [] };
        else if (routes.has(channel)) data = await host.call(routes.get(channel), input);
        else throw new Error("Unexpected fixture IPC: " + channel);
        badge.observeInvoke(channel);
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: { code: error.errorCode || "INTERNAL", message: error.message } };
      }
    });
    async function createOutcome(input, deliverEvent) {
      const { session } = await host.call("session.create", { title: input.title, mode: "agent" });
      const { turnId } = await host.call("session.beginTurn", { sessionId: session.id });
      const ended = await host.call("session.endTurn", { turnId, status: input.failed ? "error" : "completed",
        ...(input.failed ? { errorCode: "FIXTURE_FAILURE" } : {}), createNotification: true });
      if (!ended.notification) throw new Error("Terminal turn did not produce a durable notification");
      // Main is the RPC-to-IPC transport edge, just as production turn dispatch.
      if (deliverEvent) {
        const payload = { notification: ended.notification };
        win.webContents.send(IPC.event.notificationChanged, payload);
        badge.observeEvent(IPC.event.notificationChanged, payload);
      }
      return { session, notification: ended.notification };
    }
    seeded = await createOutcome({ title: "Successful task" }, false);
    await badge.refresh();
    ipcMain.handle("fixture:action", async (_event, name, input) => {
      if (name === "seed") return seeded;
      if (name === "create") return createOutcome(input, true);
      if (name === "dock") {
        // Explicit sync to the real refresh promise, with real native count readback.
        await badge.refresh();
        return app.getBadgeCount();
      }
      if (name === "list") return host.call("notification.list", { limit: 200 });
      if (name === "screenshot") {
        if (process.env.PI_DESKTOP_NOTIFICATION_EVIDENCE) {
          await writeFile(process.env.PI_DESKTOP_NOTIFICATION_EVIDENCE, (await win.webContents.capturePage()).toPNG());
        }
        return;
      }
      throw new Error("Unknown fixture action: " + name);
    });
    watchdog = setTimeout(() => { console.error("Notification scenario timed out"); void stop(1); }, 45_000);
    await win.loadFile(join(fixtureDir, "index.html"));
    const firstLoad = await win.webContents.executeJavaScript("window.notificationInboxProbe({ reloadOnly: true })");
    const loaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    win.reload();
    await loaded;
    const result = await win.webContents.executeJavaScript("window.notificationInboxProbe()");
    result.firstLoad = firstLoad;
    result.rendererReload = true;
    console.log("NOTIFICATION_INBOX " + JSON.stringify(result));
    await stop(0);
  } catch (error) { console.error(error); await stop(1); }
});
