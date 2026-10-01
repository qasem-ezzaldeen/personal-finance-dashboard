-- AuraFinance: buy and sell gold, stocks and other assets with money from your cash accounts.
--
-- A holding is its purchases minus its sales. Buying takes the money from a cash account and records
-- the purchase; selling adds the money to a cash account and records the sale. Deleting a purchase that
-- was paid from cash puts the money back. Every one of these is a history entry, so "revert to here"
-- undoes them exactly (including putting back purchases or sales that were removed afterwards).

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------

alter table public.transactions drop constraint transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('income', 'transfer', 'automation', 'adjustment', 'imported', 'buy', 'sell', 'refund', 'sale_removed'));

-- What was bought or sold ({ quantity, asset_kind }) and, for removals, the row to put back on revert
alter table public.transactions add column details jsonb;

-- ---------------------------------------------------------------------------
-- Purchases paid from a cash account
-- ---------------------------------------------------------------------------

alter table public.asset_purchases
  add column paid_from_asset_id uuid references public.assets (id) on delete set null,
  -- What was taken from that account (the price paid can be edited later without touching cash)
  add column paid_amount numeric check (paid_amount > 0),
  add column paid_currency public.currency_code,
  -- The "buy" history entry; reverting it removes the purchase
  add column transaction_id uuid references public.transactions (id) on delete cascade,
  add constraint asset_purchases_paid_pair check ((paid_amount is null) = (paid_currency is null));

create index asset_purchases_tx_idx on public.asset_purchases (transaction_id) where transaction_id is not null;

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------

create table public.asset_sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset_id uuid not null references public.assets (id) on delete cascade,
  quantity numeric not null check (quantity > 0),
  proceeds numeric not null check (proceeds >= 0),
  proceeds_currency public.currency_code not null,
  sold_on date not null,
  to_asset_id uuid references public.assets (id) on delete set null,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  note text not null default '' check (char_length(note) <= 280),
  created_at timestamptz not null default now()
);

create index asset_sales_asset_idx on public.asset_sales (asset_id);
create index asset_sales_user_idx on public.asset_sales (user_id);
create index asset_sales_tx_idx on public.asset_sales (transaction_id);

