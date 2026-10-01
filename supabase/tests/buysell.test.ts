// @vitest-environment node
// Buying and selling assets with money from cash accounts, refunds and undo.
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, one, rows, seedPrices, type Db } from "./harness";

const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let db: Db;
let bank: string;
let gold: string;

const as = <T>(fn: () => Promise<T>) => asUser(db, USER, fn);
const q = (sql: string, params: unknown[] = []) => as(() => db.query(sql, params));

async function insertAsset(user: string, sql: string): Promise<string> {
  return asUser(db, user, async () => (await one<{ id: string }>(db, sql, [user])).id);
}

const balance = async (id: string) => Number((await one<{ b: string }>(db, "select balance as b from public.assets where id = $1", [id])).b);
const holding = async (id: string) => Number((await one<{ h: string }>(db, "select private.holding($1) as h", [id])).h);
const buy = async (quantity: number, amount: number, from = bank, asset = gold) =>
  (await as(() => one<{ id: string }>(db, "select public.buy_asset($1, $2, $3, $4, null, 'test') as id", [asset, from, quantity, amount]))).id;
const sell = async (quantity: number, amount: number, to = bank, asset = gold) =>
  (await as(() => one<{ id: string }>(db, "select public.sell_asset($1, $2, $3, $4, null, '') as id", [asset, to, quantity, amount]))).id;
const revertTo = (tx: string) => q("select public.revert_to_transaction($1)", [tx]);

beforeEach(async () => {
  db = await createDb();
  await createUser(db, USER, "user@example.test");
  await createUser(db, OTHER, "other@example.test");
  await seedPrices(db);
  for (const u of [USER, OTHER]) await asUser(db, u, () => db.query("select public.bootstrap_vault()"));
  bank = await insertAsset(USER, "insert into public.assets (user_id, kind, name, currency, color) values ($1, 'cash', 'Bank', 'EGP', 'sky') returning id");
  gold = await insertAsset(USER, "insert into public.assets (user_id, kind, name, karat, color) values ($1, 'gold', 'Ingots', 24, 'butter') returning id");
  await q("select public.set_cash_balance($1, 100000, '')", [bank]);
});

describe("buying", () => {
  it("takes the money from cash and records the purchase at that price", async () => {
    const tx = await buy(10, 50000);
    expect(await balance(bank)).toBe(50000);
    expect(await holding(gold)).toBe(10);
    const purchase = await one(
      db,
      "select quantity::float, cost_total::float, cost_currency, paid_from_asset_id, paid_amount::float, transaction_id from public.asset_purchases where asset_id = $1",
      [gold],
    );
    expect(purchase).toEqual({
      quantity: 10, cost_total: 50000, cost_currency: "EGP", paid_from_asset_id: bank, paid_amount: 50000, transaction_id: tx,
    });
    expect(await one(db, "select kind, amount::float, from_asset_name, to_asset_name, details from public.transactions where id = $1", [tx])).toEqual({
      kind: "buy", amount: 50000, from_asset_name: "Bank", to_asset_name: "Ingots", details: { quantity: 10, asset_kind: "gold" },
    });
  });

  it("refuses to spend more than the account has", async () => {
    await expect(buy(10, 150000)).rejects.toThrow(/Not enough money in Bank/);
    expect(await balance(bank)).toBe(100000);
    expect(await holding(gold)).toBe(0);
  });

  it("only pays from your own cash accounts", async () => {
    const pending = (await one<{ id: string }>(db, "select id from public.assets where user_id = $1 and kind = 'pending_income'", [USER])).id;
    await expect(buy(1, 10, pending)).rejects.toThrow(/cash accounts/);
    const otherBank = await insertAsset(OTHER, "insert into public.assets (user_id, kind, name, currency, color) values ($1, 'cash', 'Theirs', 'EGP', 'sky') returning id");
    await expect(buy(1, 10, otherBank)).rejects.toThrow(/not found/);
  });

  it("editing the purchase price later doesn't touch the cash", async () => {
    await buy(10, 50000);
    await q("update public.asset_purchases set cost_total = 45000, quantity = 9 where asset_id = $1", [gold]);
    expect(await balance(bank)).toBe(50000);
  });
});

