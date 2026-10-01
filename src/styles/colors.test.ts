// @vitest-environment node
// Checks that text colors in colors.css stay readable on their backgrounds (WCAG AA: 4.5:1),
// for the default colors and every palette, in light and dark mode.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./colors.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const readTokens = (text: string) =>
  new Map([...text.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

// Every rule block: { selector, tokens }
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), tokens: readTokens(m[2]) }));

const light = blocks.find((b) => b.selector.startsWith("@theme"))!.tokens;
// Dark mode redefines colors; anything it doesn't redefine (the swatches) comes from the light palette
const darkOnly = blocks.find((b) => b.selector === ':root[data-theme="dark"]')!.tokens;
const dark = new Map([...light, ...darkOnly]);

const PALETTES = ["pastel", "minimal", "sea", "autumn", "nature", "oled"] as const;
/** Palettes with only a dark version (the app switches to dark while they're chosen) */
const DARK_ONLY = ["oled"];

function paletteBlocks(id: string) {
  const own = blocks.filter((b) => b.selector.includes(`[data-palette-preview="${id}"]`));
  if (DARK_ONLY.includes(id)) {
    // One block with everything, applied whatever the theme
    const only = own.find((b) => !b.selector.includes("data-theme"));
    return { swatches: only?.tokens, light: undefined, dark: only?.tokens };
  }
  const swatches = own.find((b) => !b.selector.includes("data-theme"));
  const lightBlock = own.find((b) => b.selector.includes(':not([data-theme="dark"])'));
  const darkBlock = own.find((b) => b.selector.includes('[data-theme="dark"]') && !b.selector.includes(":not("));
  return { swatches: swatches?.tokens, light: lightBlock?.tokens, dark: darkBlock?.tokens };
}

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
  ["surface-muted", "gain-ink"],
  ["surface-muted", "loss-ink"],
];

const SCHEMES = PALETTES.flatMap((id) => {
  const p = paletteBlocks(id);
  const darkScheme = [`${id} dark`, new Map([...dark, ...(p.swatches ?? []), ...(p.dark ?? [])])] as const;
  if (DARK_ONLY.includes(id)) return [darkScheme];
  return [[`${id} light`, new Map([...light, ...(p.swatches ?? []), ...(p.light ?? [])])] as const, darkScheme];
});

describe.each(SCHEMES)("%s contrast (colors.css)", (_name, tokens) => {
  it.each(PAIRS)("%s background with %s text is readable", (bg, fg) => {
    expect(tokens.has(bg), `missing --color-${bg}`).toBe(true);
    expect(tokens.has(fg), `missing --color-${fg}`).toBe(true);
    expect(contrast(tokens.get(bg)!, tokens.get(fg)!)).toBeGreaterThanOrEqual(4.5);
  });
});

it("dark mode redefines every page, text and meaning color", () => {
  const required = [...light.keys()].filter((k) => !k.startsWith("swatch-"));
  expect(required.filter((k) => !darkOnly.has(k))).toEqual([]);
});

describe.each(PALETTES)("the %s palette", (id) => {
  const p = paletteBlocks(id);

  it("has swatches and its light and dark blocks", () => {
    expect(p.swatches && p.dark && (DARK_ONLY.includes(id) || p.light)).toBeTruthy();
  });

  it("defines every swatch, and the same colors in light and dark", () => {
    const swatchNames = [...light.keys()].filter((k) => k.startsWith("swatch-"));
    expect(swatchNames.filter((k) => !p.swatches!.has(k))).toEqual([]);
    if (p.light) expect([...p.dark!.keys()].sort()).toEqual([...p.light.keys()].sort());
  });

  it("applies to the whole page when chosen (except Pastel, the default)", () => {
    const applied = blocks.some((b) => b.selector.includes(`:root[data-palette="${id}"]`));
    expect(applied).toBe(id !== "pastel");
  });
});

it("the Pastel preview matches the default colors", () => {
  const p = paletteBlocks("pastel");
  for (const [k, v] of p.light!) expect(v, k).toBe(light.get(k));
  for (const [k, v] of p.dark!) expect(v, k).toBe(dark.get(k));
  for (const [k, v] of p.swatches!) expect(v, k).toBe(light.get(k));
});

it("OLED is pure black", () => {
  expect(paletteBlocks("oled").dark!.get("canvas")).toBe("#000000");
});

// Light palettes should look clearly different from Pastel, not just a shade off
function distance(a: string, b: string) {
  const ch = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [ch(a), ch(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

it.each(PALETTES.filter((id) => id !== "pastel" && !DARK_ONLY.includes(id)))("the %s light palette differs clearly from Pastel", (id) => {
  const own = paletteBlocks(id).light!;
  expect(distance(own.get("canvas")!, light.get("canvas")!)).toBeGreaterThan(12);
  expect(distance(own.get("brand-strong")!, light.get("brand-strong")!)).toBeGreaterThan(40);
  expect(distance(own.get("brand")!, light.get("brand")!)).toBeGreaterThan(20);
});
