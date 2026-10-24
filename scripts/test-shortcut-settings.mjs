/** Exercise the production shortcut component in isolated Electron/Chromium. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repositoryRoot, resolveElectronBinary } from "./e2e/boot.mjs";

const root = repositoryRoot();
const temp = await mkdtemp(join(tmpdir(), "pi-shortcut-settings-"));
const { build } = createRequire(new URL("../packages/agent-runtime/package.json", import.meta.url))("esbuild");
try {
  await build({
    stdin: {
      resolveDir: join(root, "apps/desktop"), loader: "jsx",
      contents: `
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { KeyboardShortcutsSection } from "./src/components/settings/KeyboardShortcutsSection";
window.IS_REACT_ACT_ENVIRONMENT = true;
await i18n.use(initReactI18next).init({ lng: "en", keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } } });
const root = createRoot(document.getElementById("root"));
const check = (value, message) => { if (!value) throw new Error(message); };
const label = (action, id) => i18n.t("settings.shortcut" + action, {
  action: i18n.t("settings.shortcutAction." + id),
});
const button = (name) => {
  const found = [...document.querySelectorAll("button")].find(b =>
    b.getAttribute("aria-label") === name || b.textContent === name);
  check(found && !found.disabled, "Missing enabled button: " + name);
  return found;
};
const click = async (name) => { await act(async () => button(name).click()); };
const search = async (value) => {
  const element = document.querySelector('input[aria-label="' + i18n.t("settings.shortcutSearch") + '"]');
  check(element, "Search is available");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const bind = async (id, platform, key) => {
  await click(label("Change", id));
  await act(async () => button(label("Change", id)).dispatchEvent(new KeyboardEvent("keydown", {
    key, bubbles: true, cancelable: true,
    metaKey: platform === "darwin", ctrlKey: platform !== "darwin",
  })));
};
window.runTests = async () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    let saved;
    function Harness() {
      const [settings, setSettings] = useState({ keybindings: {} });
      saved = settings.keybindings;
      return <KeyboardShortcutsSection settings={settings} platform={platform}
        saveSettings={async patch => setSettings(s => ({ ...s, ...patch }))} />;
    }
    await act(async () => root.render(<Harness key={platform} />));
    await click(label("Disable", "newTask"));
    check(saved.newTask === null, "Disable must persist Unbound");
    await bind("openSearch", platform, "n");
    check(saved.openSearch === "Mod+N", "Search can use the freed binding");
    await click(label("Reset", "newTask"));
    check(saved.newTask === null && saved.openSearch === "Mod+N",
      platform + ": conflicting reset must preserve both mappings");
    check(document.querySelector('[role="alert"]')?.textContent ===
      i18n.t("settings.shortcutConflict", { action: i18n.t("settings.shortcutAction.openSearch") }),
      "Reset must identify the conflicting action inline");
    await click(label("Reset", "openSearch"));
    await click(label("Reset", "newTask"));
    check(Object.keys(saved).length === 0, "Reset succeeds once the default is free");
    await bind("openSearch", platform, "n");
    check(Object.keys(saved).length === 0 && document.querySelector('[role="alert"]'),
      "Manual assignment must still reject conflicts");
    await bind("newTask", platform, "F8");
    await bind("openSearch", platform, "n");
    await click(label("Reset", "newTask"));
    check(saved.newTask === "Mod+F8" && saved.openSearch === "Mod+N",
      "Conflicting reset must preserve a custom binding too");
    await click(i18n.t("settings.shortcutResetAll"));
    check(Object.keys(saved).length === 0 && !document.querySelector('[role="alert"]'),
      "Global reset must clear overrides and errors together");
    await search(i18n.t("settings.shortcutAction.newTask"));
    check(document.querySelectorAll(".shortcut-row").length === 1,
      "Action search finds the corresponding shortcut");
    await search("Mod+N");
    check(document.querySelectorAll(".shortcut-row").length === 1 &&
      document.querySelector(".shortcut-row").textContent.includes(i18n.t("settings.shortcutAction.newTask")),
      "Binding search accepts the canonical shortcut on every platform");
    await search("");
    await click(label("Disable", "newTask"));
    await click(i18n.t("settings.shortcutFilterModified"));
    check(document.querySelectorAll(".shortcut-row").length === 1 &&
      saved.newTask === null, "Modified filter includes explicitly disabled shortcuts");
    await click(label("Reset", "newTask"));
    check(document.querySelectorAll(".shortcut-row").length === 0 &&
      document.body.textContent.includes(i18n.t("settings.shortcutNoMatches")),
      "Reset removes the override and updates the modified empty state");
    await click(i18n.t("settings.shortcutClearFilters"));
    await click(label("Change", "newTask"));
    check(document.body.textContent.includes(i18n.t("settings.shortcutRecordingCancel")),
      "Recording exposes its cancellation method");
    await act(async () => button(label("Change", "newTask")).dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", isComposing: true, bubbles: true, cancelable: true,
    })));
    check(button(label("Change", "newTask")).getAttribute("aria-pressed") === "true" &&
      !document.querySelector('[role="alert"]'), "IME confirmation does not record a shortcut");
    await act(async () => button(label("Change", "newTask")).dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true,
    })));
    check(button(label("Change", "newTask")).getAttribute("aria-pressed") === "false" &&
      Object.keys(saved).length === 0, "Escape cancels without changing bindings");
  }
  let rejectReset = true;
  let remaining;
  function FailureHarness() {
    const [settings, setSettings] = useState({ keybindings: { newTask: null } });
    remaining = settings.keybindings;
    return <KeyboardShortcutsSection settings={settings} platform="darwin" saveSettings={async patch => {
      if (rejectReset) throw new Error("Reset rejected");
      setSettings(s => ({ ...s, ...patch }));
    }} />;
  }
  await act(async () => root.render(<FailureHarness />));
  await click(i18n.t("settings.shortcutResetAll"));
  check(remaining.newTask === null && document.querySelector('[role="alert"]')?.textContent === "Reset rejected",
    "Failed global reset keeps settings and exposes a retryable error");
  rejectReset = false;
  await click(i18n.t("settings.shortcutResetAll"));
  check(Object.keys(remaining).length === 0 && !document.querySelector('[role="alert"]'),
    "Retry clears overrides and the failed-reset state");
  await act(async () => root.unmount());
  return "PASS: shortcut search, key search, modified filter, recording/IME, conflict-safe reset, failure/retry on three platforms";
};`,
    },
    outfile: join(temp, "fixture.js"), bundle: true, format: "esm", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" },
  });
  await writeFile(join(temp, "index.html"), '<div id="root"></div><script type="module" src="fixture.js"></script>');
  await writeFile(join(temp, "runner.cjs"), `
const { app, BrowserWindow } = require("electron");
app.setPath("userData", ${JSON.stringify(join(temp, "profile"))});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadFile(${JSON.stringify(join(temp, "index.html"))});
    console.log(await win.webContents.executeJavaScript("window.runTests()"));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "runner.cjs")], { env, stdio: "inherit" });
  const timeout = setTimeout(() => child.kill(), 30_000);
  const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
  clearTimeout(timeout);
  assert.equal(code, 0, "Mounted shortcut interaction regression");
} finally {
  await rm(temp, { recursive: true, force: true });
}
