import assert from "node:assert/strict";
import test from "node:test";
import {
  contrastRatio,
  findLowContrastTextTiers,
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
