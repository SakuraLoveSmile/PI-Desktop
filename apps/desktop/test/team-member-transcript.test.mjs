import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const { buildTeamMemberTranscriptRows } = await import("../src/lib/team-member-transcript.ts");
const message = (id, role, extra = {}) => ({ id, role, content: "", createdAt: "2026-01-01", ...extra });

test("member transcript preserves user/tool/thinking/answer order without delegation filtering", () => {
  const user = message("user", "user", { content: "Please inspect" });
  const tool = message("tool", "tool", { toolName: "Read", toolStatus: "success", toolResult: "File text", parentToolCallId: "foreign-call" });
  const assistantTool = message("assistant-tool", "assistant", { toolName: "Bash", toolStatus: "error", isError: true });
  const reasoningAndAnswer = message("both", "assistant", { thinking: "Check the evidence", content: "Here is the answer", parentToolCallId: "unrelated-call" });
  const answer = message("answer", "assistant", { content: "Final answer", status: "aborted" });
  const errorOnly = message("error", "assistant", { error: { code: "MODEL_ERROR", message: "Model failed" } });
  const rows = buildTeamMemberTranscriptRows([
    user, tool, assistantTool, reasoningAndAnswer, answer, errorOnly,
    message("system", "system", { content: "Hidden instruction" }),
  ]);
  assert.deepEqual(rows, [
    { kind: "user", message: user }, { kind: "tool", message: tool },
    { kind: "tool", message: assistantTool },
    { kind: "thinking", message: reasoningAndAnswer }, { kind: "answer", message: reasoningAndAnswer },
    { kind: "answer", message: answer }, { kind: "answer", message: errorOnly },
  ]);
  assert.equal(rows[1].message, tool);
  assert.equal(rows[2].message.isError, true);
  assert.equal(rows[5].message.status, "aborted");
  assert.equal(rows[6].message.error, errorOnly.error);
});

test("thinking-only rows remain visible while blank assistant and system rows are omitted", () => {
  const thinking = message("thinking", "assistant", { thinking: "Reasoning", status: "streaming" });
  assert.deepEqual(buildTeamMemberTranscriptRows([
    message("blank", "assistant"), message("spaces", "assistant", { content: "  ", thinking: "  " }),
    thinking, message("system", "system", { thinking: "Hidden", content: "Hidden" }),
  ]), [{ kind: "thinking", message: thinking }]);
  assert.deepEqual(buildTeamMemberTranscriptRows([]), []);
});

test("member transcript uses the shared rows and never offers rollback controls", async () => {
  const source = await readFile(new URL("../src/components/workpanel/team/TeamMemberTranscript.tsx", import.meta.url), "utf8");
  assert.match(source, /buildTeamMemberTranscriptRows\(messages\)/);
  assert.match(source, /<ToolRow message=\{message\}/);
  assert.match(source, /<ThinkingRow/);
  assert.match(source, /streaming=\{isRunning && message.status === "streaming"\}/);
  assert.doesNotMatch(source, /ReviewChangeCard/);
});
