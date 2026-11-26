-- Habits and daily check-ins. Every row belongs to one user and RLS keeps it that way.

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  color text not null default 'green'
    check (color in ('red', 'orange', 'amber', 'green', 'blue', 'violet')),
  created_at timestamptz not null default now()
);

create unique index if not exists habits_user_id_lower_name_key
  on public.habits (user_id, lower(name));

create table if not exists public.check_ins (
  habit_id uuid not null references public.habits on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);

create index if not exists check_ins_user_id_day_idx
  on public.check_ins (user_id, day);

-- Explicit grants: nothing relies on the project's default privileges.
revoke all on table public.habits, public.check_ins from anon, authenticated;
grant select, insert, delete on table public.habits to authenticated;
grant update (name, color) on table public.habits to authenticated;
grant select, insert, delete on table public.check_ins to authenticated;

alter table public.habits enable row level security;
alter table public.check_ins enable row level security;

drop policy if exists "habits_select_own" on public.habits;
create policy "habits_select_own" on public.habits
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "habits_insert_own" on public.habits;
create policy "habits_insert_own" on public.habits
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "habits_update_own" on public.habits;
create policy "habits_update_own" on public.habits
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "habits_delete_own" on public.habits;
create policy "habits_delete_own" on public.habits
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- check_ins has no update policy (and no update grant): a check-in is inserted or deleted, never modified.
drop policy if exists "check_ins_select_own" on public.check_ins;
create policy "check_ins_select_own" on public.check_ins
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- The day window is a loose backstop covering UTC-12..UTC+14; the app enforces the exact range with isEditableDay.
drop policy if exists "check_ins_insert_own" on public.check_ins;
create policy "check_ins_insert_own" on public.check_ins
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.habits h
      where h.id = habit_id and h.user_id = (select auth.uid())
    )
    and day between current_date - 8 and current_date + 1
  );

drop policy if exists "check_ins_delete_own" on public.check_ins;
create policy "check_ins_delete_own" on public.check_ins
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Mark the demo user (SQL Editor): update auth.users set raw_app_meta_data = raw_app_meta_data || '{"demo": true}' where id = '<demo user id>';
create schema if not exists private;
revoke all on schema private from public;

create or replace function private.protect_demo_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.raw_app_meta_data->>'demo' = 'true'
    and (new.email is distinct from old.email
      or new.encrypted_password is distinct from old.encrypted_password) then
    raise exception 'The demo account email and password cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function private.protect_demo_account() from public;

create or replace trigger protect_demo_account
  before update on auth.users
  for each row execute function private.protect_demo_account();
