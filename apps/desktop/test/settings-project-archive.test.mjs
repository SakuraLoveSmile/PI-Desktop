import { readAppSource, readSettingsSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const settingsPageSource = await readSettingsSource();
const projectsPageSource = await readFile(
  new URL("../src/pages/ProjectsPage.tsx", import.meta.url),
  "utf8",
);
const projectsIndexSource = await readFile(
  new URL("../src/features/projects/ProjectArchiveIndex.tsx", import.meta.url),
  "utf8",
);
const projectArchiveSource = await readFile(
  new URL("../src/lib/project-archive.ts", import.meta.url),
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
const appSource = await readAppSource();
const projectsStyleSource = await loadStyles();
const projectsPartialSource = await readFile(
  new URL("../src/styles/projects.css", import.meta.url),
  "utf8",
);
const archiveUiSource = `${projectsPageSource}\n${projectsIndexSource}\n${projectArchiveSource}`;

test("settings owns the project archive destination", () => {
  assert.match(settingsSearchSource, /id: "projects"/);
  assert.match(settingsSearchSource, /titleKey: "settings\.projectArchive"/);
  assert.match(settingsPageSource, /projects: <IconArchive/);
  assert.match(settingsPageSource, /tab === "projects" && <ProjectsPage/);
  const navOrder = ["general", "agent", "import", "projects", "about"].map(
    (id) => settingsSearchSource.indexOf(`id: "${id}"`),
  );
  assert.ok(navOrder.every((index) => index >= 0));
  assert.deepEqual(navOrder, [...navOrder].sort((a, b) => a - b));
});

test("project archive includes archived projects without a visibility toggle", () => {
  assert.doesNotMatch(projectArchiveSource, /setSessionArchiveVisibility/);
  assert.match(projectArchiveSource, /Archived records are grouped last/);
  assert.match(projectsPageSource, /setSettingsTab\("projects"\)/);
  assert.match(projectArchiveSource, /if \(project\.archived === true\) return "archived"/);
});

test("project archive makes project sessions searchable and progressively visible", () => {
  assert.match(archiveUiSource, /sessionMatchesQuery/);
  assert.match(
    projectArchiveSource,
    /sessionTimestamp\(b\.updatedAt\) - sessionTimestamp\(a\.updatedAt\)/,
  );
  assert.doesNotMatch(archiveUiSource, /\.slice\(0, 4\)/);
  assert.match(projectArchiveSource, /INITIAL_VISIBLE_SESSION_COUNT = 8/);
  assert.match(projectsPageSource, /project\.sessionsCount/);
  assert.match(projectsPageSource, /project\.showMoreSessions/);
  assert.match(projectsPageSource, /project\.showFewerSessions/);
  assert.match(projectsPageSource, /projects-detail-task-updated/);
});

test("project archive is no longer a standalone app page", () => {
  assert.doesNotMatch(searchDialogSource, /page: "projects"/);
  assert.doesNotMatch(appSource, /page === "projects"/);
});

test("project archive renders the intro, toolbar, and list-inspector workbench", () => {
  assert.match(projectsPageSource, /projects-intro-desc/);
  assert.match(projectsPageSource, /project\.archiveSubtitle/);
  assert.doesNotMatch(projectsPageSource, /projects-intro-stat/);
  assert.doesNotMatch(projectsPageSource, /project\.stat[A-Z]/);

  assert.match(projectsPageSource, /projects-search-clear/);
  assert.match(projectsPageSource, /project\.clearSearch/);
  assert.match(projectsPageSource, /projects-result-count[^]*aria-live="polite"/);
  assert.match(projectsPageSource, /project\.resultCount/);
  assert.match(projectsPageSource, /"settings-segment projects-sort"/);
  assert.match(projectsPageSource, /aria-pressed=\{sort === mode\}/);
  assert.match(projectsPageSource, /project\.sortRecent/);
  assert.match(projectsPageSource, /project\.sortName/);

  assert.match(
    projectArchiveSource,
    /GROUP_ORDER: GroupId\[\] = \["pinned", "projects", "archived"\]/,
  );
  assert.match(projectArchiveSource, /pinned: "project\.groupPinned"/);
  assert.match(projectArchiveSource, /projects: "project\.groupProjects"/);
  assert.match(projectArchiveSource, /archived: "project\.groupArchived"/);
  assert.match(projectsIndexSource, /projects-group-count/);
  assert.match(projectsPageSource, /projects-empty/);

  assert.equal(projectsPageSource.match(/projects-workbench/g)?.length, 1);
  assert.match(projectsPageSource, /projects-inspector/);
  assert.match(projectsIndexSource, /projects-inspector/);
  assert.doesNotMatch(projectsPartialSource, /grid-template-columns/);
  assert.match(projectsIndexSource, /aria-labelledby=\{`projects-group-\$\{group\.id\}`\}/);
  assert.match(projectsIndexSource, /<h3 className="projects-group-label"/);
  assert.match(projectsIndexSource, /className="projects-group-rows" role="list"/);
  assert.doesNotMatch(archiveUiSource, /projects-group-head" role="presentation"/);
  assert.doesNotMatch(archiveUiSource, /projects-expand/);
  assert.match(projectsIndexSource, /onDoubleClick=\{\(\) => onActivate\(project\.path\)\}/);
  assert.match(projectsPageSource, /onActivate=\{\(path\) => void activate\(path\)\}/);
});

test("pinned projects use a distinct star glyph", () => {
  assert.match(projectsIndexSource, /IconStar/);
  assert.match(
    projectsIndexSource,
    /projects-glyph[^]*project\.pinned \? \([\s\S]*<IconStar size=\{15\} fill="currentColor" aria-hidden \/>[\s\S]*<IconFolder size=\{15\} aria-hidden \/>/,
  );
});

test("project archive row menu closes on escape and outside press", () => {
  assert.match(projectsPageSource, /<AnchoredMenu/);
  assert.match(projectsPageSource, /onClose=\{\(\) => setMenuFor\(null\)\}/);
  assert.match(projectsPageSource, /menuClassName="projects-menu"/);
  assert.match(projectsPageSource, /role="menu"/);
});

test("project archive styles group archived rows instead of hiding them", () => {
  assert.match(projectsStyleSource, /\.projects-intro-desc\s*\{/);
  assert.match(projectsStyleSource, /\.projects-sort-btn\.active\s*\{/);
  assert.match(projectsStyleSource, /\.projects-group-head\s*\{/);
  assert.match(projectsPartialSource, /\.projects-workbench\s*\{/);
  assert.match(projectsPartialSource, /\.projects-inspector\s*\{/);
  assert.doesNotMatch(projectsStyleSource, /\.projects-row-block\.archived\s*\{\s*display:\s*none/);
  assert.doesNotMatch(projectsStyleSource, /\.projects-row-block\.archived\s*\{\s*opacity/);

  assert.doesNotMatch(projectsPartialSource, /projects-hero/);
  assert.doesNotMatch(projectsPartialSource, /projects-stat/);
  assert.doesNotMatch(projectsPartialSource, /linear-gradient/);
});
