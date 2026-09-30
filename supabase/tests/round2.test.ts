// @vitest-environment node
// Estimated purchase prices, Zakat start-of-Hawl wealth and the animation preference.
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, one, seedPrices, type Db } from "./harness";

const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
let db: Db;
let goldId: string;

beforeEach(async () => {
  db = await createDb();
  await createUser(db, USER, "user@example.test");
  await seedPrices(db);
  await asUser(db, USER, () => db.query("select public.bootstrap_vault()"));
  goldId = await asUser(db, USER, async () =>
    (await one<{ id: string }>(
      db,
      "insert into public.assets (user_id, kind, name, karat, color) values ($1, 'gold', 'Ingots', 24, 'butter') returning id",
      [USER],
    )).id,
  );
});

const purchase = async (id: string) =>
  one<{ cost_total: string | null; cost_currency: string | null; cost_is_estimated: boolean; cost_estimate_attempted_at: string | null }>(
    db,
    "select cost_total, cost_currency, cost_is_estimated, cost_estimate_attempted_at from public.asset_purchases where id = $1",
    [id],
  );

async function addPurchase(date = "2025-03-03"): Promise<string> {
  return asUser(db, USER, async () =>
    (await one<{ id: string }>(
      db,
      "insert into public.asset_purchases (user_id, asset_id, quantity, acquired_on) values ($1, $2, 10, $3) returning id",
      [USER, goldId, date],
    )).id,
  );
}

// What the estimate-costs function writes (as the service role)
const estimate = (id: string, cost: number) =>
  db.query(
    "update public.asset_purchases set cost_total = $2, cost_currency = 'EGP', cost_is_estimated = true, cost_estimate_attempted_at = now() where id = $1",
    [id, cost],
  );

describe("estimated purchase prices", () => {
  it("stores the server's estimate and marks it", async () => {
    const id = await addPurchase();
    await estimate(id, 48524.03);
    expect(await purchase(id)).toMatchObject({ cost_total: "48524.03", cost_is_estimated: true });
  });

  it("users can't mark their own prices as estimates", async () => {
    const id = await addPurchase();
    await expect(asUser(db, USER, () => db.query("update public.asset_purchases set cost_is_estimated = true where id = $1", [id]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("a real price typed by the user replaces the estimate", async () => {
    const id = await addPurchase();
    await estimate(id, 48524.03);
    await asUser(db, USER, () => db.query("update public.asset_purchases set cost_total = 47000, cost_currency = 'EGP' where id = $1", [id]));
    expect(await purchase(id)).toMatchObject({ cost_total: "47000", cost_is_estimated: false });
  });

  it("changing the date of an estimated purchase clears it so it's estimated again", async () => {
    const id = await addPurchase();
    await estimate(id, 48524.03);
    await asUser(db, USER, () => db.query("update public.asset_purchases set acquired_on = '2024-01-15' where id = $1", [id]));
    expect(await purchase(id)).toMatchObject({ cost_total: null, cost_is_estimated: false, cost_estimate_attempted_at: null });
  });

  it("editing only the note keeps the estimate", async () => {
    const id = await addPurchase();
    await estimate(id, 48524.03);
    await asUser(db, USER, () => db.query("update public.asset_purchases set note = 'from the souq' where id = $1", [id]));
    expect(await purchase(id)).toMatchObject({ cost_total: "48524.03", cost_is_estimated: true });
  });

  it("remembers a failed lookup so it isn't retried on every visit", async () => {
    const id = await addPurchase();
    await db.query("update public.asset_purchases set cost_estimate_attempted_at = now() where id = $1", [id]);
    expect((await purchase(id)).cost_estimate_attempted_at).not.toBeNull();
  });
});

describe("Zakat start-of-Hawl wealth", () => {
  it("records the wealth on the day a Hawl starts, and clears it when the Hawl breaks", async () => {
    const bank = await asUser(db, USER, async () =>
      (await one<{ id: string }>(
        db,
        "insert into public.assets (user_id, kind, name, currency, color) values ($1, 'cash', 'Bank', 'EGP', 'sky') returning id",
        [USER],
      )).id,
    );
    await asUser(db, USER, () => db.query("select public.set_cash_balance($1, 600000, '')", [bank]));
    await db.query("select private.run_zakat_daily()");
    expect(await one(db, "select start_wealth::float as w, start_wealth_currency as c from public.zakat_hawl where user_id = $1", [USER])).toEqual({
      w: 600000,
      c: "EGP",
    });

    await asUser(db, USER, () => db.query("select public.set_cash_balance($1, 10, '')", [bank]));
    await db.query("update public.zakat_hawl set last_checked_on = last_checked_on - 1");
    await db.query("select private.run_zakat_daily()");
    expect(await one(db, "select hawl_start_date, start_wealth from public.zakat_hawl where user_id = $1", [USER])).toEqual({
      hawl_start_date: null,
      start_wealth: null,
    });
  });

  it("lets the user enter the start wealth themselves", async () => {
    await asUser(db, USER, () =>
      db.query("update public.zakat_hawl set hawl_start_date = current_date - 100, start_wealth = 520000, start_wealth_currency = 'EGP' where user_id = $1", [USER]),
    );
    expect((await one(db, "select start_wealth::float as w from public.zakat_hawl where user_id = $1", [USER])).w).toBe(520000);
  });

  it("requires a currency with the amount", async () => {
    await expect(
      asUser(db, USER, () => db.query("update public.zakat_hawl set start_wealth = 520000 where user_id = $1", [USER])),
    ).rejects.toThrow(/start_wealth_pair/);
  });
});

describe("animation preference", () => {
  it("accepts the five speeds only", async () => {
    await asUser(db, USER, () => db.query("update public.profiles set animation_speed = 'fast' where user_id = $1", [USER]));
    await expect(
      asUser(db, USER, () => db.query("update public.profiles set animation_speed = 'warp' where user_id = $1", [USER])),
    ).rejects.toThrow(/animation_speed/);
  });
});
