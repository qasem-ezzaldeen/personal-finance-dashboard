-- AuraFinance: tables, row-level security and privileges.
-- The previous version's `public.dashboards` table (used only by the one-time import) is left untouched.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz);
$$;

-- Token names map to CSS variables in the app; custom colors are #rrggbb.
create domain public.color_ref as text
  check (value ~ '^(#[0-9a-fA-F]{6}|[a-z][a-z0-9-]{1,23})$');

create domain public.currency_code as text
  check (value ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- Profiles & settings
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  display_name text not null default '' check (char_length(display_name) <= 60),
  phone text not null default '' check (char_length(phone) <= 40),
  country text not null default '' check (char_length(country) <= 60),
  timezone text not null default 'Africa/Cairo',
  avatar_color public.color_ref not null default 'lilac',
  vault_name text not null default 'My Vault' check (char_length(btrim(vault_name)) between 1 and 60),
  base_currency public.currency_code not null default 'EGP',
  display_currencies text[] not null default '{USD}'
    check (cardinality(display_currencies) <= 6),
  income_currency public.currency_code not null default 'EGP',
  number_locale text not null default 'en-US' check (char_length(number_locale) <= 20),
  zakat_enabled boolean not null default true,
  animation_speed text not null default 'system' check (animation_speed in ('system', 'off', 'slow', 'normal', 'fast')),
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pricing_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  gold_mode text not null default 'live' check (gold_mode in ('live', 'manual')),
  manual_gold_24k_price numeric check (manual_gold_24k_price > 0),
  manual_gold_currency public.currency_code not null default 'EGP',
  gold_premium_pct numeric not null default 2.5 check (gold_premium_pct between 0 and 100),
  gold_21k_adjustment numeric not null default -30 check (abs(gold_21k_adjustment) <= 1000000),
  gold_24k_adjustment numeric not null default 30 check (abs(gold_24k_adjustment) <= 1000000),
  gold_adjustment_currency public.currency_code not null default 'EGP',
  updated_at timestamptz not null default now(),
  check (gold_mode = 'live' or manual_gold_24k_price is not null)
);

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

-- One group per asset kind per user. Assets join their group by kind.
create table public.asset_groups (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cash', 'gold', 'stock', 'other')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color public.color_ref not null,
  sort_order integer not null default 0,
  primary key (user_id, kind)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cash', 'gold', 'stock', 'other', 'pending_income')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  currency public.currency_code,
  karat integer check (karat in (21, 24)),
  ticker text check (ticker ~ '^[A-Z0-9][A-Z0-9.\-]{0,14}$'),
  manual_unit_price numeric check (manual_unit_price >= 0),
  balance numeric not null default 0 check (balance >= 0),
  color public.color_ref not null default 'mint',
  note text not null default '' check (char_length(note) <= 280),
  sort_order integer not null default 0,
  hide_when_empty boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Shape of each kind
  check (kind not in ('cash', 'pending_income') or (currency is not null and karat is null and ticker is null)),
  check (kind <> 'gold' or (karat is not null and currency is null and ticker is null)),
  check (kind <> 'stock' or (ticker is not null and currency is null and karat is null)),
  check (kind <> 'other' or (currency is not null and manual_unit_price is not null and karat is null and ticker is null)),
  -- Only cash-like assets carry a balance; the rest are sums of purchases
  check (kind in ('cash', 'pending_income') or balance = 0)
);

create unique index assets_one_pending_income_per_user on public.assets (user_id) where kind = 'pending_income';
create index assets_user_idx on public.assets (user_id);
create index assets_ticker_idx on public.assets (ticker) where ticker is not null;

create table public.asset_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  cost_total numeric check (cost_total >= 0),
  cost_currency public.currency_code,
  acquired_on date not null default current_date,
  note text not null default '' check (char_length(note) <= 280),
  is_opening_balance boolean not null default false,
  -- True when the cost is the market price on acquired_on, filled in by the estimate-costs function
  cost_is_estimated boolean not null default false,
  cost_estimate_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((cost_total is null) = (cost_currency is null))
);

create index asset_purchases_asset_idx on public.asset_purchases (asset_id);
create index asset_purchases_user_idx on public.asset_purchases (user_id);

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  enabled boolean not null default true,
  -- 1-28 run on that day; 31 means "last day of the month"
  day_of_month integer not null check (day_of_month between 1 and 28 or day_of_month = 31),
  amount_mode text not null default 'all' check (amount_mode in ('all', 'fixed')),
  fixed_amount numeric check (fixed_amount > 0),
  from_asset_id uuid references public.assets (id) on delete set null,
  to_asset_id uuid references public.assets (id) on delete set null,
  last_run_period text check (last_run_period ~ '^\d{4}-\d{2}$'),
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_mode = 'all' or fixed_amount is not null),
  check (from_asset_id is null or to_asset_id is null or from_asset_id <> to_asset_id)
);

