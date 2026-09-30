// @vitest-environment node
// Color theme preference and first-year Zakat.
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, one, seedPrices, type Db } from "./harness";

const USER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let db: Db;

beforeEach(async () => {
  db = await createDb();
  await createUser(db, USER, "user@example.test");
  await seedPrices(db);
  await asUser(db, USER, () => db.query("select public.bootstrap_vault()"));
});

const hawl = () =>
  one<{ hawl_start_date: string | null; start_wealth: number | null; is_first_hawl: boolean }>(
    db,
    "select hawl_start_date, start_wealth::float as start_wealth, is_first_hawl from public.zakat_hawl where user_id = $1",
    [USER],
  );

async function markFirstHawl() {
  await asUser(db, USER, () =>
    db.query(
      `update public.zakat_hawl set hawl_start_date = current_date - 30, start_wealth = 409904.27,
         start_wealth_currency = 'EGP', is_first_hawl = true where user_id = $1`,
      [USER],
    ),
  );
}

describe("theme preference", () => {
  it("defaults to light and accepts light, dark or system", async () => {
    expect((await one(db, "select theme from public.profiles where user_id = $1", [USER])).theme).toBe("light");
    await asUser(db, USER, () => db.query("update public.profiles set theme = 'dark' where user_id = $1", [USER]));
    await expect(asUser(db, USER, () => db.query("update public.profiles set theme = 'neon' where user_id = $1", [USER]))).rejects.toThrow(
      /theme/,
    );
  });
});

describe("first-year Zakat", () => {
  it("users can mark their Hawl as the first one", async () => {
    await markFirstHawl();
    expect(await hawl()).toMatchObject({ start_wealth: 409904.27, is_first_hawl: true });
  });

  it("is no longer the first year once Zakat has been paid", async () => {
    const bank = await asUser(db, USER, async () =>
      (await one<{ id: string }>(
        db,
        "insert into public.assets (user_id, kind, name, currency, color) values ($1, 'cash', 'Bank', 'EGP', 'sky') returning id",
        [USER],
      )).id,
    );
    await asUser(db, USER, () => db.query("select public.set_cash_balance($1, 600000, '')", [bank]));
    await markFirstHawl();
    await asUser(db, USER, () => db.query("select public.mark_zakat_paid(10247.61, 'EGP', 'first year')"));
    expect(await hawl()).toMatchObject({ is_first_hawl: false, start_wealth: 600000 });
  });

  it("resets when the Hawl breaks", async () => {
    await markFirstHawl();
    // No wealth at all: below the Nisab at the next daily check
    await db.query("update public.zakat_hawl set last_checked_on = current_date - 1 where user_id = $1", [USER]);
    await db.query("select private.run_zakat_daily()");
    expect(await hawl()).toMatchObject({ hawl_start_date: null, start_wealth: null, is_first_hawl: false });
  });
});
