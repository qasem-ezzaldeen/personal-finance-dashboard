-- AuraFinance: stock dividends (yield, frequency, auto-reinvest / cash payout to source)
-- and stock investing fees (percentage + minimum USD fee).

-- ---------------------------------------------------------------------------
-- 1. Schema additions
-- ---------------------------------------------------------------------------

alter table public.pricing_settings
  add column if not exists stock_fee_pct numeric not null default 0.2
    check (stock_fee_pct between 0 and 100),
  add column if not exists stock_fee_min_usd numeric not null default 0.02
    check (stock_fee_min_usd >= 0 and stock_fee_min_usd <= 10000);

grant update (stock_fee_pct, stock_fee_min_usd) on public.pricing_settings to authenticated;

alter table public.assets
  add column if not exists auto_reinvest_dividends boolean not null default false,
  add column if not exists last_dividend_processed_date date;

grant insert (auto_reinvest_dividends) on public.assets to authenticated;
grant update (auto_reinvest_dividends) on public.assets to authenticated;

alter table public.market_prices
  add column if not exists dividend_amount numeric check (dividend_amount >= 0),
  add column if not exists dividend_annual numeric check (dividend_annual >= 0),
  add column if not exists dividend_frequency text
    check (dividend_frequency in ('monthly', 'quarterly', 'semi_annual', 'annual', 'irregular', 'none')),
  add column if not exists last_dividend_date date;

alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in (
    'income', 'transfer', 'automation', 'adjustment', 'imported',
    'buy', 'sell', 'refund', 'sale_removed', 'dividend'
  ));

-- ---------------------------------------------------------------------------
-- 2. Fee calculation helper
-- ---------------------------------------------------------------------------

create or replace function private.calc_stock_fee(p_user uuid, p_amount numeric, p_currency text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pct numeric;
  v_min_usd numeric;
  v_pct_fee numeric;
  v_min_fee numeric;
  v_fx numeric;
begin
  if p_amount is null or p_amount <= 0 then
    return 0;
  end if;

  select ps.stock_fee_pct, ps.stock_fee_min_usd
    into v_pct, v_min_usd
    from public.pricing_settings ps
   where ps.user_id = p_user;

  v_pct := coalesce(v_pct, 0.2);
  v_min_usd := coalesce(v_min_usd, 0.02);

  if v_pct = 0 and v_min_usd = 0 then
    return 0;
  end if;

  v_pct_fee := round(p_amount * v_pct / 100.0, 2);
  if p_currency = 'USD' or v_min_usd = 0 then
    v_min_fee := round(v_min_usd, 2);
  else
    v_fx := private.fx('USD', p_currency);
    v_min_fee := case when v_fx is null then 0 else round(v_min_usd * v_fx, 2) end;
  end if;

  return greatest(v_pct_fee, v_min_fee);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Buy & Sell with stock investing fees
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
  v_fee numeric := 0;
  v_net numeric;
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

  if v_asset.kind = 'stock' then
    v_fee := private.calc_stock_fee(v_uid, p_amount, v_cash.currency);
    if v_fee >= p_amount then
      perform private.fail(format('Amount must be greater than the investing fee (%s %s)',
        trim_scale(v_fee), v_cash.currency));
    end if;
  end if;
  v_net := p_amount - v_fee;

  update public.assets set balance = balance - p_amount where id = v_cash.id;
  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name, details
  ) values (
    v_uid, 'buy', left(coalesce(btrim(p_note), ''), 200), p_amount, v_cash.currency,
    private.fx(v_cash.currency, v_base), v_base,
    v_cash.id, v_cash.name, v_asset.id, v_asset.name,
    jsonb_strip_nulls(jsonb_build_object(
      'quantity', p_quantity,
      'asset_kind', v_asset.kind,
      'fee', case when v_fee > 0 then v_fee else null end,
      'fee_currency', case when v_fee > 0 then v_cash.currency else null end,
      'net_amount', case when v_fee > 0 then v_net else null end
    ))
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, v_uid, v_cash.id, v_cash.name, -p_amount);

  insert into public.asset_purchases (
    user_id, asset_id, quantity, cost_total, cost_currency, acquired_on, note,
    paid_from_asset_id, paid_amount, paid_currency, transaction_id
  ) values (
    v_uid, v_asset.id, p_quantity, v_net, v_cash.currency, v_date, left(coalesce(btrim(p_note), ''), 280),
    v_cash.id, p_amount, v_cash.currency, v_tx
  );

  return v_tx;
