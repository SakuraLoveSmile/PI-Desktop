import { readTranscriptModule, readTranscriptSource } from "./helpers/source-contracts.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * Detailed keeps the command and its copy affordance in the run head (D226).
 * Compact hides raw commands from that head and restores the complete input
 * and copy action inside explicitly expanded details (2026-10-07 amendment).
 * Both presentations keep the outcome beside the caret.
 */

const transcript = await readTranscriptSource();
const toolRow = await readTranscriptModule("ToolRow.tsx");
const styles = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);
const details = await readFile(
  new URL("../src/components/ToolDetails.tsx", import.meta.url),
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

test("Detailed copies the full command in the head and Compact in expanded details", () => {
  const headStart = toolRow.indexOf('<div className={`tool-row-head');
  const bodyStart = toolRow.indexOf("{blocks && blocks.length > 0 ? (");
  assert.ok(headStart >= 0 && bodyStart > headStart);
  const head = toolRow.slice(headStart, bodyStart);
  const body = toolRow.slice(bodyStart, toolRow.indexOf("{!imagesInTurn", bodyStart));
  assert.match(head, /\{!compact && runHead && command \? <ToolCommandCopy command=\{command\} \/> : null\}/);
  assert.match(body, /className="tool-row-body"/);
  assert.match(body, /\{compact && runHead && command \? <ToolCommandCopy command=\{command\} \/> : null\}/);
  // A closed row has no blocks/body. Compact restores every original input
  // when opened, while both copy locations receive the unabridged command.
  assert.match(toolRow, /const blocks = variant !== "topology" && open && hasDetails \? presentation\.current\?\.blocks : null/);
  assert.match(toolRow, /blocks: compact\s*\? \[\.\.\.buildToolPresentation\(\{ toolArgs: message\.toolArgs \}\)/);
  assert.match(
    toolRow,
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

test("a run row states what the command did, not what the call did", () => {
  assert.match(transcript, /className=\{`tool-row-state \$\{statusTone\}`\}/);
  // The outcome comes from the shell's exit code first (D227), so a command
  // that exits 1 inside a call that came back fine still reads as failed.
  assert.match(transcript, /const run = action === "run" \? runOutcome\(message\) : null/);
  assert.match(transcript, /run === "running" \|\| \(!run && status === "running"\)\s*\?\s*"is-running"/);
  assert.match(transcript, /: "is-done"/);
  assert.match(styles, /\.tool-row-state\.is-done \.tool-row-state-dot \{\s*background: var\(--ds-success\)/);
  assert.match(styles, /\.tool-row-state\.is-error \.tool-row-state-dot \{\s*background: var\(--ds-error\)/);
  // A row with nothing to claim says nothing rather than claiming success, and
  // hands the announcement back to the hidden live region.
  assert.match(transcript, /\{runHead && statusLabel \? \(/);
  assert.match(transcript, /\{runHead && statusLabel \? null : \(\s*<span className="sr-only" role="status"/);
  assert.match(
    styles,
    /\.tool-row-state\.is-running \.tool-row-state-dot \{[^}]*animation: tool-row-state-pulse/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.tool-row-state\.is-running \.tool-row-state-dot \{\s*animation: none;/,
  );
});

test("run details render their output without a card", () => {
  assert.match(transcript, /<ToolDetailBlocks blocks=\{blocks\} plain=\{runHead\} \/>/);
  // No heading, no frame — but the channel keeps a name, so stderr is not told
  // apart by its tint alone.
  assert.match(details, /plain \? \(\s*\/\/[\s\S]*?<span className="sr-only">\{label\}<\/span>/);
  assert.match(details, /\) : \(\s*<BlockHead label=\{label\} copy=\{blockCopyText\(block\)\} \/>/);
  assert.match(
    styles,
    /\.tool-block\.is-plain \.tool-row-content \{[\s\S]*?border: 0;[\s\S]*?background: transparent;[\s\S]*?padding: 0;/,
  );
  // The cap survives the frame: a long build must not bury the transcript.
  assert.match(styles, /\.tool-row-content \{\s*max-height: 260px/);
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
