import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const LOCALE_IDS = ["en", "zh-CN", "zh-TW", "de", "es", "fr", "ko", "tr"];

/** Every catalog key the delete-project flow adds to `project`. */
const DELETE_KEYS = [
  "delete",
  "deleteTitle",
  "deleteDescription",
  "deleteSessions_one",
  "deleteSessions_other",
  "deleteFolderKept",
  "deleteConfirm",
  "deleteCancel",
  "deleting",
  "deleted",
];

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [dialogSource, projectsSource, sidebarSource, ...localeSources] = await Promise.all([
  read("../src/components/ProjectDeleteDialog.tsx"),
  read("../src/pages/ProjectsPage.tsx"),
  read("../src/components/Sidebar.tsx"),
  ...LOCALE_IDS.map((id) => read(`../../../packages/i18n/src/locales/${id}/index.ts`)),
]);

const catalogs = new Map(LOCALE_IDS.map((id, index) => [id, localeSources[index]]));

function placeholders(value) {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}|{([A-Za-z_][A-Za-z0-9_]*)}/g)]
    .map((match) => match[1] ?? match[2])
    .sort();
}

/**
 * Only the `project` block: `delete` and `deleteTitle` also exist in other
 * blocks of the same catalog, so a file-wide lookup would match the wrong key.
 */
