-- Telegram bot. The webhook has no user session and no service_role: it calls these narrow security definer
-- functions as anon, and each one first checks the bot secret kept in private (not exposed by the API).
-- The secret row is inserted by hand (SQL Editor), never in the repo:
--   insert into private.telegram_secret (secret) values ('<TELEGRAM_WEBHOOK_SECRET>');

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users on delete cascade,
  chat_id bigint not null unique,
  tz text not null default 'Europe/Madrid',
  linked_at timestamptz not null default now()
);

-- Rows are only written by the functions below; the owner can see and remove their own link.
-- chat_id (the Telegram user id) is not readable by the API: the app only needs to know whether a link exists.
revoke all on table public.telegram_links from anon, authenticated;
grant select (user_id, tz, linked_at), delete on table public.telegram_links to authenticated;

alter table public.telegram_links enable row level security;

drop policy if exists "telegram_links_select_own" on public.telegram_links;
create policy "telegram_links_select_own" on public.telegram_links
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "telegram_links_delete_own" on public.telegram_links;
create policy "telegram_links_delete_own" on public.telegram_links
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- private has no USAGE for the API roles (init). RLS without policies is a second wall if a grant ever slips.
create table if not exists private.telegram_link_codes (
  code text primary key,
  user_id uuid not null unique references auth.users on delete cascade,
  tz text not null,
  expires_at timestamptz not null
);

-- The secret is the only barrier of the anon functions, so the database refuses an empty or short one.
-- Same characters and maximum as Telegram's secret_token, so one value serves the webhook header and p_secret.
-- The length is not a {32,256} in the regex: the maximum repetition there is 255.
create table if not exists private.telegram_secret (
  id boolean primary key default true check (id),
  secret text not null check (char_length(secret) between 32 and 256 and secret ~ '^[A-Za-z0-9_-]+$')
);

revoke all on table private.telegram_link_codes, private.telegram_secret from public, anon, authenticated;
alter table private.telegram_link_codes enable row level security;
alter table private.telegram_secret enable row level security;

-- Raises unless p_secret matches the stored one. No row → nothing matches → raises.
-- Hashes are compared so the check does not depend on a text comparison that stops at the first difference.
-- Not security definer: it only runs inside the definer functions below, as their owner.
create or replace function private.telegram_check_secret(p_secret text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.telegram_secret s
    where extensions.digest(s.secret, 'sha256') = extensions.digest(p_secret, 'sha256')
  ) then
    raise exception 'Forbidden' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function private.telegram_check_secret(text) from public, anon, authenticated;

-- One-time code for the signed-in user: 8 characters of Crockford base32 (no I, L, O or U), valid 10 minutes.
-- Any previous code of the user stops working. The user's time zone travels with the code to the link.
create or replace function public.create_telegram_link_code(p_tz text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz) then
    p_tz := 'Europe/Madrid';
  end if;

  -- 256 is a multiple of 32, so «byte % 32» picks every character with the same probability.
  select pg_catalog.string_agg(
    pg_catalog.substr(v_alphabet, pg_catalog.get_byte(v_bytes, i) % 32 + 1, 1), '' order by i)
  into v_code
  from pg_catalog.generate_series(0, 7) as i;

  -- One row per user: a new code replaces the previous one, also with two requests at the same time.
  insert into private.telegram_link_codes (code, user_id, tz, expires_at)
  values (v_code, v_user_id, p_tz, pg_catalog.now() + interval '10 minutes')
  on conflict (user_id) do update
    set code = excluded.code, tz = excluded.tz, expires_at = excluded.expires_at;

  return v_code;
end;
$$;

revoke all on function public.create_telegram_link_code(text) from public, anon, authenticated;
grant execute on function public.create_telegram_link_code(text) to authenticated;

-- Consumes the code (also when it has expired) and links the chat to its user. A user has one chat and a chat
-- one user: linking again replaces the user's chat, and a chat linked to someone else moves to this user.
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

  return 'linked';
end;
$$;

revoke all on function public.telegram_link(text, text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_link(text, text, bigint) to anon;

create or replace function public.telegram_unlink(p_secret text, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.telegram_check_secret(p_secret);

  delete from public.telegram_links l where l.chat_id = p_chat_id;

  if found then
    return 'unlinked';
  end if;
  return 'not_linked';
end;
$$;

revoke all on function public.telegram_unlink(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_unlink(text, bigint) to anon;

-- Lets the bot tell «link your account» apart from «no habits yet» (an empty telegram_today).
create or replace function public.telegram_status(p_secret text, p_chat_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.telegram_check_secret(p_secret);

  if exists (select 1 from public.telegram_links l where l.chat_id = p_chat_id) then
    return 'linked';
  end if;
  return 'not_linked';
end;
$$;

revoke all on function public.telegram_status(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_status(text, bigint) to anon;

-- The linked user's habits with today's state. Today is the link's time zone's, never a day from outside.
create or replace function public.telegram_today(p_secret text, p_chat_id bigint)
returns table (habit_id uuid, name text, color text, done boolean, today date)
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
    exists (select 1 from public.check_ins c where c.habit_id = h.id and c.day = v_today),
    v_today
  from public.habits h
  where h.user_id = v_user_id
  order by h.created_at, h.id;
end;
$$;

revoke all on function public.telegram_today(text, bigint) from public, anon, authenticated;
grant execute on function public.telegram_today(text, bigint) to anon;

-- Marks (p_done) or unmarks today's check-in of one of the linked user's habits. Idempotent both ways.
create or replace function public.telegram_set_checkin(p_secret text, p_chat_id bigint, p_habit_id uuid, p_done boolean)
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

  if p_done then
    insert into public.check_ins (habit_id, user_id, day)
    values (p_habit_id, v_user_id, v_today)
    on conflict do nothing;
  else
    delete from public.check_ins c
    where c.habit_id = p_habit_id and c.user_id = v_user_id and c.day = v_today;
  end if;

  return 'ok';
end;
$$;

revoke all on function public.telegram_set_checkin(text, bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.telegram_set_checkin(text, bigint, uuid, boolean) to anon;
