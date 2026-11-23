-- AuraFinance: fixes for database/trigger bugs found during deep audit.

-- ---------------------------------------------------------------------------
-- 1. Guard numeric columns against NaN and Infinity (#9)
-- ---------------------------------------------------------------------------
-- In PostgreSQL, NaN > 0 evaluates to true, but NaN < 1e15 evaluates to false.

alter table public.assets
  drop constraint if exists assets_manual_unit_price_finite,
  add constraint assets_manual_unit_price_finite
    check (manual_unit_price is null or (manual_unit_price >= 0 and manual_unit_price < 1e15)),
  drop constraint if exists assets_balance_finite,
  add constraint assets_balance_finite
    check (balance >= 0 and balance < 1e15);

alter table public.asset_purchases
  drop constraint if exists asset_purchases_quantity_finite,
  add constraint asset_purchases_quantity_finite
    check (quantity > 0 and quantity < 1e15),
  drop constraint if exists asset_purchases_cost_finite,
  add constraint asset_purchases_cost_finite
    check (cost_total is null or (cost_total >= 0 and cost_total < 1e15));

alter table public.goals
  drop constraint if exists goals_target_finite,
  add constraint goals_target_finite
    check (target_amount > 0 and target_amount < 1e15);

alter table public.automation_rules
  drop constraint if exists automation_rules_fixed_finite,
  add constraint automation_rules_fixed_finite
    check (fixed_amount is null or (fixed_amount > 0 and fixed_amount < 1e15));

alter table public.price_overrides
  drop constraint if exists price_overrides_finite,
  add constraint price_overrides_finite
    check (price > 0 and price < 1e15);

alter table public.zakat_hawl
  drop constraint if exists zakat_hawl_wealth_finite,
  add constraint zakat_hawl_wealth_finite
    check (start_wealth is null or (start_wealth >= 0 and start_wealth < 1e15));

alter table public.zakat_payments
  drop constraint if exists zakat_payments_finite,
  add constraint zakat_payments_finite
    check (amount >= 0 and amount < 1e15);

-- ---------------------------------------------------------------------------
-- 2. Prevent double-refunding cash when deleting an asset with sales (#1)
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
  -- Reverting history or deleting an already-sold asset skips cash refund
  if old.paid_from_asset_id is null or old.paid_amount is null
    or current_setting('aurafinance.reverting', true) = 'on'
    or current_setting('aurafinance.skip_refund', true) = 'on' then
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

create or replace function private.guard_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_sales boolean;
  v_held numeric;
begin
  if tg_op = 'DELETE' then
    if old.kind = 'pending_income' and current_setting('aurafinance.allow_system_delete', true) is distinct from 'on' then
      raise exception 'Upcoming Income is managed by the app and cannot be deleted' using errcode = 'P0001';
    end if;
    if old.kind in ('gold', 'stock', 'other') then
      select exists (select 1 from public.asset_sales s where s.asset_id = old.id) into v_has_sales;
      if v_has_sales then
        v_held := private.holding(old.id);
        if v_held > 1e-9 then
          perform private.fail('Some of this asset has been sold. Sell the rest or remove the sales first, or archive it instead.');
        end if;
        -- Fully sold ($0 remaining): remove purchases without double-refunding cash
        perform set_config('aurafinance.deleting_asset', old.id::text, true);
        perform set_config('aurafinance.skip_refund', 'on', true);
        delete from public.asset_purchases p where p.asset_id = old.id;
        perform set_config('aurafinance.skip_refund', '', true);
        perform set_config('aurafinance.deleting_asset', '', true);
      else
        perform set_config('aurafinance.deleting_asset', old.id::text, true);
        delete from public.asset_purchases p where p.asset_id = old.id and p.paid_from_asset_id is not null;
        perform set_config('aurafinance.deleting_asset', '', true);
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.kind = 'pending_income' and current_setting('aurafinance.allow_system_write', true) is distinct from 'on' then
      raise exception 'Upcoming Income is created automatically' using errcode = 'P0001';
    end if;
    return new;
  end if;

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
  if new.archived_at is not null and old.archived_at is null then
    if old.kind = 'cash' and old.balance <> 0 then
      raise exception 'Move the money out of % before archiving it', old.name using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Prevent reverting past a deleted asset's refund if purchase cannot be restored (#2)
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
  v_change record;
  v_balance numeric;
  v_restore jsonb;
  v_deleted integer;
  v_purchase public.asset_purchases%rowtype;
  v_sale public.asset_sales%rowtype;
begin
  select * into v_target from public.transactions t where t.id = p_tx and t.user_id = v_uid;
  if not found then
    perform private.fail('History entry not found', 'P0002');
  end if;
  if v_target.is_imported then
    perform private.fail('Entries imported from the old version can''t be reverted to');
  end if;
  if exists (select 1 from public.transactions t where t.user_id = v_uid and t.seq > v_target.seq and t.is_imported) then
    perform private.fail('Imported history can''t be reverted');
  end if;

  if exists (
    select 1
      from public.transactions t
     where t.user_id = v_uid
       and t.seq > v_target.seq
       and t.kind in ('refund', 'sale_removed')
       and t.details ? 'restore'
       and not exists (
         select 1 from public.assets a where a.id = (t.details #>> '{restore,row,asset_id}')::uuid
       )
  ) then
    perform private.fail('Cannot revert past a deleted asset''s refund because that asset no longer exists');
  end if;

  perform 1 from public.assets a where a.user_id = v_uid order by a.id for update;

  for v_change in
    select tc.asset_id, max(tc.asset_name) as asset_name, sum(tc.delta) as net
      from public.transaction_changes tc
      join public.transactions t on t.id = tc.transaction_id
     where t.user_id = v_uid and t.seq > v_target.seq and tc.asset_id is not null
     group by tc.asset_id
  loop
    select a.balance into v_balance from public.assets a where a.id = v_change.asset_id;
    if v_balance - v_change.net < 0 then
      perform private.fail(format('Can''t revert: %s would go below zero', v_change.asset_name));
    end if;
    update public.assets set balance = balance - v_change.net where id = v_change.asset_id;
  end loop;

  perform set_config('aurafinance.reverting', 'on', true);

  for v_restore in
    select t.details -> 'restore'
      from public.transactions t
     where t.user_id = v_uid and t.seq > v_target.seq and t.kind in ('refund', 'sale_removed') and t.details ? 'restore'
     order by t.seq desc
  loop
    if (v_restore #>> '{source_tx}') is not null
      and not exists (select 1 from public.transactions t where t.id = (v_restore #>> '{source_tx}')::uuid and t.seq <= v_target.seq) then
      continue;
    end if;

    if v_restore ->> 'table' = 'asset_purchases' then
      if not exists (select 1 from public.assets a where a.id = (v_restore #>> '{row,asset_id}')::uuid) then
        continue;
      end if;
      if (v_restore #>> '{row,paid_from_asset_id}') is not null and not exists (
        select 1 from public.assets a where a.id = (v_restore #>> '{row,paid_from_asset_id}')::uuid
      ) then
        v_restore := jsonb_set(v_restore, '{row,paid_from_asset_id}', 'null'::jsonb);
      end if;
      v_purchase := jsonb_populate_record(null::public.asset_purchases, v_restore -> 'row');
      insert into public.asset_purchases values (v_purchase.*) on conflict (id) do nothing;
    elsif v_restore ->> 'table' = 'asset_sales' then
      if not exists (select 1 from public.assets a where a.id = (v_restore #>> '{row,asset_id}')::uuid) then
        continue;
      end if;
      if (v_restore #>> '{row,to_asset_id}') is not null and not exists (
        select 1 from public.assets a where a.id = (v_restore #>> '{row,to_asset_id}')::uuid
      ) then
        v_restore := jsonb_set(v_restore, '{row,to_asset_id}', 'null'::jsonb);
      end if;
      v_sale := jsonb_populate_record(null::public.asset_sales, v_restore -> 'row');
      insert into public.asset_sales values (v_sale.*) on conflict (id) do nothing;
    end if;
  end loop;

  delete from public.transactions t where t.user_id = v_uid and t.seq > v_target.seq;
  get diagnostics v_deleted = row_count;
  perform set_config('aurafinance.reverting', '', true);

  update public.assets a
     set balance = coalesce((select t.pending_after from public.transactions t where t.user_id = v_uid and t.pending_after is not null order by t.seq desc limit 1), 0)
   where a.user_id = v_uid and a.kind = 'pending_income';

  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Lock automation_rules rows to prevent TOCTOU double-execution (#3)
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
    for update of ar skip locked
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

-- ---------------------------------------------------------------------------
-- 5. Reject set_cash_balance on archived cash accounts (#7)
-- ---------------------------------------------------------------------------

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
  if p_balance is null or p_balance < 0 or p_balance > 1e13 then
    perform private.fail('Balance must be zero or positive');
  end if;

  select * into v_asset from public.assets a where a.id = p_asset and a.user_id = v_uid for update;
  if not found then
    perform private.fail('Account not found', 'P0002');
  end if;
  if v_asset.kind <> 'cash' then
    perform private.fail('Only cash account balances can be edited directly');
  end if;
  if v_asset.archived_at is not null then
    perform private.fail('Unarchive this account before changing its balance');
  end if;

  v_delta := p_balance - v_asset.balance;
  if v_delta = 0 then
    return null;
  end if;

  update public.assets set balance = p_balance where id = v_asset.id;
  select p.base_currency into v_base from public.profiles p where p.user_id = v_uid;

  insert into public.transactions (
    user_id, kind, description, amount, currency, rate_to_base, base_currency,
    from_asset_id, from_asset_name, to_asset_id, to_asset_name
  ) values (
    v_uid, 'adjustment',
    coalesce(nullif(left(btrim(p_description), 200), ''), 'Balance updated'),
    abs(v_delta), v_asset.currency, private.fx(v_asset.currency, v_base), v_base,
    case when v_delta < 0 then v_asset.id else null end,
    case when v_delta < 0 then v_asset.name else null end,
    case when v_delta > 0 then v_asset.id else null end,
    case when v_delta > 0 then v_asset.name else null end
  )
  returning id into v_tx;

  insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
  values (v_tx, v_uid, v_asset.id, v_asset.name, v_delta);

  return v_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Guard mark_zakat_paid against NaN/Infinity and missing prices (#8)
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
  if p_amount is null or p_amount < 0 or not (p_amount < 1e13) then
    perform private.fail('Enter the amount you paid');
  end if;
  if p_currency !~ '^[A-Z]{3}$' then
    perform private.fail('Unknown currency');
  end if;

  select * into v_hawl from public.zakat_hawl h where h.user_id = v_uid for update;

  insert into public.zakat_payments (user_id, paid_on, amount, currency, hawl_start_date, note)
  values (v_uid, v_local, p_amount, p_currency, v_hawl.hawl_start_date, left(coalesce(p_note, ''), 280));

  select * into v_val from private.user_valuation(v_uid);
  if v_val.gold_24k_price is not null and v_val.complete then
    v_above := v_val.gold_24k_price > 0 and v_val.zakatable_wealth / v_val.gold_24k_price >= 85;
    update public.zakat_hawl set
      hawl_start_date = case when v_above then v_local end,
      start_wealth = case when v_above then round(v_val.zakatable_wealth, 2) end,
      start_wealth_currency = case when v_above then v_val.currency end,
      is_first_hawl = false,
      last_checked_on = v_local
    where user_id = v_uid;
  else
    update public.zakat_hawl set
      is_first_hawl = false
    where user_id = v_uid;
  end if;
end;
$$;
