-- The bot does everything the web does (T26): narrow security definer functions for anon, like telegram.sql. Each one
-- checks the bot secret first, takes the user from the chat's link (never from an argument) and only touches that
-- user's habits. Same rules as the web and the tables: names of 1 to 60 characters without surrounding spaces and
-- unique per user (case-insensitive), palette colors, days from 2000-01-01 to the link's today, at most 50 habits.

-- What the chat is in the middle of, for the free text that follows: the name of a new habit ('create'; name null
-- while the bot waits for it, set while it waits for the color) or the new name of habit_id ('rename').
-- One row per chat; an expired row counts as none. Same walls as the other tables of private.
create table if not exists private.telegram_pending (
  chat_id bigint primary key,
  action text not null check (action in ('create', 'rename')),
  habit_id uuid,
  name text,
  expires_at timestamptz not null,
  check ((action = 'create' and habit_id is null) or (action = 'rename' and habit_id is not null and name is null))
);

revoke all on table private.telegram_pending from public, anon, authenticated;
alter table private.telegram_pending enable row level security;

-- The body of load_sample_data, so the web and the bot share it. Writes for p_user_id: only called by the definer
-- functions below, which take it from auth.uid() or from the link. Returns false (and does nothing) if the user
-- already has habits. Not security definer: it runs as their owner.
create or replace function private.load_sample_data_for(p_user_id uuid, p_today date)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  -- One caller at a time per user (double click, two tabs, web and bot): the second waits here until the first
  -- commits, then sees its habits below and does nothing. Same key as the habits_limit trigger.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  if exists (select 1 from public.habits h where h.user_id = p_user_id) then
    return false;
  end if;

  -- Fixed pattern over d = days before p_today (1 = yesterday), so it only depends on that offset.
  -- Today is never marked. Current streak / best streak:
  --   Leer: d 1-5, 8-21 and, from d 24 to 60, three days out of four        → 5 / 14
  --   Caminar: started 45 days ago, five days a week                        → 3 / 5
  --   Beber: started 40 days ago, d 1-12, then four days out of five        → 12 / 12
  with new_habits as (
    insert into public.habits (user_id, name, color)
    values
      (p_user_id, 'Leer 20 minutos', 'blue'),
      (p_user_id, 'Caminar 30 minutos', 'green'),
      (p_user_id, 'Beber 2 litros de agua', 'amber')
    returning id, name
  )
  insert into public.check_ins (habit_id, user_id, day)
  select h.id, p_user_id, p_today - d
  from new_habits h
  cross join pg_catalog.generate_series(1, 60) as d
  where case h.name
    when 'Leer 20 minutos' then d <= 5 or d between 8 and 21 or (d >= 24 and d % 4 <> 0)
    when 'Caminar 30 minutos' then d <= 45 and (d + 1) % 7 < 5
    else d <= 12 or (d between 14 and 40 and d % 5 <> 0)
  end;

  return true;
end;
$$;

revoke all on function private.load_sample_data_for(uuid, date) from public, anon, authenticated;

-- Same behavior and grants as before: the checks stay here, the work moves to load_sample_data_for.
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

  perform private.load_sample_data_for(v_user_id, p_today);
end;
$$;

revoke all on function public.load_sample_data(date) from public, anon;
grant execute on function public.load_sample_data(date) to authenticated;

