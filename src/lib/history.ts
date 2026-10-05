// Net worth on past days, and where each change came from (Insights page and the change KPI).
//
// What was held on a day is rebuilt from the records: gold, stocks and other assets from their
// purchases and sales up to that day; cash balances by taking today's balance and undoing every
// Activity entry after that day. It is then valued with that day's closing prices, through the same
// summarizeVault() as today's numbers, so the last point always matches the dashboard.

import { addDays, todayIn } from "./format";
import { GOLD_UNIT, type Asset, type Goal, type GroupKind, type HistoricalPrice, type MarketPrice, type PeriodKey, type Transaction, type TransactionChange, type VaultData } from "./types";
import {
  buildPriceBook,
  convert,
  goldGramValue,
  isCashLike,
  makeContext,
  stockPrice,
  summarizeVault,
  unitValue,
  type AssetSummary,
  type GoalProgress,
  type PriceBook,
  type ValuationContext,
  type VaultSummary,
} from "./valuation";

export interface Ledger {
  transactions: Transaction[];
  changes: TransactionChange[];
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const PERIODS: Array<{ key: PeriodKey; label: string; short: string }> = [
  { key: "month", label: "This month", short: "Month" },
  { key: "7d", label: "Last 7 days", short: "1W" },
  { key: "30d", label: "Last 30 days", short: "1M" },
  { key: "3m", label: "Last 3 months", short: "3M" },
  { key: "ytd", label: "This year", short: "YTD" },
  { key: "1y", label: "Last 12 months", short: "1Y" },
  { key: "all", label: "All time", short: "All" },
];

export function periodLabel(key: PeriodKey): string {
  return PERIODS.find((p) => p.key === key)?.label ?? key;
}

export function isPeriodKey(value: unknown): value is PeriodKey {
  return PERIODS.some((p) => p.key === value);
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The day a period is measured from: the change is "value at the end of today" minus "value at the
 * end of this day". "This month" starts from the last day of the previous month, so it covers the 1st
 * onward. Never earlier than the day before the first record.
 */
export function periodBaseline(key: PeriodKey, today: string, firstDay: string): string {
  const earliest = addDays(firstDay, -1);
  let baseline: string;
  switch (key) {
    case "month":
      baseline = addDays(`${today.slice(0, 7)}-01`, -1);
      break;
    case "7d":
      baseline = addDays(today, -7);
      break;
    case "30d":
      baseline = addDays(today, -30);
      break;
    case "3m":
      baseline = addMonths(today, -3);
      break;
    case "ytd":
      baseline = `${Number(today.slice(0, 4)) - 1}-12-31`;
      break;
    case "1y":
      baseline = addMonths(today, -12);
      break;
    case "all":
      baseline = earliest;
      break;
  }
  return baseline < earliest ? earliest : baseline;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * The day each Activity entry counts on, in the user's time zone. Buying and selling count on the
 * purchase or sale date, so a purchase recorded later moves the money out of cash on the day it was bought.
 */
export function entryDates(vault: VaultData, ledger: Ledger): Map<string, string> {
  const tz = vault.profile.timezone;
  const purchaseDay = new Map(vault.purchases.filter((p) => p.transaction_id).map((p) => [p.transaction_id!, p.acquired_on]));
  const saleDay = new Map(vault.sales.map((s) => [s.transaction_id, s.sold_on]));
  const days = new Map<string, string>();
  for (const tx of ledger.transactions) {
    const linked = tx.kind === "buy" ? purchaseDay.get(tx.id) : tx.kind === "sell" ? saleDay.get(tx.id) : undefined;
    days.set(tx.id, linked ?? todayIn(tz, new Date(tx.occurred_at)));
  }
  return days;
}

/** The first day anything was recorded: a purchase, a sale, an Activity entry or the vault itself. */
export function firstRecordDay(vault: VaultData, ledger: Ledger, today: string): string {
  let first = today;
  const consider = (day: string | undefined) => {
    if (day && day < first) first = day;
  };
  for (const p of vault.purchases) consider(p.acquired_on);
  for (const s of vault.sales) consider(s.sold_on);
  for (const day of entryDates(vault, ledger).values()) consider(day);
  consider(todayIn(vault.profile.timezone, new Date(vault.profile.created_at)));
  return first;
}

/** Income, including income imported from the previous version (an entry that raised Upcoming Income). */
export function isIncome(tx: Transaction): boolean {
  if (tx.kind === "income") return true;
  if (tx.kind !== "imported") return false;
  return tx.pending_after === null || tx.pending_before === null || Number(tx.pending_after) >= Number(tx.pending_before);
}

/** An income entry in the base currency, at the rate on the day it was logged when it was recorded. */
export function incomeInBase(tx: Transaction, base: string, book: PriceBook): number | null {
  const amount = Number(tx.amount);
  if (tx.currency === base) return amount;
  if (tx.base_currency === base && tx.rate_to_base) return amount * Number(tx.rate_to_base);
  return convert(amount, tx.currency, base, book);
}

/** Price symbols needed to value this vault on past days. */
export function historySymbols(vault: VaultData, live: MarketPrice[]): string[] {
  const symbols = new Set<string>();
  const fx = (code: string | null | undefined) => {
    if (code && code !== "USD") symbols.add(`FX:${code}`);
  };
  const liveStocks = new Map(live.filter((r) => r.symbol.startsWith("STOCK:")).map((r) => [r.symbol, r.currency]));
  const overrides = new Map(vault.overrides.map((o) => [o.ticker, o.currency]));
  // Also what measuring in USD needs: the base currency's rate every day
  fx(vault.profile.base_currency);
  for (const asset of vault.assets) {
    if (asset.archived_at) continue;
    if (asset.kind === "gold") {
      symbols.add("METAL:XAU");
      fx(vault.pricing.gold_adjustment_currency);
      if (vault.pricing.gold_mode === "manual") fx(vault.pricing.manual_gold_currency);
    } else if (asset.kind === "stock" && asset.ticker) {
      if (overrides.has(asset.ticker)) fx(overrides.get(asset.ticker));
      else {
        symbols.add(`STOCK:${asset.ticker}`);
        fx(liveStocks.get(`STOCK:${asset.ticker}`));
      }
    } else {
      fx(asset.currency);
    }
  }
  return [...symbols].sort();
}

// ---------------------------------------------------------------------------
// Prices on a past day
// ---------------------------------------------------------------------------

type Series = Map<string, HistoricalPrice[]>;

function groupSeries(rows: HistoricalPrice[]): Series {
  const series: Series = new Map();
  for (const row of rows) {
    const price = Number(row.price);
    if (!(price > 0)) continue;
    const list = series.get(row.symbol) ?? [];
    list.push({ ...row, price });
    series.set(row.symbol, list);
  }
  for (const list of series.values()) list.sort((a, b) => a.price_date.localeCompare(b.price_date));
  return series;
}

/** The last close on or before `date`; before the first close, the first one. */
function closeOn(list: HistoricalPrice[], date: string): HistoricalPrice {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].price_date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return list[Math.max(0, found)];
}

const KIND_BY_PREFIX: Record<string, MarketPrice["kind"]> = { FX: "fx", METAL: "metal", STOCK: "stock" };

/** Today's prices, with every symbol that has history replaced by its close on `date`. */
function bookOn(date: string, series: Series, live: MarketPrice[]): PriceBook {
  const rows: MarketPrice[] = live.map((row) => {
    const list = series.get(row.symbol);
    if (!list?.length) return row;
    const close = closeOn(list, date);
    return { ...row, price: close.price, previous_price: null, currency: close.currency };
  });
  const liveSymbols = new Set(live.map((r) => r.symbol));
  for (const [symbol, list] of series) {
    if (liveSymbols.has(symbol) || !list.length) continue;
    const close = closeOn(list, date);
    rows.push({
      symbol,
      kind: KIND_BY_PREFIX[symbol.split(":")[0]] ?? "stock",
      price: close.price,
      previous_price: null,
      currency: close.currency,
      display_name: null,
      source: "history",
      fetched_at: `${date}T23:59:59Z`,
      changed_at: `${date}T23:59:59Z`,
    });
  }
  return buildPriceBook(rows);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Where a day's (or a period's) change in net worth came from, in the history's unit. */
export interface Change {
  /** Income logged */
  income: number;
  /** Price changes of gold, stocks and other assets (stocks in the currency they're priced in) */
  gold: number;
  stock: number;
  other: number;
  /** Exchange-rate moves on money held in another currency than the one it's measured in */
  currency: number;
  /** Everything else: balance edits, holdings added without paying from cash, money that left, prices that appeared */
  unexplained: number;
}

/** One asset's change from its own price and from exchange rates. */
export interface AssetChange {
  price: number;
  currency: number;
}

export type GroupValues = Record<GroupKind | "pending", number>;

/** Something whose price can be charted: gold of one karat, a stock, or an exchange rate. */
export interface Instrument {
  /** GOLD:24, STOCK:SPUS or FX:USD */
  key: string;
  label: string;
  kind: "gold" | "stock" | "fx";
  /** The currency its price is in */
  currency: string;
  /** The assets it prices (none for exchange rates) */
  assetIds: string[];
}

export interface HistoryPoint {
  date: string;
  netWorth: number;
  groups: GroupValues;
  /** Value of each asset that held something (by id) */
  assets: Record<string, number>;
  /** Since the previous point (all zero for the first one) */
  change: Change;
  /** Each asset's part of the change (only assets that moved) */
  assetChanges: Record<string, AssetChange>;
  /** Base-currency value of one of each currency it can be measured in */
  rates: Record<string, number | null>;
  /** Price of each instrument, in the instrument's currency */
  prices: Record<string, number | null>;
}

export interface VaultHistory {
  base: string;
  /** The currency the amounts are measured in */
  unit: string;
  today: string;
  /** The first day anything was recorded */
  firstDay: string;
  /** The vault was created on this day: cash balances before it are assumed unchanged */
  trackedSince: string;
  instruments: Instrument[];
  /** Daily, from the period's baseline to today */
  points: HistoryPoint[];
}

const ZERO_CHANGE: Change = { income: 0, gold: 0, stock: 0, other: 0, currency: 0, unexplained: 0 };

export function addChanges(a: Change, b: Change): Change {
  return {
    income: a.income + b.income,
    gold: a.gold + b.gold,
    stock: a.stock + b.stock,
    other: a.other + b.other,
    currency: a.currency + b.currency,
    unexplained: a.unexplained + b.unexplained,
  };
}

/** The currencies amounts can be measured in: the base currency, and USD. */
export function measureUnits(vault: VaultData): string[] {
  const base = vault.profile.base_currency;
  return base === "USD" ? [base] : [base, "USD"];
}

/** What can be charted for this vault: each karat of gold held, each stock, and each other currency money is held in. */
export function instrumentsFor(vault: VaultData, live: MarketPrice[]): Instrument[] {
  const base = vault.profile.base_currency;
  const active = vault.assets.filter((a) => !a.archived_at);
  const liveStocks = new Map(live.filter((r) => r.symbol.startsWith("STOCK:")).map((r) => [r.symbol.slice(6), r.currency]));
  const overrides = new Map(vault.overrides.map((o) => [o.ticker, o.currency]));
  const list: Instrument[] = [];
  for (const karat of [24, 21] as const) {
    const ids = active.filter((a) => a.kind === "gold" && a.karat === karat).map((a) => a.id);
    if (ids.length) list.push({ key: `GOLD:${karat}`, label: `Gold ${karat}k`, kind: "gold", currency: base, assetIds: ids });
  }
  const tickers = new Map<string, string[]>();
  for (const a of active) if (a.kind === "stock" && a.ticker) tickers.set(a.ticker, [...(tickers.get(a.ticker) ?? []), a.id]);
  for (const [ticker, ids] of tickers) {
    list.push({ key: `STOCK:${ticker}`, label: ticker, kind: "stock", currency: overrides.get(ticker) ?? liveStocks.get(ticker) ?? "USD", assetIds: ids });
  }
  const currencies = new Set<string>();
  for (const a of active) if (a.currency && a.kind !== "stock") currencies.add(a.currency);
  for (const s of list) if (s.kind === "stock") currencies.add(s.currency);
  currencies.delete(base);
  for (const c of [...currencies].sort()) list.push({ key: `FX:${c}`, label: `${c}/${base}`, kind: "fx", currency: base, assetIds: [] });
  return list;
}

function instrumentPrice(instrument: Instrument, ctx: ValuationContext): number | null {
  const [kind, code] = instrument.key.split(":");
  if (kind === "GOLD") return goldGramValue(Number(code) as 21 | 24, ctx, instrument.currency);
  if (kind === "FX") return convert(1, code, instrument.currency, ctx.book);
  const quote = stockPrice(code, ctx);
  return quote ? convert(quote.price, quote.currency, instrument.currency, ctx.book) : null;
}

/** One unit of an asset in the currency its price is set in (gold: its local price in the base currency). */
function localQuote(asset: Asset, ctx: ValuationContext, base: string): { price: number; currency: string } | null {
  if (isCashLike(asset)) return asset.currency ? { price: 1, currency: asset.currency } : null;
  if (asset.kind === "stock") {
    const quote = asset.ticker ? stockPrice(asset.ticker, ctx) : null;
    return quote ? { price: quote.price, currency: quote.currency } : null;
  }
  if (asset.kind === "other") {
    return asset.currency && asset.manual_unit_price !== null ? { price: Number(asset.manual_unit_price), currency: asset.currency } : null;
  }
  const unit = unitValue(asset, ctx, base);
  return unit === null ? null : { price: unit, currency: base };
}

interface Day {
  date: string;
  ctx: ValuationContext;
  summary: VaultSummary;
  assets: Map<string, AssetSummary>;
}

/** The change from one day to the next, split by cause and by asset. Holdings are the first day's. */
function changeBetween(a: Day, b: Day, income: number): { change: Change; byAsset: Record<string, AssetChange> } {
  const base = b.summary.base;
  const change: Change = { ...ZERO_CHANGE, income };
  const byAsset: Record<string, AssetChange> = {};
  for (const [id, held] of a.assets) {
    const qa = held.quantity;
    if (qa === 0) continue;
    const asset = b.assets.get(id)?.asset ?? held.asset;
    const la = localQuote(held.asset, a.ctx, base);
    const lb = localQuote(asset, b.ctx, base);
    if (!la || !lb) continue;
    const xa = convert(1, la.currency, base, a.ctx.book);
    const xb = convert(1, lb.currency, base, b.ctx.book);
    if (xa === null || xb === null) continue;

    let price: number;
    let fx: number;
    if (isCashLike(asset)) {
      // Cash's price is always 1: all of its change is the exchange rate
      price = 0;
      fx = qa * (xb - xa);
    } else if (la.currency === lb.currency) {
      price = qa * (lb.price - la.price) * xb;
      fx = qa * la.price * (xb - xa);
    } else {
      price = qa * (lb.price * xb - la.price * xa);
      fx = 0;
    }
    change.currency += fx;
    if (asset.kind === "gold") change.gold += price;
    else if (asset.kind === "stock") change.stock += price;
    else if (asset.kind === "other") change.other += price;
    if (price !== 0 || fx !== 0) byAsset[id] = { price, currency: fx };
  }
  const explained = change.income + change.gold + change.stock + change.other + change.currency;
  change.unexplained = b.summary.netWorth - a.summary.netWorth - explained;
  return { change, byAsset };
}

function groupValues(summary: VaultSummary): GroupValues {
  const values: GroupValues = { cash: 0, gold: 0, stock: 0, other: 0, pending: summary.pending?.value ?? 0 };
  for (const g of summary.groups) values[g.group.kind] += g.value;
  return values;
}

export interface HistoryInput {
  vault: VaultData;
  ledger: Ledger;
  /** Daily closes (any order) */
  prices: HistoricalPrice[];
  /** Today's prices */
  live: MarketPrice[];
  /** Today in the user's time zone (YYYY-MM-DD) */
  today: string;
  /** First day to compute (a period's baseline); clamped to the day before the first record */
  from: string;
}

export function buildHistory({ vault, ledger, prices, live, today, from }: HistoryInput): VaultHistory {
  const base = vault.profile.base_currency;
  const tz = vault.profile.timezone;
  // Only the Zakat fields of a summary depend on the time, and they aren't used here
  const now = new Date();
  const firstDay = firstRecordDay(vault, ledger, today);
  const start = from < addDays(firstDay, -1) ? addDays(firstDay, -1) : from > today ? today : from;
  const series = groupSeries(prices);
  const days = entryDates(vault, ledger);
  const instruments = instrumentsFor(vault, live);
  const units = measureUnits(vault);

  // Cash balance changes and income, by day
  const deltasByDay = new Map<string, Array<{ assetId: string; delta: number }>>();
  const cashIds = new Set(vault.assets.filter(isCashLike).map((a) => a.id));
  const txById = new Map(ledger.transactions.map((t) => [t.id, t]));
  for (const c of ledger.changes) {
    if (!c.asset_id || !cashIds.has(c.asset_id) || !txById.has(c.transaction_id)) continue;
    const day = days.get(c.transaction_id)!;
    const list = deltasByDay.get(day) ?? [];
    list.push({ assetId: c.asset_id, delta: Number(c.delta) });
    deltasByDay.set(day, list);
  }
  const incomeByDay = new Map<string, Transaction[]>();
  for (const tx of ledger.transactions) {
    if (!isIncome(tx)) continue;
    const day = days.get(tx.id)!;
    incomeByDay.set(day, [...(incomeByDay.get(day) ?? []), tx]);
  }

  // Balances at the end of each day, walking back from today's
  const dates: string[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) dates.push(d);
  const balances = new Map(vault.assets.filter(isCashLike).map((a) => [a.id, Number(a.balance)]));
  const undo = (day: string) => {
    for (const { assetId, delta } of deltasByDay.get(day) ?? []) balances.set(assetId, (balances.get(assetId) ?? 0) - delta);
  };
  for (const day of deltasByDay.keys()) if (day > today) undo(day);
  const balancesOn = new Map<string, Map<string, number>>();
  for (let i = dates.length - 1; i >= 0; i--) {
    balancesOn.set(dates[i], new Map(balances));
    undo(dates[i]);
  }

  const points: HistoryPoint[] = [];
  let previous: Day | null = null;
  for (const date of dates) {
    const book = date >= today ? buildPriceBook(live) : bookOn(date, series, live);
    const ctx = makeContext(book, vault.pricing, vault.overrides);
    const dayBalances = balancesOn.get(date)!;
    const held: VaultData = {
      ...vault,
      assets: vault.assets.map((a) => (isCashLike(a) ? { ...a, balance: dayBalances.get(a.id) ?? Number(a.balance) } : a)),
      purchases: vault.purchases.filter((p) => p.acquired_on <= date),
      sales: vault.sales.filter((s) => s.sold_on <= date),
    };
    const summary = summarizeVault(held, ctx, now);
    const all = [...summary.groups.flatMap((g) => g.assets), ...(summary.pending ? [summary.pending] : [])];
    const day: Day = { date, ctx, summary, assets: new Map(all.map((a) => [a.asset.id, a])) };

    const income = (incomeByDay.get(date) ?? []).reduce((sum, tx) => sum + (incomeInBase(tx, base, book) ?? 0), 0);
    const { change, byAsset } = previous ? changeBetween(previous, day, income) : { change: { ...ZERO_CHANGE }, byAsset: {} };
    const values: Record<string, number> = {};
    for (const a of all) if (a.value) values[a.asset.id] = a.value;
    points.push({
      date,
      netWorth: summary.netWorth,
      groups: groupValues(summary),
      assets: values,
      change,
      assetChanges: byAsset,
      rates: Object.fromEntries(units.map((u) => [u, convert(1, u, base, book)])),
      prices: Object.fromEntries(instruments.map((i) => [i.key, instrumentPrice(i, ctx)])),
    });
    previous = day;
  }

  return { base, unit: base, today, firstDay, trackedSince: todayIn(tz, new Date(vault.profile.created_at)), instruments, points };
}

function scaleValues<K extends string>(record: Record<K, number>, by: number): Record<K, number> {
  const scaled = {} as Record<K, number>;
  for (const key of Object.keys(record) as K[]) scaled[key] = record[key] / by;
  return scaled;
}

/**
 * The same history measured in another currency, at each day's exchange rate. A day's change splits
 * into its causes at that day's rate, plus the rate's own move on what was held the day before, which
 * counts as an exchange-rate effect. Null when a day's rate isn't known.
 */
export function measureHistory(history: VaultHistory, unit: string): VaultHistory | null {
  if (unit === history.unit) return history;
  if (history.unit !== history.base) throw new Error("Measure from the base-currency history");
  const rates = history.points.map((p) => p.rates[unit] ?? null);
  if (rates.some((r) => r === null || !(r > 0))) return null;

  const points = history.points.map((p, i): HistoryPoint => {
    const r = rates[i]!;
    const prev = i > 0 ? history.points[i - 1] : null;
    // What one base-currency unit held since yesterday gained or lost in the new unit
    const shift = prev ? 1 / r - 1 / rates[i - 1]! : 0;
    const change = scaleValues(p.change, r);
    change.currency += prev ? prev.netWorth * shift : 0;

    const assetChanges: Record<string, AssetChange> = {};
    for (const id of new Set([...Object.keys(p.assetChanges), ...Object.keys(prev?.assets ?? {})])) {
      const c = scaleValues(p.assetChanges[id] ?? { price: 0, currency: 0 }, r);
      c.currency += (prev?.assets[id] ?? 0) * shift;
      assetChanges[id] = c;
    }
    return { ...p, netWorth: p.netWorth / r, groups: scaleValues(p.groups, r), assets: scaleValues(p.assets, r), change, assetChanges };
  });
  return { ...history, unit, points };
}

// ---------------------------------------------------------------------------
// Periods and charts
// ---------------------------------------------------------------------------

export interface PeriodSummary {
  /** The day the change is measured from (its end-of-day value) */
  baseline: string;
  end: string;
  startValue: number;
  endValue: number;
  change: number;
  /** Fraction of the starting net worth; null when it started at zero */
  changePct: number | null;
  parts: Change;
  /** Price changes of gold, stocks and other assets */
  investments: number;
  /** Fraction of what gold, stocks and other assets were worth before prices moved: at the start, plus what was added */
  investmentsPct: number | null;
  /** Part of the period is before the vault was created, when cash balances weren't recorded */
  beforeTracking: boolean;
}

/** The change from `baseline` (end of that day) to the last point. */
export function summarizePeriod(history: VaultHistory, baseline: string): PeriodSummary | null {
  const points = history.points.filter((p) => p.date >= baseline);
  if (points.length === 0) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const parts = points.slice(1).reduce((sum, p) => addChanges(sum, p.change), { ...ZERO_CHANGE });
  const investments = parts.gold + parts.stock + parts.other;
  const investedAtStart = first.groups.gold + first.groups.stock + first.groups.other;
  const investedAtEnd = last.groups.gold + last.groups.stock + last.groups.other;
  // Holdings bought during the period count from what they were worth when they came in
  const invested = investedAtEnd > 0 ? investedAtEnd - investments : investedAtStart;
  const change = last.netWorth - first.netWorth;
  return {
    baseline: first.date,
    end: last.date,
    startValue: first.netWorth,
    endValue: last.netWorth,
    change,
    changePct: first.netWorth > 0 ? change / first.netWorth : null,
    parts,
    investments,
    investmentsPct: invested > 0 ? investments / invested : null,
    beforeTracking: first.date < history.trackedSince,
  };
}

export interface ChartPoint extends HistoryPoint {
  /** Income logged since the previous chart point */
  incomeSince: number;
}

/** At most about `max` points for a chart: daily, or the last day of every few days, with the income in between added up. */
export function chartPoints(points: HistoryPoint[], max = 120): ChartPoint[] {
  const step = Math.max(1, Math.ceil(points.length / max));
  const result: ChartPoint[] = [];
  let income = 0;
  points.forEach((p, i) => {
    income += i === 0 ? 0 : p.change.income;
    const isLast = i === points.length - 1;
    if (i === 0 || isLast || (points.length - 1 - i) % step === 0) {
      result.push({ ...p, incomeSince: income });
      income = 0;
    }
  });
  return result;
}

export interface MonthIncome extends IncomeTotal {
  /** YYYY-MM */
  month: string;
}

export interface IncomeTotal {
  /** In the base currency, at the rate on the day each entry was logged */
  base: number;
  /** In the income currency */
  income: number;
  entries: number;
}

function addIncome(total: IncomeTotal, tx: Transaction, vault: VaultData, book: PriceBook) {
  const base = vault.profile.base_currency;
  const incomeCurrency = vault.profile.income_currency;
  const inBase = incomeInBase(tx, base, book);
  const inIncome = tx.currency === incomeCurrency ? Number(tx.amount) : inBase === null ? null : convert(inBase, base, incomeCurrency, book);
  total.base += inBase ?? 0;
  total.income += inIncome ?? 0;
  total.entries += 1;
}

/** Income logged after `baseline` up to and including `end`. */
export function incomeBetween(vault: VaultData, ledger: Ledger, book: PriceBook, baseline: string, end: string): IncomeTotal {
  const total: IncomeTotal = { base: 0, income: 0, entries: 0 };
  const days = entryDates(vault, ledger);
  for (const tx of ledger.transactions) {
    const day = days.get(tx.id)!;
    if (isIncome(tx) && day > baseline && day <= end) addIncome(total, tx, vault, book);
  }
  return total;
}

/**
 * The income month a day counts toward (YYYY-MM). Income months start `offset` days before the 1st:
 * with 7, income logged from 24 September counts toward October.
 */
export function incomeMonthOf(day: string, offset: number): string {
  return addDays(day, offset).slice(0, 7);
}

/** The first day of an income month (YYYY-MM-DD). */
export function incomeMonthStart(month: string, offset: number): string {
  return addDays(`${month}-01`, -offset);
}

/**
 * Income per income month for the last `months` months (the current one included), oldest first.
 * Months start the profile's income_month_offset days before the 1st.
 */
export function monthlyIncome(
  vault: VaultData,
  ledger: Ledger,
  book: PriceBook,
  today: string,
  months = 12,
): MonthIncome[] {
  const offset = vault.profile.income_month_offset ?? 0;
  const current = incomeMonthOf(today, offset);
  const list: MonthIncome[] = [];
  for (let i = months - 1; i >= 0; i--) {
    list.push({ month: addMonths(`${current}-01`, -i).slice(0, 7), base: 0, income: 0, entries: 0 });
  }
  const byMonth = new Map(list.map((m) => [m.month, m]));
  const days = entryDates(vault, ledger);
  for (const tx of ledger.transactions) {
    if (!isIncome(tx)) continue;
    const month = byMonth.get(incomeMonthOf(days.get(tx.id)!, offset));
    if (month) addIncome(month, tx, vault, book);
  }
  return list;
}

/** The average of the last `count` full months (this one isn't over), counting from the first month with income. */
export function averageMonthlyIncome(months: MonthIncome[], count = 6): { base: number; income: number; months: number } {
  const first = months.findIndex((m) => m.entries > 0);
  const full = first < 0 ? [] : months.slice(first, -1).slice(-count);
  if (full.length === 0) return { base: 0, income: 0, months: 0 };
  return {
    base: full.reduce((s, m) => s + m.base, 0) / full.length,
    income: full.reduce((s, m) => s + m.income, 0) / full.length,
    months: full.length,
  };
}

// ---------------------------------------------------------------------------
// Assets and prices over a period
// ---------------------------------------------------------------------------

export interface AssetPerformance {
  asset: Asset;
  startValue: number;
  endValue: number;
  /** Its own price moving */
  price: number;
  /** Exchange rates moving */
  currency: number;
  gain: number;
  /** Of what was held: the start value plus anything added during the period. Null when nothing was. */
  pct: number | null;
}

/** How each gold, stock and other asset did from `baseline` to the last point, biggest gain first. */
export function assetPerformance(history: VaultHistory, baseline: string, vault: VaultData): AssetPerformance[] {
  const points = history.points.filter((p) => p.date >= baseline);
  if (points.length === 0) return [];
  const first = points[0];
  const last = points[points.length - 1];
  const totals = new Map<string, AssetChange>();
  for (const p of points.slice(1)) {
    for (const [id, c] of Object.entries(p.assetChanges)) {
      const t = totals.get(id) ?? { price: 0, currency: 0 };
      t.price += c.price;
      t.currency += c.currency;
      totals.set(id, t);
    }
  }
  const result: AssetPerformance[] = [];
  for (const asset of vault.assets) {
    if (asset.archived_at || isCashLike(asset)) continue;
    const startValue = first.assets[asset.id] ?? 0;
    const endValue = last.assets[asset.id] ?? 0;
    const t = totals.get(asset.id) ?? { price: 0, currency: 0 };
    const gain = t.price + t.currency;
    if (startValue === 0 && endValue === 0 && gain === 0) continue;
    // Bought during the period: measured against what it was worth when it came in
    const held = endValue > 0 ? endValue - gain : startValue;
    result.push({ asset, startValue, endValue, ...t, gain, pct: held > 0 ? gain / held : null });
  }
  return result.sort((a, b) => b.gain - a.gain);
}

/** What one unit of these assets cost on average, over every purchase with a known price, in `currency` (today's rates). */
export function averageCost(vault: VaultData, assetIds: string[], currency: string, book: PriceBook): number | null {
  const ids = new Set(assetIds);
  let cost = 0;
  let quantity = 0;
  for (const p of vault.purchases) {
    if (!ids.has(p.asset_id) || p.cost_total === null || !p.cost_currency) continue;
    const c = convert(Number(p.cost_total), p.cost_currency, currency, book);
    if (c === null) continue;
    cost += c;
    quantity += Number(p.quantity);
  }
  return quantity > 0 ? cost / quantity : null;
}

export interface Trade {
  date: string;
  kind: "buy" | "sell";
  assetName: string;
  quantity: number;
  /** Paid or received, when known */
  amount: number | null;
  currency: string | null;
}

/** Purchases and sales of these assets after `baseline`, oldest first. */
export function tradesFor(vault: VaultData, assetIds: string[], baseline: string): Trade[] {
  const names = new Map(vault.assets.filter((a) => assetIds.includes(a.id)).map((a) => [a.id, a.name]));
  const trades: Trade[] = [
    ...vault.purchases
      .filter((p) => names.has(p.asset_id) && p.acquired_on > baseline)
      .map((p): Trade => ({
        date: p.acquired_on,
        kind: "buy",
        assetName: names.get(p.asset_id)!,
        quantity: Number(p.quantity),
        amount: p.cost_total === null ? null : Number(p.cost_total),
        currency: p.cost_currency,
      })),
    ...vault.sales
      .filter((s) => names.has(s.asset_id) && s.sold_on > baseline)
      .map((s): Trade => ({
        date: s.sold_on,
        kind: "sell",
        assetName: names.get(s.asset_id)!,
        quantity: Number(s.quantity),
        amount: Number(s.proceeds),
        currency: s.proceeds_currency,
      })),
  ];
  return trades.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Goal forecast
// ---------------------------------------------------------------------------

/**
 * Months until each goal is reached if `perMonth` (in the base currency) is added every month from now:
 * 0 when reached, null when it never would be (nothing added, or no price for the goal's unit).
 * Reserved goals fill one after another, as their progress does; milestones count everything.
 */
export function forecastGoals(
  goals: Goal[],
  progress: Map<string, GoalProgress>,
  perMonth: number,
  summary: VaultSummary,
  ctx: ValuationContext,
): Map<string, number | null> {
  const result = new Map<string, number | null>();
  let queued = 0;
  for (const goal of goals) {
    const p = progress.get(goal.id);
    if (!p || p.remaining === null) {
      result.set(goal.id, null);
      continue;
    }
    const remaining =
      goal.target_unit === GOLD_UNIT
        ? summary.gold24k && summary.gold24k > 0
          ? p.remaining * summary.gold24k
          : null
        : convert(p.remaining, goal.target_unit, summary.base, ctx.book);
    if (remaining === null) {
      result.set(goal.id, null);
      continue;
    }
    const needed = goal.reserve_funds ? (queued += remaining) : remaining;
    result.set(goal.id, p.reached ? 0 : perMonth > 0 ? needed / perMonth : null);
  }
  return result;
}
