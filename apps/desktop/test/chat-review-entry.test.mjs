import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  findWorkspaceChangeForMessage,
  summarizeWorkspaceChanges,
  workspaceChangePath,
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

test("review cards resolve the file changed by their tool message", () => {
  const message = {
    id: "tool-1",
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
    toolName: "Edit",
    toolStatus: "success",
    toolArgs: { path: "src/a.ts" },
    toolResult: { details: { root: "workspace", path: "src/a.ts" } },
  };

  assert.equal(workspaceChangePath(message), "src/a.ts");
  assert.equal(
    findWorkspaceChangeForMessage(message, dirtyDiff)?.path,
    "src/a.ts",
  );

  for (const status of [
    "added",
    "modified",
    "deleted",
    "renamed",
    "untracked",
  ]) {
    const file = { ...dirtyDiff.files[0], status };
    assert.equal(
      findWorkspaceChangeForMessage(message, {
        ...dirtyDiff,
        files: [file],
      })?.status,
      status,
      `status ${status} stays reviewable`,
    );
  }

  assert.equal(
    workspaceChangePath({ ...message, toolStatus: "error" }),
    null,
  );
  assert.equal(
    workspaceChangePath({
      ...message,
      toolResult: { details: { root: "scratch", path: "src/a.ts" } },
    }),
    null,
  );
});

test("chat renders each review card immediately after its change tool row", () => {
  assert.equal(transcriptSource.includes("<WorkspaceChangesEntry />"), false);
  assert.equal(transcriptSource.includes("review-changes-entry"), false);
  assert.match(
    transcriptSource,
    /<ToolRow message=\{item\.message\} \/>[\s\S]*<WorkspaceChangeCard message=\{item\.message\} \/>/,
  );
  assert.match(
    transcriptSource,
    /findWorkspaceChangeForMessage\(message, diff\)/,
  );
  assert.match(transcriptSource, /aria-expanded=\{open\}/);
  assert.match(transcriptSource, /chat\.reviewChangeShow/);
  assert.match(transcriptSource, /InlineDiffBody/);
  assert.match(
    storeSource,
    /const reviewArtifact = shouldOpenReviewArtifact\([\s\S]*if \(reviewArtifact\)[\s\S]*openWorkPanelTabForSession/,
  );
  assert.doesNotMatch(storeSource, /workspaceReviewSessions/);
});

test("one diff refresh feeds both chat and Review with race-safe triggers", () => {
  assert.match(reviewSource, /useAppStore\(\(s\) => s\.workspaceDiff\)/);
  assert.match(reviewSource, /useAppStore\(\(s\) => s\.refreshWorkspaceDiff\)/);
  assert.doesNotMatch(reviewSource, /api\.workspaceDiff/);
  assert.match(appSource, /reviewRev === 0 \? 0 : 500/);
  assert.match(appSource, /window\.addEventListener\("focus", refreshOnFocus\)/);
});
