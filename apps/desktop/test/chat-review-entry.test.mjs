import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  reviewChangeFromMessage,
  reviewChangesFromMessages,
  summarizeReviewChanges,
} from "../src/lib/workspace-review.ts";

const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const cardSource = await readFile(
  new URL("../src/components/ReviewChangeCard.tsx", import.meta.url),
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

const baseReview = {
  version: 1,
  snapshotId: "snapshot-1",
  messageId: "tool-1",
  path: "src/a.ts",
  operation: "edit",
  status: "modified",
  state: "active",
  additions: 4,
  deletions: 1,
  hunks: [
    {
      header: "@@ -1,2 +1,3 @@",
      lines: [
        { type: "context", text: "const before = true;" },
        { type: "del", text: "const removed = true;" },
        { type: "add", text: "const added = true;" },
      ],
    },
  ],
  reversible: true,
};

function message(overrides = {}) {
  return {
    id: "tool-1",
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
    toolName: "Edit",
    toolStatus: "success",
    toolArgs: { path: "src/a.ts" },
    toolResult: { details: { root: "workspace", review: baseReview } },
    ...overrides,
  };
}

test("review evidence is read from the successful message, not Git", () => {
  const change = reviewChangeFromMessage(message());
  assert.equal(change?.path, "src/a.ts");
  assert.equal(change?.status, "modified");
  assert.equal(change?.additions, 4);
  assert.equal(change?.deletions, 1);
  assert.equal(change?.hunks[0].lines[1].type, "del");

  const entries = reviewChangesFromMessages([
    message(),
    message({
      id: "tool-2",
      toolName: "Write",
      toolResult: {
        details: {
          root: "workspace",
          review: {
            ...baseReview,
            snapshotId: "snapshot-2",
            messageId: "tool-2",
            path: "new.ts",
            operation: "write",
            status: "added",
            additions: 3,
            deletions: 0,
          },
        },
      },
    }),
    message({
      id: "tool-3",
      toolResult: {
        details: {
          root: "workspace",
          review: {
            ...baseReview,
            snapshotId: "snapshot-3",
            messageId: "tool-3",
            path: "old.ts",
            status: "deleted",
            additions: 0,
            deletions: 8,
          },
        },
      },
    }),
  ]);
  assert.deepEqual(
    entries.map(({ change }) => [change.status, change.path]),
    [
      ["modified", "src/a.ts"],
      ["added", "new.ts"],
      ["deleted", "old.ts"],
    ],
  );
  assert.deepEqual(summarizeReviewChanges(entries), {
    changeCount: 3,
    activeCount: 3,
    rolledBackCount: 0,
    additions: 7,
    deletions: 9,
  });
});

test("failed and scratch tool rows cannot manufacture review evidence", () => {
  assert.equal(reviewChangeFromMessage(message({ toolStatus: "error" })), null);
  assert.equal(
    reviewChangeFromMessage(
      message({
        toolResult: { details: { root: "scratch", review: baseReview } },
      }),
    ),
    null,
  );
  assert.equal(
    reviewChangeFromMessage(
      message({ toolResult: { details: { root: "workspace" } } }),
    ),
    null,
  );
});

test("chat renders one message-owned card immediately after its tool row", () => {
  assert.equal(transcriptSource.includes("<WorkspaceChangesEntry />"), false);
  assert.equal(transcriptSource.includes("review-changes-entry"), false);
  assert.match(
    transcriptSource,
    /<ToolRow message=\{item\.message\} \/>[\s\S]*<ReviewChangeCard message=\{item\.message\} \/>/,
  );
  assert.doesNotMatch(transcriptSource, /workspaceDiff|findWorkspaceChange/);
  assert.match(cardSource, /aria-expanded=\{open\}/);
  assert.match(cardSource, /chat\.reviewChangeShow/);
  assert.match(cardSource, /change\.hunks\.map/);
  assert.match(cardSource, /workspaceReviewRollback|rollbackWorkspaceChange/);
  assert.match(
    storeSource,
    /rollbackWorkspaceChange:[\s\S]*api\.workspaceReviewRollback[\s\S]*withReviewChangeState/,
  );
  assert.match(
    storeSource,
    /const reviewArtifact = shouldOpenReviewArtifact\([\s\S]*if \(reviewArtifact\)[\s\S]*openWorkPanelTabForSession/,
  );
  assert.doesNotMatch(storeSource, /workspaceReviewSessions/);
});

test("Review is a session change history and no longer refreshes a Git diff", () => {
  assert.match(reviewSource, /reviewChangesFromMessages\(messages\)/);
  assert.match(reviewSource, /<ReviewChangeCard/);
  assert.match(reviewSource, /panel\.review\.noChanges/);
  assert.doesNotMatch(reviewSource, /workspaceDiff|refreshWorkspaceDiff|api\.workspaceDiff/);
  assert.doesNotMatch(appSource, /reviewRev|refreshWorkspaceDiff|workspaceDiff/);
});
