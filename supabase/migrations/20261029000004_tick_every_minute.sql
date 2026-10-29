-- Testing: chat times can be 1 minute away, so the scheduler checks every minute.
-- (Same job name, so this replaces the every-5-minutes schedule.)
select cron.schedule(
  'lifeos-tick',
  '* * * * *',
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
