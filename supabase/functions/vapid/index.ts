// Gives the app the public push key, so an iPhone can subscribe to notifications.
// The private key never leaves the server.
import { cors, db, vapidKeys } from '../_shared/db.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const d = db(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const keys = await vapidKeys(d);
    return Response.json({ publicKey: keys.publicKey }, { headers: cors });
  } catch (e) {
    console.error(e);
    return new Response('Unavailable', { status: 500, headers: cors });
  }
});
