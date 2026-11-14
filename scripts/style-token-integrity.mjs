/**
 * Token-integrity checks for the renderer stylesheets (PI-UI-1114).
 *
 * `style-surface-tokens.mjs` keeps colour literals out of the themed surfaces and
 * `check-style-tokens.mjs` keeps raw typography/radius values out of declarations.
 * Two gaps let a stylesheet drift without any guard noticing, and both ship as
 * silent rendering defects:
 *
 *  1. UNDEFINED VARIABLE RULE — `var(--x)` with no `--x` defined anywhere resolves
 *     to the guaranteed-invalid value, so the property falls back to its initial
 *     value: `border` collapses to none, `font-weight` inherits, a `background`
 *     paints nothing. A fallback does not make it right: `var(--ds-bg, #000)` paints
 *     the fallback in every theme, which turned the light-theme checkbox tick
 *     invisible. A name counts as defined when a stylesheet declares it (rule,
 *     `@theme`, `@property`) or when the renderer sets it at run time, which shows as
 *     a `"--name"` string literal in TS/TSX (`style={{ "--stagger": n }}`,
 *     `setProperty("--work-panel-width", …)`).
 *
 *  2. INLINE DECLARATION RULE — the line-based typography check reads a
 *     declaration only at the start of its line, so a one-line rule
 *     (`.x { font-weight: 600; }`) slipped past it. This rule reads the declarations
 *     that follow a `{` or `;` on the same line, with the same token-only contract.
 *
 * Exemptions are enumerated with reasons instead of being invisible gaps:
 *
 *  - `ALLOWED_UNDEFINED` — names the guard accepts although no stylesheet or script
 *    defines them, each with the reason it is safe.
 *
 * Known boundary: this is static text analysis. It cannot see a variable that is
 * defined on a different element than the one that reads it, so a name defined
 * only inside one component's rule counts as defined everywhere. It catches the
 * typo and the retired-token class, which is where the drift came from.
 */

const DECLARATION = /(?:^|[;{\s])(--[\w-]+)\s*:/g;
const AT_PROPERTY = /@property\s+(--[\w-]+)/g;
const VAR_USE = /var\(\s*(--[\w-]+)\s*(,|\))/g;
const SCRIPT_PROPERTY = /["'`](--[A-Za-z][\w-]*)["'`]/g;

/**
 * Typography/radius declarations that follow `{` or `;` on their own line. The
 * start-of-line form is read by check-style-tokens.mjs, so the two never overlap.
 */
const INLINE_TYPOGRAPHY =
  /[{;]\s*(font-size|font-weight|line-height|letter-spacing|border-radius)\s*:\s*([^;}]+)/g;

const ALLOWED_BARE = new Set(["0", "!important", "inherit", "initial", "unset", "normal", "none"]);

/**
 * Names accepted without a definition in the renderer sources. Keyed by exact
 * name: a prefix rule would hide the typo class this guard exists for.
 */
export const ALLOWED_UNDEFINED = new Map([
  [
    "--leading-snug",
    "Tailwind default theme variable. Tailwind emits it into `:root` because a stylesheet references it; no project ramp step has 1.375.",
  ],
  [
    "--tracking-wider",
    "Tailwind default theme variable (0.05em), emitted on reference. The project ramp stops at --tracking-wide (0.02em), a visibly tighter eyebrow label.",
  ],
  [
    "--shadow-sm",
    "Tailwind default theme variable, emitted on reference; the project has no small raised-shadow token.",
  ],
  [
    "--shadow-xl",
    "Tailwind default theme variable, emitted on reference; the project has no image-modal shadow token.",
  ],
  [
    "--ds-main-pane-min-width",
    "Optional layout hook with a literal fallback (450px, the three-column floor). Nothing sets it today; the fallback is the contract.",
  ],
]);

/** Blank out comments but keep newlines, so diagnostics keep their line numbers. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * Collect every custom property the renderer defines.
 * @param {{ css: string[], scripts: string[] }} sources file contents
 * @returns {Set<string>}
 */
export function collectDefinedProperties({ css, scripts }) {
  const defined = new Set();
  for (const sheet of css) {
    const text = stripComments(sheet);
    for (const match of text.matchAll(DECLARATION)) defined.add(match[1]);
    for (const match of text.matchAll(AT_PROPERTY)) defined.add(match[1]);
  }
  for (const script of scripts) {
    for (const match of script.matchAll(SCRIPT_PROPERTY)) defined.add(match[1]);
  }
  return defined;
}

/**
 * Report `var(--name)` references that nothing defines.
 * @param {string} css one stylesheet
 * @param {Set<string>} defined result of collectDefinedProperties
 * @returns {Array<{line: number, name: string, hasFallback: boolean}>}
 */
export function findUndefinedProperties(css, defined) {
  const text = stripComments(css);
  const violations = [];
  for (const match of text.matchAll(VAR_USE)) {
    const name = match[1];
    if (defined.has(name) || ALLOWED_UNDEFINED.has(name)) continue;
    violations.push({ line: lineOf(text, match.index), name, hasFallback: match[2] === "," });
  }
  return violations;
}

function stripVars(value) {
  let previous;
  let out = value;
  do {
    previous = out;
    out = out.replace(/var\([^()]*\)/g, " ");
  } while (out !== previous);
  return out;
}

/**
 * Report raw typography/radius values in declarations that share a line with
 * their selector or with another declaration.
 * @param {string} css one stylesheet
 * @returns {Array<{line: number, property: string, value: string}>}
 */
export function findInlineTypographyLiterals(css) {
  const text = stripComments(css);
  const violations = [];
  let inFontFace = 0;
  text.split("\n").forEach((line, index) => {
    // Token definitions and `@font-face` descriptors are exempt, as in the
    // line-based check: they define the scale or describe a font file.
    if (/^\s*--/.test(line)) return;
    if (/@font-face\s*\{/.test(line)) inFontFace += 1;
    if (inFontFace > 0) {
      if (/\}/.test(line)) inFontFace -= 1;
      return;
    }
    for (const match of line.matchAll(INLINE_TYPOGRAPHY)) {
      const residue = stripVars(match[2])
        .trim()
        .split(/\s+/)
        .filter((token) => token && !ALLOWED_BARE.has(token));
      if (residue.length) {
        violations.push({ line: index + 1, property: match[1], value: match[2].trim() });
      }
    }
  });
  return violations;
}
