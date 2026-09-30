-- AuraFinance: one-time import of a vault from the previous version (public.dashboards.data),
-- mapped by the app. That row is only read by the app and is never modified here.

create or replace function public.import_previous_vault(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_pending_id uuid;
  v_refs jsonb := '{}'::jsonb;
  v_item jsonb;
  v_id uuid;
  v_local date;
  v_assets integer := 0;
  v_purchases integer := 0;
  v_goals integer := 0;
  v_transactions integer := 0;
  v_rules integer := 0;
begin
  perform public.bootstrap_vault();
  v_local := private.local_date(v_uid);

  if exists (select 1 from public.profiles where user_id = v_uid and imported_at is not null) then
    perform private.fail('Your old data has already been imported');
  end if;
  if exists (select 1 from public.transactions where user_id = v_uid)
    or exists (select 1 from public.assets where user_id = v_uid and (kind <> 'pending_income' or balance <> 0))
    or exists (select 1 from public.goals where user_id = v_uid and not is_system) then
    perform private.fail('Import only works into an empty vault. Remove what you added in the new version first.');
  end if;

  -- Profile & pricing
  update public.profiles set
    base_currency = coalesce(p #>> '{profile,base_currency}', base_currency),
    display_currencies = coalesce(
      (select array_agg(value) from jsonb_array_elements_text(p #> '{profile,display_currencies}')),
      display_currencies),
    income_currency = coalesce(p #>> '{profile,income_currency}', income_currency),
    zakat_enabled = coalesce((p ->> 'zakat_enabled')::boolean, zakat_enabled),
    imported_at = now()
  where user_id = v_uid;

  update public.pricing_settings set
    gold_mode = coalesce(p #>> '{pricing,gold_mode}', gold_mode),
    manual_gold_24k_price = (p #>> '{pricing,manual_gold_24k_price}')::numeric,
    manual_gold_currency = coalesce(p #>> '{pricing,manual_gold_currency}', manual_gold_currency),
    gold_premium_pct = coalesce((p #>> '{pricing,gold_premium_pct}')::numeric, gold_premium_pct)
  where user_id = v_uid;

  perform set_config('aurafinance.allow_system_write', 'on', true);

  -- Upcoming Income
  update public.assets set balance = coalesce((p ->> 'pending_balance')::numeric, 0)
    where user_id = v_uid and kind = 'pending_income'
    returning id into v_pending_id;
  v_refs := v_refs || jsonb_build_object('pending', v_pending_id);

  -- Assets (+ an opening-balance purchase for gold and stocks)
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'assets', '[]'::jsonb)) loop
    insert into public.assets (user_id, kind, name, currency, karat, ticker, manual_unit_price,
      balance, color, note, sort_order, hide_when_empty)
    values (
      v_uid,
      v_item ->> 'kind',
      left(btrim(v_item ->> 'name'), 80),
      v_item ->> 'currency',
      (v_item ->> 'karat')::integer,
      v_item ->> 'ticker',
      (v_item ->> 'manual_unit_price')::numeric,
      case when v_item ->> 'kind' = 'cash' then coalesce((v_item ->> 'balance')::numeric, 0) else 0 end,
      coalesce(v_item ->> 'color', 'mint'),
      coalesce(v_item ->> 'note', ''),
      coalesce((v_item ->> 'sort_order')::integer, 0),
      coalesce((v_item ->> 'hide_when_empty')::boolean, false)
    )
    returning id into v_id;
    v_assets := v_assets + 1;
    v_refs := v_refs || jsonb_build_object(v_item ->> 'ref', v_id);

    if v_item ->> 'kind' in ('gold', 'stock', 'other') and coalesce((v_item ->> 'quantity')::numeric, 0) > 0 then
      insert into public.asset_purchases (user_id, asset_id, quantity, acquired_on, note, is_opening_balance)
      values (v_uid, v_id, (v_item ->> 'quantity')::numeric, v_local, 'Opening balance (imported)', true);
      v_purchases := v_purchases + 1;
    end if;
  end loop;

  -- Goals
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'goals', '[]'::jsonb)) loop
    insert into public.goals (user_id, name, emoji, target_amount, target_unit, include_upcoming, sort_order)
    values (
      v_uid,
      left(btrim(v_item ->> 'name'), 60),
      coalesce(nullif(v_item ->> 'emoji', ''), '🎯'),
      (v_item ->> 'target_amount')::numeric,
      v_item ->> 'target_unit',
      coalesce((v_item ->> 'include_upcoming')::boolean, true),
      coalesce((v_item ->> 'sort_order')::integer, 1)
    );
    v_goals := v_goals + 1;
  end loop;

  -- History (read-only, oldest first so ordering is preserved)
  for v_item in
    select value from jsonb_array_elements(coalesce(p -> 'transactions', '[]'::jsonb))
    order by (value ->> 'occurred_at')::timestamptz
  loop
    insert into public.transactions (user_id, kind, description, amount, currency, rate_to_base, base_currency,
      pending_before, pending_after, is_imported, import_details, occurred_at)
    values (
      v_uid, 'imported',
      left(coalesce(v_item ->> 'description', ''), 200),
      abs((v_item ->> 'amount')::numeric),
      v_item ->> 'currency',
      (v_item ->> 'rate_to_base')::numeric,
      p #>> '{profile,base_currency}',
      (v_item ->> 'pending_before')::numeric,
      (v_item ->> 'pending_after')::numeric,
      true,
      v_item -> 'import_details',
      (v_item ->> 'occurred_at')::timestamptz
    );
    v_transactions := v_transactions + 1;
  end loop;

  -- Market preferences
  insert into public.followed_tickers (user_id, ticker, sort_order)
  select v_uid, t.value, t.ordinality::integer
  from jsonb_array_elements_text(coalesce(p -> 'followed_tickers', '[]'::jsonb)) with ordinality t
  on conflict do nothing;

  insert into public.price_overrides (user_id, ticker, price, currency)
  select v_uid, o ->> 'ticker', (o ->> 'price')::numeric, coalesce(o ->> 'currency', 'USD')
  from jsonb_array_elements(coalesce(p -> 'price_overrides', '[]'::jsonb)) o
  on conflict (user_id, ticker) do update set price = excluded.price, currency = excluded.currency;

  -- Zakat Hawl
  update public.zakat_hawl set
    hawl_start_date = (p ->> 'hawl_start_date')::date,
    last_checked_on = null
  where user_id = v_uid;

  -- Automation rules (accounts referenced by the mapping's refs)
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'automation_rules', '[]'::jsonb)) loop
    insert into public.automation_rules (user_id, name, enabled, day_of_month, amount_mode, fixed_amount,
      from_asset_id, to_asset_id, last_run_period)
    values (
      v_uid,
      left(btrim(v_item ->> 'name'), 60),
      coalesce((v_item ->> 'enabled')::boolean, true),
      (v_item ->> 'day_of_month')::integer,
      coalesce(v_item ->> 'amount_mode', 'all'),
      (v_item ->> 'fixed_amount')::numeric,
      (v_refs ->> (v_item ->> 'from_ref'))::uuid,
      (v_refs ->> (v_item ->> 'to_ref'))::uuid,
      coalesce(v_item ->> 'last_run_period',
        private.latest_due_period((v_item ->> 'day_of_month')::integer, v_local))
    );
    v_rules := v_rules + 1;
  end loop;

  perform set_config('aurafinance.allow_system_write', 'off', true);

  return jsonb_build_object(
    'assets', v_assets,
    'purchases', v_purchases,
    'goals', v_goals,
    'transactions', v_transactions,
    'automation_rules', v_rules
  );
end;
$$;

revoke all on function public.import_previous_vault(jsonb) from public, anon;
grant execute on function public.import_previous_vault(jsonb) to authenticated;
