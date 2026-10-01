// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, one, rows, seedPrices, type Db } from "./harness";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let db: Db;

beforeEach(async () => {
  db = await createDb();
  await createUser(db, ALICE, "alice@example.test");
  await createUser(db, BOB, "bob@example.test");
  await seedPrices(db);
  for (const user of [ALICE, BOB]) await asUser(db, user, () => db.query("select public.bootstrap_vault()"));
  // New vaults default to EGP income; these tests use USD income like the owner's real vault
  await db.query("update public.profiles set income_currency = 'USD'");
});

const pendingId = async (user = ALICE) =>
  (await one<{ id: string }>(db, "select id from public.assets where user_id = $1 and kind = 'pending_income'", [user])).id;

const balance = async (id: string) => Number((await one<{ balance: string }>(db, "select balance from public.assets where id = $1", [id])).balance);

async function createCash(user: string, name: string, currency = "USD"): Promise<string> {
  return asUser(db, user, async () =>
    (await one<{ id: string }>(
      db,
      "insert into public.assets (user_id, kind, name, currency, color) values ($1, 'cash', $2, $3, 'sky') returning id",
      [user, name, currency],
    )).id,
  );
}

describe("vault setup", () => {
  it("creates the profile, groups, Upcoming Income and Hawl row once (Zakat isn't a goal)", async () => {
    await asUser(db, ALICE, () => db.query("select public.bootstrap_vault()"));
    expect(await rows(db, "select kind from public.asset_groups where user_id = $1 order by sort_order", [ALICE])).toEqual([
      { kind: "cash" },
      { kind: "gold" },
      { kind: "stock" },
      { kind: "other" },
    ]);
    expect(await rows(db, "select name from public.assets where user_id = $1", [ALICE])).toEqual([{ name: "Upcoming Income" }]);
    expect(await rows(db, "select name from public.goals where user_id = $1", [ALICE])).toEqual([]);
    expect(await rows(db, "select user_id from public.zakat_hawl where user_id = $1", [ALICE])).toHaveLength(1);
    const profile = await one(db, "select display_name, base_currency from public.profiles where user_id = $1", [ALICE]);
    expect(profile).toEqual({ display_name: "alice", base_currency: "EGP" });
    expect(await one(db, "select gold_premium_pct::float from public.pricing_settings where user_id = $1", [ALICE])).toEqual({
      gold_premium_pct: 0,
    });
  });
});

