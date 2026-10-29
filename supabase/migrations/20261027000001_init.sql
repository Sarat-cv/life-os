-- Life OS pilot: the story file.
-- Every table has row-level security on. A signed-in person can read only their own rows.
-- Facts from chats (story markers), chats, messages and safety events are written only
-- by the save_chat function below, never directly by the app.

create extension if not exists pgcrypto;

-- One row per person. "state" holds where they are in the 5 chats, so the app can pick up
-- on any device. next_chat_at is when the scheduler should message them.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text,
  area          text,
  score         int check (score between 1 and 10),
  path          text,
  push_on       boolean not null default false,
  tz            text,
  state         jsonb,
  next_chat_n   int,
  next_chat_at  timestamptz,
  notified_at   timestamptz,
  reminded_at   timestamptz,
  emailed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Dated facts. An old value is marked superseded, never deleted or overwritten.
create table public.story_markers (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  key            text not null,
  value          jsonb,
  source_chat    int,
  created_at     timestamptz not null default now(),
  superseded_at  timestamptz
);
create index story_markers_current on public.story_markers (user_id, key) where superseded_at is null;

create table public.chats (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  n            int not null,
  path         text,
  is_d         boolean not null default false,
  area         text,
  score        int,
  summary      text,
  finished_at  timestamptz not null default now()
);
create index chats_user on public.chats (user_id, finished_at desc);

create table public.messages (
  id          bigint generated always as identity primary key,
  chat_id     bigint not null references public.chats (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  pos         int not null,
  sender      text not null check (sender in ('buddy', 'user', 'note')),
  kind        text not null,
  text        text,
  extra       jsonb,
  created_at  timestamptz not null default now()
);
create index messages_chat on public.messages (chat_id, pos);

-- Week 1 (milestone M6): the one tiny step and the daily check-ins.
create table public.plan_steps (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  step         text not null,
  minutes      int,
  target_days  int check (target_days between 0 and 7),
  starts_on    date not null default current_date,
  created_at   timestamptz not null default now()
);

create table public.step_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  step_id     bigint references public.plan_steps (id) on delete cascade,
  day         date not null,
  result      text not null check (result in ('done', 'partly', 'not_today')),
  created_at  timestamptz not null default now(),
  unique (user_id, step_id, day)
);

-- The person's own words, to play back later.
create table public.quotes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  chat_n      int,
  text        text not null,
  created_at  timestamptz not null default now()
);

create table public.safety_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  chat_n      int,
  answers     jsonb,
  action      text not null,
  created_at  timestamptz not null default now()
);

create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  ua          text,
  created_at  timestamptz not null default now()
);

create table public.bug_reports (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete cascade,
  screen      text,
  note        text not null,
  created_at  timestamptz not null default now()
);

-- Server-only keys (push keys, the scheduler token). No policies, so the app can't read it.
create table public.app_keys (
  name   text primary key,
  value  text not null
);
insert into public.app_keys (name, value) values ('cron_token', encode(gen_random_bytes(24), 'hex'));

-- Row-level security
alter table public.profiles            enable row level security;
alter table public.story_markers       enable row level security;
alter table public.chats               enable row level security;
alter table public.messages            enable row level security;
alter table public.plan_steps          enable row level security;
alter table public.step_logs           enable row level security;
alter table public.quotes              enable row level security;
alter table public.safety_events       enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.bug_reports         enable row level security;
alter table public.app_keys            enable row level security;

create policy "own profile: read"   on public.profiles for select using (id = auth.uid());
create policy "own profile: create" on public.profiles for insert with check (id = auth.uid());
create policy "own profile: change" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy "own markers: read"  on public.story_markers for select using (user_id = auth.uid());
create policy "own chats: read"    on public.chats         for select using (user_id = auth.uid());
create policy "own messages: read" on public.messages      for select using (user_id = auth.uid());
create policy "own safety: read"   on public.safety_events for select using (user_id = auth.uid());
create policy "own quotes: read"   on public.quotes        for select using (user_id = auth.uid());

create policy "own steps: all" on public.plan_steps for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own logs: all"  on public.step_logs  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own push: read"   on public.push_subscriptions for select using (user_id = auth.uid());
create policy "own push: add"    on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy "own push: change" on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push: remove" on public.push_subscriptions for delete using (user_id = auth.uid());

create policy "own bugs: add"  on public.bug_reports for insert with check (user_id = auth.uid());
create policy "own bugs: read" on public.bug_reports for select using (user_id = auth.uid());

-- When the next chat time changes, the scheduler should message again.
create or replace function public.profiles_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.next_chat_at is distinct from old.next_chat_at then
    new.notified_at := null;
    new.reminded_at := null;
    new.emailed_at  := null;
  elsif tg_op = 'UPDATE' then
    -- the app can't mark its own reminders as sent
    new.notified_at := old.notified_at;
    new.reminded_at := old.reminded_at;
    new.emailed_at  := old.emailed_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before insert or update on public.profiles
for each row when (current_user <> 'service_role') execute function public.profiles_touch();

-- Saves one finished chat: the chat, every line, the dated facts and any safety check.
create or replace function public.save_chat(
  p_conv int, p_path text, p_is_d boolean, p_area text, p_score int,
  p_answers jsonb, p_messages jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cid bigint;
  r record;
  cur jsonb;
  has_cur boolean;
begin
  if uid is null then raise exception 'not signed in'; end if;

  insert into chats (user_id, n, path, is_d, area, score)
  values (uid, p_conv, p_path, coalesce(p_is_d, false), p_area, p_score)
  returning id into cid;

  insert into messages (chat_id, user_id, pos, sender, kind, text, extra)
  select cid, uid, m.ord::int,
         case m.e->>'k' when 'user' then 'user' when 'note' then 'note' else 'buddy' end,
         coalesce(m.e->>'k', 'bot'),
         m.e->>'t',
         nullif(m.e - 'k' - 't', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) with ordinality as m(e, ord);

  for r in select key, value from jsonb_each(coalesce(p_answers, '{}'::jsonb)) where key not like '%@' loop
    select value, true into cur, has_cur from story_markers
      where user_id = uid and key = r.key and superseded_at is null
      order by created_at desc limit 1;
    if has_cur is null or cur is distinct from r.value then
      update story_markers set superseded_at = now()
        where user_id = uid and key = r.key and superseded_at is null;
      insert into story_markers (user_id, key, value, source_chat) values (uid, r.key, r.value, p_conv);
    end if;
    cur := null; has_cur := null;
  end loop;

  if coalesce(p_is_d, false) then
    insert into safety_events (user_id, chat_n, answers, action)
    values (uid, p_conv,
      jsonb_strip_nulls(jsonb_build_object(
        'how_are_you', p_answers->('c' || p_conv || '_hi'),
        'safe',        p_answers->('c' || p_conv || '_dsafe'),
        'after',       p_answers->('c' || p_conv || '_dcrisis'))),
      case when p_answers ? ('c' || p_conv || '_dcrisis') then 'crisis_numbers_shown' else 'gentle_chat' end);
  end if;

  update profiles set path = p_path where id = uid;
  return cid;
end $$;

-- Deletes the person and everything about them (every table cascades from auth.users).
create or replace function public.delete_me() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.save_chat(int, text, boolean, text, int, jsonb, jsonb) from public, anon;
grant execute on function public.save_chat(int, text, boolean, text, int, jsonb, jsonb) to authenticated;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
