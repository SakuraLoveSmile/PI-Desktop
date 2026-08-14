import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * A run row's head is the only place its command appears (D226): the body holds
 * output alone, so the head carries the copy affordance and the outcome beside
 * the caret. Those three controls live in markup and CSS, where nothing else
 * would notice them drifting apart.
 */

const transcript = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

test("only a run row outside the topology gets the three-control head", () => {
  assert.match(
    transcript,
    /const runHead = action === "run" && variant !== "topology"/,
  );
  assert.match(transcript, /runHead \? " is-run" : ""/);
  assert.match(styles, /\.tool-row-head\.is-run \{[^}]*display: flex/);
});

test("the head copies the command, unsqueezed", () => {
  assert.match(transcript, /\{runHead && command \? <ToolCommandCopy command=\{command\} \/> : null\}/);
  assert.match(
    transcript,
    /const command = runHead\s*\?\s*getToolSummaryValue\(message\.toolName, message\.toolArgs\)/,
  );
  assert.match(transcript, /onClick=\{\(\) => copy\(command\)\}/);
  assert.match(styles, /\.tool-row-head-copy \{[^}]*opacity: 0;/);
  // Hidden until hover, so tabbing to it has to bring it back.
  assert.match(styles, /\.tool-row-head-copy:focus-visible,[\s\S]*?opacity: 1;/);
});

test("the caret becomes a pointer target beside the copy control", () => {
  assert.match(transcript, /className="tool-row-caret is-toggle"/);
  assert.match(transcript, /aria-hidden="true"\n\s+tabIndex=\{-1\}/);
  // Its reveal rule followed it out of the header.
  assert.match(styles, /\.tool-row-header:focus-visible ~ \.tool-row-caret,/);
  assert.match(styles, /\.tool-row-caret\.is-toggle \{[^}]*width: 20px/);
});

test("a run row states its outcome, success included", () => {
  assert.match(transcript, /className=\{`tool-row-state \$\{statusTone\}`\}/);
  assert.match(transcript, /status === "running"\s*\?\s*"is-running"/);
  assert.match(transcript, /: "is-done"/);
  assert.match(styles, /\.tool-row-state\.is-done \.tool-row-state-dot \{\s*background: var\(--ds-success\)/);
  assert.match(styles, /\.tool-row-state\.is-error \.tool-row-state-dot \{\s*background: var\(--ds-error\)/);
  // The label is the announcement, so the row drops its own live region and
  // the dot never carries the meaning alone.
  assert.match(transcript, /\{runHead \? null : \(\s*<span className="sr-only" role="status"/);
  assert.match(
    styles,
    /\.tool-row-state\.is-running \.tool-row-state-dot \{[^}]*animation: tool-row-state-pulse/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.tool-row-state\.is-running \.tool-row-state-dot \{\s*animation: none;/,
  );
});

test("the head fill covers the controls it now holds", () => {
  // The header no longer spans the row, so its own hover fill would stop short
  // of the copy control and the caret.
  assert.match(
    styles,
    /\.tool-row-head\.is-run \.tool-row-header:hover \{\s*background: transparent;/,
  );
  assert.match(
    styles,
    /\.tool-row-head\.is-run:has\(\.tool-row-header:not\(:disabled\)\):hover \{\s*background: var\(--ds-bg-hover\)/,
  );
});
