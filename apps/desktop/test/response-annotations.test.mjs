import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ANNOTATION_BLOCK_CLOSE,
  ANNOTATION_BLOCK_HEADING,
  ANNOTATION_BLOCK_OPEN,
  ANNOTATION_INSTRUCTION,
  ANNOTATION_REQUEST_HEADING,
  MAX_ANNOTATION_CHARS,
  annotationExcerpt,
  annotationMarkerToken,
  annotationMarkers,
  requestTextWithoutAnnotations,
  responseAnnotation,
  responseAnnotationPrompt,
  sourceWithAnnotationMarkers,
  splitAnnotationMarkerTokens,
} from "../src/lib/response-annotations.ts";

const store = await readFile(
  new URL("../src/stores/app-store.ts", import.meta.url),
  "utf8",
);
const transcript = await readFile(
  new URL("../src/components/ChatTranscript.tsx", import.meta.url),
  "utf8",
);
const markdown = await readFile(
  new URL("../src/components/Markdown.tsx", import.meta.url),
  "utf8",
);
const composer = await readFile(
  new URL("../src/components/Composer.tsx", import.meta.url),
  "utf8",
);
const overlay = await readFile(
  new URL("../src/components/SelectionQuoteButton.tsx", import.meta.url),
  "utf8",
);

const annotation = (overrides = {}) => ({
  id: "a1",
  messageId: "m1",
  text: "the quoted pass",
  annotation: "",
  createdAt: 0,
  ...overrides,
});

test("the prompt carries the annotation block the model reads", () => {
  const prompt = responseAnnotationPrompt("explain this", [
    annotation(),
    annotation({ id: "a2", messageId: "m2", text: "and this" }),
  ]);
  assert.equal(
    prompt,
    [
      ANNOTATION_BLOCK_HEADING,
      ANNOTATION_INSTRUCTION,
      ANNOTATION_BLOCK_OPEN,
      '[{"text":"the quoted pass","annotation":"","source":{"messageId":"m1"}},{"text":"and this","annotation":"","source":{"messageId":"m2"}}]',
      ANNOTATION_BLOCK_CLOSE,
      "",
      ANNOTATION_REQUEST_HEADING,
      "explain this",
    ].join("\n"),
  );
  // A session without annotations sends the draft untouched.
  assert.equal(responseAnnotationPrompt("explain this", []), "explain this");
});

test("a stored annotated prompt reduces back to the user's request", () => {
  const prompt = responseAnnotationPrompt("explain this", [annotation()]);
  assert.equal(requestTextWithoutAnnotations(prompt), "explain this");
  // A plain prompt is left alone, and a prompt that merely looks similar is not
  // truncated.
  assert.equal(requestTextWithoutAnnotations("explain this"), "explain this");
  assert.equal(
    requestTextWithoutAnnotations(`## My request:\nplain`),
    `## My request:\nplain`,
  );
});

test("an excerpt is capped without cutting a surrogate pair", () => {
  assert.equal(annotationExcerpt("  keep me  "), "keep me");
  assert.equal(annotationExcerpt("a\r\nb"), "a\nb");
  const capped = annotationExcerpt("x".repeat(MAX_ANNOTATION_CHARS + 5));
  assert.equal(capped.length, MAX_ANNOTATION_CHARS + 1);
  assert.ok(capped.endsWith("…"));
  const surrogate = annotationExcerpt(`${"a".repeat(MAX_ANNOTATION_CHARS - 1)}😀tail`);
  assert.doesNotMatch(surrogate, /[\uD800-\uDBFF]$/);
});

test("a new annotation keeps its excerpt and starts without a comment", () => {
  const created = responseAnnotation({
    id: "a9",
    messageId: "m7",
    text: "  a pass  ",
    createdAt: 5,
  });
  assert.deepEqual(created, {
    id: "a9",
    messageId: "m7",
    text: "a pass",
    annotation: "",
    createdAt: 5,
  });
});

test("markers land on their own excerpt, never two on one occurrence", () => {
  const source = "first pass and second pass";
  const markers = annotationMarkers(source, [
    { text: "first pass" },
    { text: "second pass" },
    { text: "missing" },
  ]);
  assert.deepEqual(markers, [
    { index: 1, text: "first pass", offset: "first pass".length },
    { index: 2, text: "second pass", offset: source.indexOf("second pass") + "second pass".length },
    { index: 3, text: "missing", offset: -1 },
  ]);

  // The same excerpt twice: the second annotation takes the next occurrence.
  const repeated = annotationMarkers("pass … pass", [
    { text: "pass" },
    { text: "pass" },
    { text: "pass" },
  ]);
  assert.deepEqual(
    repeated.map((marker) => marker.offset),
    [4, 11, -1],
  );
});

