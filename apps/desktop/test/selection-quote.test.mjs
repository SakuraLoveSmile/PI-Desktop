import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SELECTION_QUOTE_GAP,
  SELECTION_QUOTE_MARGIN,
  codeFenceFor,
  normalizeSelectionMarkdown,
  placeSelectionQuote,
  selectionAnchorRect,
} from "../src/lib/selection-quote.ts";

const source = await readFile(
  new URL("../src/lib/selection-quote.ts", import.meta.url),
  "utf8",
);
const transcript = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const button = await readFile(
  new URL("../src/components/SelectionQuoteButton.tsx", import.meta.url),
  "utf8",
);

test("a fence outgrows the backticks inside the quoted snippet", () => {
  assert.equal(codeFenceFor("plain"), "```");
  assert.equal(codeFenceFor("a ``` fence"), "````");
  assert.equal(codeFenceFor("inline", 1), "`");
  assert.equal(codeFenceFor("a `b` c", 1), "``");
});

test("rendered whitespace collapses back to source-like text", () => {
  assert.equal(normalizeSelectionMarkdown("  a\r\n b \r\n"), "a\n b");
  assert.equal(normalizeSelectionMarkdown("a\u00a0b"), "a b");
  assert.equal(normalizeSelectionMarkdown("a\n\n\n\nb"), "a\n\nb");
  assert.equal(normalizeSelectionMarkdown("\n  \n"), "");
});

test("the affordance sits below the selection and follows its start edge", () => {
  const placement = placeSelectionQuote({
    anchor: { left: 100, top: 100, right: 200, bottom: 120, width: 100, height: 20 },
    size: { width: 80, height: 26 },
    viewport: { width: 400, height: 300 },
  });
  assert.deepEqual(placement, { top: 120 + SELECTION_QUOTE_GAP, left: 100 });
});

test("the affordance stays inside the viewport on both axes", () => {
  const size = { width: 80, height: 26 };
  const viewport = { width: 400, height: 300 };
  const atRight = placeSelectionQuote({
    anchor: { left: 390, top: 100, right: 400, bottom: 120, width: 10, height: 20 },
    size,
    viewport,
  });
  assert.equal(atRight.left, 400 - 80 - SELECTION_QUOTE_MARGIN);

  const atBottom = placeSelectionQuote({
    anchor: { left: 100, top: 270, right: 200, bottom: 290, width: 100, height: 20 },
    size,
    viewport,
  });
  assert.equal(atBottom.top, 270 - 26 - SELECTION_QUOTE_GAP);

  // No room above or below: the preference for "below" wins, clamped.
  const cramped = placeSelectionQuote({
    anchor: { left: 100, top: 10, right: 200, bottom: 290, width: 100, height: 280 },
    size,
    viewport: { width: 400, height: 300 },
  });
  assert.equal(cramped.top, 300 - 26 - SELECTION_QUOTE_MARGIN);
});

test("the anchor is the selection's last line, not its bounding box", () => {
  const last = { left: 10, top: 40, right: 60, bottom: 60, width: 50, height: 20 };
  const first = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 };
  assert.deepEqual(
    selectionAnchorRect({
      getClientRects: () => [first, last],
      getBoundingClientRect: () => first,
    }),
    last,
  );
  // Degenerate rects (a caret between lines) fall back to the bounding box.
  assert.deepEqual(
    selectionAnchorRect({
      getClientRects: () => [{ ...first, width: 0, height: 0 }],
      getBoundingClientRect: () => first,
    }),
    first,
  );
  assert.equal(
    selectionAnchorRect({
      getClientRects: () => [],
      getBoundingClientRect: () => ({ ...first, width: 0, height: 0 }),
    }),
    null,
  );
  assert.equal(selectionAnchorRect(null), null);
});

test("a formula quotes as TeX instead of two duplicated renderings", () => {
  // KaTeX's source lives in the MathML annotation; the visual tree is a copy.
  assert.match(source, /annotation\[encoding="application\/x-tex"\]/);
  assert.match(source, /replaceWithText\(katex, isDisplay \? `\\n\$\$\\n\$\{tex\}\\n\$\$\\n` : `\$\$\{tex\}\$`, doc\)/);
  assert.match(source, /closest\("\.katex-display"\)/);
  // A partial selection is expanded to the whole formula before cloning.
  assert.match(source, /setStartBefore\(start\)/);
  assert.match(source, /wrapper\.append\(expandRangeToWholeKatex\(range\)\.cloneContents\(\)\)/);
});

test("a quoted table keeps one line per row and a fence keeps its language", () => {
  assert.match(source, /querySelectorAll\(":scope > th, :scope > td"\)/);
  assert.match(source, /\.join\(" \| "\)/);
  assert.match(source, /querySelectorAll\("\.code-block"\)/);
  assert.match(source, /querySelector\("\.code-block-lang"\)/);
  assert.match(source, /querySelector\("pre code"\)/);
});

test("quote chrome is dropped but file-reference chips keep their text", () => {
  assert.match(source, /\.message-actions/);
  assert.match(source, /button\.replaceWith\(\.\.\.Array\.from\(button\.childNodes\)\)/);
  assert.doesNotMatch(source, /querySelectorAll\("button"\)\)\s*\{\s*node\.remove/);
});

test("formulas and code are reduced before chrome is dropped", () => {
  const order = [
    "replaceKatex(wrapper, ownerDocument)",
    "replaceCodeBlocks(wrapper, ownerDocument)",
    "replaceInlineCode(wrapper, ownerDocument)",
    "removeChrome(wrapper)",
    "replaceTables(wrapper, ownerDocument)",
  ].map((step) => source.indexOf(step));
  assert.ok(order.every((index) => index > -1), "every reduction step is present");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "steps run in order");
});

test("the floating affordance follows a selection in this transcript only", () => {
  assert.match(button, /scrollRef\.current\?\.contains\(row\)/);
  assert.match(button, /document\.addEventListener\("selectionchange", schedule\)/);
  assert.match(button, /requestAnimationFrame\(sync\)/);
  assert.match(button, /window\.addEventListener\("scroll", hide, \{ capture: true, passive: true \}\)/);
  assert.match(button, /document\.removeEventListener\("selectionchange", schedule\)/);
  // The press must not collapse the selection the quote is taken from.
  assert.match(button, /onPointerDown=\{\(event\) => event\.preventDefault\(\)\}/);
});

test("the affordance only writes a draft and hides when there is nothing to quote", () => {
  assert.match(button, /quoteMessageIntoComposer\(\{ title, text: pending\.markdown \}\)/);
  assert.doesNotMatch(button, /sendPrompt|appendComposerDraftText|createSession/);
  assert.match(button, /if \(!pending\) return null;/);
  assert.match(button, /t\("chat\.quoteSelection"\)/);
});

test("the transcript mounts the affordance and skips read-only projections", () => {
  assert.match(
    transcript,
    /transcriptReadOnly \? null : \(\s*<SelectionQuoteButton scrollRef=\{scrollRef\} title=\{sessionTitle\} \/>/,
  );
  // One recovery path: the row actions quote through the same serializer.
  assert.match(transcript, /selectionMarkdownWithinRow\(message\.id\)/);
  assert.match(transcript, /selectionMarkdownWithinRow\(entry\.anchorId\)/);
  assert.doesNotMatch(transcript, /selection\.toString\(\)/);
});
