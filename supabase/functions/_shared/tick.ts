// What the scheduler does every 5 minutes: message people whose chat time has come,
// and send one gentle reminder 30 minutes later if they haven't opened the chat.
// Kept free of Deno-only code so it can be tested with plain Node.

import type { Db } from './db.ts';
import { sendPush, type VapidKeys } from './webpush.ts';

const MIN = 60 * 1000;

export type TickEnv = {
  db: Db;
  keys: VapidKeys;
  subject: string;
  now?: Date;
  appUrl?: string;
  resendKey?: string;
  resendFrom?: string;
  fetcher?: typeof fetch;
  push?: typeof sendPush;
};

export function clockIn(iso: string, tz?: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  let s: string;
  try { s = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || 'Asia/Kolkata' }).format(new Date(iso)); }
  catch (_) { s = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'Asia/Kolkata' }).format(new Date(iso)); }
  return s.replace(/\s?AM$/i, ' am').replace(/\s?PM$/i, ' pm').replace(/ /g, ' ');
}

function localHour(d: Date, tz?: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz || 'Asia/Kolkata' }).formatToParts(d);
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return (h % 24) + m / 60;
  } catch (_) { return 12; }
}

export function chatMessage(p: any): { title: string; body: string } {
  const name = (p.name || '').trim() || 'there';
  const n = p.next_chat_n || 2;
  const a = (p.state && p.state.a) || {};
  const clock = clockIn(p.next_chat_at, p.tz);
  if (a['dprev' + n]) return { title: 'Life OS', body: 'Hi ' + name + ', it’s me. Just checking in on you, no pressure at all.' };
  const lines: Record<number, string> = {
    2: 'Hi ' + name + ', it’s ' + clock + ', the time we picked. Ready for our chat?',
    3: 'Hi ' + name + ', it’s ' + clock + '. Today is about what happened when you tried.',
    4: 'Hi ' + name + ', it’s ' + clock + '. Today: how you’re feeling about trying again.',
    5: 'Hi ' + name + ', it’s ' + clock + '. Today we start, with one small step.',
  };
  return { title: 'Still good to talk?', body: lines[n] || lines[2] };
}

export function reminderMessage(p: any): { title: string; body: string } {
  const name = (p.name || '').trim() || 'there';
  return { title: 'Life OS', body: 'No rush, ' + name + '. I’m here whenever you’re ready. You can move our chat too.' };
}

async function deliver(env: TickEnv, p: any, msg: { title: string; body: string }, allowEmail: boolean) {
  const push = env.push || sendPush;
  const subs = await env.db.get('push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq.' + p.id);
  let delivered = 0;
  for (const s of subs) {
    try {
      const r = await push(s, { title: msg.title, body: msg.body, url: './', tag: 'chat-' + (p.next_chat_n || 2) }, env.keys, env.subject);
      if (r.ok) delivered++;
      else if (r.gone) await env.db.del('push_subscriptions?id=eq.' + s.id);
    } catch (_) { /* try the next device */ }
  }
  let emailed = false;
  if (!delivered && allowEmail && env.resendKey) {
    try {
      const u = await env.db.adminUser(p.id);
      const to = u && (u.email || (u.user && u.user.email));
      if (to) {
        const f = env.fetcher || fetch;
        const res = await f('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.resendKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: env.resendFrom || 'Life OS <onboarding@resend.dev>',
            to: [to],
            subject: msg.title,
            text: msg.body + (env.appUrl ? '\n\nOpen Life OS: ' + env.appUrl : '') + '\n\nYou’re getting this because notifications are off in Life OS.',
          }),
        });
        emailed = res.ok;
      }
    } catch (_) { /* no email this time */ }
  }
  return { delivered, emailed };
}

export async function runTick(env: TickEnv) {
  const now = env.now || new Date();
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const cols = 'id,name,tz,state,next_chat_n,next_chat_at,notified_at,reminded_at';
  const out = { due: 0, sent: 0, emailed: 0, reminders: 0, skippedQuiet: 0 };

  const due = await env.db.get('profiles?select=' + cols +
    '&notified_at=is.null&next_chat_at=lte.' + encodeURIComponent(iso(MIN)) +
    '&next_chat_at=gte.' + encodeURIComponent(iso(-2 * 60 * MIN)));
  for (const p of due) {
    const phase = p.state && p.state.phase;
    if (phase && phase !== 'lock') continue;
    out.due++;
    const r = await deliver(env, p, chatMessage(p), true);
    out.sent += r.delivered; if (r.emailed) out.emailed++;
    const patch: any = { notified_at: now.toISOString() };
    if (r.emailed) patch.emailed_at = now.toISOString();
    await env.db.patch('profiles?id=eq.' + p.id, patch);
  }

  const late = await env.db.get('profiles?select=' + cols +
    '&notified_at=not.is.null&reminded_at=is.null&next_chat_at=lte.' + encodeURIComponent(iso(-30 * MIN)) +
    '&next_chat_at=gte.' + encodeURIComponent(iso(-6 * 60 * MIN)));
  for (const p of late) {
    const phase = p.state && p.state.phase;
    if (phase && phase !== 'lock') continue;
    const h = localHour(now, p.tz);
    if (h >= 22.75 || h < 7) { out.skippedQuiet++; }
    else { const r = await deliver(env, p, reminderMessage(p), false); out.reminders += r.delivered; }
    await env.db.patch('profiles?id=eq.' + p.id, { reminded_at: now.toISOString() });
  }
  return out;
}
