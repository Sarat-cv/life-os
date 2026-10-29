-- Pilot: no email code. Each phone gets a private (anonymous) account on first open,
-- and the email the person types is kept on their profile.
alter table public.profiles add column if not exists email text;

-- The journey: every screen, chat step and answer, in order, per person.
create table public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  name        text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index events_user_time on public.events (user_id, created_at);

alter table public.events enable row level security;
create policy "own events: add"  on public.events for insert with check (user_id = auth.uid());
create policy "own events: read" on public.events for select using (user_id = auth.uid());

-- For the founder, in Supabase > Table Editor or SQL: one row per person, newest first.
create or replace view public.journey_overview with (security_invoker = true) as
select p.id, p.name, p.email, p.area, p.score, p.path,
       p.state->>'phase' as phase, (p.state->>'conv')::int as chat,
       p.next_chat_at, p.push_on, p.created_at,
       (select max(e.created_at) from public.events e where e.user_id = p.id) as last_seen,
       (select count(*) from public.chats c where c.user_id = p.id) as chats_done
from public.profiles p
order by p.created_at desc;
revoke all on public.journey_overview from anon, authenticated;