end;
$$;

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
  v_fee numeric := 0;
  v_net numeric;
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

  if v_asset.kind = 'stock' then
    v_fee := private.calc_stock_fee(v_uid, p_amount, v_cash.currency);
    if v_fee >= p_amount then
      perform private.fail(format('Sale amount must be greater than the investing fee (%s %s)',
        trim_scale(v_fee), v_cash.currency));
    end if;
  end if;
  v_net := p_amount - v_fee;

  update public.assets set balance = balance + v_net where id = v_cash.id;
  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name, details
  ) values (
    v_uid, 'sell', left(coalesce(btrim(p_note), ''), 200), v_net, v_cash.currency,
    private.fx(v_cash.currency, v_base), v_base,
    v_asset.id, v_asset.name, v_cash.id, v_cash.name,
    jsonb_strip_nulls(jsonb_build_object(
      'quantity', p_quantity,
      'asset_kind', v_asset.kind,
      'gross_amount', case when v_fee > 0 then p_amount else null end,
      'fee', case when v_fee > 0 then v_fee else null end,
      'fee_currency', case when v_fee > 0 then v_cash.currency else null end
    ))
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, v_uid, v_cash.id, v_cash.name, v_net);

  insert into public.asset_sales (
    user_id, asset_id, quantity, proceeds, proceeds_currency, sold_on, to_asset_id, transaction_id, note
  ) values (
    v_uid, v_asset.id, p_quantity, v_net, v_cash.currency, v_date, v_cash.id, v_tx,
    left(coalesce(btrim(p_note), ''), 280)
  );

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Automatic dividend payouts & DRIP reinvestment
-- ---------------------------------------------------------------------------

