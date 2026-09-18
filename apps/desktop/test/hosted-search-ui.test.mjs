import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, "helpers/ts-import-hooks.mjs")));
const {
  hostedSearchTitle,
  rewriteInlineCitationMarkup,
  sourcesForHref,
} = await import("../src/lib/hosted-search-ui.ts");

const sources = [
  { url: "https://example.com/a", title: "Alpha" },
  { url: "https://example.com/b", title: "Beta" },
  { url: "https://news.example.com/c" },
  { url: "https://www.bing.com/search?q=tibo", title: "https://www.bing.com/search?q=tibo" },
];

test("rewrites Grok inline citation placeholders into cite links", () => {
  const text = rewriteInlineCitationMarkup(
    "Hello {render_inline_citation(citation_id=4)} world",
    sources,
  );
  assert.equal(text, "Hello [ ](#cite=4) world");
});

test("rewrites space-separated quoted Grok citation placeholders", () => {
  const text = rewriteInlineCitationMarkup(
    '账号是 x.com {render_inline_citation citation_id="4"} 结尾',
    sources,
  );
  assert.equal(text, "账号是 x.com [ ](#cite=4) 结尾");
});


test("drops unknown citation placeholders", () => {
  const text = rewriteInlineCitationMarkup(
    "Hello {render_inline_citation(citation_id=99)}",
    sources,
  );
  assert.equal(text, "Hello ");
});

test("never uses a raw URL as the visible title", () => {
  assert.equal(hostedSearchTitle(sources[3]), "bing.com");
  assert.equal(hostedSearchTitle(sources[0]), "Alpha");
});

test("never uses a citation index as the visible title", () => {
  assert.equal(
    hostedSearchTitle({ url: "https://www.36kr.com/p/1", title: "5" }),
    "36kr.com",
  );
});


test("resolves #cite indices as 1-based source rows", () => {
  const matched = sourcesForHref("#cite=4", sources);
  assert.equal(matched[0]?.url, "https://www.bing.com/search?q=tibo");
});
