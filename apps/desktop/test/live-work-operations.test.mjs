import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("Live work status renders the exact terminal summary as escaped text", async (t) => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => server.close());

  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { LiveWorkOperations } = await server.ssrLoadModule("/src/features/voice/live/LiveWorkOperations.tsx");
  const html = renderToStaticMarkup(React.createElement(LiveWorkOperations, {
    sessionId: "session-a",
    operations: [{
      operationId: "operation-1",
      admission: "accepted",
      execution: "completed",
      summary: "Fixed the login bug. <script>ignored</script>",
    }],
    t: (key) => key,
    busyOperationId: null,
    setBusyOperationId() {},
    setMessage() {},
  }));

  assert.match(html, /liveVoice\.workStatus\.completed/);
  assert.match(html, /Fixed the login bug\./);
  assert.match(html, /&lt;script&gt;ignored&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