alter table public.asset_sales enable row level security;
create policy "own rows: select" on public.asset_sales
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.asset_sales from anon, authenticated;
grant select on public.asset_sales to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.asset_sales;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Grams / shares / units currently held
create or replace function private.holding(p_asset uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((select sum(p.quantity) from public.asset_purchases p where p.asset_id = p_asset), 0)
       - coalesce((select sum(s.quantity) from public.asset_sales s where s.asset_id = p_asset), 0);
$$;

create or replace function private.check_amounts(p_quantity numeric, p_amount numeric)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_quantity is null or p_quantity <= 0 then
    perform private.fail('Enter an amount greater than zero');
  end if;
  if p_amount is null or p_amount <= 0 then
    perform private.fail('Enter the price, greater than zero');
  end if;
  if p_quantity > 1e12 or p_amount > 1e13 then
    perform private.fail('That amount is too large');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Buy
-- ---------------------------------------------------------------------------

create or replace function public.buy_asset(
  p_asset uuid,
  p_from uuid,
  p_quantity numeric,
  p_amount numeric,
  p_acquired_on date default null,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_today date := private.local_date(v_uid);
  v_date date := coalesce(p_acquired_on, v_today);
  v_asset public.assets%rowtype;
  v_cash public.assets%rowtype;
  v_base text;
  v_tx uuid;
begin
  perform private.check_amounts(p_quantity, p_amount);
  if v_date > v_today then
    perform private.fail('The date can''t be in the future');
  end if;

  perform 1 from public.assets a where a.id in (p_asset, p_from) and a.user_id = v_uid order by a.id for update;

  select * into v_asset from public.assets a where a.id = p_asset and a.user_id = v_uid;
  if not found then
    perform private.fail('Asset not found', 'P0002');
  end if;
  if v_asset.kind not in ('gold', 'stock', 'other') then
    perform private.fail('Only gold, stocks and other assets can be bought');
  end if;
  if v_asset.archived_at is not null then
    perform private.fail('Archived assets can''t be bought');
  end if;

  select * into v_cash from public.assets a where a.id = p_from and a.user_id = v_uid;
  if not found then
    perform private.fail('The account to pay from was not found', 'P0002');
  end if;
  if v_cash.kind <> 'cash' then
    perform private.fail('Pay from one of your cash accounts');
  end if;
  if v_cash.archived_at is not null then
    perform private.fail('Archived accounts can''t send money');
  end if;
  if v_cash.balance < p_amount then
    perform private.fail(format('Not enough money in %s (available: %s %s)',
      v_cash.name, trim_scale(v_cash.balance), v_cash.currency));
  end if;

  update public.assets set balance = balance - p_amount where id = v_cash.id;
  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name, details
  ) values (
    v_uid, 'buy', left(coalesce(btrim(p_note), ''), 200), p_amount, v_cash.currency,
    private.fx(v_cash.currency, v_base), v_base,
    v_cash.id, v_cash.name, v_asset.id, v_asset.name,
    jsonb_build_object('quantity', p_quantity, 'asset_kind', v_asset.kind)
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, v_uid, v_cash.id, v_cash.name, -p_amount);

  insert into public.asset_purchases (
    user_id, asset_id, quantity, cost_total, cost_currency, acquired_on, note,
    paid_from_asset_id, paid_amount, paid_currency, transaction_id
  ) values (
    v_uid, v_asset.id, p_quantity, p_amount, v_cash.currency, v_date, left(coalesce(btrim(p_note), ''), 280),
    v_cash.id, p_amount, v_cash.currency, v_tx
  );

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sell
-- ---------------------------------------------------------------------------

create or replace function public.sell_asset(
  p_asset uuid,
  p_to uuid,
  p_quantity numeric,
  p_amount numeric,
  p_sold_on date default null,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_today date := private.local_date(v_uid);
  v_date date := coalesce(p_sold_on, v_today);
  v_asset public.assets%rowtype;
  v_cash public.assets%rowtype;
  v_held numeric;
  v_base text;
  v_tx uuid;
begin
  perform private.check_amounts(p_quantity, p_amount);
  if v_date > v_today then
    perform private.fail('The date can''t be in the future');
  end if;

  perform 1 from public.assets a where a.id in (p_asset, p_to) and a.user_id = v_uid order by a.id for update;

  select * into v_asset from public.assets a where a.id = p_asset and a.user_id = v_uid;
  if not found then
    perform private.fail('Asset not found', 'P0002');
  end if;
  if v_asset.kind not in ('gold', 'stock', 'other') then
    perform private.fail('Only gold, stocks and other assets can be sold');
  end if;

  v_held := private.holding(v_asset.id);
  if p_quantity > v_held + 1e-9 then
    perform private.fail(format('You only have %s of %s', trim_scale(v_held), v_asset.name));
  end if;

  select * into v_cash from public.assets a where a.id = p_to and a.user_id = v_uid;
  if not found then
    perform private.fail('The account to receive the money was not found', 'P0002');
  end if;
  if v_cash.kind <> 'cash' then
    perform private.fail('Choose one of your cash accounts to receive the money');
  end if;
  if v_cash.archived_at is not null then
    perform private.fail('Archived accounts can''t receive money');
  end if;

  update public.assets set balance = balance + p_amount where id = v_cash.id;
  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name, details
  ) values (
    v_uid, 'sell', left(coalesce(btrim(p_note), ''), 200), p_amount, v_cash.currency,
    private.fx(v_cash.currency, v_base), v_base,
    v_asset.id, v_asset.name, v_cash.id, v_cash.name,
    jsonb_build_object('quantity', p_quantity, 'asset_kind', v_asset.kind)
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, v_uid, v_cash.id, v_cash.name, p_amount);

  insert into public.asset_sales (user_id, asset_id, quantity, proceeds, proceeds_currency, sold_on, to_asset_id, transaction_id, note)
  values (v_uid, v_asset.id, p_quantity, p_amount, v_cash.currency, v_date, v_cash.id, v_tx, left(coalesce(btrim(p_note), ''), 280));

  return v_tx;
end;
$$;

-- Remove a sale: the money it brought in leaves the cash account again and the holding comes back.
create or replace function public.delete_sale(p_sale uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_sale public.asset_sales%rowtype;
  v_asset_name text;
  v_cash public.assets%rowtype;
  v_amount numeric;
  v_rate numeric;
  v_base text;
  v_tx uuid;
begin
  select * into v_sale from public.asset_sales s where s.id = p_sale and s.user_id = v_uid for update;
  if not found then
    perform private.fail('That sale was not found', 'P0002');
  end if;
  select a.name into v_asset_name from public.assets a where a.id = v_sale.asset_id;

  select * into v_cash from public.assets a where a.id = v_sale.to_asset_id for update;
  if found then
    if v_cash.archived_at is not null then
      perform private.fail(format('Unarchive %s first so the money can be taken back out of it', v_cash.name));
    end if;
    v_amount := v_sale.proceeds;
    if v_cash.currency <> v_sale.proceeds_currency then
      v_rate := private.fx(v_sale.proceeds_currency, v_cash.currency);
      if v_rate is null then
        perform private.fail(format('No exchange rate is available between %s and %s yet', v_sale.proceeds_currency, v_cash.currency));
      end if;
      v_amount := round(v_amount * v_rate, 2);
    end if;
    if v_cash.balance < v_amount then
      perform private.fail(format('%s only has %s %s; the money from this sale has already been moved',
        v_cash.name, trim_scale(v_cash.balance), v_cash.currency));
    end if;
    update public.assets set balance = balance - v_amount where id = v_cash.id;
  end if;

  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;
  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name, details
  ) values (
    v_uid, 'sale_removed', 'Sale removed', coalesce(v_amount, 0), coalesce(v_cash.currency, v_sale.proceeds_currency),
    private.fx(coalesce(v_cash.currency, v_sale.proceeds_currency), v_base), v_base,
    v_cash.id, v_cash.name, v_sale.asset_id, v_asset_name,
    jsonb_build_object(
      'quantity', v_sale.quantity,
      'restore', jsonb_build_object('table', 'asset_sales', 'source_tx', v_sale.transaction_id, 'row', to_jsonb(v_sale))
    )
  )
  returning id into v_tx;

  if v_amount is not null then
    insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
    values (v_tx, v_uid, v_cash.id, v_cash.name, -v_amount);
  end if;

  delete from public.asset_sales where id = v_sale.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deleting a purchase paid from cash puts the money back (directly, or by deleting the asset)
-- ---------------------------------------------------------------------------

create or replace function private.refund_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cash public.assets%rowtype;
  v_asset public.assets%rowtype;
  v_amount numeric;
  v_rate numeric;
  v_base text;
  v_tx uuid;
begin
  -- Reverting history removes the purchase together with the payment; nothing to give back
  if old.paid_from_asset_id is null or old.paid_amount is null
    or current_setting('aurafinance.reverting', true) = 'on' then
    return old;
  end if;

  select * into v_cash from public.assets a where a.id = old.paid_from_asset_id for update;
  if not found then
    return old;
  end if;
  if v_cash.archived_at is not null then
    perform private.fail(format('Unarchive %s first so the money can go back to it', v_cash.name));
  end if;

  v_amount := old.paid_amount;
  if v_cash.currency <> old.paid_currency then
    v_rate := private.fx(old.paid_currency, v_cash.currency);
    if v_rate is null then
      perform private.fail(format('No exchange rate is available between %s and %s yet', old.paid_currency, v_cash.currency));
    end if;
    v_amount := round(v_amount * v_rate, 2);
  end if;

  update public.assets set balance = balance + v_amount where id = v_cash.id;
  select * into v_asset from public.assets a where a.id = old.asset_id;
  select p.base_currency into v_base from public.profiles p where p.user_id = old.user_id;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name, details
  ) values (
    old.user_id, 'refund', 'Purchase deleted', v_amount, v_cash.currency,
    private.fx(v_cash.currency, v_base), v_base,
    v_asset.id, v_asset.name, v_cash.id, v_cash.name,
    jsonb_build_object(
      'quantity', old.quantity,
      'asset_kind', v_asset.kind,
      'restore', jsonb_build_object('table', 'asset_purchases', 'source_tx', old.transaction_id, 'row', to_jsonb(old))
    )
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, old.user_id, v_cash.id, v_cash.name, v_amount);

  return old;
