-- AuraFinance: server-side valuation (mirrors src/lib/valuation.ts), daily Zakat Hawl check
-- and monthly automation runner.

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
    v_p24 := v_xau / 31.1034768 * private.fx('USD', v_base) * (1 + coalesce(v_pricing.gold_premium_pct, 2.5) / 100);
  end if;
  v_adj21 := coalesce(v_pricing.gold_21k_adjustment, -30) * private.fx(coalesce(v_pricing.gold_adjustment_currency, 'EGP'), v_base);
  v_adj24 := coalesce(v_pricing.gold_24k_adjustment, 30) * private.fx(coalesce(v_pricing.gold_adjustment_currency, 'EGP'), v_base);

  for r in
    select a.*,
      coalesce((select sum(p.quantity) from public.asset_purchases p where p.asset_id = a.id), 0) as qty
    from public.assets a
    where a.user_id = p_user and a.archived_at is null
  loop
    v_value := null;

    if r.kind in ('cash', 'pending_income') then
      v_value := r.balance * private.fx(r.currency, v_base);
    elsif r.qty = 0 then
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
-- Zakat: once per user per local day, record wealth and update the Hawl
-- ---------------------------------------------------------------------------

create or replace function private.run_zakat_daily(p_only_user uuid default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_local date;
  v_hawl public.zakat_hawl%rowtype;
  v_val record;
  v_above boolean;
  v_processed integer := 0;
begin
  for r in
    select p.user_id, p.timezone from public.profiles p
    where p.zakat_enabled and (p_only_user is null or p.user_id = p_only_user)
  loop
    begin
      v_local := (now() at time zone r.timezone)::date;

      select * into v_hawl from public.zakat_hawl h where h.user_id = r.user_id for update;
      if not found then
        insert into public.zakat_hawl (user_id) values (r.user_id) returning * into v_hawl;
      end if;
      if v_hawl.last_checked_on is not null and v_hawl.last_checked_on >= v_local then
        continue;
      end if;

      select * into v_val from private.user_valuation(r.user_id);
      if v_val.gold_24k_price is null or v_val.gold_24k_price <= 0 or not v_val.complete then
        continue;
      end if;

      v_above := v_val.zakatable_wealth / v_val.gold_24k_price >= 85;

      insert into public.daily_snapshots (user_id, snapshot_date, currency, net_worth, zakatable_wealth, gold_24k_price, above_nisab)
      values (r.user_id, v_local, v_val.currency, v_val.net_worth, v_val.zakatable_wealth, v_val.gold_24k_price, v_above)
      on conflict (user_id, snapshot_date) do update set
        currency = excluded.currency,
        net_worth = excluded.net_worth,
        zakatable_wealth = excluded.zakatable_wealth,
        gold_24k_price = excluded.gold_24k_price,
        above_nisab = excluded.above_nisab;

      if v_above and v_hawl.hawl_start_date is null then
        update public.zakat_hawl set
          hawl_start_date = v_local,
          start_wealth = round(v_val.zakatable_wealth, 2),
          start_wealth_currency = v_val.currency,
          is_first_hawl = false,
          last_checked_on = v_local
        where user_id = r.user_id;
      elsif not v_above then
        update public.zakat_hawl set
          hawl_start_date = null,
          start_wealth = null,
          start_wealth_currency = null,
          is_first_hawl = false,
          last_checked_on = v_local
        where user_id = r.user_id;
      else
        update public.zakat_hawl set last_checked_on = v_local where user_id = r.user_id;
      end if;

      v_processed := v_processed + 1;
    exception when others then
      raise warning 'Zakat check failed for %: %', r.user_id, sqlerrm;
    end;
  end loop;
  return v_processed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Automations: run each enabled rule at most once per due month, catching up missed runs
-- ---------------------------------------------------------------------------

create or replace function private.run_due_automations(p_only_user uuid default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_due text;
  v_balance numeric;
  v_amount numeric;
  v_ran integer := 0;
begin
  for r in
    select ar.*, p.timezone
    from public.automation_rules ar
    join public.profiles p on p.user_id = ar.user_id
    where ar.enabled and (p_only_user is null or ar.user_id = p_only_user)
    order by ar.day_of_month, ar.created_at
  loop
    v_due := private.latest_due_period(r.day_of_month, (now() at time zone r.timezone)::date);
    if r.last_run_period is not null and r.last_run_period >= v_due then
      continue;
    end if;

    perform set_config('aurafinance.allow_system_write', 'on', true);
    begin
      if r.from_asset_id is null or r.to_asset_id is null then
        perform private.fail('Choose both accounts for this rule');
      end if;

      select a.balance into v_balance from public.assets a where a.id = r.from_asset_id;
      v_amount := case when r.amount_mode = 'all' then v_balance else r.fixed_amount end;

      if v_amount > 0 then
        perform private.do_transfer(r.user_id, r.from_asset_id, r.to_asset_id, v_amount, r.name, 'automation', r.id);
        v_ran := v_ran + 1;
      end if;

      update public.automation_rules
        set last_run_period = v_due, last_run_at = now(), last_error = null
        where id = r.id;
    exception when others then
      update public.automation_rules
        set last_run_period = v_due, last_run_at = now(), last_error = left(sqlerrm, 300)
        where id = r.id;
    end;
    perform set_config('aurafinance.allow_system_write', 'off', true);
  end loop;
  return v_ran;
end;
$$;

-- Safety net: the app calls this on load so automations and the Zakat check never depend
-- solely on the scheduler being configured.
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
end;
$$;

-- ---------------------------------------------------------------------------
-- Zakat payments
-- ---------------------------------------------------------------------------

create or replace function public.mark_zakat_paid(
  p_amount numeric,
  p_currency text,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_hawl public.zakat_hawl%rowtype;
  v_val record;
  v_local date := private.local_date(v_uid);
  v_above boolean;
begin
  if p_amount is null or p_amount < 0 then
    perform private.fail('Enter the amount you paid');
  end if;
  if p_currency !~ '^[A-Z]{3}$' then
    perform private.fail('Unknown currency');
  end if;

  select * into v_hawl from public.zakat_hawl h where h.user_id = v_uid for update;

  insert into public.zakat_payments (user_id, paid_on, amount, currency, hawl_start_date, note)
  values (v_uid, v_local, p_amount, p_currency, v_hawl.hawl_start_date, left(coalesce(p_note, ''), 280));

  select * into v_val from private.user_valuation(v_uid);
  v_above := v_val.gold_24k_price > 0 and v_val.zakatable_wealth / v_val.gold_24k_price >= 85;

  -- The next Hawl starts today with today's wealth; it's no longer the first year
  update public.zakat_hawl set
    hawl_start_date = case when v_above then v_local end,
    start_wealth = case when v_above then round(v_val.zakatable_wealth, 2) end,
    start_wealth_currency = case when v_above then v_val.currency end,
    is_first_hawl = false,
    last_checked_on = v_local
  where user_id = v_uid;
end;
$$;

revoke all on function public.run_scheduled_tasks_for_me(), public.mark_zakat_paid(numeric, text, text)
  from public, anon;
grant execute on function public.run_scheduled_tasks_for_me(), public.mark_zakat_paid(numeric, text, text)
  to authenticated;
