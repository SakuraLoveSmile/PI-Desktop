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

test("light theme markdown uses paper-quiet surfaces", () => {
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\] \.prose-chat a\s*\{[\s\S]*?text-decoration:\s*underline/,
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\] \.prose-chat code\s*\{[\s\S]*?background:\s*#f2f2f2/,
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\] \.code-block\s*\{[\s\S]*?background:\s*#f7f7f7/,
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\] \.code-block-head\s*\{[\s\S]*?background:\s*#efefef/,
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\] \.prose-chat blockquote\s*\{[\s\S]*?background:\s*#f6f6f6/,
  );
  assert.match(
    stylesSource,
    /:root\[data-theme="light"\] \.prose-chat \.table-wrap\s*\{[\s\S]*?background:\s*#ffffff/,
  );
  assert.doesNotMatch(
    stylesSource,
    /:root\[data-theme="light"\] \.prose-chat[\s\S]{0,500}#0285ff/i,
  );
});
