// @vitest-environment node
// End-to-end check of the one-time import: the app's mapper output goes through the real import function.
import { beforeEach, describe, expect, it } from "vitest";
import { mapPreviousVault, toDatabasePayload, type PreviousVault } from "../../src/features/import/importMapper";
import { asUser, createDb, createUser, one, rows, seedPrices, type Db } from "./harness";

const OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PREVIOUS: PreviousVault = {
  assets: [
    { id: "qnb_bebasata", name: "QNB Bebasata", holdings: 3200, currency: "USD", color: "#0ea5e9" },
    { id: "nsave", name: "nsave", holdings: 1500.5, currency: "USD", color: "#ef4444" },
    { id: "asset_1", name: "CIB Savings", holdings: 45000, currency: "EGP", color: "#22c55e" },
    { id: "gold", name: "Gold Savings (21k)", holdings: 40, currency: "Gold (Grams)", color: "#eab308" },
    { id: "asset_4", name: "Apple", holdings: 3, currency: "Stock", color: "#3b82f6", ticker: "APPLE" },
  ],
  upcomingIncome: 750,
  goldPremium: 2.5,
  followedStockKpis: ["NVDA"],
  lastResetMonth: "2026-09",
  lastNsaveTransferMonth: "2026-09",
  zakatConsecutiveDays: 30,
  goals: [{ id: "goal_1", name: "Emergency Fund", currency: "USD", target: 10000, emoji: "💰" }],
  transactions: [{ id: "tx_1", amountUsd: 750, amountEgp: 37447.5, rateUsdEgp: 49.93, timestamp: 1790000000000, beforeIncome: 0, afterIncome: 750 }],
};

let db: Db;
const payload = () => toDatabasePayload(mapPreviousVault(PREVIOUS, "2026-09-30"));
const importAs = (user: string) =>
  asUser(db, user, () => db.query("select public.import_previous_vault($1::jsonb) as r", [JSON.stringify(payload())]));

beforeEach(async () => {
  db = await createDb();
  await createUser(db, OWNER, "owner@example.test");
  await seedPrices(db);
  await asUser(db, OWNER, () => db.query("select public.bootstrap_vault()"));
});

describe("importing a vault from the previous version", () => {
  it("recreates balances, holdings, goals, history, rules and settings", async () => {
    const result = (await importAs(OWNER)).rows[0] as { r: Record<string, number> };
    expect(result.r).toEqual({ assets: 6, purchases: 2, goals: 1, transactions: 1, automation_rules: 2 });

    const balances = await rows<{ name: string; balance: string; currency: string | null }>(
      db,
      "select name, balance, currency from public.assets where user_id = $1 and kind in ('cash', 'pending_income') order by name",
      [OWNER],
    );
    expect(balances.map((b) => [b.name, Number(b.balance), b.currency])).toEqual([
      ["CIB Savings", 45000, "EGP"],
      ["PayPal", 0, "USD"],
      ["QNB Bebasata", 3200, "USD"],
      ["Upcoming Income", 750, "USD"],
      ["nsave", 1500.5, "USD"],
    ]);

    const holdings = await rows(
      db,
      `select a.name, a.karat, a.ticker, p.quantity::float as quantity, p.is_opening_balance
         from public.asset_purchases p join public.assets a on a.id = p.asset_id order by a.name`,
    );
    expect(holdings).toEqual([
      { name: "Apple", karat: null, ticker: "AAPL", quantity: 3, is_opening_balance: true },
      { name: "Gold Savings (21k)", karat: 21, ticker: null, quantity: 40, is_opening_balance: true },
    ]);

    const rules = await rows(
      db,
      `select r.name, r.day_of_month, f.name as from_name, t.name as to_name, r.last_run_period
         from public.automation_rules r
         join public.assets f on f.id = r.from_asset_id
         join public.assets t on t.id = r.to_asset_id
        order by r.day_of_month`,
    );
    expect(rules).toEqual([
      { name: "PayPal consolidation", day_of_month: 1, from_name: "PayPal", to_name: "nsave", last_run_period: "2026-09" },
      { name: "Payday sweep", day_of_month: 24, from_name: "Upcoming Income", to_name: "PayPal", last_run_period: "2026-09" },
    ]);

    const profile = await one(db, "select base_currency, income_currency, display_currencies, imported_at from public.profiles where user_id = $1", [OWNER]);
    expect(profile).toMatchObject({ base_currency: "EGP", income_currency: "USD", display_currencies: ["USD"] });
    expect(profile.imported_at).not.toBeNull();

    expect(await rows(db, "select ticker from public.followed_tickers")).toEqual([{ ticker: "NVDA" }]);
    expect((await one(db, "select hawl_start_date::text as d from public.zakat_hawl where user_id = $1", [OWNER])).d).toBe("2026-09-01");
    expect(await rows(db, "select kind, is_imported from public.transactions")).toEqual([{ kind: "imported", is_imported: true }]);
  });

  it("can only run once", async () => {
    await importAs(OWNER);
    await expect(importAs(OWNER)).rejects.toThrow(/already been imported/);
  });

  it("refuses to import into a vault that already has data", async () => {
    await asUser(db, OWNER, () => db.query("select public.log_income(5, '')"));
    await expect(importAs(OWNER)).rejects.toThrow(/empty vault/);
  });
});
