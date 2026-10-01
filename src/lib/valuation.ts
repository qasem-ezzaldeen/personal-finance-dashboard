// How every asset, group, goal and the Zakat position is valued.
// Mirrors private.user_valuation() in supabase/migrations (keep both in sync).

import { daysBetween, todayIn } from "./format";
import {
  GOLD_UNIT,
  type Asset,
  type AssetGroup,
  type Goal,
  type MarketPrice,
  type PriceOverride,
  type PricingSettings,
  type Purchase,
  type Sale,
  type VaultData,
} from "./types";

export const TROY_OUNCE_GRAMS = 31.1034768;
export const GOLD_21K_RATIO = 0.875;
export const NISAB_GRAMS = 85;
export const HAWL_DAYS = 354;
export const ZAKAT_RATE = 0.025;

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface PriceBook {
  /** Units of each currency per 1 USD (USD = 1). */
  usdRates: Map<string, number>;
  fx: Map<string, MarketPrice>;
  xau: MarketPrice | null;
  stocks: Map<string, MarketPrice>;
  newestFetch: string | null;
}

export function buildPriceBook(rows: MarketPrice[]): PriceBook {
  const usdRates = new Map<string, number>([["USD", 1]]);
  const fx = new Map<string, MarketPrice>();
  const stocks = new Map<string, MarketPrice>();
  let xau: MarketPrice | null = null;
  let newestFetch: string | null = null;

  for (const row of rows) {
    const price = Number(row.price);
    if (!(price > 0)) continue;
    const normalized = { ...row, price, previous_price: row.previous_price === null ? null : Number(row.previous_price) };
    if (row.kind === "fx" && row.symbol.startsWith("FX:")) {
      const code = row.symbol.slice(3);
      usdRates.set(code, price);
      fx.set(code, normalized);
    } else if (row.symbol === "METAL:XAU") {
      xau = normalized;
    } else if (row.kind === "stock" && row.symbol.startsWith("STOCK:")) {
      stocks.set(row.symbol.slice(6), normalized);
    }
    if (!newestFetch || row.fetched_at > newestFetch) newestFetch = row.fetched_at;
  }
  return { usdRates, fx, xau, stocks, newestFetch };
}

