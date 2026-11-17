/**
 * Quiet-text contrast guard for the renderer token blocks (PI-UI-1114).
 *
 * The two quiet text tiers carry real content (meta lines, counts, hints, empty
 * states), so each has to stay legible on every surface it lands on, in both
 * themes. The light `--ds-text-faint` was `#afafaf`: 2.19:1 on white and 1.98:1 on
 * the sidebar, under even the 3:1 floor for UI text. Contrast is computed from the
 * colours the token blocks resolve to, with alpha tokens composited over the
 * surface the way the compositor does it, so retuning a token or the surface under
 * it is judged by the ratio instead of by eye.
 *
 * Floors: `--ds-text-muted` at least 4.5:1, `--ds-text-faint` at least 3:1,
 * against the primary, sidebar, secondary and inset surfaces.
 *
 * Status ink (PI-UI-1115): the light status colours are under 4.5:1 as text (green
 * 3.36:1 and orange 3.79:1 on white, 2.4:1 to 3.7:1 on a 15% chip of their own
 * colour), so status text and glyphs paint with `--ds-success-ink`,
 * `--ds-warning-ink` and `--ds-error-ink` while fills, dots, borders and tints keep
 * the base colours. Each ink has to clear 4.5:1 on the four surfaces and on a 15%
 * chip of its base colour over each of them (`findLowContrastStatusInk`), and a
 * `color:` declaration may not name a base status token
 * (`findBaseStatusTextColors`). Stylesheet chips run 6% to 16%; the light inks
 * keep 4.5:1 across that range, and 15% is the modelled tint.
 *
 * Known boundary: this reads the opaque base surfaces. The sidebar can be
 * translucent glass over the desktop (vibrancy), so its contrast there is
 * approximate; a custom `--ds-bg-sidebar` image or tint is a theme the guard
 * cannot see. An unsupported colour form is reported instead of passing silently,
 * so the resolver is extended when the token syntax grows.
 */

export const TIER_FLOORS = new Map([
  ["--ds-text-muted", 4.5],
  ["--ds-text-faint", 3],
]);
export const SURFACE_TOKENS = ["--ds-bg-primary", "--ds-bg-sidebar", "--ds-bg-secondary", "--ds-bg-inset"];
/** Status ink token -> the base token whose hue it darkens and whose tint forms its chip. */
export const STATUS_INK = new Map([
  ["--ds-success-ink", "--ds-success"],
  ["--ds-warning-ink", "--ds-warning"],
  ["--ds-error-ink", "--ds-error"],
]);
export const STATUS_INK_FLOOR = 4.5;
export const STATUS_CHIP_ALPHA = 0.15;
/** Base status tokens that must not paint text, with the ink to use instead. */
const BASE_STATUS_TOKENS = new Map([
  ["--ds-success", "--ds-success-ink"],
  ["--ds-warning", "--ds-warning-ink"],
  ["--ds-error", "--ds-error-ink"],
  ["--ds-danger", "--ds-error-ink"],
]);

