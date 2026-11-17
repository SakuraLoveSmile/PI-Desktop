import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STATUS_INK,
  composite,
  contrastRatio,
  findBaseStatusTextColors,
  findLowContrastStatusInk,
  findLowContrastTextTiers,
  resolveToken,
} from "../../../scripts/style-token-contrast.mjs";

/*
  `pnpm lint` runs this guard over styles/tokens.css. These fixtures pin the rule
  itself: the retired light faint tier has to fail, the fix has to pass, alpha
  tokens are judged after compositing over the surface, and a token the resolver
  cannot read is reported instead of passing silently.
*/
const SURFACES = (primary, sidebar, secondary, inset) => `
  --ds-bg-primary: ${primary};
  --ds-bg-sidebar: var(--ds-settings-rail-bg, ${sidebar});
  --ds-bg-secondary: ${secondary};
  --ds-bg-inset: ${inset};`;

const tokens = ({ lightFaint, darkFaint = "color-mix(in oklab, var(--gray-0) 38%, transparent)" }) => `
/* the dark default carries the gray scale */
:root,
:root[data-theme="dark"] {
  --gray-0: #ffffff;
  ${SURFACES("#181818", "#000000", "#212121", "#0d0d0d")}
  --ds-text-muted: color-mix(in oklab, var(--gray-0) 52%, transparent);
  --ds-text-faint: ${darkFaint};
}
@theme { --text-sm: 12px; }
:root[data-theme="light"] {
  ${SURFACES("#ffffff", "#f3f3f3", "#f9f9f9", "#ededed")}
  --ds-text-muted: #5d5d5d;
  --ds-text-faint: ${lightFaint};
}
:root[data-theme="light"] .scoped-rule { --ds-text-faint: #000000; }
`;

test("contrast guard fails the retired light faint tier on white and on the sidebar", () => {
  const violations = findLowContrastTextTiers(tokens({ lightFaint: "#afafaf" }));
  const byKey = new Map(violations.map((v) => [`${v.theme} ${v.tier} ${v.surface}`, v.ratio]));
  assert.deepEqual(
    [...byKey.keys()],
    [
      "light --ds-text-faint --ds-bg-primary",
      "light --ds-text-faint --ds-bg-sidebar",
      "light --ds-text-faint --ds-bg-secondary",
      "light --ds-text-faint --ds-bg-inset",
    ],
  );
  assert.ok(Math.abs(byKey.get("light --ds-text-faint --ds-bg-primary") - 2.19) < 0.01);
  assert.ok(Math.abs(byKey.get("light --ds-text-faint --ds-bg-sidebar") - 1.98) < 0.01);
});

test("contrast guard accepts the corrected light tier and the dark alpha tiers", () => {
  // Dark alpha tokens are composited over each surface first: 38% white over
  // #181818 is #707070, 3.59:1, and over the black sidebar 3.39:1.
  assert.deepEqual(findLowContrastTextTiers(tokens({ lightFaint: "#858585" })), []);
});

test("contrast guard judges an alpha token after compositing, not by its colour", () => {
  // White at 20% over #181818 reads as a dark grey, far under 3:1, even though
  // the token's own colour is pure white.
  const violations = findLowContrastTextTiers(
    tokens({
      lightFaint: "#858585",
      darkFaint: "color-mix(in oklab, var(--gray-0) 20%, transparent)",
    }),
  );
  assert.ok(violations.length > 0);
  assert.ok(violations.every((v) => v.theme === "dark" && v.tier === "--ds-text-faint"));
  assert.ok(violations.every((v) => v.ratio < v.floor));
});

test("contrast guard reports a token it cannot evaluate instead of passing", () => {
  const violations = findLowContrastTextTiers(tokens({ lightFaint: "oklch(0.7 0 0)" }));
  assert.equal(violations.length, 4);
  assert.ok(violations.every((v) => v.ratio === null && v.theme === "light"));
  assert.ok(violations[0].message.includes("unsupported colour form"));
});