describe("deleting a purchase", () => {
  it("puts what was paid back into the account, even after the price was edited", async () => {
    await buy(10, 50000);
    await q("update public.asset_purchases set cost_total = 1 where asset_id = $1", [gold]);
    await q("delete from public.asset_purchases where asset_id = $1", [gold]);
    expect(await balance(bank)).toBe(100000);
    expect(await holding(gold)).toBe(0);
    expect(await rows(db, "select kind, amount::float from public.transactions where user_id = $1 and kind = 'refund'", [USER])).toEqual([
      { kind: "refund", amount: 50000 },
    ]);
  });

  it("doesn't refund purchases that weren't paid from cash", async () => {
    await q("insert into public.asset_purchases (user_id, asset_id, quantity) values ($1, $2, 5)", [USER, gold]);
    await q("delete from public.asset_purchases where asset_id = $1", [gold]);
    expect(await balance(bank)).toBe(100000);
  });

  it("refunds every cash purchase when the asset is deleted", async () => {
    await buy(4, 20000);
    await buy(6, 30000);
    await sell(2, 12000);
    await q("delete from public.assets where id = $1", [gold]);
    // 100,000 − 50,000 bought + 12,000 sold + 50,000 refunded
    expect(await balance(bank)).toBe(112000);
  });

  it("can't remove a purchase that was already sold", async () => {
    await buy(10, 50000);
    await sell(8, 45000);
    await expect(q("delete from public.asset_purchases where asset_id = $1", [gold])).rejects.toThrow(/sold/);
    expect(await balance(bank)).toBe(95000);
  });
});

describe("selling", () => {
  it("adds the money to cash and lowers the holding", async () => {
    await buy(10, 50000);
    const tx = await sell(4, 24000);
    expect(await balance(bank)).toBe(74000);
    expect(await holding(gold)).toBe(6);
    expect(await one(db, "select kind, from_asset_name, to_asset_name from public.transactions where id = $1", [tx])).toEqual({
      kind: "sell", from_asset_name: "Ingots", to_asset_name: "Bank",
    });
  });

  it("can't sell more than you hold", async () => {
    await buy(10, 50000);
    await expect(sell(11, 60000)).rejects.toThrow(/only have 10/);
  });

  it("removing a sale takes the money back out and restores the holding", async () => {
    await buy(10, 50000);
    await sell(4, 24000);
    const sale = (await one<{ id: string }>(db, "select id from public.asset_sales where asset_id = $1", [gold])).id;
    await q("select public.delete_sale($1)", [sale]);
    expect(await balance(bank)).toBe(50000);
    expect(await holding(gold)).toBe(10);
  });

  it("counts sales in the server's valuation", async () => {
    await buy(10, 50000);
    await sell(4, 24000);
    const v = await one<{ z: number; p: number }>(db, "select zakatable_wealth::float as z, gold_24k_price::float as p from private.user_valuation($1)", [USER]);
    // 74,000 cash + 6 g at (5,000 + 30 adjustment)
    expect(v.z).toBeCloseTo(74000 + 6 * (v.p + 30));
  });

  it("users can't write sales directly", async () => {
    await expect(
      q(
        "insert into public.asset_sales (user_id, asset_id, quantity, proceeds, proceeds_currency, sold_on, transaction_id) values ($1, $2, 1, 1, 'EGP', current_date, gen_random_uuid())",
        [USER, gold],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("reverting", () => {
  it("undoes a purchase: money back, purchase gone", async () => {
    const before = (await one<{ id: string }>(db, "select id from public.transactions where user_id = $1 order by seq desc limit 1", [USER])).id;
    await buy(10, 50000);
    await revertTo(before);
    expect(await balance(bank)).toBe(100000);
    expect(await holding(gold)).toBe(0);
    expect(await rows(db, "select id from public.transactions where user_id = $1 and kind = 'refund'", [USER])).toEqual([]);
  });

  it("undoes a sale: money out, holding back", async () => {
    const bought = await buy(10, 50000);
    await sell(10, 60000);
    await revertTo(bought);
    expect(await balance(bank)).toBe(50000);
    expect(await holding(gold)).toBe(10);
  });

  it("puts back a deleted purchase when reverting to a point before the deletion", async () => {
    const bought = await buy(10, 50000);
    await q("delete from public.asset_purchases where asset_id = $1", [gold]);
    expect(await balance(bank)).toBe(100000);
    await revertTo(bought);
    expect(await balance(bank)).toBe(50000);
    expect(await holding(gold)).toBe(10);
    // Deleting it again still refunds
    await q("delete from public.asset_purchases where asset_id = $1", [gold]);
    expect(await balance(bank)).toBe(100000);
  });

  it("puts back a removed sale", async () => {
    await buy(10, 50000);
    const sold = await sell(4, 24000);
    const sale = (await one<{ id: string }>(db, "select id from public.asset_sales where asset_id = $1", [gold])).id;
    await q("select public.delete_sale($1)", [sale]);
    await revertTo(sold);
    expect(await balance(bank)).toBe(74000);
    expect(await holding(gold)).toBe(6);
  });
});
