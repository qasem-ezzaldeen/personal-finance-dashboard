import { MARKET, PRICING, PROFILE, asset, purchase, sale, vault } from "@/test/fixtures";
import {
  assetPerformance,
  averageCost,
  averageMonthlyIncome,
  buildHistory,
  chartPoints,
  forecastGoals,
  historySymbols,
  incomeBetween,
  instrumentsFor,
  measureHistory,
  measureUnits,
  monthlyIncome,
  periodBaseline,
  summarizePeriod,
  tradesFor,
  type Ledger,
  type MonthIncome,
} from "./history";
import { GOLD_UNIT, type Goal, type HistoricalPrice, type Transaction, type TransactionChange, type VaultData } from "./types";
import { buildPriceBook, goalsProgress, makeContext, summarizeVault } from "./valuation";

// Today is 30 Sep 2026 in Cairo; live prices: USD/EGP 50, gold $100/g, SPUS $60
const NOW = new Date("2026-09-30T10:00:00Z");
const PROFILE_SINCE_SEPT = { ...PROFILE, created_at: "2026-09-01T00:00:00Z" };
const OUNCE = 31.1034768;

const close = (symbol: string, price_date: string, price: number, currency = "USD"): HistoricalPrice => ({ symbol, price_date, price, currency });
const egp = (pairs: Array<[string, number]>) => pairs.map(([d, p]) => close("FX:EGP", d, p));
const goldPerGram = (pairs: Array<[string, number]>) => pairs.map(([d, p]) => close("METAL:XAU", d, p * OUNCE));

let seq = 0;
function tx(partial: Partial<Transaction> & Pick<Transaction, "kind" | "amount" | "currency" | "occurred_at">): Transaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    seq,
    user_id: "u1",
    description: "",
    rate_to_base: null,
    base_currency: null,
    from_asset_id: null,
    from_asset_name: null,
    to_asset_id: null,
    to_asset_name: null,
    converted_amount: null,
    converted_currency: null,
    fx_rate: null,
    pending_before: null,
    pending_after: null,
    automation_rule_id: null,
    is_imported: false,
    details: null,
    ...partial,
  };
}
const change = (transaction_id: string, asset_id: string, delta: number): TransactionChange => ({
  id: ++seq,
  transaction_id,
  asset_id,
  asset_name: asset_id,
  delta,
});

const EMPTY: Ledger = { transactions: [], changes: [] };

function history(data: VaultData, prices: HistoricalPrice[], ledger: Ledger = EMPTY, from = "2026-09-26") {
  return buildHistory({ vault: data, ledger, prices, live: MARKET, today: "2026-09-30", from });
}
const on = (h: ReturnType<typeof history>, date: string) => h.points.find((p) => p.date === date)!;

describe("periods", () => {
  it("measures this month from the end of last month", () => {
    expect(periodBaseline("month", "2026-09-30", "2020-01-01")).toBe("2026-08-31");
    expect(periodBaseline("month", "2026-10-01", "2020-01-01")).toBe("2026-09-30");
  });

  it("goes back whole days, months or to 1 January", () => {
    expect(periodBaseline("7d", "2026-09-30", "2020-01-01")).toBe("2026-09-23");
    expect(periodBaseline("3m", "2026-05-31", "2020-01-01")).toBe("2026-02-28");
    expect(periodBaseline("ytd", "2026-09-30", "2020-01-01")).toBe("2025-12-31");
    expect(periodBaseline("1y", "2026-09-30", "2020-01-01")).toBe("2025-09-30");
  });

  it("never starts before the first record", () => {
    expect(periodBaseline("1y", "2026-09-30", "2026-06-15")).toBe("2026-06-14");
    expect(periodBaseline("all", "2026-09-30", "2026-06-15")).toBe("2026-06-14");
  });
});

