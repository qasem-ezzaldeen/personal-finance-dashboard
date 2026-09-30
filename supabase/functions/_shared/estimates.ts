// Shared by the web app (tests) and the estimate-costs function. Pure TypeScript.
// Mirrors goldGramValue() in src/lib/valuation.ts, but with the market inputs of a past date.

export const TROY_OUNCE_GRAMS = 31.1034768;
export const GOLD_21K_RATIO = 0.875;

export interface GoldSettings {
  gold_premium_pct: number;
  gold_21k_adjustment: number;
  gold_24k_adjustment: number;
  gold_adjustment_currency: string;
}

/** Market price of one gram of 24k gold (with the local premium) from that day's spot price and exchange rate. */
export function gold24kGramOn(xauUsdPerOunce: number, baseUsdRate: number, premiumPct: number): number {
  return (xauUsdPerOunce / TROY_OUNCE_GRAMS) * baseUsdRate * (1 + Number(premiumPct) / 100);
}

/**
 * Value of one gram of gold on a past date, in the base currency.
 * @param xauUsdPerOunce spot price that day
 * @param baseUsdRate units of the base currency per USD that day
 * @param adjustmentUsdRate units of the adjustment currency per USD that day
 */
export function estimateGoldGram(
  karat: 21 | 24,
  xauUsdPerOunce: number,
  baseUsdRate: number,
  adjustmentUsdRate: number,
  settings: GoldSettings,
): number {
  const p24 = gold24kGramOn(xauUsdPerOunce, baseUsdRate, settings.gold_premium_pct);
  const rawAdjustment = karat === 24 ? settings.gold_24k_adjustment : settings.gold_21k_adjustment;
  const adjustment = (Number(rawAdjustment) / adjustmentUsdRate) * baseUsdRate;
  return Math.max(0, (karat === 24 ? p24 : p24 * GOLD_21K_RATIO) + adjustment);
}
