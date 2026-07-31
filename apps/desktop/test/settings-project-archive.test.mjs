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
const projectsStyleSource = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
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

test("project archive renders the overview, toolbar, and grouped index bands", () => {
  // Overview banner: four counters derived from the same pass as the list.
  assert.match(projectsPageSource, /projects-hero-stats/);
  for (const labelKey of [
    "project.statProjects",
    "project.statOpen",
    "project.statArchived",
    "project.statSessions",
  ]) {
    assert.match(projectsPageSource, new RegExp(labelKey.replace(".", "\\.")));
  }

  // Toolbar: clearable search with a live match count plus a sort control.
  assert.match(projectsPageSource, /projects-search-clear/);
  assert.match(projectsPageSource, /project\.clearSearch/);
  assert.match(projectsPageSource, /projects-result-count[^]*aria-live="polite"/);
  assert.match(projectsPageSource, /project\.resultCount/);
  assert.match(projectsPageSource, /projects-sort/);
  assert.match(projectsPageSource, /aria-pressed=\{sort === mode\}/);
  assert.match(projectsPageSource, /project\.sortRecent/);
  assert.match(projectsPageSource, /project\.sortName/);

  // Grouped index: archived records are a trailing section, not a filter.
  assert.match(
    projectsPageSource,
    /GROUP_ORDER: GroupId\[\] = \["pinned", "projects", "archived"\]/,
  );
  assert.match(projectsPageSource, /pinned: "project\.groupPinned"/);
  assert.match(projectsPageSource, /projects: "project\.groupProjects"/);
  assert.match(projectsPageSource, /archived: "project\.groupArchived"/);
  assert.match(projectsPageSource, /projects-group-count/);
  assert.match(projectsPageSource, /projects-empty/);
});

test("project archive row menu closes on escape and outside press", () => {
  assert.match(projectsPageSource, /addEventListener\("mousedown", onPointerDown\)/);
  assert.match(projectsPageSource, /addEventListener\("keydown", onKeyDown\)/);
  assert.match(projectsPageSource, /removeEventListener\("mousedown", onPointerDown\)/);
  assert.match(projectsPageSource, /removeEventListener\("keydown", onKeyDown\)/);
  assert.match(projectsPageSource, /"Escape"[^]*setMenuFor\(null\)/);
});

test("project archive styles group archived rows instead of hiding them", () => {
  assert.match(projectsStyleSource, /\.projects-hero-stats\s*\{/);
  assert.match(projectsStyleSource, /\.projects-sort-btn\.active\s*\{/);
  assert.match(projectsStyleSource, /\.projects-group-head\s*\{/);
  assert.doesNotMatch(projectsStyleSource, /\.projects-row-block\.archived\s*\{\s*display:\s*none/);
  assert.doesNotMatch(projectsStyleSource, /\.projects-row-block\.archived\s*\{\s*opacity/);
});