create index automation_rules_user_idx on public.automation_rules (user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('income', 'transfer', 'automation', 'adjustment', 'imported')),
  description text not null default '' check (char_length(description) <= 200),
  amount numeric not null check (amount >= 0),
  currency public.currency_code not null,
  -- Value of one unit of `currency` in the user's base currency at the time
  rate_to_base numeric,
  base_currency public.currency_code,
  from_asset_id uuid references public.assets (id) on delete set null,
  from_asset_name text,
  to_asset_id uuid references public.assets (id) on delete set null,
  to_asset_name text,
  -- Cross-currency transfers: what arrived and at which rate
  converted_amount numeric,
  converted_currency public.currency_code,
  fx_rate numeric,
  pending_before numeric,
  pending_after numeric,
  automation_rule_id uuid references public.automation_rules (id) on delete set null,
  is_imported boolean not null default false,
  import_details jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index transactions_seq_idx on public.transactions (seq);
create index transactions_user_time_idx on public.transactions (user_id, occurred_at desc);
create index transactions_user_seq_idx on public.transactions (user_id, seq);

-- Exactly which balance changed by how much, so any entry can be undone.
create table public.transaction_changes (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  asset_name text not null,
  delta numeric not null
);

create index transaction_changes_tx_idx on public.transaction_changes (transaction_id);
create index transaction_changes_user_idx on public.transaction_changes (user_id);

-- ---------------------------------------------------------------------------
-- Goals & Zakat
-- ---------------------------------------------------------------------------

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  emoji text not null default '🎯' check (char_length(emoji) between 1 and 16),
  target_amount numeric not null check (target_amount > 0),
  -- A currency code, or GOLD_24K_G for grams of 24k gold
  target_unit text not null check (target_unit ~ '^[A-Z]{3}$' or target_unit = 'GOLD_24K_G'),
  include_upcoming boolean not null default true,
  sort_order integer not null default 0,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index goals_one_system_per_user on public.goals (user_id) where is_system;
create index goals_user_idx on public.goals (user_id);

create table public.zakat_hawl (
  user_id uuid primary key references auth.users (id) on delete cascade,
  hawl_start_date date,
  last_checked_on date,
  -- Wealth when the Hawl started; 2.5% of it is due when the Hawl completes
  start_wealth numeric check (start_wealth >= 0),
  start_wealth_currency public.currency_code,
  -- First Hawl: start_wealth is the value of the Nisab (85 g of 24k gold) on hawl_start_date
  is_first_hawl boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint zakat_hawl_start_wealth_pair check ((start_wealth is null) = (start_wealth_currency is null))
);

create table public.zakat_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  paid_on date not null default current_date,
  amount numeric not null check (amount >= 0),
  currency public.currency_code not null,
  hawl_start_date date,
  note text not null default '' check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);

create index zakat_payments_user_idx on public.zakat_payments (user_id);

create table public.daily_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  snapshot_date date not null,
  currency public.currency_code not null,
  net_worth numeric not null,
  zakatable_wealth numeric not null,
  gold_24k_price numeric not null,
  above_nisab boolean not null,
  primary key (user_id, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- Market data
-- ---------------------------------------------------------------------------

create table public.followed_tickers (
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9][A-Z0-9.\-]{0,14}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

create table public.price_overrides (
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9][A-Z0-9.\-]{0,14}$'),
  price numeric not null check (price > 0),
  currency public.currency_code not null default 'USD',
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

-- Shared, read-only for users. Symbols: FX:EGP (units per 1 USD), METAL:XAU (USD per troy ounce),
-- STOCK:SPUS (price in `currency`).
create table public.market_prices (
  symbol text primary key,
  kind text not null check (kind in ('fx', 'metal', 'stock')),
  price numeric not null check (price > 0),
  previous_price numeric,
  currency public.currency_code not null default 'USD',
  display_name text,
  source text not null,
  fetched_at timestamptz not null default now(),
  changed_at timestamptz not null default now()
);

-- Daily closing prices, shared cache for estimates (written by the estimate-costs function).
-- Symbols follow market_prices: FX:EGP (units per USD), METAL:XAU (USD/oz), STOCK:AAPL.
create table public.historical_prices (
  symbol text not null,
  price_date date not null,
  price numeric not null check (price > 0),
  currency public.currency_code not null default 'USD',
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, price_date)
);

