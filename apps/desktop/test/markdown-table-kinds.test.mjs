import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { tableColumnKinds } from "../src/lib/markdown-table.ts";

function kindsOf(source) {
  const tables = [];
  renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [rehypeRaw, rehypeSanitize, rehypeKatex],
    components: { table({ node }) { tables.push(tableColumnKinds(node)); return null; } },
  }, source));
  return tables;
}

test("a column of bare numbers is numeric", () => {
  const [kinds] = kindsOf(
    "| Command | exitCode | Summary |\n| --- | --- | --- |\n| `flutter analyze` | 0 | ok |\n| `flutter test` | -1 | failed |",
  );
  assert.deepEqual(kinds, ["text", "number", "text"]);
});

test("mixed, empty and prose columns stay text", () => {
  const [kinds] = kindsOf(
    "| Code | Note |\n| --- | --- |\n| 0 | run 1 |\n| n/a | 2 |\n| 3 | |",
  );
  assert.deepEqual(kinds, ["text", "text"]);
});

test("a header-only table has no body kinds", () => {
  assert.deepEqual(kindsOf("| A | B |\n| --- | --- |"), [[]]);
});
