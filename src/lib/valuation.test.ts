import { GROUPS, MARKET, PRICING, asset, purchase, vault } from "@/test/fixtures";
import {
  buildPriceBook,
  combineGrowth,
  convert,
  goalProgress,
  goalsProgress,
  goldGramValue,
  gold24kPerGram,
  makeContext,
  purchaseGrowth,
  summarizeVault,
} from "./valuation";
import { estimateGoldGram, gold24kGramOn } from "@shared/estimates";
import { GOLD_UNIT, type Goal } from "./types";

const book = buildPriceBook(MARKET);
const ctx = makeContext(book, PRICING, []);
const NOW = new Date("2026-09-30T10:00:00Z");

describe("currency conversion", () => {
  it("converts through USD rates", () => {
    expect(convert(10, "USD", "EGP", book)).toBe(500);
    expect(convert(500, "EGP", "USD", book)).toBe(10);
    expect(convert(1.5, "AUD", "EGP", book)).toBeCloseTo(50);
  });

  it("returns null when a rate is unknown", () => {
    expect(convert(10, "USD", "JPY", book)).toBeNull();
  });
});

describe("gold prices", () => {
  it("prices 24k from the spot price and premium", () => {
    expect(gold24kPerGram(ctx, "USD")).toBeCloseTo(100);
    expect(gold24kPerGram(makeContext(book, { ...PRICING, gold_premium_pct: 2.5 }, []), "EGP")).toBeCloseTo(5125);
  });

  it("applies the per-gram adjustments (24k +30 EGP, 21k -30 EGP)", () => {
    expect(goldGramValue(24, ctx, "EGP")).toBeCloseTo(5030);
    expect(goldGramValue(21, ctx, "EGP")).toBeCloseTo(5000 * 0.875 - 30);
  });

  it("never values gold below zero", () => {
    const harsh = makeContext(book, { ...PRICING, gold_21k_adjustment: -100000 }, []);
    expect(goldGramValue(21, harsh, "EGP")).toBe(0);
  });

  it("uses the manual price when set", () => {
    const manual = makeContext(book, { ...PRICING, gold_mode: "manual", manual_gold_24k_price: 4000 }, []);
    expect(gold24kPerGram(manual, "EGP")).toBe(4000);
    expect(gold24kPerGram(manual, "USD")).toBe(80);
  });

  it("has no price without market data", () => {
    expect(gold24kPerGram(makeContext(buildPriceBook([]), PRICING, []), "EGP")).toBeNull();
  });
});

describe("growth since purchase", () => {
  it("2 g bought for 200 EGP, now worth 240 EGP, has grown 20%", () => {
    // A manual 24k price of 90 EGP/g plus the +30 EGP/g ingot adjustment = 120 EGP/g
    const manual = makeContext(book, { ...PRICING, gold_mode: "manual", manual_gold_24k_price: 90 }, []);
    const ingots = asset({ kind: "gold", karat: 24, name: "Gold ingots" });
    const growth = purchaseGrowth(
      purchase({ asset_id: ingots.id, quantity: 2, cost_total: 200, cost_currency: "EGP" }),
      ingots,
      manual,
    );
    expect(growth?.value).toBeCloseTo(240);
    expect(growth?.gain).toBeCloseTo(40);
    expect(growth?.pct).toBeCloseTo(0.2);
  });

  it("measures growth in the currency that was paid", () => {
    const spus = asset({ kind: "stock", ticker: "SPUS", name: "SPUS" });
    const growth = purchaseGrowth(
      purchase({ asset_id: spus.id, quantity: 10, cost_total: 500, cost_currency: "USD" }),
      spus,
      ctx,
    );
    expect(growth).toMatchObject({ cost: 500, value: 600, currency: "USD" });
    expect(growth?.pct).toBeCloseTo(0.2);
  });

  it("shows nothing when the purchase price is unknown", () => {
    const spus = asset({ kind: "stock", ticker: "SPUS", name: "SPUS" });
    expect(purchaseGrowth(purchase({ asset_id: spus.id, quantity: 1 }), spus, ctx)).toBeNull();
  });

  it("combines growth across currencies at the same rate", () => {
    const combined = combineGrowth(
      [
        { cost: 100, value: 120, gain: 20, pct: 0.2, currency: "USD", estimated: false },
        { cost: 5000, value: 5000, gain: 0, pct: 0, currency: "EGP", estimated: true },
      ],
      "EGP",
      book,
    );
    expect(combined?.cost).toBeCloseTo(10000);
    expect(combined?.value).toBeCloseTo(11000);
    expect(combined?.pct).toBeCloseTo(0.1);
    // one estimated cost makes the combined growth an estimate too
    expect(combined?.estimated).toBe(true);
  });
});

