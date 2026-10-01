// @vitest-environment node
// Restoring a vault from a JSON backup, in the same or another account.
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, one, rows, seedPrices, type Db } from "./harness";

const ALICE = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const BOB = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
let db: Db;

const as = <T>(user: string, fn: () => Promise<T>) => asUser(db, user, fn);
const id = async (user: string, sql: string, params: unknown[] = []) => (await as(user, () => one<{ id: string }>(db, sql, params))).id;
const balanceOf = async (user: string, name: string) =>
  Number((await one<{ b: string }>(db, "select balance as b from public.assets where user_id = $1 and name = $2", [user, name])).b);
const holdingOf = async (user: string, name: string) =>
  Number((await one<{ h: string }>(db, "select private.holding(id) as h from public.assets where user_id = $1 and name = $2", [user, name])).h);

/** The same shape the app downloads from Settings › Data (VaultData + transactions + changes). */
async function exportVault(user: string, { withChanges = true } = {}) {
  const all = async (table: string) =>
    (await one<{ j: unknown[] }>(db, `select coalesce(jsonb_agg(t), '[]') as j from public.${table} t where user_id = $1`, [user])).j;
  const single = async (table: string) => (await one<{ j: unknown }>(db, `select to_jsonb(t) as j from public.${table} t where user_id = $1`, [user])).j;
  const transactions = (await one<{ j: unknown[] }>(
    db,
    "select coalesce(jsonb_agg(t order by t.seq), '[]') as j from public.transactions t where user_id = $1",
    [user],
  )).j;
  return {
    format: "aurafinance-backup",
    version: 2,
    app: "AuraFinance",
    profile: await single("profiles"),
    pricing: await single("pricing_settings"),
    groups: await all("asset_groups"),
    assets: await all("assets"),
    purchases: await all("asset_purchases"),
    sales: await all("asset_sales"),
    goals: await all("goals"),
    hawl: await single("zakat_hawl"),
    zakatPayments: await all("zakat_payments"),
    rules: await all("automation_rules"),
    followed: await all("followed_tickers"),
    overrides: await all("price_overrides"),
    transactions,
    ...(withChanges ? { transaction_changes: await all("transaction_changes") } : {}),
  };
}

const restore = (user: string, backup: unknown) => as(user, () => one<{ r: Record<string, unknown> }>(db, "select public.restore_vault($1) as r", [backup]));

let aliceBank: string;
let aliceGold: string;

beforeEach(async () => {
  db = await createDb();
  await createUser(db, ALICE, "alice@example.test");
  await createUser(db, BOB, "bob@example.test");
  await seedPrices(db);
  for (const u of [ALICE, BOB]) await as(u, () => db.query("select public.bootstrap_vault()"));

  // Alice: a bank account, gold bought and partly sold from it, a reserved goal and an automation
  await as(ALICE, () => db.query("update public.profiles set vault_name = 'Alice vault', color_palette = 'sea' where user_id = $1", [ALICE]));
  aliceBank = await id(ALICE, "insert into public.assets (user_id, kind, name, currency, color) values ($1, 'cash', 'Bank', 'EGP', 'sky') returning id", [ALICE]);
  aliceGold = await id(ALICE, "insert into public.assets (user_id, kind, name, karat, color) values ($1, 'gold', 'Ingots', 24, 'butter') returning id", [ALICE]);
  await as(ALICE, () => db.query("select public.set_cash_balance($1, 100000, '')", [aliceBank]));
  await as(ALICE, () => db.query("select public.buy_asset($1, $2, 10, 50000, null, '')", [aliceGold, aliceBank]));
  await as(ALICE, () => db.query("select public.sell_asset($1, $2, 4, 24000, null, '')", [aliceGold, aliceBank]));
  await as(ALICE, () => db.query("select public.log_income(500, 'Client')"));
  await as(ALICE, () =>
    db.query("insert into public.goals (user_id, name, target_amount, target_unit, reserve_funds) values ($1, 'House', 1000000, 'EGP', true)", [ALICE]),
  );
  const pending = (await one<{ id: string }>(db, "select id from public.assets where user_id = $1 and kind = 'pending_income'", [ALICE])).id;
  await as(ALICE, () =>
    db.query("insert into public.automation_rules (user_id, name, day_of_month, from_asset_id, to_asset_id) values ($1, 'Sweep', 1, $2, $3)", [ALICE, pending, aliceBank]),
  );
});

