// @vitest-environment node
// The dashboard's change KPI settings.
import { beforeEach, describe, expect, it } from "vitest";
import { asUser, createDb, createUser, one, seedPrices, type Db } from "./harness";

const USER = "abababab-abab-4bab-8bab-abababababab";
let db: Db;

beforeEach(async () => {
  db = await createDb();
  await createUser(db, USER, "user@example.test");
  await seedPrices(db);
  await asUser(db, USER, () => db.query("select public.bootstrap_vault()"));
});

const update = (set: string) => asUser(db, USER, () => db.query(`update public.profiles set ${set} where user_id = $1`, [USER]));

describe("change KPI settings", () => {
  it("default to the change in net worth this month", async () => {
    expect(await one(db, "select kpi_metric, kpi_period from public.profiles where user_id = $1", [USER])).toEqual({
      kpi_metric: "net_worth",
      kpi_period: "month",
    });
  });

  it("can be changed by the user to known values only", async () => {
    await update("kpi_metric = 'income', kpi_period = 'ytd'");
    expect(await one(db, "select kpi_metric, kpi_period from public.profiles where user_id = $1", [USER])).toEqual({
      kpi_metric: "income",
      kpi_period: "ytd",
    });
    await expect(update("kpi_metric = 'luck'")).rejects.toThrow(/kpi_metric/);
    await expect(update("kpi_period = '5y'")).rejects.toThrow(/kpi_period/);
  });
});

describe("price history backfills", () => {
  it("are only for the server", async () => {
    await expect(asUser(db, USER, () => db.query("select * from public.price_history_backfills"))).rejects.toThrow(/permission denied/);
  });
});
