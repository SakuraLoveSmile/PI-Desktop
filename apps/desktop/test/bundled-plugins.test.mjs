import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

/**
 * Bundled first-party plugins (ADR 0104).
 *
 * The point of shipping Files as a plugin rather than host code is that it
 * proves the public contribution channel is sufficient. These assertions guard
 * that property: the manifest must be an ordinary one, the plugin must reach
 * the panel through `contributes.views`, and it must not depend on anything a
 * third-party plugin could not also declare.
 */

const read = (path) => readFileSync(resolve(path), "utf8");
const manifest = JSON.parse(read("resources/plugins/pi.files/manifest.json"));
const view = read("resources/plugins/pi.files/views/tree.html");
const panelSource = read("src/components/workpanel/WorkPanel.tsx");
const hostProcessSource = read("electron/main/host-process.ts");
const packageJson = JSON.parse(read("package.json"));

test("Files ships as an ordinary plugin, not a privileged one", () => {
  assert.equal(manifest.id, "pi.files");
  assert.deepEqual(manifest.contributes.views.map((v) => v.id), ["tree"]);
  // Exactly the permissions a third party would have to declare for the same
  // capability — nothing host-only.
  assert.deepEqual([...manifest.permissions].sort(), ["fs.read", "ui.view"]);
  assert.equal(manifest.fs.read.root, "workspace");
  assert.deepEqual(manifest.fs.read.scope, ["**"]);
  // A localized title, because the panel menu shows it to the user.
  assert.equal(typeof manifest.contributes.views[0].title.en, "string");
  assert.equal(typeof manifest.contributes.views[0].title["zh-CN"], "string");
});

test("the Files view uses only public bridge channels", () => {
  for (const channel of ["fs.list", "fs.readText", "workspace.get", "app.getAppearance"]) {
    assert.ok(
      view.includes(`"${channel}"`),
      `expected the view to call ${channel} over the bridge`,
    );
  }
  // No Node, no Electron, no host internals: it is a sandboxed page.
  assert.doesNotMatch(view, /require\(|import\s+.*from\s+["']node:|ipcRenderer/);
  // The titlebar height is read, not hard-coded, so the same file also works
  // in a detached panel window.
  assert.match(view, /var\(--pi-plugin-titlebar-height, 0px\)/);
});

test("the host no longer offers Files as a built-in tool", () => {
  const tools = panelSource.slice(
    panelSource.indexOf("const HEADER_TOOLS = ["),
    panelSource.indexOf("] as const;", panelSource.indexOf("const HEADER_TOOLS = [")),
  );
  assert.doesNotMatch(tools, /kind: "file"/);
  // Review and Terminal are still built in; this migration is sequenced.
  assert.match(tools, /kind: "browser"/);
  // The `file` kind survives: a `file:<path>` tab is a transcript artifact
  // (a file link or plan checkpoint), not an entry in the tool launcher.
  assert.match(panelSource, /activeTab\?\.kind === "file"/);
});

test("bundled plugins are packaged and located at runtime", () => {
  assert.ok(
    packageJson.build.extraResources.some(
      (entry) => entry.from === "resources/plugins" && entry.to === "plugins",
    ),
    "resources/plugins must be copied outside the asar",
  );
  // host-core cannot know whether it runs from resources/ or a checkout, so
  // Electron resolves the directory and hands it over.
  assert.match(hostProcessSource, /function resolveBuiltinPluginsDir\(\)/);
  assert.match(hostProcessSource, /PI_DESKTOP_BUILTIN_PLUGINS_DIR/);
  assert.match(hostProcessSource, /join\(process\.resourcesPath \|\| "", "plugins"\)/);
});
