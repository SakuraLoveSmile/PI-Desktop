import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStyles } from "./helpers/styles.mjs";

const stylesSource = await loadStyles();
const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const minimapSource = await readFile(
  new URL("../src/components/ConversationMinimap.tsx", import.meta.url),
  "utf8",
);

test("user turns keep a compact right-aligned plate", () => {
  const userBubbleStyles = stylesSource.match(
    /\.message-row\.user \.message-bubble \{([^}]*)\}/,
  )?.[1];
  assert.ok(userBubbleStyles);
  assert.match(stylesSource, /\.message-row\.user \{\s*justify-content:\s*flex-end;/);
  assert.match(
    stylesSource,
    /\.message-row\.user \.message-col \{[\s\S]*?max-width:\s*min\(82%,\s*600px\);[\s\S]*?align-items:\s*flex-end;/,
  );
  // The wrap constraint lives on the column alone; the bubble fills it.
  assert.match(
    userBubbleStyles,
    /max-width:\s*100%;[\s\S]*?background:\s*color-mix\(in oklab,\s*var\(--ds-text-primary\) 8%,\s*transparent\);/,
  );
  assert.doesNotMatch(userBubbleStyles, /var\(--ds-accent\)/);
});

test("fork tools use the branch icon", () => {
  assert.match(transcriptSource, /case "fork":\s*return <IconBranch/);
});

test("assistant turns stay transparent full-width prose", () => {
  assert.match(
    stylesSource,
    /\.message-row\.assistant \.message-bubble[\s\S]*?background:\s*transparent;/,
  );
  assert.match(
    stylesSource,
    /\.message-row\.assistant[\s\S]*?\.message-col[\s\S]*?width:\s*min\(100%,\s*720px\);/,
  );
  assert.match(
    stylesSource,
    /\.message-row\.assistant-turn\.streaming \.message-col\s*\{[\s\S]*?border-left-color:/,
  );
});

test("transcript density and hover actions are quiet", () => {
  assert.match(stylesSource, /\.message-row \{[\s\S]*?padding:\s*12px 0;/);
  assert.match(
    stylesSource,
    /\.thread-content \{[\s\S]*?padding:\s*20px 28px calc\(var\(--composer-dock-height, 228px\) \+ 16px\);/,
  );
  assert.match(
    stylesSource,
    /\.message-actions \{[\s\S]*?opacity:\s*0;[\s\S]*?\.message-row:hover \.message-actions/,
  );
  assert.match(stylesSource, /\.message-row\.user \.message-actions \{[\s\S]*?justify-content:\s*flex-end;/);
});

test("transcript markup uses dedicated user text and assistant turn surfaces", () => {
  assert.match(transcriptSource, /className="message-user-text selectable"/);
  assert.match(transcriptSource, /streaming \? " streaming" : ""/);
  assert.match(transcriptSource, /CopyButton text=\{message\.content\}/);
  assert.match(transcriptSource, /className=\{`message-row assistant assistant-turn/);
  assert.match(transcriptSource, /CopyButton text=\{content\}/);
});

test("user plaintext preserves hard newlines without forced mid-word breaks", () => {
  assert.match(
    stylesSource,
    /\.message-user-text \{\s*\/\* Preserve hard newlines; wrap long tokens without splitting every CJK glyph\. \*\/\s*white-space:\s*pre-wrap;\s*overflow-wrap:\s*break-word;\s*word-break:\s*normal;/,
  );
  assert.doesNotMatch(stylesSource, /\.message-user-text br \{/);
  // Newlines come from `white-space: pre-wrap`; no manual <br> splitting.
  assert.doesNotMatch(transcriptSource, /user-line-/);
});

test("stopping a turn undoes an unanswered prompt or settles the partial reply", async () => {
  const storeSource = await readFile(
    new URL("../src/stores/app-store.ts", import.meta.url),
    "utf8",
  );
  assert.match(storeSource, /composerPrefill:\s*prompt/);
  assert.match(storeSource, /replyStarted/);
  assert.match(storeSource, /status:\s*"aborted" as const/);
  assert.match(storeSource, /replaceSessionMessages\(sessionId,\s*kept\)/);
  assert.match(storeSource, /replaceSessionMessages\(sessionId,\s*settled\)/);
});

test("delete remains on user turns and is removed from assistant toolbar", async () => {
  const storeSource = await readFile(
    new URL("../src/stores/app-store.ts", import.meta.url),
    "utf8",
  );
  assert.match(storeSource, /deleteMessage:\s*async \(messageId\)/);
  assert.match(storeSource, /replaceSessionMessages\(sessionId,\s*next\)/);
  assert.match(transcriptSource, /deleteMessage\(message\.id\)/);
  assert.match(transcriptSource, /chat\.deleteMessage/);
  assert.match(transcriptSource, /\{isUser \? \(/);
  assert.match(stylesSource, /\.copy-btn\.danger:hover/);
});

test("editing a user prompt regenerates it and keeps the old branch reachable", async () => {
  const storeSource = await readFile(
    new URL("../src/stores/app-store.ts", import.meta.url),
    "utf8",
  );
  // Edit lives on the user turn (the prompt is what gets rewritten), not on
  // the assistant answer.
  assert.match(transcriptSource, /editUserMessage\(message\.id, next\)/);
  assert.match(transcriptSource, /className="message-edit-input selectable"/);
  assert.match(transcriptSource, /chat\.editMessage/);
  assert.doesNotMatch(transcriptSource, /editAssistantMessage/);
  assert.doesNotMatch(storeSource, /editAssistantMessage/);
  // Slash prompts edit their typed form so the resend re-expands the template.
  assert.match(transcriptSource, /const editSeed = \(isUser && message\.command\) \|\| message\.content/);
  // Same branch mechanics as regenerate, so main archives the replaced turn
  // as a revision the pager can walk back to.
  assert.match(storeSource, /editUserMessage:\s*async \(messageId, content\)/);
  assert.match(storeSource, /truncateBefore:\s*userIndex/);
  assert.match(storeSource, /editUserMessage\(root\.id, root\.content\)/);
  assert.match(stylesSource, /\.message-edit-input/);
  assert.match(
    stylesSource,
    /\.message-row\.user \.message-col:has\(\.message-edit\)/,
  );
});

test("message toolbars are icon-only with hover tooltips", () => {
  // No worded chips in the toolbar: labels ride on data-tip + aria-label.
  assert.doesNotMatch(
    transcriptSource,
    /<span>\{(?:forkLabel|retryLabel|editLabel|copyLabel)\}<\/span>/,
  );
  for (const label of ["editLabel", "deleteLabel"]) {
    assert.ok(
      transcriptSource.includes(`aria-label={${label}}`),
      `${label} needs an aria-label`,
    );
    assert.ok(
      transcriptSource.includes(`data-tip={${label}}`),
      `${label} needs a hover tooltip`,
    );
  }
  for (const key of ["chat.forkResponse", "chat.retry"]) {
    assert.match(transcriptSource, new RegExp(`aria-label=\\{t\\("${key}"\\)\\}`));
    assert.match(transcriptSource, new RegExp(`data-tip=\\{t\\("${key}"\\)\\}`));
  }
  assert.ok(transcriptSource.includes("label={copyLabel}"));
  assert.match(transcriptSource, /className="copy-btn icon"/);
  assert.match(transcriptSource, /data-tip=\{t\("chat\.forkResponse"\)\}/);
  assert.match(stylesSource, /\.copy-btn\[data-tip\]::after \{[\s\S]*?content:\s*attr\(data-tip\);/);
  assert.match(
    stylesSource,
    /\.copy-btn\[data-tip\]:hover::after,\s*\.copy-btn\[data-tip\]:focus-visible::after \{\s*opacity:\s*1;/,
  );
  // Worded surfaces (error details) keep their label.
  assert.match(transcriptSource, /withLabel/);
});

test("assistant context ring and retry action are wired", () => {
  assert.match(transcriptSource, /function MessageMeta/);
  assert.match(transcriptSource, /message-meta-chip/);
  assert.match(transcriptSource, /className="context-usage"/);
  assert.match(transcriptSource, /chat\.usageContextUsed/);
  assert.match(transcriptSource, /latestMessageUsage/);
  assert.match(transcriptSource, /resolveContextWindow/);
  assert.match(transcriptSource, /aria-describedby=\{tooltipId\}/);
  assert.match(transcriptSource, /retryAssistantMessage/);
  assert.match(transcriptSource, /chat\.retry/);
  assert.match(stylesSource, /\.context-usage-ring-progress/);
  assert.match(
    stylesSource,
    /\.context-usage:hover \.context-usage-popover,[\s\S]*?\.context-usage:focus \.context-usage-popover/,
  );
});

test("regenerate rewrites the current turn instead of appending", async () => {
  const storeSource = await readFile(
    new URL("../src/stores/app-store.ts", import.meta.url),
    "utf8",
  );
  const mainSource = await readFile(
    new URL("../electron/main/index.ts", import.meta.url),
    "utf8",
  );
  const protocolSource = await readFile(
    new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
    "utf8",
  );
  assert.match(storeSource, /truncateBefore:\s*userIndex/);
  assert.match(storeSource, /messages:\s*kept/);
  assert.match(mainSource, /session\.replaceMessages/);
  assert.match(mainSource, /agent\.disposeSession/);
  assert.match(mainSource, /truncateBefore/);
  assert.match(protocolSource, /sessionReplaceMessages/);
});

test("conversation minimap hides until content overflows one viewport", () => {
  assert.match(minimapSource, /OVERFLOW_EPSILON_PX/);
  assert.match(
    minimapSource,
    /scrollHeight - el\.clientHeight > OVERFLOW_EPSILON_PX/,
  );
  assert.match(
    minimapSource,
    /if \(markers\.length < 2 \|\| !overflows\) return null;/,
  );
  assert.match(
    minimapSource,
    /window\.addEventListener\("resize", scheduleScroll\)/,
  );
  assert.match(minimapSource, /new ResizeObserver\(scheduleResize\)/);
  assert.match(minimapSource, /updateOverflow/);
});

test("conversation minimap stays centered below titlebar at high density", () => {
  assert.match(
    minimapSource,
    /"--minimap-marker-count": markers\.length/,
  );
  assert.match(
    stylesSource,
    /\.minimap-rail \{[\s\S]*?top:\s*var\(--ds-toolbar-height\);[\s\S]*?bottom:\s*calc\(var\(--composer-dock-height, 200px\) \+ 16px\);[\s\S]*?justify-content:\s*center;/,
  );
  assert.match(
    stylesSource,
    /\.minimap-rail \{[\s\S]*?gap:\s*clamp\([\s\S]*?var\(--minimap-marker-count\)[\s\S]*?-webkit-app-region:\s*no-drag;/,
  );
  assert.match(
    stylesSource,
    /\.minimap-marker \{[\s\S]*?min-height:\s*0;/,
  );
  assert.match(
    stylesSource,
    /\.minimap-marker::before \{[\s\S]*?height:\s*min\(2px,\s*100%\);/,
  );
});

test("regenerate history pager and stable revision family are wired", async () => {
  const storeSource = await readFile(
    new URL("../src/stores/app-store.ts", import.meta.url),
    "utf8",
  );
  const mainSource = await readFile(
    new URL("../electron/main/index.ts", import.meta.url),
    "utf8",
  );
  const sharedSource = await readFile(
    new URL("../../../packages/shared/src/types.ts", import.meta.url),
    "utf8",
  );
  assert.match(transcriptSource, /message-revision-pager/);
  assert.match(transcriptSource, /activateMessageRevision/);
  assert.match(transcriptSource, /chat\.revisionPager/);
  assert.match(
    transcriptSource,
    /const showRevisionPager = isUser && revisionCount > 1;/,
  );
  assert.match(
    transcriptSource,
    /activateMessageRevision\(message\.id, Math\.max\(1, activeRevision - 1\)\)/,
  );
  assert.doesNotMatch(transcriptSource, /showRevisionPagerHere|revisionOwner/);
  assert.match(stylesSource, /\.message-revision-pager/);
  assert.doesNotMatch(
    stylesSource,
    /\.message-actions:has\(\.message-revision-pager\)[\s\S]*?opacity:\s*1/,
  );
  assert.match(storeSource, /revisionRootId \|\| root\.id/);
  assert.match(storeSource, /activateSessionRevision/);
  assert.match(mainSource, /session\.saveRevision/);
  assert.match(mainSource, /revisionRootId/);
  assert.match(mainSource, /revisionCount: count \+ 1/);
  assert.match(
    mainSource,
    /save regenerate revision failed[\s\S]*?throw error;[\s\S]*?session\.replaceMessages/,
  );
  assert.match(sharedSource, /revisionRootId\?: string/);
  assert.match(sharedSource, /MessageRevisionSummary/);
});