describe("vault summary", () => {
  const cash = asset({ kind: "cash", currency: "USD", balance: 100, name: "Bank" });
  const egp = asset({ kind: "cash", currency: "EGP", balance: 1000, name: "Wallet" });
  const pending = asset({ kind: "pending_income", currency: "USD", balance: 50, name: "Upcoming Income" });
  const gold = asset({ kind: "gold", karat: 24, name: "Ingots" });
  const stock = asset({ kind: "stock", ticker: "SPUS", name: "SPUS" });
  const unknown = asset({ kind: "stock", ticker: "ZZZZ", name: "Mystery" });
  const empty = asset({ kind: "cash", currency: "USD", balance: 0, name: "PayPal", hide_when_empty: true });

  const data = vault({
    assets: [cash, egp, pending, gold, stock, unknown, empty],
    purchases: [
      purchase({ asset_id: gold.id, quantity: 2, cost_total: 9000, cost_currency: "EGP" }),
      purchase({ asset_id: stock.id, quantity: 10, cost_total: 500, cost_currency: "USD" }),
      purchase({ asset_id: unknown.id, quantity: 1 }),
    ],
    hawl: { user_id: "u1", hawl_start_date: "2026-03-01", last_checked_on: "2026-09-30", start_wealth: null, start_wealth_currency: null, is_first_hawl: false },
  });
  const summary = summarizeVault(data, ctx, NOW);

  it("totals net worth in the base currency, with Upcoming Income", () => {
    // cash 100 USD = 5000, wallet 1000, gold 2 x 5030 = 10060, SPUS 10 x 60 USD = 30000, pending 50 USD = 2500
    expect(summary.zakatable).toBeCloseTo(5000 + 1000 + 10060 + 30000);
    expect(summary.netWorth).toBeCloseTo(summary.zakatable + 2500);
  });

  it("flags assets without a price instead of inventing one", () => {
    expect(summary.incomplete).toBe(true);
    expect(summary.missingPrices).toEqual(["Mystery"]);
  });

  it("groups assets by kind in group order, with shares of net worth", () => {
    expect(summary.groups.map((g) => g.group.kind)).toEqual(GROUPS.map((g) => g.kind));
    const total = summary.groups.reduce((s, g) => s + g.share, 0) + 2500 / summary.netWorth;
    expect(total).toBeCloseTo(1);
  });

  it("hides empty accounts marked 'hide when empty'", () => {
    const cashGroup = summary.groups.find((g) => g.group.kind === "cash")!;
    expect(cashGroup.assets.find((a) => a.asset.name === "PayPal")?.hidden).toBe(true);
  });

  it("counts the Hawl in the user's calendar days", () => {
    expect(summary.zakat.daysIntoHawl).toBe(214);
    expect(summary.zakat.daysRemaining).toBe(140);
    expect(summary.zakat.isDue).toBe(false);
    expect(summary.zakat.grams).toBeCloseTo(46060 / 5000);
    expect(summary.zakat.aboveNisab).toBe(false);
    expect(summary.zakat.dueAmount).toBeCloseTo(summary.zakatable * 0.025);
  });
});

