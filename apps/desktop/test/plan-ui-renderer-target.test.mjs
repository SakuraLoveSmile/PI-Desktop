import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { findDesktopRendererTarget } from "../../../scripts/e2e/boot.mjs";

const appDir = join(process.cwd(), "Fork Project", "apps", "desktop");
const rendererUrl = pathToFileURL(join(appDir, "out", "renderer", "index.html")).href;
const main = {
  type: "page",
  url: rendererUrl,
  webSocketDebuggerUrl: "ws://127.0.0.1/main",
};
const launcher = {
  ...main,
  url: `${rendererUrl}?surface=plugin-launcher`,
  webSocketDebuggerUrl: "ws://127.0.0.1/launcher",
};

test("Plan UI connects to the main renderer when the prewarmed launcher is listed first", () => {
  assert.equal(findDesktopRendererTarget([launcher, main], appDir), main);
  assert.equal(findDesktopRendererTarget([main, launcher], appDir), main);
});

test("Plan UI waits for its main renderer instead of selecting another page by title or file URL", () => {
  assert.equal(findDesktopRendererTarget([
    launcher,
    { ...main, url: "file:///other/index.html", title: "PI-Desktop" },
    { ...main, type: "worker" },
    { ...main, webSocketDebuggerUrl: undefined },
  ], appDir), undefined);
});
