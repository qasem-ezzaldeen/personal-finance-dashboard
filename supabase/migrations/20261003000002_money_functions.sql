-- AuraFinance: vault setup and all money-moving functions.
-- Every balance change writes a transaction and its exact per-account changes in one database transaction.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You need to be signed in' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- Units of p_currency per 1 USD (null when unknown)
create or replace function private.usd_rate(p_currency text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_currency = 'USD' then 1::numeric
    else (select m.price from public.market_prices m where m.symbol = 'FX:' || p_currency)
  end;
$$;

-- Multiply an amount in p_from by this to get p_to (null when unknown)
create or replace function private.fx(p_from text, p_to text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case
    when p_from = p_to then 1::numeric
    else private.usd_rate(p_to) / nullif(private.usd_rate(p_from), 0)
  end;
$$;

create or replace function private.local_date(p_user uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.user_id = p_user), 'UTC'))::date;
$$;

-- The most recent 'YYYY-MM' whose scheduled day has already arrived on p_local.
-- Day 31 (or any day past the month's end) means the last day of the month.
create or replace function private.latest_due_period(p_day integer, p_local date)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_last_day integer := extract(day from (date_trunc('month', p_local) + interval '1 month - 1 day'))::integer;
begin
  if extract(day from p_local)::integer >= least(p_day, v_last_day) then
    return to_char(p_local, 'YYYY-MM');
  end if;
  return to_char(p_local - interval '1 month', 'YYYY-MM');
end;
$$;

create or replace function private.fail(p_message text, p_code text default 'P0001')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message using errcode = p_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Automation rule integrity
-- ---------------------------------------------------------------------------

create or replace function private.guard_automation_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due text;
begin
  -- Internal writers (automation runner, one-time import) manage these fields themselves
  if current_setting('aurafinance.allow_system_write', true) = 'on' then
    return new;
  end if;

  if (tg_op = 'INSERT' or new.from_asset_id is distinct from old.from_asset_id)
    and new.from_asset_id is not null and not exists (
    select 1 from public.assets a
    where a.id = new.from_asset_id and a.user_id = new.user_id
      and a.kind in ('cash', 'pending_income') and a.archived_at is null
  ) then
    perform private.fail('Choose one of your cash accounts (or Upcoming Income) to move money from');
  end if;

  if (tg_op = 'INSERT' or new.to_asset_id is distinct from old.to_asset_id)
    and new.to_asset_id is not null and not exists (
    select 1 from public.assets a
    where a.id = new.to_asset_id and a.user_id = new.user_id
      and a.kind in ('cash', 'pending_income') and a.archived_at is null
  ) then
    perform private.fail('Choose one of your cash accounts (or Upcoming Income) to move money to');
  end if;

  -- New, re-scheduled or re-enabled rules start with the next occurrence instead of firing immediately.
  v_due := private.latest_due_period(new.day_of_month, private.local_date(new.user_id));
  if tg_op = 'INSERT' then
    new.last_run_period := v_due;
    new.last_error := null;
  elsif new.day_of_month <> old.day_of_month or (new.enabled and not old.enabled) then
    new.last_run_period := greatest(coalesce(old.last_run_period, v_due), v_due);
  end if;

  return new;
end;
$$;

create trigger automation_rules_guard before insert or update on public.automation_rules
  for each row execute function private.guard_automation_rule();

-- ---------------------------------------------------------------------------
-- Vault setup (idempotent; called by the app after every sign-in)
-- ---------------------------------------------------------------------------

create or replace function public.bootstrap_vault()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_email text;
begin
  select u.email into v_email from auth.users u where u.id = v_uid;

  insert into public.profiles (user_id, display_name)
  values (v_uid, left(coalesce(split_part(v_email, '@', 1), ''), 60))
  on conflict (user_id) do nothing;

  insert into public.pricing_settings (user_id) values (v_uid)
  on conflict (user_id) do nothing;

  insert into public.asset_groups (user_id, kind, name, color, sort_order) values
    (v_uid, 'cash', 'Cash', 'sky', 0),
    (v_uid, 'gold', 'Gold', 'butter', 1),
    (v_uid, 'stock', 'Stocks & ETFs', 'lavender', 2),
    (v_uid, 'other', 'Other', 'peach', 3)
  on conflict (user_id, kind) do nothing;

  perform set_config('aurafinance.allow_system_write', 'on', true);
  insert into public.assets (user_id, kind, name, currency, color, sort_order)
  select v_uid, 'pending_income', 'Upcoming Income', p.income_currency, 'slate', 0
  from public.profiles p
  where p.user_id = v_uid
    and not exists (select 1 from public.assets a where a.user_id = v_uid and a.kind = 'pending_income');
  perform set_config('aurafinance.allow_system_write', 'off', true);

  insert into public.goals (user_id, name, emoji, target_amount, target_unit, include_upcoming, sort_order, is_system)
  select v_uid, 'Zakat threshold', '🕌', 85, 'GOLD_24K_G', false, 0, true
  where not exists (select 1 from public.goals g where g.user_id = v_uid and g.is_system);

  insert into public.zakat_hawl (user_id) values (v_uid)
  on conflict (user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core transfer (shared by user transfers and automations)
-- ---------------------------------------------------------------------------

create or replace function private.do_transfer(
  p_user uuid,
  p_from uuid,
  p_to uuid,
  p_amount numeric,
  p_description text,
  p_kind text,
  p_rule uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_from public.assets%rowtype;
  v_to public.assets%rowtype;
  v_rate numeric;
  v_converted numeric;
  v_base text;
  v_tx uuid;
  v_pending_before numeric;
  v_pending_after numeric;
begin
  if p_amount is null or p_amount <= 0 then
    perform private.fail('Enter an amount greater than zero');
  end if;
  if p_amount > 1e13 then
    perform private.fail('That amount is too large');
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    perform private.fail('Choose two different accounts');
  end if;

  -- Lock both rows in a stable order to avoid deadlocks
  perform 1 from public.assets a
    where a.id in (p_from, p_to) and a.user_id = p_user
    order by a.id
    for update;

  select * into v_from from public.assets a where a.id = p_from and a.user_id = p_user;
  if not found then
    perform private.fail('The account to move money from was not found', 'P0002');
  end if;
  select * into v_to from public.assets a where a.id = p_to and a.user_id = p_user;
  if not found then
    perform private.fail('The account to move money to was not found', 'P0002');
  end if;

  if v_from.kind not in ('cash', 'pending_income') or v_to.kind not in ('cash', 'pending_income') then
    perform private.fail('Money can only move between cash accounts and Upcoming Income');
  end if;
  if v_from.archived_at is not null or v_to.archived_at is not null then
    perform private.fail('Archived accounts can''t send or receive money');
  end if;
  if v_from.balance < p_amount then
    perform private.fail(format('Not enough money in %s (available: %s %s)',
      v_from.name, trim_scale(v_from.balance), v_from.currency));
  end if;

  v_rate := private.fx(v_from.currency, v_to.currency);
  if v_rate is null then
    perform private.fail(format('No exchange rate is available between %s and %s yet', v_from.currency, v_to.currency));
  end if;
  v_converted := case when v_from.currency = v_to.currency then p_amount else round(p_amount * v_rate, 2) end;

  update public.assets set balance = balance - p_amount where id = v_from.id;
  update public.assets set balance = balance + v_converted where id = v_to.id;

  if v_from.kind = 'pending_income' then
    v_pending_before := v_from.balance;
    v_pending_after := v_from.balance - p_amount;
  elsif v_to.kind = 'pending_income' then
    v_pending_before := v_to.balance;
    v_pending_after := v_to.balance + v_converted;
  end if;

  select p.base_currency into v_base from public.profiles p where p.user_id = p_user;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name,
    converted_amount, converted_currency, fx_rate,
    pending_before, pending_after, automation_rule_id
  ) values (
    p_user, p_kind, left(coalesce(btrim(p_description), ''), 200), p_amount, v_from.currency,
    private.fx(v_from.currency, v_base), v_base,
    v_from.id, v_from.name, v_to.id, v_to.name,
    case when v_from.currency <> v_to.currency then v_converted end,
    case when v_from.currency <> v_to.currency then v_to.currency end,
    case when v_from.currency <> v_to.currency then v_rate end,
    v_pending_before, v_pending_after, p_rule
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta) values
    (v_tx, p_user, v_from.id, v_from.name, -p_amount),
    (v_tx, p_user, v_to.id, v_to.name, v_converted);

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- User-facing money functions
-- ---------------------------------------------------------------------------

create or replace function public.transfer_funds(
  p_from uuid,
  p_to uuid,
  p_amount numeric,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.do_transfer(private.require_uid(), p_from, p_to, p_amount, p_description, 'transfer', null);
end;
$$;

create or replace function public.log_income(
  p_amount numeric,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_pending public.assets%rowtype;
  v_base text;
  v_tx uuid;
begin
  if p_amount is null or p_amount <= 0 then
    perform private.fail('Enter an amount greater than zero');
  end if;
  if p_amount > 1e13 then
    perform private.fail('That amount is too large');
  end if;

  select * into v_pending from public.assets a
    where a.user_id = v_uid and a.kind = 'pending_income'
    for update;
  if not found then
    perform private.fail('Your vault isn''t set up yet. Reload the page and try again.', 'P0002');
  end if;

  update public.assets set balance = balance + p_amount where id = v_pending.id;
  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    to_asset_id, to_asset_name, pending_before, pending_after
  ) values (
    v_uid, 'income', left(coalesce(btrim(p_description), ''), 200), p_amount, v_pending.currency,
    private.fx(v_pending.currency, v_base), v_base,
    v_pending.id, v_pending.name, v_pending.balance, v_pending.balance + p_amount
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, v_uid, v_pending.id, v_pending.name, p_amount);

  return v_tx;
end;
$$;

-- Set a cash account (or Upcoming Income) to an exact balance; the difference is recorded as an adjustment.
create or replace function public.set_cash_balance(
  p_asset uuid,
  p_balance numeric,
  p_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_asset public.assets%rowtype;
  v_delta numeric;
  v_base text;
  v_tx uuid;
begin
  if p_balance is null or p_balance < 0 then
    perform private.fail('The balance can''t be negative');
  end if;
  if p_balance > 1e13 then
    perform private.fail('That amount is too large');
  end if;

  select * into v_asset from public.assets a
    where a.id = p_asset and a.user_id = v_uid
    for update;
  if not found then
    perform private.fail('Account not found', 'P0002');
  end if;
  if v_asset.kind not in ('cash', 'pending_income') then
    perform private.fail('Only cash accounts and Upcoming Income have a balance');
  end if;

  v_delta := p_balance - v_asset.balance;
  if v_delta = 0 then
    return null;
  end if;

  update public.assets set balance = p_balance where id = v_asset.id;
  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name, pending_before, pending_after
  ) values (
    v_uid, 'adjustment',
    left(coalesce(nullif(btrim(p_description), ''), 'Balance updated'), 200),
    abs(v_delta), v_asset.currency, private.fx(v_asset.currency, v_base), v_base,
    case when v_delta < 0 then v_asset.id end, case when v_delta < 0 then v_asset.name end,
    case when v_delta > 0 then v_asset.id end, case when v_delta > 0 then v_asset.name end,
    case when v_asset.kind = 'pending_income' then v_asset.balance end,
    case when v_asset.kind = 'pending_income' then p_balance end
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, v_uid, v_asset.id, v_asset.name, v_delta);

  return v_tx;
end;
$$;

-- Undo every entry after p_tx (newest first), restoring each balance they changed, then remove them.
create or replace function public.revert_to_transaction(p_tx uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_target public.transactions%rowtype;
  v_row record;
  v_balance numeric;
  v_count integer;
begin
  select * into v_target from public.transactions t where t.id = p_tx and t.user_id = v_uid;
  if not found then
    perform private.fail('That history entry was not found', 'P0002');
  end if;
  if v_target.is_imported then
    perform private.fail('Entries imported from the old version can''t be reverted to');
  end if;

  perform 1 from public.assets a where a.user_id = v_uid order by a.id for update;

  for v_row in
    select c.asset_id, max(c.asset_name) as asset_name, sum(c.delta) as total
    from public.transaction_changes c
    join public.transactions t on t.id = c.transaction_id
    where t.user_id = v_uid and t.seq > v_target.seq and c.asset_id is not null
    group by c.asset_id
  loop
    select a.balance into v_balance from public.assets a where a.id = v_row.asset_id;
    if v_balance - v_row.total < 0 then
      perform private.fail(format('Can''t revert: %s would go below zero', v_row.asset_name));
    end if;
    update public.assets set balance = balance - v_row.total where id = v_row.asset_id;
  end loop;

  delete from public.transactions t where t.user_id = v_uid and t.seq > v_target.seq;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.bootstrap_vault(),
  public.transfer_funds(uuid, uuid, numeric, text),
  public.log_income(numeric, text),
  public.set_cash_balance(uuid, numeric, text),
  public.revert_to_transaction(uuid)
from public, anon;

grant execute on function
  public.bootstrap_vault(),
  public.transfer_funds(uuid, uuid, numeric, text),
  public.log_income(numeric, text),
  public.set_cash_balance(uuid, numeric, text),
  public.revert_to_transaction(uuid)
to authenticated;