describe("net worth history", () => {
  it("values USD cash at each day's exchange rate and calls the change currency", () => {
    const bank = asset({ kind: "cash", currency: "USD", balance: 100, name: "Bank" });
    const h = history(vault({ profile: PROFILE_SINCE_SEPT, assets: [bank] }), egp([["2026-09-26", 48], ["2026-09-28", 49], ["2026-09-29", 50]]));
    expect(h.points.map((p) => p.date)).toEqual(["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    // No close on the 27th: the 26th's carries over
    expect(h.points.map((p) => p.netWorth)).toEqual([4800, 4800, 4900, 5000, 5000]);
    const period = summarizePeriod(h, "2026-09-26")!;
    expect(period.change).toBeCloseTo(200);
    expect(period.parts.currency).toBeCloseTo(200);
    expect(period.parts.unexplained).toBeCloseTo(0);
  });

  it("counts gold's price in the base currency as a gold gain", () => {
    const ingots = asset({ kind: "gold", karat: 24, name: "Ingots" });
    const prices = [...egp([["2026-09-26", 50]]), ...goldPerGram([["2026-09-26", 90], ["2026-09-28", 95], ["2026-09-29", 100]])];
    const h = history(vault({ profile: PROFILE_SINCE_SEPT, assets: [ingots], purchases: [purchase({ asset_id: ingots.id, quantity: 2, acquired_on: "2026-09-01" })] }), prices);
    // 24k: $/g x 50 + 30 EGP adjustment
    expect(on(h, "2026-09-26").netWorth).toBeCloseTo(2 * (4500 + 30));
    expect(on(h, "2026-09-30").netWorth).toBeCloseTo(2 * (5000 + 30));
    const period = summarizePeriod(h, "2026-09-26")!;
    expect(period.parts.gold).toBeCloseTo(1000);
    expect(period.parts.currency).toBeCloseTo(0);
    expect(period.investments).toBeCloseTo(1000);
    expect(period.investmentsPct).toBeCloseTo(1000 / 9060);
  });

  it("splits a USD stock's change into its price and the exchange rate", () => {
    const spus = asset({ kind: "stock", ticker: "SPUS", name: "SPUS" });
    const prices = [...egp([["2026-09-26", 48], ["2026-09-29", 50]]), close("STOCK:SPUS", "2026-09-26", 50), close("STOCK:SPUS", "2026-09-29", 60)];
    const h = history(vault({ profile: PROFILE_SINCE_SEPT, assets: [spus], purchases: [purchase({ asset_id: spus.id, quantity: 10, acquired_on: "2026-09-01" })] }), prices);
    const period = summarizePeriod(h, "2026-09-26")!;
    // 10 x $50 x 48 = 24,000 → 10 x $60 x 50 = 30,000
    expect(period.startValue).toBeCloseTo(24000);
    expect(period.endValue).toBeCloseTo(30000);
    expect(period.parts.stock).toBeCloseTo(10 * 10 * 50);
    expect(period.parts.currency).toBeCloseTo(10 * 50 * 2);
  });

  it("adds holdings on the day they were bought", () => {
    const spus = asset({ kind: "stock", ticker: "SPUS", name: "SPUS" });
    const prices = [...egp([["2026-09-26", 50]]), close("STOCK:SPUS", "2026-09-26", 60)];
    const h = history(vault({ profile: PROFILE_SINCE_SEPT, assets: [spus], purchases: [purchase({ asset_id: spus.id, quantity: 1, acquired_on: "2026-09-28" })] }), prices);
    expect(on(h, "2026-09-27").netWorth).toBe(0);
    expect(on(h, "2026-09-28").netWorth).toBeCloseTo(3000);
    // Not paid from cash: nothing explains it
    expect(on(h, "2026-09-28").change.unexplained).toBeCloseTo(3000);
  });

  it("rebuilds Upcoming Income before income was logged, and counts the income", () => {
    const pending = asset({ kind: "pending_income", currency: "USD", balance: 100, name: "Upcoming Income" });
    const income = tx({ kind: "income", amount: 100, currency: "USD", rate_to_base: 50, base_currency: "EGP", occurred_at: "2026-09-28T09:00:00Z", to_asset_id: pending.id });
    const h = history(vault({ profile: PROFILE_SINCE_SEPT, assets: [pending] }), egp([["2026-09-26", 50]]), {
      transactions: [income],
      changes: [change(income.id, pending.id, 100)],
    });
    expect(on(h, "2026-09-27").netWorth).toBe(0);
    expect(on(h, "2026-09-28").netWorth).toBeCloseTo(5000);
    const period = summarizePeriod(h, "2026-09-26")!;
    expect(period.parts.income).toBeCloseTo(5000);
    expect(period.parts.unexplained).toBeCloseTo(0);
  });

  it("takes the money for a purchase recorded later out of cash on the day it was bought", () => {
    const bank = asset({ kind: "cash", currency: "USD", balance: 0, name: "Bank" });
    const spus = asset({ kind: "stock", ticker: "SPUS", name: "SPUS" });
    // Bought on the 27th, recorded on the 30th
    const buy = tx({ kind: "buy", amount: 100, currency: "USD", occurred_at: "2026-09-30T08:00:00Z", from_asset_id: bank.id });
    const data = vault({
      profile: PROFILE_SINCE_SEPT,
      assets: [bank, spus],
      purchases: [purchase({ asset_id: spus.id, quantity: 2, acquired_on: "2026-09-27", transaction_id: buy.id, paid_from_asset_id: bank.id, paid_amount: 100, paid_currency: "USD" })],
    });
    const prices = [...egp([["2026-09-26", 50]]), close("STOCK:SPUS", "2026-09-26", 50)];
    const h = history(data, prices, { transactions: [buy], changes: [change(buy.id, bank.id, -100)] });
    expect(on(h, "2026-09-26").netWorth).toBeCloseTo(5000); // $100 in the bank
    expect(on(h, "2026-09-27").netWorth).toBeCloseTo(5000); // 2 shares of $50 instead
    expect(on(h, "2026-09-29").netWorth).toBeCloseTo(5000);
  });

  it("ends on today's net worth, valued like the rest of the app", () => {
    const bank = asset({ kind: "cash", currency: "USD", balance: 100, name: "Bank" });
    const ingots = asset({ kind: "gold", karat: 21, name: "Ring" });
    const data = vault({ profile: PROFILE_SINCE_SEPT, assets: [bank, ingots], purchases: [purchase({ asset_id: ingots.id, quantity: 3, acquired_on: "2026-09-02" })] });
    const h = history(data, [...egp([["2026-09-26", 40]]), ...goldPerGram([["2026-09-26", 80]])]);
    const today = summarizeVault(data, makeContext(buildPriceBook(MARKET), PRICING, []), NOW);
    expect(h.points.at(-1)!.netWorth).toBeCloseTo(today.netWorth);
  });

  it("starts the day before the first record, and knows when tracking began", () => {
    const bank = asset({ kind: "cash", currency: "EGP", balance: 1000, name: "Wallet" });
    const h = history(vault({ profile: PROFILE_SINCE_SEPT, assets: [bank] }), [], EMPTY, "2020-01-01");
    expect(h.points[0].date).toBe("2026-08-31");
    expect(h.trackedSince).toBe("2026-09-01");
    expect(summarizePeriod(h, "2026-08-31")!.beforeTracking).toBe(true);
    expect(summarizePeriod(h, "2026-09-01")!.beforeTracking).toBe(false);
  });
});

describe("symbols to look up", () => {
  it("asks for gold, held stocks and every currency besides USD", () => {
    const data = vault({
      assets: [
        asset({ kind: "gold", karat: 24, name: "Ingots" }),
        asset({ kind: "stock", ticker: "SPUS", name: "SPUS" }),
        asset({ kind: "cash", currency: "AUD", balance: 1, name: "Aussie" }),
        asset({ kind: "cash", currency: "USD", balance: 1, name: "Bank" }),
      ],
    });
    expect(historySymbols(data, MARKET)).toEqual(["FX:AUD", "FX:EGP", "METAL:XAU", "STOCK:SPUS"]);
  });
});

describe("monthly income", () => {
  it("adds up income per month, including imported income but not imported transfers", () => {
    const ledger: Ledger = {
      transactions: [
        tx({ kind: "income", amount: 100, currency: "USD", rate_to_base: 50, base_currency: "EGP", occurred_at: "2026-09-03T10:00:00Z" }),
        tx({ kind: "income", amount: 50, currency: "USD", rate_to_base: 48, base_currency: "EGP", occurred_at: "2026-09-20T10:00:00Z" }),
        tx({ kind: "imported", amount: 200, currency: "USD", rate_to_base: 49, base_currency: "EGP", pending_before: 0, pending_after: 200, occurred_at: "2026-08-10T10:00:00Z" }),
        tx({ kind: "imported", amount: 200, currency: "USD", rate_to_base: 49, base_currency: "EGP", pending_before: 200, pending_after: 0, occurred_at: "2026-08-11T10:00:00Z" }),
        tx({ kind: "transfer", amount: 999, currency: "USD", occurred_at: "2026-09-05T10:00:00Z" }),
      ],
      changes: [],
    };
    const months = monthlyIncome(vault(), ledger, buildPriceBook(MARKET), "2026-09-30", 3);
    expect(months.map((m) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(months.map((m) => m.income)).toEqual([0, 200, 150]);
    // At the rate on the day each was logged
    expect(months.map((m) => m.base)).toEqual([0, 200 * 49, 100 * 50 + 50 * 48]);
    expect(months[2].entries).toBe(2);
    // This month so far (from the end of August)
    expect(incomeBetween(vault(), ledger, buildPriceBook(MARKET), "2026-08-31", "2026-09-30")).toEqual({ base: 100 * 50 + 50 * 48, income: 150, entries: 2 });
  });
});

describe("chart points", () => {
  it("keeps the first and last day and adds up the income in between", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      netWorth: i,
      groups: { cash: i, gold: 0, stock: 0, other: 0, pending: 0 },
      assets: {},
      change: { income: i === 0 ? 0 : 1, gold: 0, stock: 0, other: 0, currency: 0, unexplained: 0 },
      assetChanges: {},
      rates: {},
      prices: {},
    }));
    const chart = chartPoints(points, 4);
    expect(chart[0].date).toBe("2026-09-01");
    expect(chart.at(-1)!.date).toBe("2026-09-10");
    expect(chart.length).toBeLessThanOrEqual(5);
    expect(chart.reduce((s, p) => s + p.incomeSince, 0)).toBe(9);
  });
});