describe("restoring a backup", () => {
  it("rebuilds the vault in another account", async () => {
    const backup = await exportVault(ALICE);
    // Bob had something of his own: it's replaced
    await id(BOB, "insert into public.assets (user_id, kind, name, currency, color) values ($1, 'cash', 'Old', 'USD', 'sky') returning id", [BOB]);

    const result = (await restore(BOB, backup)).r;
    expect(result).toMatchObject({ assets: 2, purchases: 1, sales: 1, goals: 1, automation_rules: 1, revertable: true });

    expect(await rows(db, "select name from public.assets where user_id = $1 and kind <> 'pending_income' order by name", [BOB])).toEqual([
      { name: "Bank" },
      { name: "Ingots" },
    ]);
    expect(await balanceOf(BOB, "Bank")).toBe(74000);
    expect(await balanceOf(BOB, "Upcoming Income")).toBe(500);
    expect(await holdingOf(BOB, "Ingots")).toBe(6);
    expect(await one(db, "select vault_name, color_palette, display_name from public.profiles where user_id = $1", [BOB])).toEqual({
      vault_name: "Alice vault", color_palette: "sea", display_name: "bob",
    });
    expect(await one(db, "select name, reserve_funds from public.goals where user_id = $1", [BOB])).toEqual({ name: "House", reserve_funds: true });
    // Nothing points at Alice's rows
    const leaks = await one<{ n: number }>(
      db,
      `select (select count(*) from public.asset_purchases p join public.assets a on a.id = p.asset_id where p.user_id = $1 and a.user_id <> $1)
            + (select count(*) from public.transactions t join public.assets a on a.id in (t.from_asset_id, t.to_asset_id) where t.user_id = $1 and a.user_id <> $1)
            + (select count(*) from public.automation_rules r join public.assets a on a.id in (r.from_asset_id, r.to_asset_id) where r.user_id = $1 and a.user_id <> $1)
            as n`,
      [BOB],
    );
    expect(Number(leaks.n)).toBe(0);
    // Alice's vault is untouched
    expect(await balanceOf(ALICE, "Bank")).toBe(74000);
  });

  it("keeps history that can be reverted", async () => {
    await restore(BOB, await exportVault(ALICE));
    const buy = (await one<{ id: string }>(db, "select id from public.transactions where user_id = $1 and kind = 'buy'", [BOB])).id;
    await as(BOB, () => db.query("select public.revert_to_transaction($1)", [buy]));
    // The sale and the income are undone
    expect(await balanceOf(BOB, "Bank")).toBe(50000);
    expect(await holdingOf(BOB, "Ingots")).toBe(10);
    expect(await balanceOf(BOB, "Upcoming Income")).toBe(0);
  });

  it("restores older backups with read-only history", async () => {
    const result = (await restore(BOB, await exportVault(ALICE, { withChanges: false }))).r;
    expect(result.revertable).toBe(false);
    expect(await balanceOf(BOB, "Bank")).toBe(74000);
    const flags = await rows<{ is_imported: boolean }>(db, "select is_imported from public.transactions where user_id = $1", [BOB]);
    expect(flags.every((f) => f.is_imported)).toBe(true);
  });

  it("can restore over the same vault", async () => {
    const backup = await exportVault(ALICE);
    await as(ALICE, () => db.query("select public.set_cash_balance($1, 1, '')", [aliceBank]));
    await restore(ALICE, backup);
    expect(await balanceOf(ALICE, "Bank")).toBe(74000);
    expect(await holdingOf(ALICE, "Ingots")).toBe(6);
    expect(await rows(db, "select id from public.assets where user_id = $1 and kind = 'cash'", [ALICE])).toHaveLength(1);
  });

  it("doesn't move money by restoring automations", async () => {
    await restore(BOB, await exportVault(ALICE));
    await as(BOB, () => db.query("select public.run_scheduled_tasks_for_me()"));
    expect(await balanceOf(BOB, "Upcoming Income")).toBe(500);
  });

  it("rejects files that aren't backups", async () => {
    await expect(restore(BOB, { hello: "world" })).rejects.toThrow(/isn't an AuraFinance backup/);
  });
});

describe("palettes and hero colors", () => {
  it("OLED replaces Vivid", async () => {
    await as(ALICE, () => db.query("update public.profiles set color_palette = 'oled' where user_id = $1", [ALICE]));
    await expect(as(ALICE, () => db.query("update public.profiles set color_palette = 'vivid' where user_id = $1", [ALICE]))).rejects.toThrow(
      /color_palette/,
    );
  });

  it("stores a hero color per palette and rejects anything else", async () => {
    await as(ALICE, () => db.query(`update public.profiles set palette_accents = '{"sea": "#FF5500"}' where user_id = $1`, [ALICE]));
    expect(await one(db, "select palette_accents from public.profiles where user_id = $1", [ALICE])).toEqual({ palette_accents: { sea: "#ff5500" } });
    for (const bad of ['{"sea": "red"}', '{"neon": "#ff0000"}', '["#ff0000"]']) {
      await expect(as(ALICE, () => db.query(`update public.profiles set palette_accents = '${bad}' where user_id = $1`, [ALICE]))).rejects.toThrow(
        /Hero colors/,
      );
    }
  });

  it("restores the palette and its hero colors, turning Vivid into OLED", async () => {
    const backup = await exportVault(ALICE);
    const profile = { ...(backup.profile as object), color_palette: "vivid", palette_accents: { oled: "#00ff88", bogus: "x" } };
    await restore(BOB, { ...backup, profile });
    expect(await one(db, "select color_palette, palette_accents from public.profiles where user_id = $1", [BOB])).toEqual({
      color_palette: "oled",
      palette_accents: { oled: "#00ff88" },
    });
  });
});
