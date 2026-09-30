// @vitest-environment node
// Checks that text colors in colors.css stay readable on their backgrounds (WCAG AA: 4.5:1).
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./colors.css", import.meta.url), "utf8");
const DARK_MARKER = ':root[data-theme="dark"]';
const readTokens = (text: string) =>
  new Map([...text.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

const light = readTokens(css.slice(0, css.indexOf(DARK_MARKER)));
// Dark mode redefines colors; anything it doesn't redefine (the swatches) comes from the light palette
const dark = new Map([...light, ...readTokens(css.slice(css.indexOf(DARK_MARKER)))]);

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [background, text] pairs used together in the app
const PAIRS: Array<[string, string]> = [
  ["surface", "ink"],
  ["surface", "ink-soft"],
  ["canvas", "ink-soft"],
  ["surface-muted", "ink-soft"],
  ["brand", "brand-ink"],
  ["surface", "brand-ink"],
  ["brand-strong", "on-brand-strong"],
  ["gain", "gain-ink"],
  ["loss", "loss-ink"],
  ["warning", "warning-ink"],
  ["neutral", "neutral-ink"],
  ["cash", "cash-ink"],
  ["gold", "gold-ink"],
  ["stocks", "stocks-ink"],
  ["other", "other-ink"],
  ["pending", "pending-ink"],
  ["surface", "gain-ink"],
  ["surface", "loss-ink"],
];

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("%s palette contrast (colors.css)", (_name, tokens) => {
  it.each(PAIRS)("%s background with %s text is readable", (bg, fg) => {
    expect(tokens.has(bg), `missing --color-${bg}`).toBe(true);
    expect(tokens.has(fg), `missing --color-${fg}`).toBe(true);
    expect(contrast(tokens.get(bg)!, tokens.get(fg)!)).toBeGreaterThanOrEqual(4.5);
  });
});

it("dark mode redefines every page, text and meaning color", () => {
  const darkOnly = readTokens(css.slice(css.indexOf(DARK_MARKER)));
  const required = [...light.keys()].filter((k) => !k.startsWith("swatch-"));
  expect(required.filter((k) => !darkOnly.has(k))).toEqual([]);
});