describe("measuring in USD", () => {
  it("offers the base currency and USD only", () => {
    // AUD is a display currency too, but isn't offered
    expect(measureUnits(vault({ profile: { ...PROFILE, display_currencies: ["USD", "AUD"] } }))).toEqual(["EGP", "USD"]);
    expect(measureUnits(vault({ profile: { ...PROFILE, base_currency: "USD" } }))).toEqual(["USD"]);
  });

  const wallet = asset({ kind: "cash", currency: "EGP", balance: 4800, name: "Wallet" });
  const bank = asset({ kind: "cash", currency: "USD", balance: 100, name: "Bank" });
  // The pound weakens from 48 to 50 per dollar
  const prices = egp([["2026-09-26", 48], ["2026-09-29", 50]]);

  it("shows money in pounds losing value when measured in dollars", () => {
    const h = measureHistory(history(vault({ profile: PROFILE_SINCE_SEPT, assets: [wallet, bank] }), prices), "USD")!;
    expect(h.unit).toBe("USD");
    expect(h.points[0].netWorth).toBeCloseTo(4800 / 48 + 100);
    const period = summarizePeriod(h, "2026-09-26")!;
    // The dollars stay the same in dollars; the pounds lose $100 - $96
    expect(period.change).toBeCloseTo(4800 / 50 - 100);
    expect(period.parts.currency).toBeCloseTo(period.change);
    expect(period.parts.unexplained).toBeCloseTo(0);
  });

  it("gives up on a unit without a rate", () => {
    const h = history(vault({ profile: PROFILE_SINCE_SEPT, assets: [bank] }), prices);
    expect(measureHistory(h, "JPY")).toBeNull();
  });
});