test("contrast ratio matches the WCAG reference values", () => {
  const black = { rgb: [0, 0, 0], alpha: 1 };
  const white = { rgb: [255, 255, 255], alpha: 1 };
  assert.ok(Math.abs(contrastRatio(black, white) - 21) < 1e-9);
  assert.ok(Math.abs(contrastRatio({ rgb: [255, 255, 255], alpha: 0 }, white) - 1) < 1e-9);
  // #767676 on white is the well-known 4.54:1 AA boundary grey.
  assert.ok(Math.abs(contrastRatio({ rgb: [0x76, 0x76, 0x76], alpha: 1 }, white) - 4.54) < 0.01);
});

test("composite blends an alpha colour over an opaque surface", () => {
  const white = { rgb: [255, 255, 255], alpha: 1 };
  assert.deepEqual(composite({ rgb: [0, 0, 0], alpha: 0.5 }, white), { rgb: [127.5, 127.5, 127.5], alpha: 1 });
  assert.deepEqual(composite({ rgb: [10, 20, 30], alpha: 1 }, white), { rgb: [10, 20, 30], alpha: 1 });
});

/*
  Status ink (PI-UI-1115). The factory builds a mini tokens.css with the four
  surfaces, the base status colours and the ink tokens under test. The retired
  paint was the base colour itself, so aliasing the ink to the base is the
  failing repro; the shipped light inks are the fix.
*/
const inks = (success, warning, error) => ({ success, warning, error });
const BASE_AS_INK = inks("var(--ds-success)", "var(--ds-warning)", "var(--ds-error)");
const SHIPPED_LIGHT_INK = inks("#006c2b", "#a03c05", "#ad2421");

const statusTokens = ({ lightInk, darkInk = BASE_AS_INK }) => `
:root,
:root[data-theme="dark"] {
  ${SURFACES("#181818", "#000000", "#212121", "#0d0d0d")}
  --ds-success: #40c977;
  --ds-warning: #ff8549;
  --ds-error: #ff6764;
  --ds-success-ink: ${darkInk.success};
  --ds-warning-ink: ${darkInk.warning};
  --ds-error-ink: ${darkInk.error};
}
:root[data-theme="light"] {
  ${SURFACES("#ffffff", "#f3f3f3", "#f9f9f9", "#ededed")}
  --ds-success: #00a240;
  --ds-warning: #e25507;
  --ds-error: #e02e2a;
  --ds-success-ink: ${lightInk.success};
  --ds-warning-ink: ${lightInk.warning};
  --ds-error-ink: ${lightInk.error};
}
`;
const byInkKey = (violations) =>
  new Map(violations.map((v) => [`${v.theme} ${v.tier} ${v.surface} ${v.ground}`, v.ratio]));

test("status ink guard fails the base colours as light text ink, which is what status text painted before PI-UI-1115", () => {
  const byKey = byInkKey(findLowContrastStatusInk(statusTokens({ lightInk: BASE_AS_INK })));
  // 3 inks x 4 surfaces x (plain text, chip) = 24 checks; error text on white (4.57:1) is the only pass.
  assert.equal(byKey.size, 23);
  assert.ok([...byKey.keys()].every((key) => key.startsWith("light ")));
  assert.equal(byKey.has("light --ds-error-ink --ds-bg-primary text"), false);
  const near = (key, ratio) => assert.ok(Math.abs(byKey.get(key) - ratio) < 0.01, `${key} is ${byKey.get(key)}`);
  near("light --ds-success-ink --ds-bg-primary text", 3.36);
  near("light --ds-warning-ink --ds-bg-primary text", 3.79);
  near("light --ds-success-ink --ds-bg-primary chip", 2.82);
  near("light --ds-error-ink --ds-bg-primary chip", 3.65);
  near("light --ds-success-ink --ds-bg-inset chip", 2.45);
});

test("status ink guard accepts the shipped light inks and the dark aliases", () => {
  // Dark aliases the base colours, which clear 4.5:1 on every surface and 15% chip.
  assert.deepEqual(findLowContrastStatusInk(statusTokens({ lightInk: SHIPPED_LIGHT_INK })), []);
});

test("status ink guard judges the chip separately from the surface", () => {
  // #cc2a26 is 4.58:1 or more as text on the four surfaces, yet only 3.70:1 on the
  // tightest 15% error chip: an ink that passes the plain-text check can still fail.
  const violations = findLowContrastStatusInk(
    statusTokens({ lightInk: { ...SHIPPED_LIGHT_INK, error: "#cc2a26" } }),
  );
  assert.ok(violations.length > 0);
  assert.ok(violations.every((v) => v.theme === "light" && v.tier === "--ds-error-ink" && v.ground === "chip"));
  assert.ok(Math.abs(Math.min(...violations.map((v) => v.ratio)) - 3.7) < 0.01);
});

