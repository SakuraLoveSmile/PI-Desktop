import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_UNDEFINED,
  collectDefinedProperties,
  findInlineTypographyLiterals,
  findUndefinedProperties,
} from "../../../scripts/style-token-integrity.mjs";

const TOKENS = `
:root { --ds-border-default: #ddd; --ds-tile: #eee; }
@theme { --font-weight-medium: 500; }
@property --sweep { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
`;

test("undefined guard reports retired token names with their source line", () => {
  /*
    The Team panel read --font-medium, --ds-bg-sunken and --ds-amber for months:
    none exists, so each declaration silently fell back to its initial value
    (inherited weight, no tile, no accent). The guard has to name them.
  */
  const defined = collectDefinedProperties({ css: [TOKENS], scripts: [] });
  const violations = findUndefinedProperties(
    `.team-chip {
  font-weight: var(--font-medium);
  background: var(--ds-tile);
  color: var(--ds-amber);
}`,
    defined,
  );
  assert.deepEqual(
    violations.map(({ line, name }) => [line, name]),
    [
      [2, "--font-medium"],
      [4, "--ds-amber"],
    ],
  );
});

test("undefined guard does not let a fallback excuse a missing token", () => {
  // var(--ds-bg, #000) paints #000 in every theme, which hid the light-theme checkbox tick.
  const defined = collectDefinedProperties({ css: [TOKENS], scripts: [] });
  const [violation, ...rest] = findUndefinedProperties(
    ".tick { border: solid var(--ds-bg, #000); }",
    defined,
  );
  assert.equal(rest.length, 0);
  assert.deepEqual({ name: violation.name, hasFallback: violation.hasFallback }, {
    name: "--ds-bg",
    hasFallback: true,
  });
});

test("undefined guard counts rule, @theme, @property and run-time script definitions", () => {
  const defined = collectDefinedProperties({
    css: [TOKENS, ".rail { --rail-width: 12px; }"],
    scripts: [
      `<div style={{ "--stagger": index }} />`,
      "el.style.setProperty('--work-panel-width', `${w}px`);",
    ],
  });
  const violations = findUndefinedProperties(
    `.a { border: 1px solid var(--ds-border-default); font-weight: var(--font-weight-medium); }
.b { width: var(--rail-width); animation-delay: var(--stagger); inset-inline-end: var(--work-panel-width); }
.c { rotate: var(--sweep); }`,
    defined,
  );
  assert.deepEqual(violations, []);
});

test("undefined guard ignores commented-out references and honours the exact-name allowlist", () => {
  const defined = collectDefinedProperties({ css: [TOKENS], scripts: [] });
  assert.deepEqual(
    findUndefinedProperties(
      `/* .old { color: var(--ds-retired); } */
.a { letter-spacing: var(--tracking-wider); min-width: var(--ds-main-pane-min-width, 450px); }`,
      defined,
    ),
    [],
  );
  // The allowlist is by exact name: a near miss is still a violation.
  assert.deepEqual(
    findUndefinedProperties(".a { letter-spacing: var(--tracking-widest); }", defined).map(
      ({ name }) => name,
    ),
    ["--tracking-widest"],
  );
  for (const [name, reason] of ALLOWED_UNDEFINED) {
    assert.match(name, /^--[\w-]+$/, "allowlist entries are exact custom property names");
    assert.ok(reason.length > 20, `${name} needs a recorded reason`);
  }
});

test("inline guard reads declarations that share a line with their selector", () => {
  /*
    The line-based typography check only reads a declaration at the start of its
    line, so `.x { font-weight: 600; }` escaped it. These are the rules that did.
  */
  const violations = findInlineTypographyLiterals(`
.plugin-scenic-blur-label { font-weight: 600; }
.plugin-scenic-check { font-size: 12px; border-radius: 50%; font-weight: 700; }
.composer-footer-hint { margin: 0; line-height: 1.5; }
`);
  assert.deepEqual(
    violations.map(({ line, property, value }) => [line, property, value]),
    [
      [2, "font-weight", "600"],
      [3, "font-size", "12px"],
      [3, "border-radius", "50%"],
      [3, "font-weight", "700"],
      [4, "line-height", "1.5"],
    ],
  );
});

test("inline guard accepts token values, bare keywords, token blocks and font-face descriptors", () => {
  assert.deepEqual(
    findInlineTypographyLiterals(`
:root { --text-sm: 12px; --leading-body: 1.45; }
.a { font-weight: var(--font-weight-semibold); }
.b { font-size: var(--text-sm); line-height: var(--leading-body); border-radius: 0; }
.c { letter-spacing: inherit; font-weight: normal !important; }
/* .d { font-size: 13px; } */
@font-face { font-family: "Mono"; font-weight: 100 900; }
@font-face {
  font-family: "Sans"; font-weight: 400;
}
`),
    [],
  );
});

test("inline guard leaves start-of-line declarations to the line-based check", () => {
  // One owner per declaration shape, so a violation is never reported twice.
  assert.deepEqual(
    findInlineTypographyLiterals(`
.a {
  font-size: 13px;
  font-weight: 600;
}`),
    [],
  );
});
