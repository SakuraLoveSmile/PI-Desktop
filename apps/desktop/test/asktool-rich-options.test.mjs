import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  askToolOptionDescription,
  askToolOptionLabel,
  normalizeAskToolOption,
} from "../../../packages/shared/src/types/agent.ts";
import { AskToolRichText } from "../src/components/AskToolRichText.ts";

const richTextSource = await readFile(
  new URL("../src/components/AskToolRichText.ts", import.meta.url),
  "utf8",
);
const cardSource = await readFile(
  new URL("../src/components/AskToolCard.tsx", import.meta.url),
  "utf8",
);
const styleSource = await readFile(
  new URL("../src/styles/messages.css", import.meta.url),
  "utf8",
);

test("asktool keeps legacy strings and normalizes rich labels and descriptions", () => {
  const legacy = normalizeAskToolOption("  Web  ");
  const rich = normalizeAskToolOption({
    label: "  Desktop  ",
    description: "  Installed on your computer.  ",
  });
  assert.equal(legacy, "Web");
  assert.deepEqual(rich, {
    label: "Desktop",
    description: "Installed on your computer.",
  });
  assert.equal(normalizeAskToolOption({ label: "  " }), undefined);
  assert.equal(askToolOptionLabel(rich), "Desktop");
  assert.equal(askToolOptionDescription(rich), "Installed on your computer.");
  assert.equal(askToolOptionDescription(legacy), undefined);
});

test("asktool renders rich question and option content while keeping label answers intact", () => {
  assert.match(cardSource, /<AskToolRichText source=\{current\.question\} \/>/);
  assert.match(cardSource, /<AskToolRichText source=\{label\} \/>/);
  assert.match(cardSource, /<span className="asktool-option-description">\{description\}<\/span>/);
  assert.doesNotMatch(cardSource, /<AskToolRichText source=\{description\}/);
  assert.match(cardSource, /onClick=\{\(\) => selectOption\(label\)\}/);
  assert.match(richTextSource, /remarkPlugins: \[remarkGfm\]/);
  assert.match(styleSource, /\.asktool-rich-code\s*\{/);

  const html = renderToStaticMarkup(
    createElement(AskToolRichText, {
      source:
        "**Bold** and *italic*, ~~removed~~, `code`, and\n\n- one\n- two\n\n1. first\n2. second",
    }),
  );
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>removed<\/del>/);
  assert.match(html, /<code[^>]*>code<\/code>/);
  assert.match(html, /role="list"/);
  assert.match(html, /asktool-rich-list-ordered/);
});

test("asktool rich content never creates live links, images, or raw HTML", () => {
  const html = renderToStaticMarkup(
    createElement(AskToolRichText, {
      source:
        "[Open](https://example.invalid) ![diagram](https://example.invalid/x.png)\n\n<script>alert(1)</script>",
    }),
  );
  assert.match(html, /Open/);
  assert.match(html, /diagram/);
  assert.doesNotMatch(html, /<a\b|<img\b|<script\b|href=|src=/i);
});

test("asktool renders wide tables as aligned row groups inside the question content", () => {
  const html = renderToStaticMarkup(
    createElement(AskToolRichText, {
      source: [
        "Please confirm these assignments.",
        "",
        "| Name | Route | Role | Responsibility | Tests | Validation | Dependencies |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| Alice | foundation_dev | Research | `app/validation/password_policy.py` | Unit | [Review](https://example.invalid) | None |",
        "| Bob | service_dev | Implementation | `app/service/user_management.py` | Integration | ![diagram](https://example.invalid/x.png) | Alice |",
        "",
        "The researchers work in parallel.",
      ].join("\n"),
    }),
  );
  assert.equal((html.match(/role="table"/g) ?? []).length, 1);
  assert.equal((html.match(/role="rowgroup"/g) ?? []).length, 2);
  assert.equal((html.match(/role="row"/g) ?? []).length, 3);
  assert.equal((html.match(/role="columnheader"/g) ?? []).length, 7);
  assert.equal((html.match(/role="cell"/g) ?? []).length, 14);
  assert.match(html, /asktool-rich-table-scroll/);
  assert.match(html, /asktool-rich-table-cell-content[^>]*><code[^>]*>app\/validation\/password_policy\.py/);
  assert.ok(html.indexOf("Please confirm") < html.indexOf('role="table"'));
  assert.ok(html.indexOf("The researchers") > html.lastIndexOf('role="cell"'));
  assert.doesNotMatch(html, /<(?:table|thead|tbody|tr|th|td|a|img|input)\b|href=|src=/i);
  assert.match(
    cardSource,
    /<span className="asktool-question-content">\s*<AskToolRichText source=\{current\.question\} \/>\s*<\/span>/,
  );
});
