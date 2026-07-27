import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sidebarSource = await readFile(
  new URL("../src/components/Sidebar.tsx", import.meta.url),
  "utf8",
);

test("home sidebar exposes only the supported destination entries", () => {
  assert.match(sidebarSource, /data-nav="projects"/);
  assert.match(sidebarSource, /data-nav="plugins"/);
  assert.doesNotMatch(sidebarSource, /data-nav="pulls"/);
  assert.doesNotMatch(sidebarSource, /data-nav="scheduled"/);
  assert.doesNotMatch(sidebarSource, /t\("nav\.(?:pullRequests|scheduled)"\)/);
});

test("sidebar separates retained projects from standalone sessions", () => {
  const newProjectAction = sidebarSource.match(
    /<div className="sidebar-list-toolbar">[\s\S]*?data-action="new-project"[\s\S]*?<\/div>/,
  )?.[0] ?? "";
  const standaloneSessions = sidebarSource.match(
    /data-sidebar-session-section="temporary"[\s\S]*?<\/section>/,
  )?.[0] ?? "";

  assert.match(newProjectAction, /t\("nav\.projects"\)/);
  assert.match(newProjectAction, /<IconNewProject/);
  assert.match(newProjectAction, /openProjectPicker\(\)/);
  assert.match(standaloneSessions, /t\("nav\.sessions"/);
  assert.match(standaloneSessions, /data-action="new-standalone-session"/);
  assert.match(standaloneSessions, /createSession\(\{ projectPath: null \}\)/);
  assert.match(standaloneSessions, /renderSessionRows\(temporarySessions/);
  assert.ok(
    sidebarSource.indexOf('data-action="new-project"') <
      sidebarSource.indexOf('data-sidebar-session-section="temporary"'),
  );
  assert.doesNotMatch(sidebarSource, /data-sidebar-project-group="temporary"/);
});
