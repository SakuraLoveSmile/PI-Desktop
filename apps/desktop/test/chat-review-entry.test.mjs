import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  summarizeSessionWorkspaceChanges,
  summarizeWorkspaceChanges,
  withoutWorkspaceReviewSessions,
} from "../src/lib/workspace-review.ts";

const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const reviewSource = await readFile(
  new URL("../src/components/workpanel/ReviewTab.tsx", import.meta.url),
  "utf8",
);
const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const storeSource = await readFile(
  new URL("../src/stores/app-store.ts", import.meta.url),
  "utf8",
);

const dirtyDiff = {
  repo: true,
  clean: false,
  truncated: false,
  files: [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 4,
      deletions: 1,
      hunks: [],
    },
  ],
};

test("workspace change summary only describes a dirty git work tree", () => {
  assert.equal(summarizeWorkspaceChanges(null), null);
  assert.equal(
    summarizeWorkspaceChanges({ repo: false, clean: true, files: [] }),
    null,
  );
  assert.equal(
    summarizeWorkspaceChanges({ repo: true, clean: true, files: [] }),
    null,
  );

  assert.deepEqual(
    summarizeWorkspaceChanges({
      repo: true,
      clean: false,
      truncated: true,
      files: [
        {
          path: "src/a.ts",
          status: "modified",
          additions: 4,
          deletions: 1,
          hunks: [],
        },
        {
          path: "src/b.ts",
          status: "untracked",
          additions: 3,
          deletions: 0,
          hunks: [],
        },
      ],
    }),
    { fileCount: 2, additions: 7, deletions: 1, truncated: true },
  );
});

test("workspace change entry belongs only to the session that edited it", () => {
  const reviewSessions = { "session-a": "/repo", "session-c": "/other" };

  assert.deepEqual(
    summarizeSessionWorkspaceChanges({
      diff: dirtyDiff,
      diffPath: "/repo",
      workspacePath: "/repo/",
      sessionId: "session-a",
      reviewSessions,
    }),
    { fileCount: 1, additions: 4, deletions: 1, truncated: false },
  );
  assert.equal(
    summarizeSessionWorkspaceChanges({
      diff: dirtyDiff,
      diffPath: "/repo",
      workspacePath: "/repo",
      sessionId: "session-b",
      reviewSessions,
    }),
    null,
  );
  assert.equal(
    summarizeSessionWorkspaceChanges({
      diff: dirtyDiff,
      diffPath: "/repo",
      workspacePath: "/repo",
      sessionId: "session-c",
      reviewSessions,
    }),
    null,
  );
});

test("clean workspace refresh clears every review owner for that workspace", () => {
  assert.deepEqual(
    withoutWorkspaceReviewSessions(
      {
        "session-a": "/repo",
        "session-b": "/repo/",
        "session-c": "/other",
      },
      "/repo",
    ),
    { "session-c": "/other" },
  );
});

test("chat exposes a persistent review entry backed by the shared diff", () => {
  const entryIndex = transcriptSource.indexOf("<WorkspaceChangesEntry />");
  const permissionIndex = transcriptSource.indexOf("{pendingPermission ? (");

  assert.ok(entryIndex > -1, "review entry is rendered in the transcript");
  assert.ok(
    entryIndex < permissionIndex,
    "review entry stays outside collapsed activity rows",
  );
  assert.match(
    transcriptSource,
    /openWorkPanelTab\(toolWorkPanelTab\("review"\)\)/,
  );
  assert.match(transcriptSource, /sessionId: activeSessionId/);
  assert.match(transcriptSource, /reviewSessions/);
  assert.match(transcriptSource, /chat\.reviewChangesAccessible/);
  assert.match(
    storeSource,
    /const reviewArtifact = shouldOpenReviewArtifact\([\s\S]*if \(reviewArtifact\)[\s\S]*\[envelope\.sessionId\]: workspacePath/,
  );
});

test("one diff refresh feeds both chat and Review with race-safe triggers", () => {
  assert.match(reviewSource, /useAppStore\(\(s\) => s\.workspaceDiff\)/);
  assert.match(reviewSource, /useAppStore\(\(s\) => s\.refreshWorkspaceDiff\)/);
  assert.doesNotMatch(reviewSource, /api\.workspaceDiff/);
  assert.match(appSource, /reviewRev === 0 \? 0 : 500/);
  assert.match(appSource, /window\.addEventListener\("focus", refreshOnFocus\)/);
});