create or replace function private.process_due_dividends(p_only_user uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_held numeric;
  v_earliest date;
  v_gross numeric;
  v_fee numeric;
  v_net numeric;
  v_shares numeric;
  v_target public.assets%rowtype;
  v_payout numeric;
  v_fx numeric;
  v_base text;
  v_tx uuid;
begin
  for r in
    select a.*, mp.price as stock_price, mp.currency as stock_currency,
           mp.dividend_amount, mp.last_dividend_date
      from public.assets a
      join public.market_prices mp on mp.symbol = 'STOCK:' || a.ticker
     where a.kind = 'stock'
       and a.archived_at is null
       and a.ticker is not null
       and mp.last_dividend_date is not null
       and mp.dividend_amount is not null
       and mp.dividend_amount > 0
       and mp.last_dividend_date > coalesce(a.last_dividend_processed_date, date '1900-01-01')
       and (p_only_user is null or a.user_id = p_only_user)
     for update of a skip locked
  loop
    select min(p.acquired_on) into v_earliest
      from public.asset_purchases p
     where p.asset_id = r.id;

    v_held := private.holding(r.id);

    -- Skip if user holds nothing or the dividend date predates their earliest purchase
    if v_held <= 1e-9 or v_earliest is null or r.last_dividend_date < v_earliest then
      update public.assets set last_dividend_processed_date = r.last_dividend_date where id = r.id;
      continue;
    end if;

    v_gross := round(v_held * r.dividend_amount, 2);
    if v_gross <= 0 then
      update public.assets set last_dividend_processed_date = r.last_dividend_date where id = r.id;
      continue;
    end if;

    select p.base_currency into v_base from public.profiles p where p.user_id = r.user_id;

    if r.auto_reinvest_dividends then
      v_fee := private.calc_stock_fee(r.user_id, v_gross, r.stock_currency);
      v_net := v_gross - v_fee;
      if v_net > 0 and r.stock_price > 0 then
        v_shares := round(v_net / r.stock_price, 8);
        if v_shares > 0 then
          insert into public.transactions (
            user_id, kind, description, amount, currency, rate_to_base, base_currency,
            from_asset_id, from_asset_name, to_asset_id, to_asset_name, details
          ) values (
            r.user_id, 'dividend', 'Dividend reinvested', v_net, r.stock_currency,
            private.fx(r.stock_currency, v_base), v_base,
            r.id, r.name, r.id, r.name,
            jsonb_build_object(
              'reinvested', true,
              'quantity', v_shares,
              'asset_kind', 'stock',
              'gross_amount', v_gross,
              'fee', v_fee,
              'fee_currency', r.stock_currency,
              'per_share', r.dividend_amount,
              'dividend_date', r.last_dividend_date
            )
          )
          returning id into v_tx;

          insert into public.asset_purchases (
            user_id, asset_id, quantity, cost_total, cost_currency, acquired_on, note, transaction_id
          ) values (
            r.user_id, r.id, v_shares, v_net, r.stock_currency, r.last_dividend_date, 'Dividend reinvested', v_tx
          );
        end if;
      end if;
    else
      -- Pay out to the most recent cash account this stock was bought from; fall back to Upcoming Income
      select ca.* into v_target
        from public.asset_purchases p
        join public.assets ca on ca.id = p.paid_from_asset_id
       where p.asset_id = r.id
         and ca.kind = 'cash'
         and ca.archived_at is null
       order by p.acquired_on desc, p.created_at desc
       limit 1
         for update of ca;

      if not found then
        select ca.* into v_target
          from public.assets ca
         where ca.user_id = r.user_id and ca.kind = 'pending_income'
         limit 1
           for update of ca;
      end if;

      if found then
        if v_target.currency = r.stock_currency then
          v_payout := v_gross;
        else
          v_fx := private.fx(r.stock_currency, v_target.currency);
          if v_fx is null then
            continue;
          end if;
          v_payout := round(v_gross * v_fx, 2);
        end if;

        if v_payout > 0 then
          update public.assets set balance = balance + v_payout where id = v_target.id;

          insert into public.transactions (
            user_id, kind, description, amount, currency, rate_to_base, base_currency,
            from_asset_id, from_asset_name, to_asset_id, to_asset_name,
            pending_before, pending_after, details
          ) values (
            r.user_id, 'dividend', 'Dividend payout', v_payout, v_target.currency,
            private.fx(v_target.currency, v_base), v_base,
            r.id, r.name, v_target.id, v_target.name,
            case when v_target.kind = 'pending_income' then v_target.balance else null end,
            case when v_target.kind = 'pending_income' then v_target.balance + v_payout else null end,
            jsonb_build_object(
              'reinvested', false,
              'asset_kind', 'stock',
              'per_share', r.dividend_amount,
              'dividend_date', r.last_dividend_date
            )
          )
          returning id into v_tx;

          insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
          values (v_tx, r.user_id, v_target.id, v_target.name, v_payout);
        end if;
      end if;
    end if;

    update public.assets set last_dividend_processed_date = r.last_dividend_date where id = r.id;
  end loop;
end;
$$;

create or replace function public.run_scheduled_tasks_for_me()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
begin
  perform private.run_due_automations(v_uid);
  perform private.run_zakat_daily(v_uid);
  perform private.process_due_dividends(v_uid);
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('aurafinance-dividends', '35 * * * *', $cron$select private.process_due_dividends()$cron$);
  end if;
end;
$$;