/** Converts between currencies at the latest rates. Null when a rate is unknown. */
export function convert(amount: number, from: string, to: string, book: PriceBook): number | null {
  if (from === to) return amount;
  const fromRate = book.usdRates.get(from);
  const toRate = book.usdRates.get(to);
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

/** Trend of a currency pair (e.g. USD/EGP): +1 up, -1 down, 0 unchanged/unknown. */
export function pairTrend(from: string, to: string, book: PriceBook): number {
  const now = convert(1, from, to, book);
  const prev = (code: string) =>
    code === "USD" ? 1 : (book.fx.get(code)?.previous_price ?? book.usdRates.get(code) ?? null);
  const pf = prev(from);
  const pt = prev(to);
  if (now === null || !pf || !pt) return 0;
  const before = pt / pf;
  return Math.sign(Math.round((now - before) * 1e8));
}

export interface ValuationContext {
  book: PriceBook;
  pricing: PricingSettings;
  overrides: Map<string, PriceOverride>;
}

export function makeContext(book: PriceBook, pricing: PricingSettings, overrides: PriceOverride[]): ValuationContext {
  return { book, pricing, overrides: new Map(overrides.map((o) => [o.ticker, o])) };
}

/** 24k gold per gram in `currency`, including the local premium (or the manual price). */
export function gold24kPerGram(ctx: ValuationContext, currency: string): number | null {
  const { pricing, book } = ctx;
  if (pricing.gold_mode === "manual" && pricing.manual_gold_24k_price) {
    return convert(Number(pricing.manual_gold_24k_price), pricing.manual_gold_currency, currency, book);
  }
  if (!book.xau) return null;
  const perGram = convert(book.xau.price / TROY_OUNCE_GRAMS, "USD", currency, book);
  if (perGram === null) return null;
  return perGram * (1 + Number(pricing.gold_premium_pct) / 100);
}

/** Previous 24k price (for the trend arrow); null in manual mode or when unknown. */
export function gold24kTrend(ctx: ValuationContext): number {
  if (ctx.pricing.gold_mode === "manual" || !ctx.book.xau?.previous_price) return 0;
  return Math.sign(ctx.book.xau.price - ctx.book.xau.previous_price);
}

/** Value of one gram of 21k or 24k gold in `currency`, after the per-gram adjustment. */
export function goldGramValue(karat: 21 | 24, ctx: ValuationContext, currency: string): number | null {
  const p24 = gold24kPerGram(ctx, currency);
  if (p24 === null) return null;
  const rawAdjustment = karat === 24 ? ctx.pricing.gold_24k_adjustment : ctx.pricing.gold_21k_adjustment;
  const adjustment = convert(Number(rawAdjustment), ctx.pricing.gold_adjustment_currency, currency, ctx.book);
  if (adjustment === null) return null;
  const market = karat === 24 ? p24 : p24 * GOLD_21K_RATIO;
  return Math.max(0, market + adjustment);
}

export interface StockPrice {
  price: number;
  currency: string;
  isOverride: boolean;
  previous: number | null;
  fetchedAt: string | null;
  name: string | null;
}

export function stockPrice(ticker: string, ctx: ValuationContext): StockPrice | null {
  const override = ctx.overrides.get(ticker);
  const market = ctx.book.stocks.get(ticker);
  if (override) {
    return {
      price: Number(override.price),
      currency: override.currency,
      isOverride: true,
      previous: null,
      fetchedAt: null,
      name: market?.display_name ?? null,
    };
  }
  if (!market) return null;
  return {
    price: market.price,
    currency: market.currency,
    isOverride: false,
    previous: market.previous_price,
    fetchedAt: market.fetched_at,
    name: market.display_name,
  };
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export function isCashLike(asset: Pick<Asset, "kind">): boolean {
  return asset.kind === "cash" || asset.kind === "pending_income";
}

/** Value of one unit (gram / share / unit) of a gold, stock or other asset in `currency`. */
export function unitValue(asset: Asset, ctx: ValuationContext, currency: string): number | null {
  switch (asset.kind) {
    case "gold":
      return asset.karat ? goldGramValue(asset.karat, ctx, currency) : null;
    case "stock": {
      const quote = asset.ticker ? stockPrice(asset.ticker, ctx) : null;
      return quote ? convert(quote.price, quote.currency, currency, ctx.book) : null;
    }
    case "other":
      return asset.currency && asset.manual_unit_price !== null
        ? convert(Number(asset.manual_unit_price), asset.currency, currency, ctx.book)
        : null;
    default:
      return null;
  }
}

/** Cash balance, or what's held of a gold/stock/other asset: its purchases minus its sales. */
export function holdingQuantity(asset: Asset, purchases: Purchase[], sales: Sale[] = []): number {
  if (isCashLike(asset)) return Number(asset.balance);
  const bought = purchases.reduce((sum, p) => sum + Number(p.quantity), 0);
  const sold = sales.reduce((sum, s) => sum + Number(s.quantity), 0);
  return Math.max(0, bought - sold);
}

export function assetValue(asset: Asset, quantity: number, ctx: ValuationContext, currency: string): number | null {
  if (isCashLike(asset)) {
    return asset.currency ? convert(Number(asset.balance), asset.currency, currency, ctx.book) : null;
  }
  if (quantity === 0) return 0;
  const unit = unitValue(asset, ctx, currency);
  return unit === null ? null : quantity * unit;
}

// ---------------------------------------------------------------------------
// Growth since purchase
// ---------------------------------------------------------------------------

export interface Growth {
  cost: number;
  value: number;
  gain: number;
  /** Fraction: 0.2 means +20%. Null when the cost was zero. */
  pct: number | null;
  currency: string;
  /** True when (part of) the cost is the market price on the purchase date, not a price the user entered */
  estimated: boolean;
}

/** Growth of one purchase, measured in the currency it was paid in. */
export function purchaseGrowth(purchase: Purchase, asset: Asset, ctx: ValuationContext): Growth | null {
  if (purchase.cost_total === null || !purchase.cost_currency) return null;
  const unit = unitValue(asset, ctx, purchase.cost_currency);
  if (unit === null) return null;
  const cost = Number(purchase.cost_total);
  const value = Number(purchase.quantity) * unit;
  return {
    cost,
    value,
    gain: value - cost,
    pct: cost > 0 ? (value - cost) / cost : null,
    currency: purchase.cost_currency,
    estimated: purchase.cost_is_estimated,
  };
}

/** The same growth for a share of the holding (average cost: every unit cost the same). */
export function scaleGrowth(growth: Growth | null, share: number): Growth | null {
  if (!growth || share === 1) return growth;
  const cost = growth.cost * share;
  const value = growth.value * share;
  return { ...growth, cost, value, gain: value - cost, pct: cost > 0 ? (value - cost) / cost : null };
}

/** Combines several growths into one, converting cost and value at the same (current) rate. */
export function combineGrowth(items: Array<Growth | null>, currency: string, book: PriceBook): Growth | null {
  let cost = 0;
  let value = 0;
  let any = false;
  let estimated = false;
  for (const g of items) {
    if (!g) continue;
    const c = convert(g.cost, g.currency, currency, book);
    const v = convert(g.value, g.currency, currency, book);
    if (c === null || v === null) continue;
    cost += c;
    value += v;
    any = true;
    estimated ||= g.estimated;
  }
  if (!any) return null;
  return { cost, value, gain: value - cost, pct: cost > 0 ? (value - cost) / cost : null, currency, estimated };
}

// ---------------------------------------------------------------------------
// Whole-vault summary
// ---------------------------------------------------------------------------

export interface PurchaseSummary {
  purchase: Purchase;
  growth: Growth | null;
  /** Current value in the base currency */
  value: number | null;
}

export interface SaleSummary {
  sale: Sale;
  /** What the sold units cost, at the asset's average cost, in the sale's currency (null when unknown) */
  cost: number | null;
  /** Received minus cost */
  gain: number | null;
  pct: number | null;
}

export interface AssetSummary {
  asset: Asset;
  /** Held now: purchases minus sales */
  quantity: number;
  /** In the base currency; null when a price is missing. */
  value: number | null;
  unitValue: number | null;
  growth: Growth | null;
  purchases: PurchaseSummary[];
  sales: SaleSummary[];
  hidden: boolean;
}

export interface GroupSummary {
  group: AssetGroup;
  assets: AssetSummary[];
  value: number;
  share: number;
  growth: Growth | null;
  incomplete: boolean;
}

export interface ZakatStatus {
  enabled: boolean;
  grams: number | null;
  aboveNisab: boolean | null;
  hawlStart: string | null;
  daysIntoHawl: number;
  daysRemaining: number;
  isDue: boolean;
  /** Wealth recorded at the start of the Hawl, in the base currency (null if none was recorded) */
  startWealth: number | null;
  /** 2.5% of the start-of-Hawl wealth, or of today's wealth when no start wealth is recorded */
  dueAmount: number | null;
  /** start: wealth recorded at the start · nisab: first Hawl, value of 85 g of 24k gold on the start date · current: today */
  dueBasis: "start" | "nisab" | "current";
  lastPayment: VaultData["zakatPayments"][number] | null;
}

export interface VaultSummary {
  base: string;
  today: string;
  groups: GroupSummary[];
  pending: AssetSummary | null;
  netWorth: number;
  zakatable: number;
  incomplete: boolean;
  missingPrices: string[];
  totalGrowth: Growth | null;
  gold24k: number | null;
  zakat: ZakatStatus;
}

export function summarizeVault(vault: VaultData, ctx: ValuationContext, now = new Date()): VaultSummary {
  const base = vault.profile.base_currency;
  const today = todayIn(vault.profile.timezone, now);

  const purchasesByAsset = new Map<string, Purchase[]>();
  for (const p of vault.purchases) {
    const list = purchasesByAsset.get(p.asset_id) ?? [];
    list.push(p);
    purchasesByAsset.set(p.asset_id, list);
  }

  const salesByAsset = new Map<string, Sale[]>();
  for (const s of vault.sales ?? []) {
    const list = salesByAsset.get(s.asset_id) ?? [];
    list.push(s);
    salesByAsset.set(s.asset_id, list);
  }

  const missing: string[] = [];
  const summarize = (asset: Asset): AssetSummary => {
    const purchases = [...(purchasesByAsset.get(asset.id) ?? [])].sort((a, b) =>
      b.acquired_on === a.acquired_on ? b.created_at.localeCompare(a.created_at) : b.acquired_on.localeCompare(a.acquired_on),
    );
    const sales = [...(salesByAsset.get(asset.id) ?? [])].sort((a, b) =>
      b.sold_on === a.sold_on ? b.created_at.localeCompare(a.created_at) : b.sold_on.localeCompare(a.sold_on),
    );
    const quantity = holdingQuantity(asset, purchases, sales);
    const value = assetValue(asset, quantity, ctx, base);
    if (value === null) missing.push(asset.name);
    const unit = isCashLike(asset) ? null : unitValue(asset, ctx, base);
    const purchaseSummaries = purchases.map((purchase) => ({
      purchase,
      growth: purchaseGrowth(purchase, asset, ctx),
      value: unit === null ? null : Number(purchase.quantity) * unit,
    }));

    // Average cost: what one unit cost, over every purchase with a known price
    let knownCost = 0;
    let knownQuantity = 0;
    for (const p of purchases) {
      const cost = p.cost_total !== null && p.cost_currency ? convert(Number(p.cost_total), p.cost_currency, base, ctx.book) : null;
      if (cost === null) continue;
      knownCost += cost;
      knownQuantity += Number(p.quantity);
    }
    const averageCost = knownQuantity > 0 ? knownCost / knownQuantity : null;
    const saleSummaries = sales.map((sale): SaleSummary => {
      const cost = averageCost === null ? null : convert(averageCost * Number(sale.quantity), base, sale.proceeds_currency, ctx.book);
      const gain = cost === null ? null : Number(sale.proceeds) - cost;
      return { sale, cost, gain, pct: cost !== null && cost > 0 && gain !== null ? gain / cost : null };
    });

    // Growth of what's still held: the purchases' growth, for the share that hasn't been sold
    const bought = purchases.reduce((sum, p) => sum + Number(p.quantity), 0);
    const share = bought > 0 ? quantity / bought : 1;
    return {
      asset,
      quantity,
      value,
      unitValue: unit,
      growth: quantity === 0 && sales.length > 0 ? null : scaleGrowth(combineGrowth(purchaseSummaries.map((p) => p.growth), base, ctx.book), share),
      purchases: purchaseSummaries,
      sales: saleSummaries,
      hidden: asset.hide_when_empty && quantity === 0,
    };
  };

  const active = vault.assets.filter((a) => !a.archived_at);
  const pendingAsset = active.find((a) => a.kind === "pending_income") ?? null;
  const pending = pendingAsset ? summarize(pendingAsset) : null;

  const groupsSorted = [...vault.groups].sort((a, b) => a.sort_order - b.sort_order);
  const groups: GroupSummary[] = groupsSorted.map((group) => {
    const assets = active
      .filter((a) => a.kind === group.kind)
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
      .map(summarize);
    const value = assets.reduce((sum, a) => sum + (a.value ?? 0), 0);
    return {
      group,
      assets,
      value,
      share: 0,
      growth: combineGrowth(assets.map((a) => a.growth), base, ctx.book),
      incomplete: assets.some((a) => a.value === null),
    };
  });

  const zakatable = groups.reduce((sum, g) => sum + g.value, 0);
  const netWorth = zakatable + (pending?.value ?? 0);
  for (const g of groups) g.share = netWorth > 0 ? g.value / netWorth : 0;

  const gold24k = gold24kPerGram(ctx, base);
  const grams = gold24k && gold24k > 0 ? zakatable / gold24k : null;
  const hawlStart = vault.hawl?.hawl_start_date ?? null;
  const daysIntoHawl = hawlStart ? Math.max(1, daysBetween(hawlStart, today) + 1) : 0;
  const lastPayment = [...vault.zakatPayments].sort((a, b) => b.paid_on.localeCompare(a.paid_on))[0] ?? null;
  const startWealth =
    hawlStart && vault.hawl?.start_wealth !== null && vault.hawl?.start_wealth !== undefined && vault.hawl.start_wealth_currency
      ? convert(Number(vault.hawl.start_wealth), vault.hawl.start_wealth_currency, base, ctx.book)
      : null;

  return {
    base,
    today,
    groups,
    pending,
    netWorth,
    zakatable,
    incomplete: missing.length > 0,
    missingPrices: missing,
    totalGrowth: combineGrowth(groups.map((g) => g.growth), base, ctx.book),
    gold24k,
    zakat: {
      enabled: vault.profile.zakat_enabled,
      grams,
      aboveNisab: grams === null ? null : grams >= NISAB_GRAMS,
      hawlStart,
      daysIntoHawl,
      daysRemaining: hawlStart ? Math.max(0, HAWL_DAYS - daysIntoHawl) : HAWL_DAYS,
      isDue: daysIntoHawl >= HAWL_DAYS,
      startWealth,
      dueAmount: (startWealth ?? zakatable) * ZAKAT_RATE,
      dueBasis: startWealth === null ? "current" : vault.hawl?.is_first_hawl ? "nisab" : "start",
      lastPayment,
    },
  };
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalProgress {
  current: number | null;
  target: number;
  unit: string;
  /** Fraction 0..n */
  progress: number | null;
  remaining: number | null;
  reached: boolean;
}

/** Converts an amount in the base currency to a goal unit (a currency or grams of 24k gold), and back. */
function toUnit(amount: number, unit: string, summary: VaultSummary, ctx: ValuationContext): number | null {
  if (unit === GOLD_UNIT) return summary.gold24k && summary.gold24k > 0 ? amount / summary.gold24k : null;
  return convert(amount, summary.base, unit, ctx.book);
}

function fromUnit(amount: number, unit: string, summary: VaultSummary, ctx: ValuationContext): number | null {
  if (unit === GOLD_UNIT) return summary.gold24k && summary.gold24k > 0 ? amount * summary.gold24k : null;
  return convert(amount, unit, summary.base, ctx.book);
}

function progressOf(current: number | null, goal: Goal): GoalProgress {
  const target = Number(goal.target_amount);
  // Tiny rounding differences from converting back and forth shouldn't keep a goal from being reached
  const reached = current !== null && current >= target * (1 - 1e-9);
  return {
    current,
    target,
    unit: goal.target_unit,
    progress: current === null ? null : reached ? Math.max(1, current / target) : current / target,
    remaining: current === null || reached ? (current === null ? null : 0) : Math.max(0, target - current),
    reached,
  };
}

/** Progress toward one goal, measured against all of the wealth it counts (milestones). */
export function goalProgress(goal: Goal, summary: VaultSummary, ctx: ValuationContext): GoalProgress {
  const wealth = goal.include_upcoming ? summary.netWorth : summary.zakatable;
  return progressOf(toUnit(wealth, goal.target_unit, summary, ctx), goal);
}

/**
 * Progress for a list of goals in their order. Unreserved goals see all the wealth they count.
 * Reserved goals claim money one after another, each up to its target, so the same money is never
 * counted twice: with 1M and two reserved 1M goals, the first is reached and the second is at 0%.
 * A goal that excludes Upcoming Income can only claim money that isn't Upcoming Income, so reserved
 * goals that include it use Upcoming Income first.
 */
export function goalsProgress(goals: Goal[], summary: VaultSummary, ctx: ValuationContext): Map<string, GoalProgress> {
  const result = new Map<string, GoalProgress>();
  let main = Math.max(0, summary.zakatable);
  let upcoming = Math.max(0, summary.netWorth - summary.zakatable);

  for (const goal of goals) {
    if (!goal.reserve_funds) {
      result.set(goal.id, goalProgress(goal, summary, ctx));
      continue;
    }
    const targetInBase = fromUnit(Number(goal.target_amount), goal.target_unit, summary, ctx);
    if (targetInBase === null) {
      result.set(goal.id, progressOf(null, goal));
      continue;
    }
    let claimed = 0;
    if (goal.include_upcoming) {
      const fromUpcoming = Math.min(upcoming, targetInBase);
      upcoming -= fromUpcoming;
      claimed += fromUpcoming;
    }
    const fromMain = Math.min(main, targetInBase - claimed);
    main -= fromMain;
    claimed += fromMain;
    result.set(goal.id, progressOf(toUnit(claimed, goal.target_unit, summary, ctx), goal));
  }
  return result;
}
