// Called every 5 minutes by the database timer (pg_cron). Sends due chat messages.
import { db, vapidKeys } from '../_shared/db.ts';
import { runTick } from '../_shared/tick.ts';

Deno.serve(async (req) => {
  const d = db(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = req.headers.get('x-cron-token') || '';
  const rows = await d.get('app_keys?select=value&name=eq.cron_token');
  if (!token || !rows.length || rows[0].value !== token) {
    return new Response('Not allowed', { status: 401 });
  }
  try {
    const out = await runTick({
      db: d,
      keys: await vapidKeys(d),
      subject: Deno.env.get('VAPID_SUBJECT') || 'mailto:hello@lifeos.app',
      appUrl: Deno.env.get('APP_URL') || '',
      resendKey: Deno.env.get('RESEND_API_KEY') || '',
      resendFrom: Deno.env.get('RESEND_FROM') || '',
    });
    return Response.json(out);
  } catch (e) {
    console.error(e);
    return new Response('Tick failed', { status: 500 });
  }
});