end;
$$;

create trigger asset_purchases_refund before delete on public.asset_purchases
  for each row execute function private.refund_purchase();

-- A holding can't go below zero: purchases that were partly sold can't be removed or shrunk past the sales
create or replace function private.check_holding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset uuid := coalesce(new.asset_id, old.asset_id);
begin
  if current_setting('aurafinance.reverting', true) = 'on'
    or current_setting('aurafinance.deleting_asset', true) = v_asset::text
    or not exists (select 1 from public.assets a where a.id = v_asset) then
    return null;
  end if;
  if private.holding(v_asset) < -1e-9 then
    perform private.fail('Part of this has been sold. Remove the sale first, or keep at least what was sold.');
  end if;
  return null;
end;
$$;

create trigger asset_purchases_holding after update or delete on public.asset_purchases
  for each row execute function private.check_holding();

-- Same as before; deleting a gold/stock/other asset first gives back what its cash purchases cost
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
    if old.kind in ('gold', 'stock', 'other') then
      perform set_config('aurafinance.deleting_asset', old.id::text, true);
      delete from public.asset_purchases p where p.asset_id = old.id and p.paid_from_asset_id is not null;
      perform set_config('aurafinance.deleting_asset', '', true);
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

-- ---------------------------------------------------------------------------
-- Revert: also puts back purchases and sales that were removed after the chosen entry
-- ---------------------------------------------------------------------------

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
  v_restore jsonb;
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
  perform set_config('aurafinance.reverting', 'on', true);

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

  -- A purchase deleted (or sale removed) after the target comes back if the entry that created it stays
  for v_row in
    select t.details from public.transactions t
    where t.user_id = v_uid and t.seq > v_target.seq and t.kind in ('refund', 'sale_removed') and t.details ? 'restore'
    order by t.seq desc
  loop
    v_restore := v_row.details -> 'restore';
    if exists (
        select 1 from public.transactions s
        where s.id = (v_restore ->> 'source_tx')::uuid and s.user_id = v_uid and s.seq <= v_target.seq)
      and exists (select 1 from public.assets a where a.id = (v_restore #>> '{row,asset_id}')::uuid and a.user_id = v_uid) then
      if v_restore ->> 'table' = 'asset_purchases' then
        insert into public.asset_purchases
          select * from jsonb_populate_record(null::public.asset_purchases, v_restore -> 'row')
        on conflict (id) do nothing;
      elsif v_restore ->> 'table' = 'asset_sales' then
        insert into public.asset_sales
          select * from jsonb_populate_record(null::public.asset_sales, v_restore -> 'row')
        on conflict (id) do nothing;
      end if;
    end if;
  end loop;

  delete from public.transactions t where t.user_id = v_uid and t.seq > v_target.seq;
  get diagnostics v_count = row_count;
  perform set_config('aurafinance.reverting', 'off', true);
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Server-side valuation: holdings are purchases minus sales (and no default gold premium)
-- ---------------------------------------------------------------------------

create or replace function private.user_valuation(p_user uuid)
returns table (
  currency text,
  net_worth numeric,
  zakatable_wealth numeric,
  gold_24k_price numeric,
  complete boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_pricing public.pricing_settings%rowtype;
  v_base text;
  v_xau numeric;
  v_p24 numeric;
  v_adj21 numeric;
  v_adj24 numeric;
  v_total numeric := 0;
  v_zakatable numeric := 0;
  v_complete boolean := true;
  v_value numeric;
  v_price numeric;
  v_price_currency text;
  r record;
begin
  select * into v_profile from public.profiles p where p.user_id = p_user;
  if not found then
    return;
  end if;
  select * into v_pricing from public.pricing_settings s where s.user_id = p_user;
  v_base := v_profile.base_currency;

  if v_pricing.gold_mode = 'manual' then
    v_p24 := v_pricing.manual_gold_24k_price * private.fx(v_pricing.manual_gold_currency, v_base);
  else
    select m.price into v_xau from public.market_prices m where m.symbol = 'METAL:XAU';
    v_p24 := v_xau / 31.1034768 * private.fx('USD', v_base) * (1 + coalesce(v_pricing.gold_premium_pct, 0) / 100);
  end if;
  v_adj21 := coalesce(v_pricing.gold_21k_adjustment, -30) * private.fx(coalesce(v_pricing.gold_adjustment_currency, 'EGP'), v_base);
  v_adj24 := coalesce(v_pricing.gold_24k_adjustment, 30) * private.fx(coalesce(v_pricing.gold_adjustment_currency, 'EGP'), v_base);

  for r in
    select a.*, private.holding(a.id) as qty
    from public.assets a
    where a.user_id = p_user and a.archived_at is null
  loop
    v_value := null;

    if r.kind in ('cash', 'pending_income') then
      v_value := r.balance * private.fx(r.currency, v_base);
    elsif r.qty <= 0 then
      v_value := 0;
    elsif r.kind = 'gold' then
      v_value := r.qty * greatest(0,
        case when r.karat = 24 then v_p24 + v_adj24 else v_p24 * 0.875 + v_adj21 end);
    elsif r.kind = 'stock' then
      v_price := null;
      v_price_currency := null;
      select o.price, o.currency into v_price, v_price_currency
        from public.price_overrides o where o.user_id = p_user and o.ticker = r.ticker;
      if v_price is null then
        select m.price, m.currency into v_price, v_price_currency
          from public.market_prices m where m.symbol = 'STOCK:' || r.ticker;
      end if;
      v_value := r.qty * v_price * private.fx(v_price_currency, v_base);
    elsif r.kind = 'other' then
      v_value := r.qty * r.manual_unit_price * private.fx(r.currency, v_base);
    end if;

    if v_value is null then
      v_complete := false;
      continue;
    end if;

    v_total := v_total + v_value;
    if r.kind <> 'pending_income' then
      v_zakatable := v_zakatable + v_value;
    end if;
  end loop;

  return query select v_base, v_total, v_zakatable, v_p24, (v_complete and v_p24 is not null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function
  public.buy_asset(uuid, uuid, numeric, numeric, date, text),
  public.sell_asset(uuid, uuid, numeric, numeric, date, text),
  public.delete_sale(uuid)
from public, anon;

grant execute on function
  public.buy_asset(uuid, uuid, numeric, numeric, date, text),
  public.sell_asset(uuid, uuid, numeric, numeric, date, text),
  public.delete_sale(uuid)
to authenticated;
