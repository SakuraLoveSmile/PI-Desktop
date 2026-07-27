import type {
  BundledLanguage,
  BundledTheme,
  GrammarState,
  HighlighterGeneric,
  ThemedToken,
} from "shiki";
import { bundledLanguages, createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/*
 * Singleton Shiki highlighter for chat code blocks.
 *
 * - JavaScript regex engine: no wasm asset, synchronous tokenization once
 *   languages are loaded.
 * - Languages load lazily on first sight of a fence tag; callers render a
 *   plain-text fallback until `subscribeHighlighter` notifies readiness.
 * - `tokenizeIncremental` keeps a per-line token cache chained through
 *   GrammarState so a streaming code block only re-tokenizes the lines that
 *   changed (normally just the tail line) — per-frame cost stays constant
 *   regardless of block size.
 */

export const THEMES = { light: "one-light", dark: "one-dark-pro" } as const;
export type ThemeMode = keyof typeof THEMES;

export function themeForMode(mode: ThemeMode): BundledTheme {
  return THEMES[mode];
}

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>;

let highlighter: Highlighter | null = null;
let creating: Promise<Highlighter> | null = null;
let version = 0;

const readyLangs = new Set<string>();
const pendingLangs = new Set<string>();
const failedLangs = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeHighlighter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic readiness counter — snapshot for useSyncExternalStore. */
export function getHighlightVersion(): number {
  return version;
}

const PLAIN_LANGS = new Set(["", "text", "txt", "plain", "plaintext", "ansi"]);

/** Normalize a fence tag to a loadable Shiki language id, or null for plain. */
export function resolveLang(lang: string): string | null {
  const id = lang.trim().toLowerCase();
  if (PLAIN_LANGS.has(id)) return null;
  return id in bundledLanguages ? id : null;
}

function getHighlighterInstance(): Promise<Highlighter> {
  creating ??= createHighlighter({
    themes: [THEMES.light, THEMES.dark],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }).then((instance) => {
    highlighter = instance;
    return instance;
  });
  return creating;
}

/** Kick off lazy loading for a language; safe to call every render. */
export function ensureLang(lang: string): void {
  if (readyLangs.has(lang) || pendingLangs.has(lang) || failedLangs.has(lang)) {
    return;
  }
  pendingLangs.add(lang);
  void getHighlighterInstance()
    .then((instance) => instance.loadLanguage(lang as BundledLanguage))
    .then(() => {
      readyLangs.add(lang);
    })
    .catch(() => {
      // Grammar failed to load/compile — settle on the plain-text fallback.
      failedLangs.add(lang);
    })
    .finally(() => {
      pendingLangs.delete(lang);
      notify();
    });
}

export type LineCache = {
  lang: string;
  theme: string;
  /** Source lines already tokenized. */
  lines: string[];
  /** Tokens per line; rows are reused by reference for unchanged lines. */
  tokens: ThemedToken[][];
  /** Grammar state at the end of each line, chaining line i into i+1. */
  states: (GrammarState | undefined)[];
};

/**
 * Incrementally tokenize `code`, reusing every line before the first
 * divergence from `prev`. Returns null while the language is not ready
 * (caller renders plain text). Returns `prev` unchanged when the code is
 * identical, so referential equality can skip re-renders.
 */
export function tokenizeIncremental(
  prev: LineCache | null,
  code: string,
  lang: string,
  theme: string,
): LineCache | null {
  if (!highlighter || !readyLangs.has(lang)) return null;

  const lines = code.split("\n");
  const cache =
    prev && prev.lang === lang && prev.theme === theme ? prev : null;
  const reusable = cache
    ? Math.min(cache.lines.length, lines.length)
    : 0;

  let start = 0;
  while (start < reusable && cache!.lines[start] === lines[start]) start += 1;

  if (cache && start === lines.length && cache.lines.length === lines.length) {
    return cache;
  }

  const outLines = cache ? cache.lines.slice(0, start) : [];
  const outTokens = cache ? cache.tokens.slice(0, start) : [];
  const outStates = cache ? cache.states.slice(0, start) : [];

  for (let i = start; i < lines.length; i += 1) {
    const grammarState = i > 0 ? outStates[i - 1] : undefined;
    const rows = highlighter.codeToTokensBase(lines[i], {
      lang: lang as BundledLanguage,
      theme: theme as BundledTheme,
      grammarState,
      includeExplanation: false,
    });
    outLines.push(lines[i]);
    outTokens.push(rows[0] ?? []);
    outStates.push(highlighter.getLastGrammarState(rows));
  }

  return { lang, theme, lines: outLines, tokens: outTokens, states: outStates };
}
