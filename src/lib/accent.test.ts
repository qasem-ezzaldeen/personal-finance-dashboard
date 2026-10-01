import { accentColors, contrast, isHexColor, mix } from "./accent";

describe("hero colors", () => {
  // A spread of colors people might pick, including awkward mid-tones
  const PICKS = ["#ff0000", "#00ff88", "#ffd400", "#0000ff", "#888888", "#ff66cc", "#14532d", "#ffffff", "#000000", "#6a45ff", "#e08a52"];
  const PAGES = [
    ["light", "#ffffff"],
    ["light", "#fffaf3"],
    ["dark", "#1e1f28"],
    ["dark", "#0a0a0c"],
  ] as const;

  it.each(PICKS.flatMap((hero) => PAGES.map(([theme, surface]) => [hero, theme, surface] as const)))(
    "%s on a %s page (%s) keeps text readable",
    (hero, theme, surface) => {
      const c = accentColors(hero, theme, surface);
      expect(c["brand-strong"]).toBe(hero);
      expect(contrast(c["brand-strong"], c["on-brand-strong"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.brand, c["brand-ink"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(surface, c["brand-ink"])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("mixes colors", () => {
    expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(mix("#ff0000", "#0000ff", 1)).toBe("#ff0000");
  });

  it("checks color values", () => {
    expect(isHexColor("#a1B2c3")).toBe(true);
    expect(isHexColor("red")).toBe(false);
  });
});