describe("Zakat due amount", () => {
  const bank = asset({ kind: "cash", currency: "EGP", balance: 600000, name: "Bank" });
  const hawl = (start_wealth: number | null, start_wealth_currency: string | null = "EGP") => ({
    user_id: "u1",
    hawl_start_date: "2025-10-01",
    last_checked_on: "2026-09-30",
    start_wealth,
    start_wealth_currency: start_wealth === null ? null : start_wealth_currency,
    is_first_hawl: false,
  });

  it("is 2.5% of the wealth recorded at the start of the Hawl", () => {
    const z = summarizeVault(vault({ assets: [bank], hawl: hawl(500000) }), ctx, NOW).zakat;
    expect(z.isDue).toBe(true);
    expect(z.dueBasis).toBe("start");
    expect(z.startWealth).toBe(500000);
    expect(z.dueAmount).toBeCloseTo(12500);
  });

  it("converts a start wealth recorded in another currency", () => {
    const z = summarizeVault(vault({ assets: [bank], hawl: hawl(10000, "USD") }), ctx, NOW).zakat;
    expect(z.dueAmount).toBeCloseTo(10000 * 50 * 0.025);
  });

  it("in the first year, is 2.5% of the Nisab value on the start date", () => {
    const first = { ...hawl(409904.27), is_first_hawl: true };
    const z = summarizeVault(vault({ assets: [bank], hawl: first }), ctx, NOW).zakat;
    expect(z.dueBasis).toBe("nisab");
    expect(z.dueAmount).toBeCloseTo(10247.61, 1);
  });

  it("falls back to today's wealth when no start wealth was recorded", () => {
    const z = summarizeVault(vault({ assets: [bank], hawl: hawl(null) }), ctx, NOW).zakat;
    expect(z.dueBasis).toBe("current");
    expect(z.dueAmount).toBeCloseTo(15000);
  });
});

describe("estimated purchase prices", () => {
  it("uses the same gold formula on the server as in the app", () => {
    // With the same market inputs, the server's historical estimate equals today's valuation
    const settings = { ...PRICING, gold_premium_pct: 2.5 };
    const live = makeContext(book, settings, []);
    for (const karat of [21, 24] as const) {
      expect(estimateGoldGram(karat, 3110.34768, 50, 50, settings)).toBeCloseTo(goldGramValue(karat, live, "EGP")!);
    }
  });

  it("prices the Nisab on a past date the same way as today's 24k price", () => {
    const settings = { ...PRICING, gold_premium_pct: 2.5 };
    expect(gold24kGramOn(3110.34768, 50, 2.5)).toBeCloseTo(gold24kPerGram(makeContext(book, settings, []), "EGP")!);
    // Worked example from real prices on 3 March 2025: $2,901.10/oz, 50.4413 EGP/$
    expect(85 * gold24kGramOn(2901.1, 50.4413, 2.5)).toBeCloseTo(409904.27, 0);
  });

  it("marks growth as estimated when the cost came from the market price", () => {
    const ingots = asset({ kind: "gold", karat: 24, name: "Ingots" });
    const g = purchaseGrowth(
      purchase({ asset_id: ingots.id, quantity: 1, cost_total: 4000, cost_currency: "EGP", cost_is_estimated: true }),
      ingots,
      ctx,
    );
    expect(g?.estimated).toBe(true);
  });
});

