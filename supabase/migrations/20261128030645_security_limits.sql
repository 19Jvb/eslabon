-- Quotas (T24, SEC-1): at most 50 habits per user (MAX_HABITS in src/lib/habits.ts), which also bounds the
-- check-ins one account can write. The app tells this error apart by its code, check_violation (23514), and its
-- message, 'Habit limit reached' (LIMIT_MESSAGE in src/lib/habits.ts): a check of the table never gets that message.
-- security definer: the count sees every habit of new.user_id, whatever RLS would show the caller.
create or replace function private.habits_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A row in someone else's name is left to RLS (42501, as always): before triggers run ahead of the policies, and
  -- counting or locking for that user would tell the caller whether they have 50 habits. load_sample_data runs as
  -- the user, so its auth.uid() is theirs. With no session (SQL Editor, service_role) there is no limit: trusted.
  if new.user_id is distinct from auth.uid() then
    return new;
  end if;

  -- Two inserts at the same time (two tabs, a script) would both count 49 and both pass. With this lock the second
  -- waits until the first commits; its count, a new statement with a new snapshot (read committed), then sees that
  -- row. Same key as load_sample_data, whose own insert takes it again inside the same transaction.
  -- Released at the end of the transaction. A multi-row insert also counts the rows it has already added.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));

  if (select pg_catalog.count(*) from public.habits h where h.user_id = new.user_id) >= 50 then
    raise exception 'Habit limit reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.habits_limit() from public, anon, authenticated;

create or replace trigger habits_limit
  before insert on public.habits
  for each row execute function private.habits_limit();

-- SEC-7: the upper bound in UTC, not current_date (that one follows the session time zone, which a request can set
-- with Prefer: timezone=…). The + 1 still covers users already in tomorrow (up to UTC+14). The owner checks and the
-- lower bound (EARLIEST_DAY in src/lib/dates.ts) stay the same.
drop policy if exists "check_ins_insert_own" on public.check_ins;
create policy "check_ins_insert_own" on public.check_ins
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.habits h
      where h.id = habit_id and h.user_id = (select auth.uid())
    )
    and day between date '2000-01-01' and (pg_catalog.now() at time zone 'UTC')::date + 1
  );
