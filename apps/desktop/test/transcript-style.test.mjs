import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);
const transcriptSource = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
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
  // Stacked percentage max-widths previously wrapped prompts at ~60% width.
  assert.match(
    userBubbleStyles,
    /max-width:\s*100%;[\s\S]*?background:\s*color-mix\(in oklab,\s*var\(--ds-text-primary\) 7%,\s*transparent\);[\s\S]*?border:\s*1px solid color-mix\(in oklab,\s*var\(--ds-text-primary\) 5%,\s*transparent\);/,
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
    /\.message-row\.assistant \.message-col[\s\S]*?width:\s*min\(100%,\s*720px\);/,
  );
  assert.match(
    stylesSource,
    /\.message-row\.assistant\.streaming \.message-bubble \{[\s\S]*?border-left:\s*2px solid/,
  );
});

test("transcript density and hover actions are quiet", () => {
  assert.match(stylesSource, /\.message-row \{[\s\S]*?padding:\s*10px 0;/);
  assert.match(stylesSource, /\.thread-content \{[\s\S]*?padding:\s*20px 28px 228px;/);
  assert.match(
    stylesSource,
    /\.message-actions \{[\s\S]*?opacity:\s*0;[\s\S]*?\.message-row:hover \.message-actions/,
  );
  assert.match(stylesSource, /\.message-row\.user \.message-actions \{[\s\S]*?justify-content:\s*flex-end;/);
});

test("transcript markup uses the dedicated user text surface and streaming class", () => {
  assert.match(transcriptSource, /className="message-user-text selectable"/);
  assert.match(transcriptSource, /streaming \? " streaming" : ""/);
  assert.match(transcriptSource, /CopyButton text=\{message\.content\}/);
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

test("messages can be deleted and a user turn takes its reply with it", async () => {
  const storeSource = await readFile(
    new URL("../src/stores/app-store.ts", import.meta.url),
    "utf8",
  );
  assert.match(storeSource, /deleteMessage:\s*async \(messageId\)/);
  assert.match(storeSource, /replaceSessionMessages\(sessionId,\s*next\)/);
  assert.match(transcriptSource, /deleteMessage\(message\.id\)/);
  assert.match(transcriptSource, /chat\.deleteMessage/);
  assert.match(stylesSource, /\.copy-btn\.danger:hover/);
});

test("assistant meta chips and retry action are wired", () => {
  assert.match(transcriptSource, /function MessageMeta/);
  assert.match(transcriptSource, /message-meta-chip/);
  assert.match(transcriptSource, /chat\.usageTokens/);
  assert.match(transcriptSource, /retryAssistantMessage/);
  assert.match(transcriptSource, /chat\.retry/);
  assert.match(stylesSource, /\.message-meta-chip\.usage/);
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

test("conversation minimap hides until content overflows one viewport", async () => {
  const minimapSource = await readFile(
    new URL("../src/components/ConversationMinimap.tsx", import.meta.url),
    "utf8",
  );
  assert.match(minimapSource, /OVERFLOW_EPSILON_PX/);
  assert.match(
    minimapSource,
    /scrollHeight - el\.clientHeight > OVERFLOW_EPSILON_PX/,
  );
  assert.match(
    minimapSource,
    /if \(markers\.length < 2 \|\| !overflows\) return null;/,
  );
  assert.match(minimapSource, /window\.addEventListener\("resize", schedule\)/);
  assert.match(minimapSource, /updateOverflow/);
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