test("marker tokens are inserted without moving each other", () => {
  const source = "alpha beta";
  const markers = annotationMarkers(source, [{ text: "alpha" }, { text: "beta" }]);
  const annotated = sourceWithAnnotationMarkers(source, markers);
  assert.equal(
    annotated,
    `alpha${annotationMarkerToken(1)} beta${annotationMarkerToken(2)}`,
  );
  // An unplaceable marker contributes nothing.
  assert.equal(
    sourceWithAnnotationMarkers("alpha", [
      { index: 1, text: "alpha", offset: 5 },
      { index: 2, text: "gone", offset: -1 },
    ]),
    `alpha${annotationMarkerToken(1)}`,
  );
});

test("a marker token round-trips through the split the renderer uses", () => {
  const source = `before${annotationMarkerToken(2)}after`;
  assert.deepEqual(splitAnnotationMarkerTokens(source), [
    { kind: "text", value: "before" },
    { kind: "marker", index: 2 },
    { kind: "text", value: "after" },
  ]);
  // Text without tokens stays one segment, so the pipeline can skip the work.
  assert.deepEqual(splitAnnotationMarkerTokens("plain"), [
    { kind: "text", value: "plain" },
  ]);
});

test("the markdown pass turns marker tokens into numbered markers", () => {
  assert.match(markdown, /remarkAnnotationMarkers/);
  assert.match(markdown, /const staticRemarkPlugins = \[remarkGfm, remarkMath, remarkAnnotationMarkers\]/);
  assert.match(markdown, /url: annotationMarkerHref\(segment\.index\)/);
  assert.match(markdown, /if \(annotationIndex !== null\) \{\s*return <AnnotationMarker index=\{annotationIndex\} \/>;\s*\}/);
  // The marker shows the excerpt of its own number.
  assert.match(markdown, /\[index - 1\]\?\.text/);
  assert.match(markdown, /t\("chat\.annotationMarker", \{ index \}\)/);
});

test("annotations attach to assistant turns, not to the draft", () => {
  // The row has to say what it is before a selection can be routed.
  assert.match(transcript, /data-row-role="assistant"/);
  assert.match(transcript, /data-row-role="user"/);
  assert.match(
    transcript,
    /\(marker\) => marker\.offset >= 0 && !markedAnnotations\.has\(marker\.index\),/,
  );
  // A read-only projection shows another session's rows.
  assert.match(
    transcript,
    /if \(transcriptReadOnly \|\| sessionAnnotations\.length === 0 \|\| !source\) \{/,
  );
  assert.match(transcript, /<Markdown source=\{sourceWithMarkers\(part\.message\.content\)\} \/>/);
  assert.match(store, /addResponseAnnotation: \(\{ messageId, text \}\) => \{/);
  assert.match(store, /if \(current\.some\(\(annotation\) => annotation\.text === excerpt\)\) return;/);
});

test("sending carries the annotations and consumes them", () => {
  assert.match(store, /const outgoing = responseAnnotationPrompt\(\s*content,\s*get\(\)\.responseAnnotations\[sessionId\] \?\? \[\],\s*\);/);
  assert.match(store, /content: outgoing,/);
  assert.match(store, /isDefaultSessionTitle\(current\?\.title\)[\s\S]*?promptFallbackSessionTitle\(content,/);
  assert.match(store, /consumeAnnotations\(\)/);
  // Queued prompts are sends too.
  assert.match(store, /get\(\)\.enqueuePrompt\(outgoing, draft, sessionId\);/);
});

test("the composer shows one annotation attachment and can drop it", () => {
  assert.match(composer, /data-testid="composer-annotations"/);
  assert.match(composer, /t\("chat\.annotationChip", \{ count: sessionAnnotations\.length \}\)/);
  assert.match(composer, /onClick=\{clearResponseAnnotations\}/);
  // The chip's tooltip is the numbered excerpt list.
  assert.match(composer, /\.map\(\(annotation, index\) => `\$\{index \+ 1\}\. \$\{annotation\.text\}`\)/);
});

test("the overlay annotates a response and quotes anything else", () => {
  assert.match(overlay, /if \(target\.annotatable\) \{/);
  assert.match(overlay, /addResponseAnnotation\(\{\s*messageId: target\.rowAnchorId,\s*text: target\.markdown,\s*\}\);/);
  assert.match(overlay, /quoteMessageIntoComposer\(\{ title, text: target\.markdown \}\)/);
});