test("status ink guard judges each theme on its own", () => {
  const violations = findLowContrastStatusInk(
    statusTokens({ lightInk: SHIPPED_LIGHT_INK, darkInk: { ...BASE_AS_INK, error: "#7a1a18" } }),
  );
  assert.ok(violations.length > 0);
  assert.ok(violations.every((v) => v.theme === "dark" && v.tier === "--ds-error-ink" && v.ratio < v.floor));
});

test("status ink guard reports an ink it cannot evaluate or find instead of passing", () => {
  const unsupported = findLowContrastStatusInk(
    statusTokens({ lightInk: { ...SHIPPED_LIGHT_INK, success: "oklch(0.45 0.15 150)" } }),
  );
  assert.equal(unsupported.length, 8);
  assert.ok(unsupported.every((v) => v.ratio === null && v.theme === "light" && v.tier === "--ds-success-ink"));
  assert.ok(unsupported[0].message.includes("unsupported colour form"));

  const missing = findLowContrastStatusInk(
    statusTokens({ lightInk: SHIPPED_LIGHT_INK }).replace(/--ds-warning-ink: [^;]+;/g, ""),
  );
  assert.equal(missing.length, 16);
  assert.ok(missing.every((v) => v.ratio === null && v.tier === "--ds-warning-ink"));
  assert.ok(missing[0].message.includes("is not defined"));
});

test("the shipped status inks clear 4.5:1, and the light inks keep it on chips up to 16%", () => {
  const tokensCss = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  assert.deepEqual(findLowContrastStatusInk(tokensCss), []);
  // Stylesheet chips run 6% to 16%; the guard models 15%, the light inks cover the rest.
  assert.deepEqual(findLowContrastStatusInk(tokensCss, { chipAlpha: 0.16 }).filter((v) => v.theme === "light"), []);
});

test("the dark theme paints each status ink exactly as its base colour, and the light ink is darker", () => {
  const tokensCss = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  for (const [ink, base] of STATUS_INK) {
    assert.deepEqual(resolveToken(tokensCss, "dark", ink), resolveToken(tokensCss, "dark", base), `dark ${ink}`);
    // Same hue family, darker: every channel of the light ink is at or below the base.
    const [lightInk, lightBase] = [resolveToken(tokensCss, "light", ink), resolveToken(tokensCss, "light", base)];
    assert.ok(lightInk.rgb.every((channel, i) => channel <= lightBase.rgb[i]), `light ${ink} is not darker than ${base}`);
  }
});

test("usage guard flags color declarations that name a base status token", () => {
  const css = `
.a { color: var(--ds-success); }
.b { background: color-mix(in oklab, var(--ds-error) 14%, transparent); color: var(--ds-danger, #ef4444); }
.c { color: color-mix(in oklab, var(--ds-error) 72%, var(--ds-text-primary)) !important; }
/* color: var(--ds-warning); is only a note */
.d { color: var(--ds-warning-ink); border-color: var(--ds-warning); background-color: var(--ds-warning); fill: var(--ds-success); }
.e { --status-color: var(--ds-error); box-shadow: 0 0 0 1px var(--ds-error); background: var(--ds-danger); }
`;
  assert.deepEqual(
    findBaseStatusTextColors(css).map(({ line, token, ink }) => ({ line, token, ink })),
    [
      { line: 2, token: "--ds-success", ink: "--ds-success-ink" },
      { line: 3, token: "--ds-danger", ink: "--ds-error-ink" },
      { line: 4, token: "--ds-error", ink: "--ds-error-ink" },
    ],
  );
});

test("usage guard reports a multi-line value at the line of its color property", () => {
  const css = ".x {\n  font-size: 12px;\n  color:\n    var(--ds-warning);\n}\n.y { color: var(--ds-text-muted); }\n";
  const found = findBaseStatusTextColors(css);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 3);
  assert.equal(found[0].ink, "--ds-warning-ink");
  assert.ok(found[0].message.includes("--ds-warning-ink"));
});
