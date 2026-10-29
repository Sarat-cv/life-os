-- Life OS pilot: the scheduler.
-- Every 5 minutes the database calls the "tick" backend function, which sends any
-- chat messages and reminders that are due. __PROJECT_REF__ is filled in by the
-- deploy workflow from the SUPABASE_PROJECT_REF repository variable.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'lifeos-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-token', (select value from public.app_keys where name = 'cron_token')
    ),
    body    := '{}'::jsonb
  );
  $$
);