describe("prices and trades of what you hold", () => {
  const spus = asset({ kind: "stock", ticker: "SPUS", name: "SPUS", id: "spus" });
  const ring = asset({ kind: "gold", karat: 21, name: "Ring", id: "ring" });
  const aussie = asset({ kind: "cash", currency: "AUD", balance: 1, name: "Aussie" });
  const data = vault({
    profile: PROFILE_SINCE_SEPT,
    assets: [spus, ring, aussie],
    purchases: [
      purchase({ asset_id: "spus", quantity: 4, acquired_on: "2026-09-01", cost_total: 200, cost_currency: "USD" }),
      purchase({ asset_id: "spus", quantity: 6, acquired_on: "2026-09-28", cost_total: 330, cost_currency: "USD" }),
      purchase({ asset_id: "ring", quantity: 3, acquired_on: "2026-09-01" }),
    ],
    sales: [sale({ asset_id: "spus", quantity: 2, proceeds: 120, proceeds_currency: "USD", sold_on: "2026-09-29" })],
  });

  it("charts each karat held, each stock and each other currency", () => {
    const list = instrumentsFor(data, MARKET);
    expect(list.map((i) => `${i.key} ${i.currency}`)).toEqual(["GOLD:21 EGP", "STOCK:SPUS USD", "FX:AUD EGP", "FX:USD EGP"]);
    const h = history(data, [...egp([["2026-09-26", 50]]), close("STOCK:SPUS", "2026-09-26", 50), close("STOCK:SPUS", "2026-09-29", 55)]);
    expect(h.points.map((p) => p.prices["STOCK:SPUS"])).toEqual([50, 50, 50, 55, 60]);
    expect(on(h, "2026-09-26").prices["FX:USD"]).toBe(50);
  });

  it("averages what was paid per unit", () => {
    expect(averageCost(data, ["spus"], "USD", buildPriceBook(MARKET))).toBeCloseTo(53);
    // No price paid for the ring
    expect(averageCost(data, ["ring"], "EGP", buildPriceBook(MARKET))).toBeNull();
  });

  it("lists the period's purchases and sales", () => {
    expect(tradesFor(data, ["spus"], "2026-09-26").map((t) => `${t.date} ${t.kind} ${t.quantity}`)).toEqual(["2026-09-28 buy 6", "2026-09-29 sell 2"]);
  });

  it("splits each asset's gain into its price and the exchange rate", () => {
    const h = history(data, [...egp([["2026-09-26", 48], ["2026-09-29", 50]]), close("STOCK:SPUS", "2026-09-26", 50)]);
    const result = assetPerformance(h, "2026-09-26", data);
    const stock = result.find((a) => a.asset.id === "spus")!;
    // 4 shares at $50 and 48 EGP per $ at the start; 8 shares at $60 and 50 EGP per $ today
    expect(stock.startValue).toBeCloseTo(4 * 50 * 48);
    expect(stock.endValue).toBeCloseTo(8 * 60 * 50);
    // The price only moved today (8 shares, +$10); the rate moved on the 29th, on the 10 shares held the day before
    expect(stock.price).toBeCloseTo(8 * 10 * 50);
    expect(stock.currency).toBeCloseTo(10 * 50 * 2);
    expect(stock.gain).toBeCloseTo(stock.price + stock.currency);
    // Cash isn't listed
    expect(result.some((a) => a.asset.kind === "cash")).toBe(false);
  });
});

