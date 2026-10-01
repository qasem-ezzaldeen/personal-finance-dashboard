-- AuraFinance: reserved goals, and Zakat is no longer a goal.

-- ---------------------------------------------------------------------------
-- Reserved goals: money counted toward one doesn't count toward the next
-- (goals claim money in their list order). Milestones stay unreserved.
-- ---------------------------------------------------------------------------

alter table public.goals add column reserve_funds boolean not null default false;

grant insert (reserve_funds) on public.goals to authenticated;
grant update (reserve_funds) on public.goals to authenticated;

-- ---------------------------------------------------------------------------
-- Zakat lives in Settings now: remove the pinned system goal
-- ---------------------------------------------------------------------------

select set_config('aurafinance.allow_system_delete', 'on', true);
delete from public.goals where is_system;
select set_config('aurafinance.allow_system_delete', 'off', true);

create or replace function private.guard_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.is_system then
    raise exception 'Goals are created by you' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger goals_guard on public.goals;
create trigger goals_guard before insert or update or delete on public.goals
  for each row execute function private.guard_goal();

-- Same as before, without creating the Zakat goal
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

  insert into public.zakat_hawl (user_id) values (v_uid)
  on conflict (user_id) do nothing;
end;
$$;
