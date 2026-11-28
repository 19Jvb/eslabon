-- Full history: a check-in can be inserted for any day from 2000-01-01 (EARLIEST_DAY in src/lib/dates.ts) to today,
-- no longer only the last week. current_date follows the session time zone (UTC by default), so the + 1 covers users
-- already in tomorrow (up to UTC+14). The upper bound stays a loose backstop: the app enforces the exact range with
-- isEditableDay. Only the day window changes; the owner checks stay the same.
drop policy if exists "check_ins_insert_own" on public.check_ins;
create policy "check_ins_insert_own" on public.check_ins
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.habits h
      where h.id = habit_id and h.user_id = (select auth.uid())
    )
    and day between date '2000-01-01' and current_date + 1
  );
