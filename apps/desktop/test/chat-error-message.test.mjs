import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readRoot = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("provider failures stay in the transcript as structured assistant messages", async () => {
  const [runtime, store, main] = await Promise.all([
    readRoot("packages/agent-runtime/src/runtime.ts"),
    read("src/stores/app-store.ts"),
    read("electron/main/index.ts"),
  ]);

  assert.match(runtime, /error:\s*classifiedError,\s*isError:\s*true/);
  assert.match(runtime, /m\.status === "error" \|\| m\.isError \|\| m\.error/);
  assert.match(store, /!event\.message\.error/);
  assert.match(store, /assistantErrorMessage\(event\.error\)/);
  assert.match(main, /failed && empty && !event\.message\.error/);
});

test("assistant error messages expose readable provider details and actions", async () => {
  const transcript = await read("src/components/ChatTranscript.tsx");

  assert.match(transcript, /function AssistantErrorMessage/);
  assert.match(transcript, /aria-expanded=\{open\}/);
  assert.match(transcript, /error\.message/);
  assert.match(transcript, /message\.providerId/);
  assert.match(transcript, /message\.modelId/);
  assert.match(transcript, /copyErrorDetails/);
  assert.match(transcript, /retryLastPrompt/);
  assert.match(transcript, /const continueAction = error\.code === "PROVIDER_RATE_LIMITED"/);
  assert.match(
    transcript,
    /continueAction \? "errors\.action\.continue" : "errors\.action\.retry"/,
  );
  assert.match(transcript, /setSettingsTab\("agent"\)/);
});