describe("security", () => {
  it("keeps each vault private", async () => {
    await createCash(ALICE, "Alice bank");
    const seenByBob = await asUser(db, BOB, () => rows(db, "select name from public.assets where kind = 'cash'"));
    expect(seenByBob).toEqual([]);
  });

  it("doesn't let users write balances directly", async () => {
    const id = await createCash(ALICE, "Bank");
    await expect(asUser(db, ALICE, () => db.query("update public.assets set balance = 1000000 where id = $1", [id]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("doesn't let users write ledger rows or prices", async () => {
    await expect(
      asUser(db, ALICE, () =>
        db.query("insert into public.transactions (user_id, kind, amount, currency) values ($1, 'income', 5, 'USD')", [ALICE]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ALICE, () => db.query("update public.market_prices set price = 1"))).rejects.toThrow(/permission denied/);
  });

  it("doesn't let one user move another user's money", async () => {
    const aliceBank = await createCash(ALICE, "Bank");
    await asUser(db, ALICE, () => db.query("select public.log_income(100, '')"));
    const alicePending = await pendingId(ALICE);
    await expect(
      asUser(db, BOB, () => db.query("select public.transfer_funds($1, $2, 50, '')", [alicePending, aliceBank])),
    ).rejects.toThrow(/not found/);
    expect(await balance(alicePending)).toBe(100);
  });

  it("protects Upcoming Income from deletion", async () => {
    const pending = await pendingId();
    await expect(asUser(db, ALICE, () => db.query("delete from public.assets where id = $1", [pending]))).rejects.toThrow(/Upcoming Income/);
    expect(await balance(pending)).toBe(0);
  });

  it("lets users reserve money for a goal", async () => {
    const goal = await asUser(db, ALICE, async () =>
      (await one<{ id: string }>(
        db,
        "insert into public.goals (user_id, name, target_amount, target_unit, reserve_funds) values ($1, 'House', 1000000, 'EGP', true) returning id",
        [ALICE],
      )).id,
    );
    await asUser(db, ALICE, () => db.query("update public.goals set reserve_funds = false where id = $1", [goal]));
    expect(await one(db, "select reserve_funds from public.goals where id = $1", [goal])).toEqual({ reserve_funds: false });
  });

  it("rejects unknown time zones", async () => {
    await expect(
      asUser(db, ALICE, () => db.query("update public.profiles set timezone = 'Mars/Base' where user_id = $1", [ALICE])),
    ).rejects.toThrow(/Unknown time zone/);
  });
});

describe("money movements", () => {
  it("logs income into Upcoming Income with a matching history entry", async () => {
    await asUser(db, ALICE, () => db.query("select public.log_income(250.5, 'Client')"));
    expect(await balance(await pendingId())).toBe(250.5);
    const tx = await one(db, "select kind, amount, currency, pending_before, pending_after from public.transactions where user_id = $1", [ALICE]);
    expect(tx).toMatchObject({ kind: "income", currency: "USD" });
    expect(Number(tx.pending_after)).toBe(250.5);
  });

  it("transfers between accounts and blocks overdrafts", async () => {
    const bank = await createCash(ALICE, "Bank");
    const pending = await pendingId();
    await asUser(db, ALICE, () => db.query("select public.log_income(100, '')"));
    await expect(asUser(db, ALICE, () => db.query("select public.transfer_funds($1, $2, 150, '')", [pending, bank]))).rejects.toThrow(
      /Not enough money in Upcoming Income/,
    );
    await asUser(db, ALICE, () => db.query("select public.transfer_funds($1, $2, 60, '')", [pending, bank]));
    expect(await balance(pending)).toBe(40);
    expect(await balance(bank)).toBe(60);
  });

  it("converts between currencies at the live rate", async () => {
    const usd = await createCash(ALICE, "USD bank", "USD");
    const egp = await createCash(ALICE, "EGP bank", "EGP");
    await asUser(db, ALICE, () => db.query("select public.set_cash_balance($1, 10, '')", [usd]));
    await asUser(db, ALICE, () => db.query("select public.transfer_funds($1, $2, 10, '')", [usd, egp]));
    expect(await balance(egp)).toBe(500);
    const tx = await one(db, "select converted_amount, fx_rate from public.transactions where kind = 'transfer'");
    expect(Number(tx.converted_amount)).toBe(500);
    expect(Number(tx.fx_rate)).toBe(50);
  });

  it("records balance edits as adjustments", async () => {
    const bank = await createCash(ALICE, "Bank");
    await asUser(db, ALICE, () => db.query("select public.set_cash_balance($1, 300, 'Opening balance')", [bank]));
    await asUser(db, ALICE, () => db.query("select public.set_cash_balance($1, 250, '')", [bank]));
    const adjustments = await rows(db, "select c.delta from public.transaction_changes c order by c.id");
    expect(adjustments.map((r) => Number(r.delta))).toEqual([300, -50]);
  });

  it("blocks changing the income currency while Upcoming Income holds money", async () => {
    await asUser(db, ALICE, () => db.query("select public.log_income(10, '')"));
    await expect(
      asUser(db, ALICE, () => db.query("update public.profiles set income_currency = 'EGP' where user_id = $1", [ALICE])),
    ).rejects.toThrow(/Upcoming Income/);
  });

  it("switches the Upcoming Income currency when it is empty", async () => {
    await asUser(db, ALICE, () => db.query("update public.profiles set income_currency = 'AUD' where user_id = $1", [ALICE]));
    expect((await one(db, "select currency from public.assets where id = $1", [await pendingId()])).currency).toBe("AUD");
  });
});

describe("revert", () => {
  it("undoes every balance change after the chosen entry (no double-counting)", async () => {
    const paypal = await createCash(ALICE, "PayPal");
    const pending = await pendingId();
    const first = await asUser(db, ALICE, async () => (await one<{ id: string }>(db, "select public.log_income(100, '') as id")).id);
    await asUser(db, ALICE, () => db.query("select public.transfer_funds($1, $2, 100, '')", [pending, paypal]));
    await asUser(db, ALICE, () => db.query("select public.log_income(20, '')"));

    const removed = await asUser(db, ALICE, async () => (await one<{ n: number }>(db, "select public.revert_to_transaction($1) as n", [first])).n);

    expect(removed).toBe(2);
    expect(await balance(pending)).toBe(100);
    expect(await balance(paypal)).toBe(0);
    expect(await rows(db, "select id from public.transactions")).toHaveLength(1);
  });

  it("refuses to revert to imported history", async () => {
    await db.query(
      "insert into public.transactions (user_id, kind, amount, currency, is_imported) values ($1, 'imported', 5, 'USD', true)",
      [ALICE],
    );
    const id = (await one<{ id: string }>(db, "select id from public.transactions")).id;
    await expect(asUser(db, ALICE, () => db.query("select public.revert_to_transaction($1)", [id]))).rejects.toThrow(/imported/);
  });
});

describe("automations", () => {
  it("starts new rules at their next occurrence, then runs once per due month and catches up", async () => {
    const paypal = await createCash(ALICE, "PayPal");
    const pending = await pendingId();
    await asUser(db, ALICE, () => db.query("select public.log_income(500, '')"));
    await asUser(db, ALICE, () =>
      db.query(
        "insert into public.automation_rules (user_id, name, day_of_month, amount_mode, from_asset_id, to_asset_id) values ($1, 'Payday sweep', 1, 'all', $2, $3)",
        [ALICE, pending, paypal],
      ),
    );

    // Just created: nothing runs
    await db.query("select private.run_due_automations()");
    expect(await balance(paypal)).toBe(0);

    // Pretend the last run was months ago (the app wasn't opened): it catches up once
    await db.query("update public.automation_rules set last_run_period = '2000-01'");
    await db.query("select private.run_due_automations()");
    await db.query("select private.run_due_automations()");
    expect(await balance(paypal)).toBe(500);
    expect(await balance(pending)).toBe(0);
    const log = await rows(db, "select kind, description from public.transactions where kind = 'automation'");
    expect(log).toEqual([{ kind: "automation", description: "Payday sweep" }]);
  });

  it("records an error instead of failing when the source can't cover a fixed amount", async () => {
    const a = await createCash(ALICE, "A");
    const b = await createCash(ALICE, "B");
    await asUser(db, ALICE, () =>
      db.query(
        "insert into public.automation_rules (user_id, name, day_of_month, amount_mode, fixed_amount, from_asset_id, to_asset_id) values ($1, 'Save', 1, 'fixed', 50, $2, $3)",
        [ALICE, a, b],
      ),
    );
    await db.query("update public.automation_rules set last_run_period = '2000-01'");
    await db.query("select private.run_due_automations()");
    const rule = await one(db, "select last_error, last_run_period from public.automation_rules");
    expect(rule.last_error).toMatch(/Not enough money/);
    expect(rule.last_run_period).not.toBe("2000-01");
  });
});

describe("valuation & Zakat", () => {
  it("values a vault on the server the same way as the app", async () => {
    const bank = await createCash(ALICE, "Bank");
    await asUser(db, ALICE, () => db.query("select public.set_cash_balance($1, 100, '')", [bank]));
    await asUser(db, ALICE, () => db.query("select public.log_income(50, '')"));
    const gold = await asUser(db, ALICE, async () =>
      (await one<{ id: string }>(
        db,
        "insert into public.assets (user_id, kind, name, karat, color) values ($1, 'gold', 'Ingots', 24, 'butter') returning id",
        [ALICE],
      )).id,
    );
    await asUser(db, ALICE, () =>
      db.query("insert into public.asset_purchases (user_id, asset_id, quantity) values ($1, $2, 2)", [ALICE, gold]),
    );
    await db.query("update public.pricing_settings set gold_premium_pct = 0");

    const v = await one(db, "select * from private.user_valuation($1)", [ALICE]);
    // Same numbers as src/lib/valuation.test.ts: 100 USD = 5000, 2 g x 5030 = 10060, pending 50 USD = 2500
    expect(Number(v.zakatable_wealth)).toBeCloseTo(15060);
    expect(Number(v.net_worth)).toBeCloseTo(17560);
    expect(Number(v.gold_24k_price)).toBeCloseTo(5000);
    expect(v.complete).toBe(true);
  });

  it("starts, keeps and resets the Hawl based on the Nisab", async () => {
    const bank = await createCash(ALICE, "Bank");
    // 85 g of 24k gold at 5000 EGP/g (+2.5% premium) is about 435,625 EGP, about $8,713
    await asUser(db, ALICE, () => db.query("select public.set_cash_balance($1, 10000, '')", [bank]));
    await db.query("select private.run_zakat_daily()");
    const hawl = await one(db, "select hawl_start_date, last_checked_on from public.zakat_hawl where user_id = $1", [ALICE]);
    expect(hawl.hawl_start_date).not.toBeNull();
    expect(await rows(db, "select above_nisab from public.daily_snapshots where user_id = $1", [ALICE])).toEqual([{ above_nisab: true }]);

    // Below the Nisab the next day: the Hawl resets
    await asUser(db, ALICE, () => db.query("select public.set_cash_balance($1, 10, '')", [bank]));
    await db.query("update public.zakat_hawl set last_checked_on = last_checked_on - 1");
    await db.query("select private.run_zakat_daily()");
    expect((await one(db, "select hawl_start_date from public.zakat_hawl where user_id = $1", [ALICE])).hawl_start_date).toBeNull();
  });

  it("marks Zakat as paid and starts a new Hawl", async () => {
    const bank = await createCash(ALICE, "Bank");
    await asUser(db, ALICE, () => db.query("select public.set_cash_balance($1, 10000, '')", [bank]));
    await db.query("update public.zakat_hawl set hawl_start_date = current_date - 400 where user_id = $1", [ALICE]);
    await asUser(db, ALICE, () => db.query("select public.mark_zakat_paid(12500, 'EGP', 'Paid')"));
    expect(await rows(db, "select amount::float as amount from public.zakat_payments")).toEqual([{ amount: 12500 }]);
    const hawl = await one<{ days: number }>(db, "select current_date - hawl_start_date as days from public.zakat_hawl where user_id = $1", [ALICE]);
    expect(hawl.days).toBeLessThanOrEqual(1);
  });
});
