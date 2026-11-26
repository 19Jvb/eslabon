-- «Cargar datos de ejemplo»: 3 habits with about 60 days of history for the calling user, only if they have none.
-- The check_ins insert policy only allows the last few days, so this runs as security definer (the owner bypasses
-- RLS): every row it writes takes its user_id from auth.uid(), never from an argument.

create or replace function public.load_sample_data(p_today date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  -- In UTC, not current_date: that one follows the session time zone, which a request can set (Prefer: timezone=…).
  v_utc_today date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  -- p_today is the user's today in their time zone, which is at most one day away from UTC's.
  -- «is null» first: «not between» on a null is null, and the if would let it through.
  if p_today is null or p_today not between v_utc_today - 1 and v_utc_today + 1 then
    raise exception 'p_today must be the user''s today' using errcode = 'invalid_parameter_value';
  end if;

  -- One caller at a time per user (double click, two tabs): the second waits here until the first commits,
  -- then sees its habits below and does nothing. Released at the end of the transaction.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  if exists (select 1 from public.habits h where h.user_id = v_user_id) then
    return;
  end if;

  -- Fixed pattern over d = days before p_today (1 = yesterday), so it only depends on that offset.
  -- Today is never marked. Current streak / best streak:
  --   Leer: d 1-5, 8-21 and, from d 24 to 60, three days out of four        → 5 / 14
  --   Caminar: started 45 days ago, five days a week                        → 3 / 5
  --   Beber: started 40 days ago, d 1-12, then four days out of five        → 12 / 12
  with new_habits as (
    insert into public.habits (user_id, name, color)
    values
      (v_user_id, 'Leer 20 minutos', 'blue'),
      (v_user_id, 'Caminar 30 minutos', 'green'),
      (v_user_id, 'Beber 2 litros de agua', 'amber')
    returning id, name
  )
  insert into public.check_ins (habit_id, user_id, day)
  select h.id, v_user_id, p_today - d
  from new_habits h
  cross join pg_catalog.generate_series(1, 60) as d
  where case h.name
    when 'Leer 20 minutos' then d <= 5 or d between 8 and 21 or (d >= 24 and d % 4 <> 0)
    when 'Caminar 30 minutos' then d <= 45 and (d + 1) % 7 < 5
    else d <= 12 or (d between 14 and 40 and d % 5 <> 0)
  end;
end;
$$;

revoke all on function public.load_sample_data(date) from public, anon;
grant execute on function public.load_sample_data(date) to authenticated;
