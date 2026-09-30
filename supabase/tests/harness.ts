// Runs the real migrations in PGlite (Postgres compiled to WebAssembly) with small stand-ins for
// the parts of Supabase they rely on (roles, auth.uid(), the realtime publication).
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;

  create publication supabase_realtime;
`;

export type Db = PGlite;

export async function createDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    // pg_cron, pg_net and Vault aren't available in PGlite
    .filter((f) => !f.includes("scheduled_jobs"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return db;
}

export async function createUser(db: Db, id: string, email: string) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}

/** Runs `fn` as a signed-in user (role `authenticated`, auth.uid() = userId), like PostgREST does. */
export async function asUser<T>(db: Db, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<T>(sql, params);
  return result.rows[0];
}

export async function rows<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function seedPrices(db: Db) {
  await db.exec(`
    insert into public.market_prices (symbol, kind, price, previous_price, currency, source) values
      ('FX:EGP', 'fx', 50, 49, 'USD', 'test'),
      ('FX:AUD', 'fx', 1.5, 1.5, 'USD', 'test'),
      ('METAL:XAU', 'metal', 3110.34768, 3000, 'USD', 'test'),
      ('STOCK:SPUS', 'stock', 60, 55, 'USD', 'test')
    on conflict (symbol) do update set price = excluded.price;
  `);
}
