import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { updateUiSsr } from "./helpers/update-ui-ssr.mjs";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));

const ENTITIES = { "&#x27;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">" };
const visibleText = (html) =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, " ")
    .trim();
const buttons = (html) => [...html.matchAll(/<button[^>]*class="btn[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => visibleText(m[1]));

test("the banner offers the restart for a downloaded assisted update and says nothing long-winded", async (t) => {
  const ui = await updateUiSsr(t);
  const html = ui.banner(ui.state({ status: "downloaded", availableVersion: "0.16.1" }));
  assert.deepEqual(buttons(html), ["Restart to update"]);
  assert.match(visibleText(html), /Version 0\.16\.1 is ready to install\./);
  assert.doesNotMatch(visibleText(html), /Developer ID/);
});

test("the banner shows download progress for the assisted lane like any other lane", async (t) => {
  const ui = await updateUiSsr(t);
  const html = ui.banner(ui.state({ status: "downloading", availableVersion: "0.16.1", progressPercent: 42 }));
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="42"/);
  assert.match(visibleText(html), /Downloading update… 42%/);
});

test("a failed in-place install is announced with a retry and the releases page", async (t) => {
  const ui = await updateUiSsr(t);
  const html = ui.banner(
    ui.state({ status: "available", availableVersion: "0.16.1", assistedInstallFailed: true, manualReminder: true }),
  );
  assert.match(visibleText(html), /Installing version 0\.16\.1 in place didn't work\./);
  assert.deepEqual(buttons(html), ["Try again", "View release"]);
});

test("a manual-mode install that failed earlier links to the release but cannot retry", async (t) => {
  const ui = await updateUiSsr(t);
  const html = ui.banner(
    ui.state({
      mode: "manual",
      preference: "manual",
      status: "available",
      availableVersion: "0.16.1",
      assistedInstallFailed: true,
      manualReminder: true,
    }),
  );
  assert.match(visibleText(html), /Installing version 0\.16\.1 in place didn't work\./);
  assert.deepEqual(buttons(html), ["View release"]);
});

test("a declined or already announced offer stays out of the banner", async (t) => {
  const ui = await updateUiSsr(t);
  // The user dismissed this version: Main keeps the lane from downloading it and the banner quiet.
  assert.equal(ui.banner(ui.state({ status: "available", availableVersion: "0.16.1", dismissed: true })), "");
  // In-app available without a failure has no banner: the lane downloads it on its own.
  assert.equal(ui.banner(ui.state({ status: "available", availableVersion: "0.16.1", manualReminder: true })), "");
  // A failure is announced once per version, the same as a manual reminder.
  assert.equal(
    ui.banner(ui.state({ status: "available", availableVersion: "0.16.1", assistedInstallFailed: true, manualReminder: false })),
    "",
  );
});

test("the manual reminder for other installs is unchanged", async (t) => {
  const ui = await updateUiSsr(t);
  const html = ui.banner(
    ui.state({
      delivery: undefined,
      mode: "manual",
      automaticSupported: false,
      status: "available",
      availableVersion: "0.16.1",
      manualReminder: true,
    }),
  );
  assert.match(visibleText(html), /Version 0\.16\.1 is available\./);
  assert.deepEqual(buttons(html), ["View release"]);
});

test("Settings explains what Automatic does on an assisted install", async (t) => {
  const ui = await updateUiSsr(t);
  const html = ui.row(ui.state({ preference: "manual", status: "idle" }));
  const text = visibleText(html);
  assert.match(text, /isn't signed with an Apple Developer ID/);
  assert.match(text, /verifies its published checksum/);
  assert.match(text, /previous version is kept as a backup/);
  assert.doesNotMatch(text, /portable copy/);
});

test("other installs keep their own notes", async (t) => {
  const ui = await updateUiSsr(t);
  const portable = ui.row(ui.state({ delivery: undefined, preference: "manual", status: "idle" }));
  assert.match(visibleText(portable), /portable copy/);
  assert.doesNotMatch(visibleText(portable), /Apple Developer ID/);
  const unsupported = ui.row(
    ui.state({ delivery: undefined, automaticSupported: false, mode: "manual", preference: "manual", status: "idle" }),
  );
  assert.match(visibleText(unsupported), /Automatic installation isn't supported by this package\./);
});

for (const [reason, pattern] of [
  ["translocated", /opened this app from a temporary location/],
  ["read-only", /read-only volume/],
  ["not-writable", /can't change the folder this app is in/],
  ["symlink", /opened through a link or alias/],
]) {
  test(`a blocked ad-hoc install says what to do about "${reason}"`, async (t) => {
    const ui = await updateUiSsr(t);
    const html = ui.row(
      ui.state({
        delivery: undefined,
        automaticSupported: false,
        mode: "manual",
        preference: "manual",
        status: "idle",
        assistedBlockedReason: reason,
      }),
    );
    assert.match(visibleText(html), pattern);
    assert.doesNotMatch(visibleText(html), /isn't supported by this package/);
  });
}

test("the Settings action follows the state of the assisted lane", async (t) => {
  const ui = await updateUiSsr(t);
  const action = (overrides) => buttons(ui.row(ui.state(overrides))).filter((label) => label !== "Release notes");
  assert.deepEqual(action({ status: "idle" }), ["Check for updates"]);
  assert.deepEqual(action({ status: "available", availableVersion: "0.16.1" }), ["Download"]);
  assert.deepEqual(
    action({ status: "available", availableVersion: "0.16.1", assistedInstallFailed: true }),
    ["Try again"],
  );
  assert.deepEqual(action({ status: "downloaded", availableVersion: "0.16.1" }), ["Restart to update"]);
  assert.deepEqual(
    action({ mode: "manual", preference: "manual", status: "available", availableVersion: "0.16.1" }),
    ["View release"],
  );
  // The explicit download exists only on the assisted lane.
  assert.deepEqual(
    action({ delivery: undefined, status: "available", availableVersion: "0.16.1" }),
    ["Check for updates"],
  );
});

test("Settings reports a failed install and a download error in plain words", async (t) => {
  const ui = await updateUiSsr(t);
  const failed = visibleText(
    ui.row(ui.state({ status: "available", availableVersion: "0.16.1", assistedInstallFailed: true })),
  );
  assert.match(failed, /Installing version 0\.16\.1 in place didn't work\. Try again, or download it from the releases page\./);
  const error = visibleText(ui.row(ui.state({ status: "error", error: "the download does not match the release" })));
  assert.match(error, /Couldn't check for updates: the download does not match the release/);
});

test("the assisted copy exists in a non-English catalog too", async (t) => {
  const ui = await updateUiSsr(t, "zh-CN");
  const html = ui.row(ui.state({ status: "available", availableVersion: "0.16.1", assistedInstallFailed: true }));
  assert.match(visibleText(html), /原地安装 0\.16\.1 版本失败/);
  assert.match(visibleText(html), /Apple Developer ID/);
  assert.doesNotMatch(visibleText(html), /updates\.assisted/);
});