describe("goal progress", () => {
  const cash = asset({ kind: "cash", currency: "USD", balance: 100, name: "Bank" });
  const pending = asset({ kind: "pending_income", currency: "USD", balance: 100, name: "Upcoming Income" });
  const summary = summarizeVault(vault({ assets: [cash, pending] }), ctx, NOW);
  const goal = (partial: Partial<Goal>): Goal => ({
    id: "g",
    user_id: "u1",
    name: "Goal",
    emoji: "🎯",
    target_amount: 400,
    target_unit: "USD",
    include_upcoming: true,
    reserve_funds: false,
    sort_order: 1,
    is_system: false,
    ...partial,
  });

  it("measures currency goals in their own currency", () => {
    const p = goalProgress(goal({}), summary, ctx);
    expect(p.current).toBeCloseTo(200);
    expect(p.progress).toBeCloseTo(0.5);
    expect(p.remaining).toBeCloseTo(200);
  });

  it("can leave Upcoming Income out", () => {
    expect(goalProgress(goal({ include_upcoming: false }), summary, ctx).current).toBeCloseTo(100);
  });

  it("measures gold goals in grams of 24k gold", () => {
    const p = goalProgress(goal({ target_unit: GOLD_UNIT, target_amount: 1, include_upcoming: false }), summary, ctx);
    expect(p.current).toBeCloseTo(1); // $100 = 1 g at $100/g
    expect(p.reached).toBe(true);
  });
});

describe("reserved goals", () => {
  // $1,000 in the bank, nothing upcoming
  const bank = asset({ kind: "cash", currency: "USD", balance: 1000, name: "Bank" });
  const summary = summarizeVault(vault({ assets: [bank] }), ctx, NOW);
  const goal = (id: string, partial: Partial<Goal> = {}): Goal => ({
    id,
    user_id: "u1",
    name: id,
    emoji: "🎯",
    target_amount: 1000,
    target_unit: "USD",
    include_upcoming: true,
    reserve_funds: true,
    sort_order: 1,
    is_system: false,
    ...partial,
  });

  it("fills reserved goals in order without counting the same money twice", () => {
    const p = goalsProgress([goal("first"), goal("second")], summary, ctx);
    expect(p.get("first")).toMatchObject({ reached: true, remaining: 0 });
    expect(p.get("first")!.current).toBeCloseTo(1000);
    expect(p.get("second")!.current).toBeCloseTo(0);
    expect(p.get("second")!.progress).toBeCloseTo(0);
  });

  it("gives the next reserved goal whatever is left", () => {
    const p = goalsProgress([goal("first", { target_amount: 600 }), goal("second")], summary, ctx);
    expect(p.get("first")!.reached).toBe(true);
    expect(p.get("second")!.current).toBeCloseTo(400);
    expect(p.get("second")!.remaining).toBeCloseTo(600);
  });

  it("follows the list order", () => {
    const p = goalsProgress([goal("second"), goal("first")], summary, ctx);
    expect(p.get("second")!.reached).toBe(true);
    expect(p.get("first")!.current).toBeCloseTo(0);
  });

  it("keeps milestones (unreserved goals) measured against all wealth", () => {
    const p = goalsProgress([goal("reserved"), goal("milestone", { reserve_funds: false, target_amount: 2000 })], summary, ctx);
    expect(p.get("reserved")!.reached).toBe(true);
    expect(p.get("milestone")!.current).toBeCloseTo(1000);
    expect(p.get("milestone")!.progress).toBeCloseTo(0.5);
  });

  it("converts between units: a 5 g gold goal takes $500 before a dollar goal", () => {
    const p = goalsProgress([goal("gold", { target_unit: GOLD_UNIT, target_amount: 5 }), goal("usd")], summary, ctx);
    expect(p.get("gold")!.current).toBeCloseTo(5);
    expect(p.get("usd")!.current).toBeCloseTo(500);
  });

  it("only lets goals that include Upcoming Income use it, and spends it first", () => {
    const pending = asset({ kind: "pending_income", currency: "USD", balance: 300, name: "Upcoming Income" });
    const withPending = summarizeVault(vault({ assets: [bank, pending] }), ctx, NOW);
    const p = goalsProgress(
      [goal("withUpcoming", { target_amount: 500 }), goal("savingsOnly", { include_upcoming: false })],
      withPending,
      ctx,
    );
    // The first goal uses the $300 upcoming + $200 from the bank, leaving $800 in the bank
    expect(p.get("withUpcoming")!.reached).toBe(true);
    expect(p.get("savingsOnly")!.current).toBeCloseTo(800);
  });
});
