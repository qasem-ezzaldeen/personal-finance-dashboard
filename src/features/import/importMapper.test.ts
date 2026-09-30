import { mapPreviousVault, toDatabasePayload, type PreviousVault } from "./importMapper";

// Same shape as a real document from the previous version (see supabase/seed.sql)
const PREVIOUS: PreviousVault = {
  assets: [
    { id: "qnb_bebasata", name: "QNB Bebasata", category: "Cash Savings", holdings: 3200, currency: "USD", color: "#0ea5e9" },
    { id: "nsave", name: "nsave", category: "nsave Savings", holdings: 1500.5, currency: "USD", color: "#ef4444" },
    { id: "asset_1", name: "CIB Savings", holdings: 45000, currency: "EGP", color: "#22c55e" },
    { id: "gold", name: "Gold Savings (21k)", holdings: 40, currency: "Gold (Grams)", color: "#eab308" },
    { id: "asset_2", name: "Gold Ingots", holdings: 25, currency: "Gold 24k (Grams)", color: "#f97316" },
    { id: "asset_3", name: "SPUS ETF", holdings: 12, currency: "Stock", color: "#a855f7", ticker: "SPUS" },
    { id: "asset_4", name: "Apple", holdings: 3, currency: "Stock", color: "#3b82f6", ticker: "APPLE" },
  ],
  upcomingIncome: 750,
  goldPremium: 2.5,
  isManualGold: false,
  manualGold24kEgp: null,
  manualSpusPrice: 61.2,
  followedStockKpis: ["NVDA", "apple"],
  lastResetMonth: "2026-09",
  lastNsaveTransferMonth: "2026-09",
  zakatConsecutiveDays: 212,
  goals: [
    { id: "goal_zakat", name: "Zakat Threshold", currency: "Gold", target: 85, emoji: "🕌" },
    { id: "goal_1", name: "Emergency Fund", currency: "USD", target: 10000, emoji: "💰" },
    { id: "goal_2", name: "Move to Australia", currency: "AUD", target: 40000, emoji: "🇦🇺" },
  ],
  transactions: [
    { id: "tx_1", amountUsd: 500, amountEgp: 24965, rateUsdEgp: 49.93, timestamp: 1790000000000, beforeIncome: 0, afterIncome: 500 },
    { id: "tx_2", amountUsd: -250, amountEgp: -12482.5, rateUsdEgp: 49.93, timestamp: 1790500000000, beforeIncome: 750, afterIncome: 500, description: "Transfer to PayPal" },
  ],
};

describe("import mapping", () => {
  const payload = mapPreviousVault(PREVIOUS, "2026-09-30");

  it("maps every holding to the right asset type", () => {
    const byName = Object.fromEntries(payload.assets.map((a) => [a.name, a]));
    expect(byName["QNB Bebasata"]).toMatchObject({ kind: "cash", currency: "USD", balance: 3200 });
    expect(byName["CIB Savings"]).toMatchObject({ kind: "cash", currency: "EGP", balance: 45000 });
    expect(byName["Gold Savings (21k)"]).toMatchObject({ kind: "gold", karat: 21, quantity: 40 });
    expect(byName["Gold Ingots"]).toMatchObject({ kind: "gold", karat: 24, quantity: 25 });
    expect(byName["SPUS ETF"]).toMatchObject({ kind: "stock", ticker: "SPUS", quantity: 12 });
  });

  it("fixes the APPLE alias bug by saving the real ticker", () => {
    expect(payload.assets.find((a) => a.name === "Apple")?.ticker).toBe("AAPL");
    expect(payload.warnings.some((w) => w.includes("AAPL"))).toBe(true);
    expect(payload.followed_tickers).toEqual(["NVDA", "AAPL"]);
  });

  it("keeps colors and order", () => {
    expect(payload.assets.slice(0, 7).map((a) => a.color)).toEqual(PREVIOUS.assets!.map((a) => a.color));
    expect(payload.assets.slice(0, 7).map((a) => a.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("recreates the 24th and 1st-of-month automations with the same accounts", () => {
    const nsave = payload.assets.find((a) => a.name === "nsave")!;
    const paypal = payload.assets.find((a) => a.name === "PayPal")!;
    expect(paypal).toMatchObject({ kind: "cash", currency: "USD", balance: 0, hide_when_empty: true });
    expect(payload.automation_rules).toEqual([
      { name: "Payday sweep", day_of_month: 24, amount_mode: "all", from_ref: "pending", to_ref: paypal.ref, last_run_period: "2026-09" },
      { name: "PayPal consolidation", day_of_month: 1, amount_mode: "all", from_ref: paypal.ref, to_ref: nsave.ref, last_run_period: "2026-09" },
    ]);
  });

  it("carries over Upcoming Income, settings and the Zakat streak", () => {
    expect(payload.pending_balance).toBe(750);
    expect(payload.profile).toEqual({ base_currency: "EGP", display_currencies: ["USD", "AUD"], income_currency: "USD" });
    expect(payload.pricing).toMatchObject({ gold_mode: "live", gold_premium_pct: 2.5 });
    expect(payload.price_overrides).toEqual([{ ticker: "SPUS", price: 61.2, currency: "USD" }]);
    // 212 days including today: Sep 30 is day 273 of 2026, and day 273 - 211 = 62 is March 3
    expect(payload.hawl_start_date).toBe("2026-03-03");
  });

  it("maps goals, dropping the built-in Zakat goal", () => {
    expect(payload.goals).toEqual([
      { name: "Emergency Fund", emoji: "💰", target_amount: 10000, target_unit: "USD", include_upcoming: true, sort_order: 1 },
      { name: "Move to Australia", emoji: "🇦🇺", target_amount: 40000, target_unit: "AUD", include_upcoming: true, sort_order: 2 },
    ]);
  });

  it("imports history as positive amounts with before/after values", () => {
    expect(payload.transactions).toHaveLength(2);
    expect(payload.transactions[1]).toMatchObject({ amount: 250, currency: "USD", pending_before: 750, pending_after: 500 });
  });

  it("handles the earliest format (two numbers, no assets list)", () => {
    const old = mapPreviousVault({ usdSavings: 900, goldGrams: 12 }, "2026-09-30");
    expect(old.assets.map((a) => [a.name, a.kind])).toEqual([
      ["QNB Bebasata", "cash"],
      ["Gold Savings (21k)", "gold"],
      ["PayPal", "cash"],
      ["nsave", "cash"],
    ]);
  });

  it("sends no preview-only fields to the database", () => {
    const db = toDatabasePayload(payload);
    expect("warnings" in db).toBe(false);
    expect(db.assets.every((a) => !("source" in a))).toBe(true);
  });
});