-- As in telegram.sql, and linking also drops whatever the chat had pending.
create or replace function public.telegram_link(p_secret text, p_code text, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_tz text;
  v_expires_at timestamptz;
begin
  perform private.telegram_check_secret(p_secret);

  delete from private.telegram_link_codes c
  where c.code = p_code
  returning c.user_id, c.tz, c.expires_at into v_user_id, v_tz, v_expires_at;

  if v_user_id is null or v_expires_at <= pg_catalog.now() then
    return 'invalid_code';
  end if;

  delete from public.telegram_links l where l.chat_id = p_chat_id and l.user_id <> v_user_id;

  insert into public.telegram_links (user_id, chat_id, tz)
  values (v_user_id, p_chat_id, v_tz)
  on conflict (user_id) do update
    set chat_id = excluded.chat_id, tz = excluded.tz, linked_at = pg_catalog.now();

  delete from private.telegram_pending p where p.chat_id = p_chat_id;

  return 'linked';
end;
$$;

revoke all on function public.telegram_link(text, text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_link(text, text, bigint) to anon;

-- As in telegram.sql, and unlinking also drops whatever the chat had pending.
create or replace function public.telegram_unlink(p_secret text, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.telegram_check_secret(p_secret);

  delete from private.telegram_pending p where p.chat_id = p_chat_id;

  delete from public.telegram_links l where l.chat_id = p_chat_id;

  if found then
    return 'unlinked';
  end if;
  return 'not_linked';
end;
$$;

revoke all on function public.telegram_unlink(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_unlink(text, bigint) to anon;

-- The linked user's habits in the web's order, each with all its marked days (ascending) and the link's today: the
-- bot computes the stats with the web's functions. No link → no rows.
create or replace function public.telegram_habits(p_secret text, p_chat_id bigint)
returns table (habit_id uuid, name text, color text, days date[], today date)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_today date;
begin
  perform private.telegram_check_secret(p_secret);

  select l.user_id, (pg_catalog.now() at time zone l.tz)::date
  into v_user_id, v_today
  from public.telegram_links l
  where l.chat_id = p_chat_id;

  return query
  select h.id, h.name, h.color,
    array(select c.day from public.check_ins c where c.habit_id = h.id order by c.day),
    v_today
  from public.habits h
  where h.user_id = v_user_id
  order by h.created_at, h.id;
end;
$$;

revoke all on function public.telegram_habits(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_habits(text, bigint) to anon;

-- Marks (p_done) or unmarks any day of one of the linked user's habits, from 2000-01-01 (EARLIEST_DAY in
-- src/lib/dates.ts) to the link's today. Idempotent both ways.
create or replace function public.telegram_set_day(p_secret text, p_chat_id bigint, p_habit_id uuid, p_day date, p_done boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_today date;
begin
  perform private.telegram_check_secret(p_secret);

  if p_done is null then
    raise exception 'p_done is required' using errcode = 'invalid_parameter_value';
  end if;

  select l.user_id, (pg_catalog.now() at time zone l.tz)::date
  into v_user_id, v_today
  from public.telegram_links l
  where l.chat_id = p_chat_id;

  if v_user_id is null then
    return 'not_linked';
  end if;

  if not exists (select 1 from public.habits h where h.id = p_habit_id and h.user_id = v_user_id) then
    return 'not_found';
  end if;

  -- «is null» first: «not between» on a null is null, and the if would let it through.
  if p_day is null or p_day not between date '2000-01-01' and v_today then
    return 'out_of_range';
  end if;

  if p_done then
    insert into public.check_ins (habit_id, user_id, day)
    values (p_habit_id, v_user_id, p_day)
    on conflict do nothing;
  else
    delete from public.check_ins c
    where c.habit_id = p_habit_id and c.user_id = v_user_id and c.day = p_day;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.telegram_set_day(text, bigint, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.telegram_set_day(text, bigint, uuid, date, boolean) to anon;

-- First step of creating a habit: keeps the name until the color arrives (telegram_create_habit). With no name
-- (/nuevo alone) it keeps 'create' without one, so the next free text is the name. A rejected name leaves whatever
-- was pending as it was, so the user can send another one. The limit is checked again on create, under the lock.
create or replace function public.telegram_start_create(p_secret text, p_chat_id bigint, p_name text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  perform private.telegram_check_secret(p_secret);

  select l.user_id into v_user_id from public.telegram_links l where l.chat_id = p_chat_id;

  if v_user_id is null then
    return 'not_linked';
  end if;

  if p_name is not null then
    -- The check of habits.name.
    if not (pg_catalog.char_length(p_name) between 1 and 60 and p_name = pg_catalog.btrim(p_name)) then
      return 'invalid';
    end if;
    if exists (
      select 1 from public.habits h
      where h.user_id = v_user_id and pg_catalog.lower(h.name) = pg_catalog.lower(p_name)
    ) then
      return 'duplicate';
    end if;
  end if;

  if (select pg_catalog.count(*) from public.habits h where h.user_id = v_user_id) >= 50 then
    return 'limit';
  end if;

  insert into private.telegram_pending (chat_id, action, habit_id, name, expires_at)
  values (p_chat_id, 'create', null, p_name, pg_catalog.now() + interval '10 minutes')
  on conflict (chat_id) do update
    set action = excluded.action, habit_id = excluded.habit_id, name = excluded.name, expires_at = excluded.expires_at;

  return 'ok';
end;
$$;

revoke all on function public.telegram_start_create(text, bigint, text) from public, anon, authenticated;
grant execute on function public.telegram_start_create(text, bigint, text) to anon;

-- Second step: creates the pending name with p_color and clears what was pending. A failure ('invalid',
-- 'duplicate', 'limit') keeps it, so the user can pick another color or send another name.
create or replace function public.telegram_create_habit(p_secret text, p_chat_id bigint, p_color text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_name text;
begin
  perform private.telegram_check_secret(p_secret);

  select l.user_id into v_user_id from public.telegram_links l where l.chat_id = p_chat_id;

  if v_user_id is null then
    return 'not_linked';
  end if;

  -- for update: a double tap on the color waits here, then finds the row gone and gets 'no_pending'.
  select p.name into v_name
  from private.telegram_pending p
  where p.chat_id = p_chat_id and p.action = 'create' and p.name is not null and p.expires_at > pg_catalog.now()
  for update;

  if v_name is null then
    return 'no_pending';
  end if;

  -- The habits_limit trigger skips rows whose user is not auth.uid() (null here), so the limit is checked here,
  -- under the same lock: two creations at the same time (bot and web) count one after the other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));

  if (select pg_catalog.count(*) from public.habits h where h.user_id = v_user_id) >= 50 then
    return 'limit';
  end if;

  -- The table's checks decide what is valid (name, palette color, not null).
  begin
    insert into public.habits (user_id, name, color) values (v_user_id, v_name, p_color);
  exception
    when unique_violation then
      return 'duplicate';
    when check_violation or not_null_violation then
      return 'invalid';
  end;

  delete from private.telegram_pending p where p.chat_id = p_chat_id;

  return 'ok';
end;
$$;

revoke all on function public.telegram_create_habit(text, bigint, text) from public, anon, authenticated;
grant execute on function public.telegram_create_habit(text, bigint, text) to anon;

-- First step of renaming one of the linked user's habits: the next free text is its new name.
create or replace function public.telegram_start_rename(p_secret text, p_chat_id bigint, p_habit_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  perform private.telegram_check_secret(p_secret);

  select l.user_id into v_user_id from public.telegram_links l where l.chat_id = p_chat_id;

  if v_user_id is null then
    return 'not_linked';
  end if;

  if not exists (select 1 from public.habits h where h.id = p_habit_id and h.user_id = v_user_id) then
    return 'not_found';
  end if;

  insert into private.telegram_pending (chat_id, action, habit_id, name, expires_at)
  values (p_chat_id, 'rename', p_habit_id, null, pg_catalog.now() + interval '10 minutes')
  on conflict (chat_id) do update
    set action = excluded.action, habit_id = excluded.habit_id, name = excluded.name, expires_at = excluded.expires_at;

  return 'ok';
end;
$$;

revoke all on function public.telegram_start_rename(text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.telegram_start_rename(text, bigint, uuid) to anon;

-- 'create' or 'rename' if the linked chat has something pending that has not expired, null otherwise: where the
-- bot sends the free text.
create or replace function public.telegram_pending_action(p_secret text, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  perform private.telegram_check_secret(p_secret);

  select p.action into v_action
  from private.telegram_pending p
  join public.telegram_links l on l.chat_id = p.chat_id
  where p.chat_id = p_chat_id and p.expires_at > pg_catalog.now();

  return v_action;
end;
$$;

revoke all on function public.telegram_pending_action(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_pending_action(text, bigint) to anon;

-- Second step: renames the pending habit to p_name and clears what was pending. 'invalid' and 'duplicate' keep it,
-- so the next text tries again; a habit that is gone ('not_found') clears it.
create or replace function public.telegram_rename_habit(p_secret text, p_chat_id bigint, p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_habit_id uuid;
begin
  perform private.telegram_check_secret(p_secret);

  select l.user_id into v_user_id from public.telegram_links l where l.chat_id = p_chat_id;

  if v_user_id is null then
    return 'not_linked';
  end if;

  -- for update: two texts at the same time rename once; the second finds the row gone and gets 'no_pending'.
  select p.habit_id into v_habit_id
  from private.telegram_pending p
  where p.chat_id = p_chat_id and p.action = 'rename' and p.expires_at > pg_catalog.now()
  for update;

  if v_habit_id is null then
    return 'no_pending';
  end if;

  -- The table's checks decide what is valid (1 to 60 characters, no surrounding spaces, not null).
  begin
    update public.habits h set name = p_name where h.id = v_habit_id and h.user_id = v_user_id;
    if not found then
      delete from private.telegram_pending p where p.chat_id = p_chat_id;
      return 'not_found';
    end if;
  exception
    when unique_violation then
      return 'duplicate';
    when check_violation or not_null_violation then
      return 'invalid';
  end;

  delete from private.telegram_pending p where p.chat_id = p_chat_id;

  return 'ok';
end;
$$;

revoke all on function public.telegram_rename_habit(text, bigint, text) from public, anon, authenticated;
grant execute on function public.telegram_rename_habit(text, bigint, text) to anon;

-- /cancelar, and any command: drops whatever the chat had pending. Only touches the chat's own row.
create or replace function public.telegram_cancel(p_secret text, p_chat_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.telegram_check_secret(p_secret);

  delete from private.telegram_pending p where p.chat_id = p_chat_id;
end;
$$;

revoke all on function public.telegram_cancel(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_cancel(text, bigint) to anon;

-- Deletes one of the linked user's habits with its history (check_ins cascade).
create or replace function public.telegram_delete_habit(p_secret text, p_chat_id bigint, p_habit_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  perform private.telegram_check_secret(p_secret);

  select l.user_id into v_user_id from public.telegram_links l where l.chat_id = p_chat_id;

  if v_user_id is null then
    return 'not_linked';
  end if;

  delete from public.habits h where h.id = p_habit_id and h.user_id = v_user_id;

  if not found then
    return 'not_found';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.telegram_delete_habit(text, bigint, uuid) from public, anon, authenticated;
grant execute on function public.telegram_delete_habit(text, bigint, uuid) to anon;

-- «Cargar datos de ejemplo» from the bot, with the link's today. 'not_empty' if the user already has habits.
create or replace function public.telegram_load_sample(p_secret text, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_today date;
begin
  perform private.telegram_check_secret(p_secret);

  select l.user_id, (pg_catalog.now() at time zone l.tz)::date
  into v_user_id, v_today
  from public.telegram_links l
  where l.chat_id = p_chat_id;

  if v_user_id is null then
    return 'not_linked';
  end if;

  if not private.load_sample_data_for(v_user_id, v_today) then
    return 'not_empty';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.telegram_load_sample(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_load_sample(text, bigint) to anon;