-- Server-side API call budgets (never exposed to users)
create table private.api_usage (
  provider text not null,
  usage_date date not null,
  calls integer not null default 0,
  primary key (provider, usage_date)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger pricing_settings_updated_at before update on public.pricing_settings
  for each row execute function private.set_updated_at();
create trigger assets_updated_at before update on public.assets
  for each row execute function private.set_updated_at();
create trigger asset_purchases_updated_at before update on public.asset_purchases
  for each row execute function private.set_updated_at();
create trigger automation_rules_updated_at before update on public.automation_rules
  for each row execute function private.set_updated_at();
create trigger goals_updated_at before update on public.goals
  for each row execute function private.set_updated_at();
create trigger zakat_hawl_updated_at before update on public.zakat_hawl
  for each row execute function private.set_updated_at();
create trigger price_overrides_updated_at before update on public.price_overrides
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.asset_groups enable row level security;
alter table public.assets enable row level security;
alter table public.asset_purchases enable row level security;
alter table public.automation_rules enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_changes enable row level security;
alter table public.goals enable row level security;
alter table public.zakat_hawl enable row level security;
alter table public.zakat_payments enable row level security;
alter table public.daily_snapshots enable row level security;
alter table public.followed_tickers enable row level security;
alter table public.price_overrides enable row level security;
alter table public.market_prices enable row level security;
alter table public.historical_prices enable row level security;

-- Tables users fully manage (subject to column privileges below)
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'pricing_settings', 'asset_groups', 'assets', 'asset_purchases',
    'automation_rules', 'goals', 'zakat_hawl', 'followed_tickers', 'price_overrides'
  ] loop
    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format(
      'create policy "own rows: delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;

  -- Read-only tables (written only by database functions)
  foreach t in array array['transactions', 'transaction_changes', 'zakat_payments', 'daily_snapshots'] loop
    execute format(
      'create policy "own rows: select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

create policy "signed-in users can read prices" on public.market_prices
  for select to authenticated using (true);
create policy "signed-in users can read price history" on public.historical_prices
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anonymous visitors; column-level writes for users.
-- Balances, ledger rows and system flags can only change through functions.
-- ---------------------------------------------------------------------------

revoke all on
  public.profiles, public.pricing_settings, public.asset_groups, public.assets,
  public.asset_purchases, public.automation_rules, public.transactions,
  public.transaction_changes, public.goals, public.zakat_hawl, public.zakat_payments,
  public.daily_snapshots, public.followed_tickers, public.price_overrides, public.market_prices,
  public.historical_prices
from anon, authenticated;

grant select on
  public.profiles, public.pricing_settings, public.asset_groups, public.assets,
  public.asset_purchases, public.automation_rules, public.transactions,
  public.transaction_changes, public.goals, public.zakat_hawl, public.zakat_payments,
  public.daily_snapshots, public.followed_tickers, public.price_overrides, public.market_prices,
  public.historical_prices
to authenticated;

grant update (full_name, display_name, phone, country, timezone, avatar_color, vault_name,
  base_currency, display_currencies, income_currency, number_locale, zakat_enabled, animation_speed, theme)
  on public.profiles to authenticated;

grant update (gold_mode, manual_gold_24k_price, manual_gold_currency, gold_premium_pct,
  gold_21k_adjustment, gold_24k_adjustment, gold_adjustment_currency)
  on public.pricing_settings to authenticated;

grant update (name, color, sort_order) on public.asset_groups to authenticated;

grant insert (user_id, kind, name, currency, karat, ticker, manual_unit_price, color, note,
  sort_order, hide_when_empty)
  on public.assets to authenticated;
grant update (name, currency, karat, ticker, manual_unit_price, color, note, sort_order,
  hide_when_empty, archived_at)
  on public.assets to authenticated;
grant delete on public.assets to authenticated;

grant insert (user_id, asset_id, quantity, cost_total, cost_currency, acquired_on, note)
  on public.asset_purchases to authenticated;
grant update (quantity, cost_total, cost_currency, acquired_on, note)
  on public.asset_purchases to authenticated;
grant delete on public.asset_purchases to authenticated;

grant insert (user_id, name, enabled, day_of_month, amount_mode, fixed_amount, from_asset_id, to_asset_id)
  on public.automation_rules to authenticated;
grant update (name, enabled, day_of_month, amount_mode, fixed_amount, from_asset_id, to_asset_id)
  on public.automation_rules to authenticated;
grant delete on public.automation_rules to authenticated;

grant insert (user_id, name, emoji, target_amount, target_unit, include_upcoming, sort_order)
  on public.goals to authenticated;
grant update (name, emoji, target_amount, target_unit, include_upcoming, sort_order)
  on public.goals to authenticated;
grant delete on public.goals to authenticated;

grant update (hawl_start_date, start_wealth, start_wealth_currency, is_first_hawl) on public.zakat_hawl to authenticated;

grant insert, delete on public.followed_tickers to authenticated;
grant update (sort_order) on public.followed_tickers to authenticated;

grant insert, update, delete on public.price_overrides to authenticated;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

create or replace function private.guard_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending public.assets%rowtype;
begin
  if not private.is_valid_timezone(new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone using errcode = '22023';
  end if;

  if exists (select 1 from unnest(new.display_currencies) c where c !~ '^[A-Z]{3}$') then
    raise exception 'Display currencies must be 3-letter codes' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and new.income_currency is distinct from old.income_currency then
    select * into v_pending from public.assets
      where user_id = new.user_id and kind = 'pending_income' for update;
    if found then
      if v_pending.balance <> 0 then
        raise exception 'Move or clear your Upcoming Income before changing the income currency'
          using errcode = 'P0001';
      end if;
      perform set_config('aurafinance.allow_system_write', 'on', true);
      update public.assets set currency = new.income_currency where id = v_pending.id;
      perform set_config('aurafinance.allow_system_write', 'off', true);
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard before insert or update on public.profiles
  for each row execute function private.guard_profile();

create or replace function private.guard_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'pending_income' and current_setting('aurafinance.allow_system_delete', true) is distinct from 'on' then
      raise exception 'Upcoming Income is managed by the app and cannot be deleted' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'pending_income' and current_setting('aurafinance.allow_system_write', true) is distinct from 'on' then
      raise exception 'Upcoming Income is created automatically' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.kind <> old.kind then
    raise exception 'An asset''s type cannot be changed' using errcode = 'P0001';
  end if;
  if old.kind = 'pending_income' and current_setting('aurafinance.allow_system_write', true) is distinct from 'on' then
    if new.name <> old.name or new.archived_at is not null or new.currency <> old.currency then
      raise exception 'Upcoming Income is managed by the app' using errcode = 'P0001';
    end if;
  end if;
  if old.kind = 'cash' and new.currency <> old.currency and old.balance <> 0 then
    raise exception 'Empty this account before changing its currency' using errcode = 'P0001';
  end if;
  if new.archived_at is not null and old.archived_at is null and new.kind = 'cash' and new.balance <> 0 then
    raise exception 'Move this account''s money elsewhere before archiving it' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger assets_guard before insert or update or delete on public.assets
  for each row execute function private.guard_asset();

create or replace function private.guard_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.assets%rowtype;
begin
  select * into v_asset from public.assets where id = new.asset_id;
  if not found or v_asset.user_id <> new.user_id then
    raise exception 'Asset not found' using errcode = 'P0002';
  end if;
  if v_asset.kind not in ('gold', 'stock', 'other') then
    raise exception 'Purchases can only be recorded for gold, stocks and other assets' using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    new.cost_is_estimated := new.cost_is_estimated and new.cost_total is not null;
    return new;
  end if;

  -- A writer that doesn't touch the flag is a user edit
  if new.cost_is_estimated = old.cost_is_estimated then
    if old.cost_is_estimated
      and new.cost_total is not distinct from old.cost_total
      and (new.acquired_on <> old.acquired_on or new.quantity <> old.quantity) then
      -- Date or amount changed: the old estimate no longer applies, estimate again
      new.cost_total := null;
      new.cost_currency := null;
      new.cost_is_estimated := false;
    elsif new.cost_total is distinct from old.cost_total or new.cost_currency is distinct from old.cost_currency then
      -- The user entered (or cleared) the real price
      new.cost_is_estimated := false;
    end if;
  end if;

  -- A price that was just removed should be estimated again right away
  if new.cost_total is null and old.cost_total is not null then
    new.cost_estimate_attempted_at := null;
  end if;
  return new;
end;
$$;

create trigger asset_purchases_guard before insert or update on public.asset_purchases
  for each row execute function private.guard_purchase();

create or replace function private.guard_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system and current_setting('aurafinance.allow_system_delete', true) is distinct from 'on' then
      raise exception 'The Zakat goal cannot be deleted. Turn Zakat off in your profile instead.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.is_system then
    -- Only the position of the Zakat goal can change
    new.name := old.name;
    new.emoji := old.emoji;
    new.target_amount := old.target_amount;
    new.target_unit := old.target_unit;
    new.include_upcoming := old.include_upcoming;
  end if;
  return new;
end;
$$;

create trigger goals_guard before update or delete on public.goals
  for each row execute function private.guard_goal();

create or replace function private.guard_hawl()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hawl_start_date is not null and new.hawl_start_date > current_date + 1 then
    raise exception 'The Hawl start date cannot be in the future' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger zakat_hawl_guard before insert or update on public.zakat_hawl
  for each row execute function private.guard_hawl();

-- ---------------------------------------------------------------------------
-- Realtime: every user table plus shared prices
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.profiles, public.pricing_settings, public.asset_groups, public.assets,
      public.asset_purchases, public.automation_rules, public.transactions, public.goals,
      public.zakat_hawl, public.zakat_payments, public.followed_tickers, public.price_overrides,
      public.market_prices;
  end if;
end;
$$;
