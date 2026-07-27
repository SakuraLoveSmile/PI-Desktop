import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stylesSource = await readFile(
  new URL("../src/styles/globals.css", import.meta.url),
  "utf8",
);
const markdownSource = await readFile(
  new URL("../src/components/Markdown.tsx", import.meta.url),
  "utf8",
);

test("chat prose keeps a refined hierarchy and quieter chrome", () => {
  assert.match(stylesSource, /\.prose-chat\s*\{/);
  assert.match(stylesSource, /\.prose-chat h1\s*\{[\s\S]*?font-size:\s*var\(--text-xl\)/);
  assert.match(stylesSource, /\.prose-chat h2\s*\{[\s\S]*?font-size:\s*var\(--text-lg-plus\)/);
  assert.match(stylesSource, /\.prose-chat blockquote\s*\{[\s\S]*?border-left:\s*3px solid/);
  assert.match(stylesSource, /\.prose-chat code\s*\{[\s\S]*?border:\s*1px solid/);
  assert.match(stylesSource, /\.prose-chat \.table-wrap\s*\{/);
  assert.match(stylesSource, /tbody tr:nth-child\(even\) td/);
  assert.match(stylesSource, /\.code-block\s*\{[\s\S]*?border-radius:\s*var\(--radius-md-plus\)/);
  assert.match(stylesSource, /\.code-block-lang\s*\{[\s\S]*?font-family:\s*var\(--font-mono\)/);
  assert.match(stylesSource, /\.thinking-prose\s*\{[\s\S]*?font-size:\s*var\(--text-sm-plus\)/);
});

test("markdown renderer still streams by memoized blocks", () => {
  assert.match(markdownSource, /function useBlocks\(source: string\)/);
  assert.match(markdownSource, /const markdownComponents: Components =/);
  assert.match(markdownSource, /className="code-block"/);
  assert.match(markdownSource, /className="table-wrap"/);
});
