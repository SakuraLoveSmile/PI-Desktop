import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("panorama geometry matches the 304 by 140 card grid and edge anchors", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const geometry = await server.ssrLoadModule(
      "/src/components/workpanel/agent-panorama-viewport.ts",
    );
    const layout = geometry.createPanoramaLayout(["a", "b", "c", "d"]);

    assert.equal(layout.width, 960);
    assert.equal(layout.height, 612);
    assert.deepEqual(layout.root, { id: "root", x: 328, y: 40 });
    assert.deepEqual(layout.children, [
      { id: "a", x: 0, y: 260 },
      { id: "b", x: 328, y: 260 },
      { id: "c", x: 656, y: 260 },
      { id: "d", x: 328, y: 432 },
    ]);
    assert.equal(layout.root.x + 152, layout.children[1].x + 152);
    assert.equal(layout.root.y + 140 + 80, layout.children[0].y);
    assert.equal(layout.children[3].y - layout.children[0].y - 140, 32);
  } finally {
    await server.close();
  }
});

test("fit and manual viewport transitions preserve the chosen world point", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const viewport = await server.ssrLoadModule(
      "/src/components/workpanel/agent-panorama-viewport.ts",
    );
    const geometry = { width: 960, height: 612 };
    const fitted = viewport.fittedViewport(800, 600, geometry);
    assert.equal(fitted.mode, "fit");
    assert.equal(fitted.zoom, 752 / 960);
    assert.equal(fitted.x, 24);
    assert.equal(fitted.y, 64);

    const initial = { zoom: 1, x: 80, y: 100, mode: "fit" };
    const zoomed = viewport.zoomedViewport(initial, 1.1, 200, 150);
    assert.deepEqual(zoomed, { zoom: 1.1, x: 68, y: 95, mode: "manual" });
    assert.deepEqual(
      viewport.pannedViewport(zoomed, -40, 30),
      { zoom: 1.1, x: 28, y: 125, mode: "manual" },
    );
    assert.deepEqual(
      viewport.refreshFittedViewport(zoomed, fitted),
      zoomed,
      "topology and container updates must leave a manual viewport untouched",
    );
    assert.deepEqual(
      viewport.refreshFittedViewport(initial, fitted),
      fitted,
      "fit mode follows a new fitted geometry",
    );

    const reset = viewport.resetViewport(800, geometry);
    assert.deepEqual(reset, { zoom: 1, x: -80, y: 64, mode: "manual" });
    assert.ok(reset.y + 40 > 90, "reset keeps the root below the top toolbar");
    assert.equal(viewport.zoomedViewport(initial, 4, 200, 150).zoom, 1.5);
    assert.equal(viewport.zoomedViewport(initial, 0.1, 200, 150).zoom, 0.5);
  } finally {
    await server.close();
  }
});

test("the canvas uses pointer capture selectors and exposes drag state for integration checks", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../src/components/workpanel/AgentPanorama.tsx", import.meta.url), "utf8");
    const controller = await readFile(new URL("../src/components/workpanel/agent-panorama-viewport.ts", import.meta.url), "utf8");
    assert.match(source, /data-panorama-canvas/);
    assert.match(source, /data-panorama-toolbar/);
    assert.match(source, /data-panorama-tool/);
    assert.match(source, /data-panorama-node/);
    assert.match(source, /data-panorama-zoom=\{viewport\.zoom\}/);
    assert.match(source, /data-panorama-pan-x=\{viewport\.x\}/);
    assert.match(source, /data-panorama-pan-y=\{viewport\.y\}/);
    assert.match(source, /statusLabel \?\? statusLabels\[status\]/);
    assert.match(source, /renderStatusBadge\(rootNode\.status, rootNode\.statusLabel\)/);
    assert.match(source, /renderStatusBadge\(child\.status, child\.statusLabel\)/);
    assert.match(controller, /setPointerCapture\(event\.pointerId\)/);
    assert.match(controller, /onPointerCancel: endPan/);
    assert.match(controller, /onLostPointerCapture/);
    assert.match(controller, /active\.scopeKey !== scopeKey/);
    assert.match(controller, /releasePointerCapture\(active\.pointerId\)/);
  } finally {
    await server.close();
  }
});