function projectBlock(source) {
  const start = source.search(/^  "?project"?: \{/m);
  assert.ok(start >= 0, "project block starts");
  const rest = source.slice(start + 1);
  const end = rest.search(/^  "?pulls"?: \{/m);
  assert.ok(end > 0, "project block ends");
  return rest.slice(0, end);
}

function projectValue(block, key) {
  const match = block.match(new RegExp(`^    "?${key}"?:\\s*"([^"]*)"`, "m"));
  assert.ok(match, `${key} is defined in the project block`);
  return match[1];
}

test("the delete dialog is a real confirmation backed by the store action", () => {
  assert.match(dialogSource, /export function ProjectDeleteDialog/);
  assert.match(dialogSource, /const deleteProject = useAppStore\(\(s\) => s\.deleteProject\)/);
  assert.match(dialogSource, /await deleteProject\(project\.path\)/);
  assert.match(dialogSource, /onDeleted/);
  assert.match(dialogSource, /onError\(error\)/);
});

test("the delete dialog names the sessions and keeps the folder on disk", () => {
  assert.match(dialogSource, /t\("project\.deleteSessions", \{ count: project\.sessionCount \}\)/);
  assert.match(dialogSource, /t\("project\.deleteDescription", \{ name: project\.name \}\)/);
  assert.match(dialogSource, /t\("project\.deleteFolderKept"\)/);
  assert.match(dialogSource, /createPortal\(dialog, document\.body\)/);
});

test("the delete dialog is a labelled modal that blocks cancel while busy", () => {
  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-labelledby="project-delete-dialog-title"/);
  assert.match(dialogSource, /id="project-delete-dialog-title"/);
  assert.match(dialogSource, /aria-describedby="project-delete-dialog-description/);
  for (const id of [
    "project-delete-dialog-description",
    "project-delete-dialog-sessions",
    "project-delete-dialog-folder-kept",
  ]) {
    assert.match(dialogSource, new RegExp(`id="${id}"`));
  }
  assert.match(dialogSource, /event\.key === "Escape"/);
  assert.match(dialogSource, /disabled=\{busy\}/);
  assert.match(dialogSource, /busy \? t\("project\.deleting"\) : t\("project\.deleteConfirm"\)/);
});

test("both project menus expose a destructive delete action", () => {
  for (const [surface, source] of [
    ["ProjectsPage", projectsSource],
    ["Sidebar", sidebarSource],
  ]) {
    assert.match(source, /className="danger"\s+data-action="delete-project"/, surface);
    assert.match(source, /<ProjectDeleteDialog/, surface);
  }

  // The delete item follows the archive/restore item and opens the dialog.
  assert.ok(
    projectsSource.indexOf('data-action="delete-project"') >
      projectsSource.indexOf("toggleProjectArchive(project)"),
    "ProjectsPage orders delete after archive",
  );
  assert.match(projectsSource, /sessionCount: totalSessions/);
  assert.match(projectsSource, /setDeleteFor\(\{/);
  assert.match(
    projectsSource,
    /setRecents\(loadRecentProjects\(\)\);\s+showToast\(t\("project\.deleted", \{ name: deleteFor\.name \}\), \{ variant: "success" \}\)/,
  );

  const sidebarDelete = sidebarSource.indexOf('data-action="delete-project"');
  assert.ok(
    sidebarDelete > sidebarSource.indexOf('data-action="toggle-project-archive"'),
    "Sidebar orders delete after archive",
  );
  assert.ok(
    sidebarDelete < sidebarSource.indexOf('t("project.close")'),
    "Sidebar orders delete before close",
  );
  assert.match(sidebarSource, /sessionCount: deleteProjectFor\.sessions\.length/);
  assert.match(sidebarSource, /onError=\{reportError\}/);
});

test("every shipped catalog defines the delete keys with matching placeholders", () => {
  const englishBlock = projectBlock(catalogs.get("en"));
  assert.equal(projectValue(englishBlock, "delete"), "Delete project");
  assert.equal(projectValue(englishBlock, "deleteTitle"), "Delete project");
  assert.equal(projectValue(englishBlock, "deleteConfirm"), "Delete project");
  assert.equal(projectValue(englishBlock, "deleteFolderKept"), "The folder on disk is not deleted.");
  assert.deepEqual(placeholders(projectValue(englishBlock, "deleteSessions_one")), ["count"]);
  assert.deepEqual(placeholders(projectValue(englishBlock, "deleteDescription")), ["name"]);

  for (const id of LOCALE_IDS) {
    const block = projectBlock(catalogs.get(id));
    for (const key of DELETE_KEYS) {
      const value = projectValue(block, key);
      assert.notEqual(value.trim(), "", `${id} ${key}`);
      assert.deepEqual(
        placeholders(value),
        placeholders(projectValue(englishBlock, key)),
        `${id} ${key} placeholders`,
      );
      if (id !== "en") {
        assert.notEqual(value, projectValue(englishBlock, key), `${id} ${key} is translated`);
      }
    }
  }
});

test("translated delete copy stays recognizable in the shipped locales", () => {
  assert.equal(projectValue(projectBlock(catalogs.get("zh-CN")), "deleteConfirm"), "删除项目");
  assert.equal(
    projectValue(projectBlock(catalogs.get("zh-CN")), "deleteFolderKept"),
    "磁盘上的文件夹不会被删除。",
  );
  assert.equal(projectValue(projectBlock(catalogs.get("zh-TW")), "deleteConfirm"), "刪除專案");
  assert.equal(projectValue(projectBlock(catalogs.get("de")), "deleteCancel"), "Abbrechen");
  assert.equal(projectValue(projectBlock(catalogs.get("fr")), "deleteCancel"), "Annuler");
  assert.equal(projectValue(projectBlock(catalogs.get("ko")), "deleteCancel"), "취소");
});

test("a project the host does not know is still removed from the desktop", async () => {
  const storeSource = await read("../src/stores/slices/project-slice.ts");
  const storeBlock =
    storeSource.match(/deleteProject: async[\s\S]*?\n    \},/)?.[0] ?? "";
  assert.ok(storeBlock, "deleteProject action exists");
  // A missing host row must not read as a failure, so the host result never
  // gates the renderer-local removal.
  assert.doesNotMatch(storeBlock, /removed === true/);
  assert.match(storeBlock, /await api\.removeProject\(path\)/);
  assert.match(storeBlock, /delete projectMeta\[key\]/);
  assert.match(storeBlock, /removeRecentProject\(path\)/);
  assert.match(storeBlock, /clearLocalSessionState\(/);
  assert.doesNotMatch(dialogSource, /project\.notFound/);
});
