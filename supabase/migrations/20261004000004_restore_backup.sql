-- AuraFinance: restore a vault from a JSON backup made with Settings › Data, in this or another account.
--
-- Everything in the vault is replaced. Every row gets a new id and every reference in the file is looked up
-- through the ids created here, so a file can never point at someone else's data. Backups that include the
-- per-entry changes (made after this update) restore history that can be reverted; older backups restore
-- history as read-only.

-- New id for an id from the file (null when the file's id is unknown)
create or replace function private.ref(p_refs jsonb, p_old text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_old is null then null else (p_refs ->> p_old)::uuid end;
$$;

create or replace function private.ref_json(p_refs jsonb, p_old text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(to_jsonb(private.ref(p_refs, p_old)), 'null'::jsonb);
$$;

create or replace function public.restore_vault(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_profile jsonb := coalesce(p -> 'profile', '{}'::jsonb);
  v_pricing jsonb := coalesce(p -> 'pricing', '{}'::jsonb);
  v_hawl jsonb := coalesce(p -> 'hawl', '{}'::jsonb);
  -- Backups from before buy/sell have no per-entry changes; their history is restored read-only
  v_full_history boolean := coalesce(jsonb_typeof(p -> 'transaction_changes') = 'array', false);
  v_assets jsonb := '{}'::jsonb;
  v_txs jsonb := '{}'::jsonb;
  v_rules jsonb := '{}'::jsonb;
  v_pending_id uuid;
  v_item jsonb;
  v_details jsonb;
  v_restore jsonb;
  v_id uuid;
  v_from uuid;
  v_to uuid;
  v_count_assets integer := 0;
  v_count_purchases integer := 0;
  v_count_sales integer := 0;
  v_count_goals integer := 0;
  v_count_transactions integer := 0;
  v_count_rules integer := 0;
begin
  if coalesce(p ->> 'app', '') <> 'AuraFinance' or jsonb_typeof(p -> 'assets') is distinct from 'array' then
    perform private.fail('This file isn''t an AuraFinance backup');
  end if;

  perform public.bootstrap_vault();
  perform 1 from public.assets a where a.user_id = v_uid order by a.id for update;

  -- 1. Empty the vault. Nothing is refunded while clearing: the whole vault is being replaced.
  perform set_config('aurafinance.reverting', 'on', true);
  delete from public.automation_rules where user_id = v_uid;
  delete from public.transactions where user_id = v_uid;
  delete from public.asset_sales where user_id = v_uid;
  delete from public.asset_purchases where user_id = v_uid;
  delete from public.assets where user_id = v_uid and kind <> 'pending_income';
  update public.assets set balance = 0 where user_id = v_uid and kind = 'pending_income'
    returning id into v_pending_id;
  delete from public.goals where user_id = v_uid;
  delete from public.zakat_payments where user_id = v_uid;
  delete from public.daily_snapshots where user_id = v_uid;
  delete from public.followed_tickers where user_id = v_uid;
  delete from public.price_overrides where user_id = v_uid;

  -- 2. Settings (account details like display name and email stay as they are)
  update public.profiles set
    vault_name = coalesce(nullif(left(btrim(v_profile ->> 'vault_name'), 60), ''), vault_name),
    base_currency = coalesce(v_profile ->> 'base_currency', base_currency),
    display_currencies = case
      when jsonb_typeof(v_profile -> 'display_currencies') = 'array'
        then coalesce((select array_agg(value) from jsonb_array_elements_text(v_profile -> 'display_currencies')), '{}')
      else display_currencies end,
    income_currency = coalesce(v_profile ->> 'income_currency', income_currency),
    number_locale = coalesce(v_profile ->> 'number_locale', number_locale),
    timezone = case when private.is_valid_timezone(v_profile ->> 'timezone') then v_profile ->> 'timezone' else timezone end,
    zakat_enabled = coalesce((v_profile ->> 'zakat_enabled')::boolean, zakat_enabled),
    animation_speed = case when v_profile ->> 'animation_speed' in ('system', 'off', 'slow', 'normal', 'fast')
      then v_profile ->> 'animation_speed' else animation_speed end,
    theme = case when v_profile ->> 'theme' in ('light', 'dark', 'system') then v_profile ->> 'theme' else theme end,
    color_palette = case when v_profile ->> 'color_palette' in ('pastel', 'minimal', 'sea', 'autumn', 'nature', 'vivid')
      then v_profile ->> 'color_palette' else color_palette end
  where user_id = v_uid;

  update public.pricing_settings set
    gold_mode = coalesce(v_pricing ->> 'gold_mode', gold_mode),
    manual_gold_24k_price = (v_pricing ->> 'manual_gold_24k_price')::numeric,
    manual_gold_currency = coalesce(v_pricing ->> 'manual_gold_currency', manual_gold_currency),
    gold_premium_pct = coalesce((v_pricing ->> 'gold_premium_pct')::numeric, gold_premium_pct),
    gold_21k_adjustment = coalesce((v_pricing ->> 'gold_21k_adjustment')::numeric, gold_21k_adjustment),
    gold_24k_adjustment = coalesce((v_pricing ->> 'gold_24k_adjustment')::numeric, gold_24k_adjustment),
    gold_adjustment_currency = coalesce(v_pricing ->> 'gold_adjustment_currency', gold_adjustment_currency)
  where user_id = v_uid;

  for v_item in select value from jsonb_array_elements(coalesce(p -> 'groups', '[]'::jsonb)) loop
    update public.asset_groups set
      name = coalesce(nullif(btrim(v_item ->> 'name'), ''), name),
      color = coalesce(v_item ->> 'color', color),
      sort_order = coalesce((v_item ->> 'sort_order')::integer, sort_order)
    where user_id = v_uid and kind = v_item ->> 'kind';
  end loop;

  -- 3. Assets (Upcoming Income maps onto this vault's own)
  for v_item in select value from jsonb_array_elements(p -> 'assets') loop
    if v_item ->> 'kind' = 'pending_income' then
      update public.assets set balance = coalesce((v_item ->> 'balance')::numeric, 0) where id = v_pending_id;
      v_assets := v_assets || jsonb_build_object(v_item ->> 'id', v_pending_id);
      continue;
    end if;
    insert into public.assets (user_id, kind, name, currency, karat, ticker, manual_unit_price, balance, color, note,
      sort_order, hide_when_empty, archived_at, created_at)
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
      coalesce((v_item ->> 'hide_when_empty')::boolean, false),
      (v_item ->> 'archived_at')::timestamptz,
      coalesce((v_item ->> 'created_at')::timestamptz, now())
    )
    returning id into v_id;
    v_assets := v_assets || jsonb_build_object(v_item ->> 'id', v_id);
    v_count_assets := v_count_assets + 1;
  end loop;

  -- 4. Automatic transfers. They start again from their next date, so restoring never moves money by itself.
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'rules', '[]'::jsonb)) loop
    v_from := private.ref(v_assets, v_item ->> 'from_asset_id');
    v_to := private.ref(v_assets, v_item ->> 'to_asset_id');
    if not exists (select 1 from public.assets a where a.id = v_from and a.kind in ('cash', 'pending_income') and a.archived_at is null) then
      v_from := null;
    end if;
    if not exists (select 1 from public.assets a where a.id = v_to and a.kind in ('cash', 'pending_income') and a.archived_at is null)
      or v_to = v_from then
      v_to := null;
    end if;
    insert into public.automation_rules (user_id, name, enabled, day_of_month, amount_mode, fixed_amount, from_asset_id, to_asset_id)
    values (
      v_uid,
      left(btrim(v_item ->> 'name'), 60),
      coalesce((v_item ->> 'enabled')::boolean, true),
      (v_item ->> 'day_of_month')::integer,
      coalesce(v_item ->> 'amount_mode', 'all'),
      (v_item ->> 'fixed_amount')::numeric,
      v_from,
      v_to
    )
    returning id into v_id;
    v_rules := v_rules || jsonb_build_object(v_item ->> 'id', v_id);
    v_count_rules := v_count_rules + 1;
  end loop;

  -- 5. History, oldest first so the order is kept
  for v_item in
    select value from jsonb_array_elements(coalesce(p -> 'transactions', '[]'::jsonb))
    order by (value ->> 'seq')::bigint nulls first, (value ->> 'occurred_at')::timestamptz
  loop
    v_details := v_item -> 'details';
    if jsonb_typeof(v_details) = 'object' and v_details ? 'restore' then
      -- What a removal would put back on revert, pointed at the new ids
      v_restore := v_details -> 'restore';
      v_restore := jsonb_set(v_restore, '{source_tx}', private.ref_json(v_txs, v_restore ->> 'source_tx'));
      v_restore := jsonb_set(v_restore, '{row,id}', to_jsonb(gen_random_uuid()));
      v_restore := jsonb_set(v_restore, '{row,user_id}', to_jsonb(v_uid));
      v_restore := jsonb_set(v_restore, '{row,asset_id}', private.ref_json(v_assets, v_restore #>> '{row,asset_id}'));
      v_restore := jsonb_set(v_restore, '{row,transaction_id}', private.ref_json(v_txs, v_restore #>> '{row,transaction_id}'));
      if v_restore -> 'row' ? 'paid_from_asset_id' then
        v_restore := jsonb_set(v_restore, '{row,paid_from_asset_id}', private.ref_json(v_assets, v_restore #>> '{row,paid_from_asset_id}'));
      end if;
      if v_restore -> 'row' ? 'to_asset_id' then
        v_restore := jsonb_set(v_restore, '{row,to_asset_id}', private.ref_json(v_assets, v_restore #>> '{row,to_asset_id}'));
      end if;
      v_details := jsonb_set(v_details, '{restore}', v_restore);
    end if;

    insert into public.transactions (
      user_id, kind, description, amount, currency, rate_to_base, base_currency,
      from_asset_id, from_asset_name, to_asset_id, to_asset_name,
      converted_amount, converted_currency, fx_rate, pending_before, pending_after,
      automation_rule_id, is_imported, import_details, details, occurred_at
    ) values (
      v_uid,
      v_item ->> 'kind',
      left(coalesce(v_item ->> 'description', ''), 200),
      abs(coalesce((v_item ->> 'amount')::numeric, 0)),
      v_item ->> 'currency',
      (v_item ->> 'rate_to_base')::numeric,
      v_item ->> 'base_currency',
      private.ref(v_assets, v_item ->> 'from_asset_id'),
      v_item ->> 'from_asset_name',
      private.ref(v_assets, v_item ->> 'to_asset_id'),
      v_item ->> 'to_asset_name',
      (v_item ->> 'converted_amount')::numeric,
      v_item ->> 'converted_currency',
      (v_item ->> 'fx_rate')::numeric,
      (v_item ->> 'pending_before')::numeric,
      (v_item ->> 'pending_after')::numeric,
      private.ref(v_rules, v_item ->> 'automation_rule_id'),
      coalesce((v_item ->> 'is_imported')::boolean, false) or not v_full_history,
      v_item -> 'import_details',
      v_details,
      coalesce((v_item ->> 'occurred_at')::timestamptz, now())
    )
    returning id into v_id;
    v_txs := v_txs || jsonb_build_object(v_item ->> 'id', v_id);
    v_count_transactions := v_count_transactions + 1;
  end loop;

  if v_full_history then
    insert into public.transaction_changes (transaction_id, user_id, asset_id, asset_name, delta)
    select private.ref(v_txs, c ->> 'transaction_id'), v_uid, private.ref(v_assets, c ->> 'asset_id'),
      coalesce(c ->> 'asset_name', ''), (c ->> 'delta')::numeric
    from jsonb_array_elements(p -> 'transaction_changes') c
    where private.ref(v_txs, c ->> 'transaction_id') is not null;
  end if;

  -- 6. Purchases and sales
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'purchases', '[]'::jsonb)) loop
    v_id := private.ref(v_assets, v_item ->> 'asset_id');
    continue when v_id is null;
    insert into public.asset_purchases (user_id, asset_id, quantity, cost_total, cost_currency, acquired_on, note,
      is_opening_balance, cost_is_estimated, cost_estimate_attempted_at,
      paid_from_asset_id, paid_amount, paid_currency, transaction_id, created_at)
    values (
      v_uid, v_id,
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'cost_total')::numeric,
      v_item ->> 'cost_currency',
      coalesce((v_item ->> 'acquired_on')::date, current_date),
      coalesce(v_item ->> 'note', ''),
      coalesce((v_item ->> 'is_opening_balance')::boolean, false),
      coalesce((v_item ->> 'cost_is_estimated')::boolean, false),
      (v_item ->> 'cost_estimate_attempted_at')::timestamptz,
      private.ref(v_assets, v_item ->> 'paid_from_asset_id'),
      (v_item ->> 'paid_amount')::numeric,
      v_item ->> 'paid_currency',
      private.ref(v_txs, v_item ->> 'transaction_id'),
      coalesce((v_item ->> 'created_at')::timestamptz, now())
    );
    v_count_purchases := v_count_purchases + 1;
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p -> 'sales', '[]'::jsonb)) loop
    v_id := private.ref(v_assets, v_item ->> 'asset_id');
    continue when v_id is null or private.ref(v_txs, v_item ->> 'transaction_id') is null;
    insert into public.asset_sales (user_id, asset_id, quantity, proceeds, proceeds_currency, sold_on, to_asset_id,
      transaction_id, note, created_at)
    values (
      v_uid, v_id,
      (v_item ->> 'quantity')::numeric,
      (v_item ->> 'proceeds')::numeric,
      v_item ->> 'proceeds_currency',
      (v_item ->> 'sold_on')::date,
      private.ref(v_assets, v_item ->> 'to_asset_id'),
      private.ref(v_txs, v_item ->> 'transaction_id'),
      coalesce(v_item ->> 'note', ''),
      coalesce((v_item ->> 'created_at')::timestamptz, now())
    );
    v_count_sales := v_count_sales + 1;
  end loop;

  -- 7. Goals (the old pinned Zakat goal isn't a goal anymore)
  for v_item in select value from jsonb_array_elements(coalesce(p -> 'goals', '[]'::jsonb)) loop
    continue when coalesce((v_item ->> 'is_system')::boolean, false);
    insert into public.goals (user_id, name, emoji, target_amount, target_unit, include_upcoming, reserve_funds, sort_order)
    values (
      v_uid,
      left(btrim(v_item ->> 'name'), 60),
      coalesce(nullif(v_item ->> 'emoji', ''), '🎯'),
      (v_item ->> 'target_amount')::numeric,
      v_item ->> 'target_unit',
      coalesce((v_item ->> 'include_upcoming')::boolean, true),
      coalesce((v_item ->> 'reserve_funds')::boolean, false),
      coalesce((v_item ->> 'sort_order')::integer, 1)
    );
    v_count_goals := v_count_goals + 1;
  end loop;

  -- 8. Zakat
  update public.zakat_hawl set
    hawl_start_date = (v_hawl ->> 'hawl_start_date')::date,
    start_wealth = (v_hawl ->> 'start_wealth')::numeric,
    start_wealth_currency = case when v_hawl ->> 'start_wealth' is null then null else v_hawl ->> 'start_wealth_currency' end,
    is_first_hawl = coalesce((v_hawl ->> 'is_first_hawl')::boolean, false),
    last_checked_on = null
  where user_id = v_uid;

  insert into public.zakat_payments (user_id, paid_on, amount, currency, hawl_start_date, note)
  select v_uid, (z ->> 'paid_on')::date, (z ->> 'amount')::numeric, z ->> 'currency',
    (z ->> 'hawl_start_date')::date, coalesce(z ->> 'note', '')
  from jsonb_array_elements(coalesce(p -> 'zakatPayments', '[]'::jsonb)) z;

  -- 9. Market preferences
  insert into public.followed_tickers (user_id, ticker, sort_order)
  select v_uid, t ->> 'ticker', coalesce((t ->> 'sort_order')::integer, 0)
  from jsonb_array_elements(coalesce(p -> 'followed', '[]'::jsonb)) t
  on conflict do nothing;

  insert into public.price_overrides (user_id, ticker, price, currency)
  select v_uid, o ->> 'ticker', (o ->> 'price')::numeric, coalesce(o ->> 'currency', 'USD')
  from jsonb_array_elements(coalesce(p -> 'overrides', '[]'::jsonb)) o
  on conflict (user_id, ticker) do update set price = excluded.price, currency = excluded.currency;

  perform set_config('aurafinance.reverting', 'off', true);

  return jsonb_build_object(
    'assets', v_count_assets,
    'purchases', v_count_purchases,
    'sales', v_count_sales,
    'goals', v_count_goals,
    'transactions', v_count_transactions,
    'automation_rules', v_count_rules,
    'revertable', v_full_history
  );
end;
$$;

revoke all on function public.restore_vault(jsonb) from public, anon;
grant execute on function public.restore_vault(jsonb) to authenticated;