const THEME_ROOT = /^:root(?:\[data-theme=["'](dark|light)["']\])?$/;

/** The top-level rules of a stylesheet as `{ selector, body }`, comments removed. */
function topLevelRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") {
      if (depth === 0) open = i;
      depth += 1;
    } else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        rules.push({ selector: text.slice(start, open).trim(), body: text.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return rules;
}

/** Custom property declarations of the theme-root rules, later rules winning. */
function themeScopes(css) {
  const dark = new Map();
  const light = new Map();
  for (const { selector, body } of topLevelRules(css)) {
    const themes = selector
      .split(",")
      .map((part) => part.trim().match(THEME_ROOT))
      .filter(Boolean)
      .map((match) => match[1] ?? "dark");
    if (!themes.length) continue;
    for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      for (const theme of themes) (theme === "dark" ? dark : light).set(match[1], match[2].trim());
    }
  }
  // The light theme overrides the dark default, so it sees every dark token too.
  return { dark, light: new Map([...dark, ...light]) };
}

/** Resolve the colour forms the token blocks use to `{ rgb, alpha }`. */
function resolve(value, scope, seen = new Set()) {
  const text = value.trim();
  let match = text.match(/^#([\da-f]{6})$/i);
  if (match) {
    const n = Number.parseInt(match[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: 1 };
  }
  match = text.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (match) {
    if (seen.has(match[1])) throw new Error(`${match[1]} refers to itself`);
    const next = scope.get(match[1]) ?? match[2];
    if (!next) throw new Error(`${match[1]} is not defined and has no fallback`);
    return resolve(next, scope, new Set([...seen, match[1]]));
  }
  match = text.match(/^color-mix\(\s*in oklab,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/);
  if (match) {
    const color = resolve(match[1], scope, seen);
    return { rgb: color.rgb, alpha: color.alpha * (Number(match[2]) / 100) };
  }
  throw new Error(`unsupported colour form "${text}"`);
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The colour a token resolves to in a theme (`dark` or `light`), as `{ rgb, alpha }`. */
export function resolveToken(tokensCss, theme, token) {
  return resolve(`var(${token})`, themeScopes(tokensCss)[theme]);
}

/** `color` (alpha composited over the opaque `surface`) as an opaque colour. */
export function composite(color, surface) {
  return { rgb: color.rgb.map((channel, i) => surface.rgb[i] + color.alpha * (channel - surface.rgb[i])), alpha: 1 };
}

/** WCAG contrast of `ink` (alpha composited over `surface`) against `surface`. */
export function contrastRatio(ink, surface) {
  const over = composite(ink, surface).rgb;
  const [hi, lo] = [luminance(over), luminance(surface.rgb)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Report quiet text tiers that fall under their floor on a surface, and any token
 * the resolver cannot evaluate.
 * @param {string} tokensCss contents of styles/tokens.css
 * @returns {Array<{theme: string, tier: string, surface: string, ratio: number | null, floor: number, message: string}>}
 */
export function findLowContrastTextTiers(tokensCss) {
  const scopes = themeScopes(tokensCss);
  const violations = [];
  for (const theme of ["dark", "light"]) {
    const scope = scopes[theme];
    for (const [tier, floor] of TIER_FLOORS) {
      for (const surface of SURFACE_TOKENS) {
        try {
          const ratio = contrastRatio(resolve(`var(${tier})`, scope), resolve(`var(${surface})`, scope));
          if (ratio < floor) {
            violations.push({
              theme,
              tier,
              surface,
              ratio,
              floor,
              message: `${theme} ${tier} on ${surface} is ${ratio.toFixed(2)}:1, below ${floor}:1 — retune the token or its surface`,
            });
          }
        } catch (error) {
          violations.push({
            theme,
            tier,
            surface,
            ratio: null,
            floor,
            message: `${theme} ${tier} on ${surface} cannot be evaluated (${error.message}) — teach scripts/style-token-contrast.mjs the new token syntax`,
          });
        }
      }
    }
  }
  return violations;
}

/**
 * Report status ink tokens that fall under 4.5:1 as text on a surface or on a chip of
 * their own base colour, and any token the resolver cannot evaluate. The chip is the
 * base colour at 15% over the surface, composited the way the compositor does it.
 * @param {string} tokensCss contents of styles/tokens.css
 * @param {{ chipAlpha?: number }} [options] tint alpha of the modelled chip, 15% by default
 * @returns {Array<{theme: string, tier: string, surface: string, ground: "text" | "chip", ratio: number | null, floor: number, message: string}>}
 */
export function findLowContrastStatusInk(tokensCss, { chipAlpha = STATUS_CHIP_ALPHA } = {}) {
  const scopes = themeScopes(tokensCss);
  const violations = [];
  for (const theme of ["dark", "light"]) {
    const scope = scopes[theme];
    for (const [ink, base] of STATUS_INK) {
      for (const surface of SURFACE_TOKENS) {
        for (const ground of ["text", "chip"]) {
          const where = ground === "chip" ? `a ${Math.round(chipAlpha * 100)}% ${base} chip over ${surface}` : surface;
          try {
            const surfaceColor = resolve(`var(${surface})`, scope);
            const tint = resolve(`var(${base})`, scope);
            const paper =
              ground === "chip"
                ? composite({ rgb: tint.rgb, alpha: tint.alpha * chipAlpha }, surfaceColor)
                : surfaceColor;
            const ratio = contrastRatio(resolve(`var(${ink})`, scope), paper);
            if (ratio < STATUS_INK_FLOOR) {
              violations.push({
                theme,
                tier: ink,
                surface,
                ground,
                ratio,
                floor: STATUS_INK_FLOOR,
                message: `${theme} ${ink} on ${where} is ${ratio.toFixed(2)}:1, below ${STATUS_INK_FLOOR}:1 — darken the ink or retune its base colour`,
              });
            }
          } catch (error) {
            violations.push({
              theme,
              tier: ink,
              surface,
              ground,
              ratio: null,
              floor: STATUS_INK_FLOOR,
              message: `${theme} ${ink} on ${where} cannot be evaluated (${error.message}) — teach scripts/style-token-contrast.mjs the new token syntax`,
            });
          }
        }
      }
    }
  }
  return violations;
}

/**
 * Report `color:` declarations that name a base status token. Text and glyphs take the
 * ink tokens; the base colours stay for fills, dots, borders and tint mixes. A
 * `color-mix()` that blends a base token into text is the same declaration.
 * @param {string} css contents of a stylesheet
 * @returns {Array<{line: number, token: string, ink: string, message: string}>}
 */
export function findBaseStatusTextColors(css) {
  // Blank out comments but keep their newlines, so an offset still gives the right line.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const violations = [];
  for (const declaration of text.matchAll(/(?<![-\w])color\s*:\s*([^;{}]+)/g)) {
    const line = text.slice(0, declaration.index).split("\n").length;
    for (const reference of declaration[1].matchAll(/var\(\s*(--ds-(?:success|warning|error|danger))\s*[,)]/g)) {
      const token = reference[1];
      const ink = BASE_STATUS_TOKENS.get(token);
      violations.push({ line, token, ink, message: `color uses ${token}, under 4.5:1 as light-theme text — use ${ink}` });
    }
  }
  return violations;
}
