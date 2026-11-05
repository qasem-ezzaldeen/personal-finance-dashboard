-- AuraFinance: Audit fixes and performance enhancements.
-- 1. Covering indexes for foreign keys with ON DELETE SET NULL / CASCADE to eliminate full table locks
-- 2. Hardened revert_to_transaction to prevent FK violation if referencing cash accounts were removed

create index if not exists transactions_from_asset_idx on public.transactions (from_asset_id) where from_asset_id is not null;
create index if not exists transactions_to_asset_idx on public.transactions (to_asset_id) where to_asset_id is not null;
create index if not exists transactions_automation_rule_idx on public.transactions (automation_rule_id) where automation_rule_id is not null;
create index if not exists transaction_changes_asset_idx on public.transaction_changes (asset_id) where asset_id is not null;
create index if not exists asset_purchases_paid_from_idx on public.asset_purchases (paid_from_asset_id) where paid_from_asset_id is not null;
create index if not exists asset_sales_to_asset_idx on public.asset_sales (to_asset_id) where to_asset_id is not null;
create index if not exists automation_rules_from_asset_idx on public.automation_rules (from_asset_id) where from_asset_id is not null;
create index if not exists automation_rules_to_asset_idx on public.automation_rules (to_asset_id) where to_asset_id is not null;
create index if not exists automation_rules_due_idx on public.automation_rules (day_of_month, created_at) where enabled = true;

-- Hardened revert_to_transaction
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
        if (v_restore #>> '{row,paid_from_asset_id}') is not null and not exists (
          select 1 from public.assets a where a.id = (v_restore #>> '{row,paid_from_asset_id}')::uuid
        ) then
          v_restore := jsonb_set(v_restore, '{row,paid_from_asset_id}', 'null'::jsonb);
        end if;
        insert into public.asset_purchases
          select * from jsonb_populate_record(null::public.asset_purchases, v_restore -> 'row')
        on conflict (id) do nothing;
      elsif v_restore ->> 'table' = 'asset_sales' then
        if (v_restore #>> '{row,to_asset_id}') is not null and not exists (
          select 1 from public.assets a where a.id = (v_restore #>> '{row,to_asset_id}')::uuid
        ) then
          v_restore := jsonb_set(v_restore, '{row,to_asset_id}', 'null'::jsonb);
        end if;
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
