import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsPageSource = await readFile(
  new URL("../src/pages/SettingsPage.tsx", import.meta.url),
  "utf8",
);
const projectsPageSource = await readFile(
  new URL("../src/pages/ProjectsPage.tsx", import.meta.url),
  "utf8",
);
const settingsSearchSource = await readFile(
  new URL("../src/lib/settings-search.ts", import.meta.url),
  "utf8",
);
const searchDialogSource = await readFile(
  new URL("../src/components/SearchDialog.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);

test("settings owns the project archive destination", () => {
  assert.match(settingsSearchSource, /id: "projects"/);
  assert.match(settingsSearchSource, /labelKey: "settings\.projectArchive"/);
  assert.match(settingsPageSource, /projects: <IconArchive/);
  assert.match(settingsPageSource, /tab === "projects" && <ProjectsPage/);
  const navOrder = ["general", "agent", "import", "projects", "about"].map(
    (id) => settingsSearchSource.indexOf(`id: "${id}"`),
  );
  assert.ok(navOrder.every((index) => index >= 0));
  assert.deepEqual(navOrder, [...navOrder].sort((a, b) => a - b));
});

test("project archive includes archived projects without a visibility toggle", () => {
  assert.doesNotMatch(
    projectsPageSource,
    /filter\(\(project\).*project\.archived/s,
  );
  assert.doesNotMatch(projectsPageSource, /setSessionArchiveVisibility/);
  assert.match(projectsPageSource, /setSettingsTab\("projects"\)/);
});

test("project archive makes project sessions searchable and progressively visible", () => {
  assert.match(projectsPageSource, /sessionMatchesQuery/);
  assert.match(projectsPageSource, /sessionTimestamp\(b\.updatedAt\) - sessionTimestamp\(a\.updatedAt\)/);
  assert.doesNotMatch(projectsPageSource, /\.slice\(0, 4\)/);
  assert.match(projectsPageSource, /INITIAL_VISIBLE_SESSION_COUNT = 8/);
  assert.match(projectsPageSource, /project\.sessionsCount/);
  assert.match(projectsPageSource, /project\.showMoreSessions/);
  assert.match(projectsPageSource, /project\.showFewerSessions/);
  assert.match(projectsPageSource, /projects-detail-task-updated/);
});

test("project archive is no longer a standalone app page", () => {
  assert.doesNotMatch(searchDialogSource, /page: "projects"/);
  assert.doesNotMatch(appSource, /page === "projects"/);
});
