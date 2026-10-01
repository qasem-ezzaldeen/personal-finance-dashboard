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

const PALETTES = ["pastel", "minimal", "sea", "autumn", "nature", "vivid"] as const;

function paletteBlocks(id: string) {
  const own = blocks.filter((b) => b.selector.includes(`[data-palette-preview="${id}"]`));
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
  return [
    [`${id} light`, new Map([...light, ...(p.swatches ?? []), ...(p.light ?? [])])],
    [`${id} dark`, new Map([...dark, ...(p.swatches ?? []), ...(p.dark ?? [])])],
  ] as const;
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

  it("has swatches, a light block and a dark block", () => {
    expect(p.swatches && p.light && p.dark).toBeTruthy();
  });

  it("defines every swatch, and the same colors in light and dark", () => {
    const swatchNames = [...light.keys()].filter((k) => k.startsWith("swatch-"));
    expect(swatchNames.filter((k) => !p.swatches!.has(k))).toEqual([]);
    expect([...p.dark!.keys()].sort()).toEqual([...p.light!.keys()].sort());
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