describe("goal forecast", () => {
  const goal = (partial: Partial<Goal> & Pick<Goal, "id" | "target_amount" | "target_unit">): Goal => ({
    user_id: "u1",
    name: partial.id,
    emoji: "🎯",
    include_upcoming: true,
    reserve_funds: false,
    sort_order: 0,
    is_system: false,
    ...partial,
  });
  const bank = asset({ kind: "cash", currency: "USD", balance: 100, name: "Bank" });
  const ctx = makeContext(buildPriceBook(MARKET), PRICING, []);
  const summary = summarizeVault(vault({ assets: [bank] }), ctx, NOW);

  it("counts the months at a monthly amount, filling reserved goals one after another", () => {
    // $100 (5,000 EGP) saved; 5,000 EGP added a month
    const goals = [
      goal({ id: "first", target_amount: 300, target_unit: "USD", reserve_funds: true }),
      goal({ id: "second", target_amount: 200, target_unit: "USD", reserve_funds: true }),
      goal({ id: "milestone", target_amount: 300, target_unit: "USD" }),
      goal({ id: "done", target_amount: 50, target_unit: "USD" }),
      goal({ id: "gold", target_amount: 2, target_unit: GOLD_UNIT }),
    ];
    const forecast = forecastGoals(goals, goalsProgress(goals, summary, ctx), 5000, summary, ctx);
    expect(forecast.get("first")).toBeCloseTo(2);
    expect(forecast.get("second")).toBeCloseTo(4);
    expect(forecast.get("milestone")).toBeCloseTo(2);
    expect(forecast.get("done")).toBe(0);
    // 2 g of 24k at 5,000 EGP is 10,000 EGP, and 5,000 is there
    expect(forecast.get("gold")).toBeCloseTo(1);
    expect(forecastGoals(goals, goalsProgress(goals, summary, ctx), 0, summary, ctx).get("first")).toBeNull();
  });

  it("averages income over full months since the first one with income", () => {
    const months: MonthIncome[] = [
      { month: "2026-06", base: 0, income: 0, entries: 0 },
      { month: "2026-07", base: 1000, income: 20, entries: 1 },
      { month: "2026-08", base: 3000, income: 60, entries: 2 },
      { month: "2026-09", base: 9999, income: 999, entries: 1 },
    ];
    expect(averageMonthlyIncome(months)).toEqual({ base: 2000, income: 40, months: 2 });
    expect(averageMonthlyIncome(months.slice(0, 1))).toEqual({ base: 0, income: 0, months: 0 });
  });
});
