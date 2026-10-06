import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";

test("panorama exposes icon-only controls, decorative state glyphs and valid button content", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { AgentPanorama } = await server.ssrLoadModule("/src/components/workpanel/AgentPanorama.tsx");
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: { team: {
      back: "Back", zoomOut: "Zoom out", zoomIn: "Zoom in", zoomFit: "Fit", zoomReset: "Reset",
    } } } } });
    const states = { running: "loader", completed: "circle-check", failed: "circle-x",
      paused: "circle-pause", blocked: "circle-dashed", idle: "circle", todo: "circle" };
    const render = (onBack) => renderToStaticMarkup(createElement(I18nextProvider, { i18n },
      createElement(AgentPanorama, {
        rootNode: { id: "lead", name: "Lead Agent", task: "Coordinate", status: "idle", statusLabel: "Waiting for team members" },
        childNodes: Object.keys(states).map((status) => ({ id: status, name: status, task: "Subject", status })),
        onSelectNode() {}, onBack, viewportScopeKey: "fixture", onViewportSave() {},
      })));
    const html = render(() => {});
    const controls = Array.from(html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g));
    for (const label of ["Back", "Zoom out", "Zoom in", "Fit", "Reset"]) {
      const button = controls.find((match) => match[1].includes(`aria-label="${label}"`));
      assert.ok(button, `missing accessible ${label} control`);
      assert.match(button[2], /^<svg/);
      assert.doesNotMatch(button[2], /<div|<span/);
    }
    assert.doesNotMatch(render(undefined), /aria-label="Back"/);
    for (const [status, glyph] of Object.entries(states)) {
      assert.match(html, new RegExp(`agent-panorama-status-badge status-${status}"><svg[^>]*lucide-${glyph}[\\s\\S]*?aria-hidden="true"`));
    }
    assert.match(html, /Waiting for team members/);
    assert.match(html, /width="32" height="32"/);
    assert.ok(controls.every((match) => !match[2].includes("<div")), "node buttons must contain phrasing elements");
  } finally {
    await server.close();
  }
});

test("panorama geometry matches the 276 by 86 two-column grid and edge anchors", async () => {
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
    const cases = [
      { width: 276, height: 166, root: [0, 40], children: [] },
      { width: 276, height: 316, root: [0, 40], children: [[0, 190]] },
      { width: 594, height: 316, root: [159, 40], children: [[0, 190], [318, 190]] },
      { width: 594, height: 498, root: [159, 40], children: [[0, 190], [318, 190], [159, 372]] },
      { width: 594, height: 498, root: [159, 40], children: [[0, 190], [318, 190], [0, 372], [318, 372]] },
    ];
    for (const [count, expected] of cases.entries()) {
      const ids = Array.from({ length: count }, (_, index) => `child-${index}`);
      const layout = geometry.createPanoramaLayout(ids);
      assert.equal(layout.width, expected.width);
      assert.equal(layout.height, expected.height);
      assert.deepEqual(layout.root, { id: "root", x: expected.root[0], y: expected.root[1] });
      assert.deepEqual(layout.children, expected.children.map(([x, y], index) => ({ id: ids[index], x, y })));
    }
    const edges = (count) => {
      const layout = geometry.createPanoramaLayout(Array.from({ length: count }, (_, index) => `${index}`));
      return layout.children.map(({ x, y }) => geometry.panoramaEdgePath(layout.root.x + 138, layout.root.y + 86, x + 138, y));
    };
    assert.deepEqual(edges(3), [
      "M 297 126 C 297 172, 138 144, 138 190",
      "M 297 126 C 297 172, 456 144, 456 190",
      "M 297 126 C 297 172, 297 326, 297 372",
    ]);
    assert.deepEqual(edges(4).slice(2), [
      "M 297 126 C 297 172, 138 326, 138 372",
      "M 297 126 C 297 172, 456 326, 456 372",
    ]);
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
