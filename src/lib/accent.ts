// A palette's hero (accent) color, picked in Settings › Appearance. From one color this works out the
// brand colors the app uses, keeping text readable (WCAG AA, 4.5:1) whatever color is picked.

type Rgb = [number, number, number];

const parse = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** `amount` of `a` mixed into `b` (1 = all a). */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [parse(a), parse(b)];
  return toHex([0, 1, 2].map((i) => x[i] * amount + y[i] * (1 - amount)) as Rgb);
}

export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

const READABLE = 4.5;

/** The colors a hero color replaces */
export const ACCENT_TOKENS = ["brand-strong", "on-brand-strong", "brand", "brand-ink", "focus"] as const;

/** The first shade of `color`, moving toward `toward`, that's readable on every background. */
function readableShade(color: string, toward: string, backgrounds: string[]): string {
  for (let step = 0; step <= 20; step++) {
    const shade = mix(toward, color, step / 20);
    if (backgrounds.every((bg) => contrast(shade, bg) >= READABLE)) return shade;
  }
  return toward;
}

/**
 * The brand colors for a hero color, on a light or dark page whose cards use `surface`:
 * buttons in the hero color with readable text on them, a soft fill (active navigation, chips)
 * and an ink for links and text on that fill.
 */
export function accentColors(hero: string, theme: "light" | "dark", surface: string): Record<string, string> {
  const color = hero.toLowerCase();
  const onStrong = ["#ffffff", "#111111", "#000000"].find((c) => contrast(color, c) >= READABLE)
    ?? (contrast(color, "#ffffff") > contrast(color, "#000000") ? "#ffffff" : "#000000");
  const fill = theme === "light" ? mix(color, surface, 0.22) : mix(color, surface, 0.28);
  const ink = readableShade(color, theme === "light" ? "#000000" : "#ffffff", [fill, surface]);
  return {
    "brand-strong": color,
    "on-brand-strong": onStrong,
    brand: fill,
    "brand-ink": ink,
    focus: color,
  };
}
