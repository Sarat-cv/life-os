// Scheduler logic against an in-memory database. Run: node --experimental-strip-types tests/tick.test.ts
import { runTick, chatMessage, clockIn } from '../supabase/functions/_shared/tick.ts';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const now = new Date('2026-10-28T14:00:00Z'); // 7:30 pm IST
const at = (min: number) => new Date(now.getTime() + min * 60000).toISOString();
const tables: any = {
  profiles: [
    { id: 'u1', name: 'Asha', tz: 'Asia/Kolkata', next_chat_n: 2, next_chat_at: at(0), notified_at: null, reminded_at: null, state: { phase: 'lock', a: {} } },
    { id: 'u2', name: 'Ravi', tz: 'Asia/Kolkata', next_chat_n: 3, next_chat_at: at(30), notified_at: null, reminded_at: null, state: { phase: 'lock', a: {} } },
    { id: 'u3', name: 'Meera', tz: 'Asia/Kolkata', next_chat_n: 4, next_chat_at: at(-35), notified_at: at(-35), reminded_at: null, state: { phase: 'lock', a: {} } },
    { id: 'u4', name: 'Kabir', tz: 'Asia/Kolkata', next_chat_n: 4, next_chat_at: at(-40), notified_at: at(-40), reminded_at: null, state: { phase: 'chat', a: {} } },
    { id: 'u5', name: 'Nisha', tz: 'Asia/Kolkata', next_chat_n: 3, next_chat_at: at(-2), notified_at: null, reminded_at: null, state: { phase: 'lock', a: { dprev3: true } } },
    { id: 'u6', name: 'Old', tz: 'Asia/Kolkata', next_chat_n: 3, next_chat_at: at(-60 * 24), notified_at: null, reminded_at: null, state: { phase: 'lock', a: {} } },
  ],
  push_subscriptions: [
    { id: 1, user_id: 'u1', endpoint: 'https://web.push.apple.com/a', p256dh: 'x', auth: 'y' },
    { id: 2, user_id: 'u1', endpoint: 'https://web.push.apple.com/dead', p256dh: 'x', auth: 'y' },
    { id: 3, user_id: 'u3', endpoint: 'https://web.push.apple.com/c', p256dh: 'x', auth: 'y' },
  ],
};
function parse(path: string) {
  const [t, q] = path.split('?');
  const conds = (q || '').split('&').filter((s) => !s.startsWith('select=') && !s.startsWith('on_conflict='));
  return { t, conds: conds.map((c) => { const [k, ...r] = c.split('='); return [k, decodeURIComponent(r.join('='))]; }) };
}
function match(row: any, conds: string[][]) {
  return conds.every(([k, v]) => {
    const x = row[k];
    if (v === 'is.null') return x == null;
    if (v === 'not.is.null') return x != null;
    if (v.startsWith('eq.')) return String(x) === v.slice(3);
    if (v.startsWith('lte.')) return x != null && Date.parse(x) <= Date.parse(v.slice(4));
    if (v.startsWith('gte.')) return x != null && Date.parse(x) >= Date.parse(v.slice(4));
    throw new Error('unknown filter ' + v);
  });
}
const sent: any[] = [];
const emails: any[] = [];
const db = {
  get: async (p: string) => { const { t, conds } = parse(p); return tables[t].filter((r: any) => match(r, conds)); },
  post: async () => null,
  patch: async (p: string, b: any) => { const { t, conds } = parse(p); tables[t].filter((r: any) => match(r, conds)).forEach((r: any) => Object.assign(r, b)); },
  del: async (p: string) => { const { t, conds } = parse(p); tables[t] = tables[t].filter((r: any) => !match(r, conds)); },
  adminUser: async (id: string) => ({ id, email: id + '@example.com' }),
};
const push = async (s: any, m: any) => { if (s.endpoint.endsWith('dead')) return { ok: false, status: 410, gone: true }; sent.push({ to: s.endpoint, ...m }); return { ok: true, status: 201, gone: false }; };
const fetcher: any = async (_u: string, init: any) => { emails.push(JSON.parse(init.body)); return { ok: true }; };
const keys: any = { publicKey: 'k', privateJwk: {} };

const out = await runTick({ db, keys, subject: 'mailto:t@t', now, push, fetcher, resendKey: 're_test', appUrl: 'https://x.github.io/life-os/' });
console.log(JSON.stringify(out));
ok(sent.some((s) => s.to.endsWith('/a') && /Hi Asha, it’s 7:30 pm, the time we picked/.test(s.body)), 'Asha gets her chat 2 message at 7:30 pm IST');
ok(!tables.push_subscriptions.some((s: any) => s.endpoint.endsWith('dead')), 'a dead iPhone subscription is removed');
ok(!!tables.profiles[0].notified_at, 'Asha is marked as messaged');
ok(!tables.profiles[1].notified_at, 'Ravi (30 minutes away) is not messaged yet');
ok(sent.some((s) => s.to.endsWith('/c') && /No rush, Meera/.test(s.body)) && !!tables.profiles[2].reminded_at, 'Meera gets one reminder after 30 minutes');
ok(!sent.some((s) => /Kabir/.test(s.body)), 'Kabir, already in the chat, gets no reminder');
ok(emails.length === 1 && emails[0].to[0] === 'u5@example.com' && /no pressure at all/.test(emails[0].text), 'Nisha (no push, after a hard day) gets the gentle check-in by email');
ok(!tables.profiles[5].notified_at, 'a chat time from yesterday is not sent late');
const again = await runTick({ db, keys, subject: 'mailto:t@t', now, push, fetcher, resendKey: 're_test' });
ok(again.due === 0 && again.reminders === 0, 'running again sends nothing twice');
const late = new Date('2026-10-28T17:30:00Z'); // 11 pm IST
tables.profiles.push({ id: 'u7', name: 'Late', tz: 'Asia/Kolkata', next_chat_n: 2, next_chat_at: new Date(late.getTime() - 31 * 60000).toISOString(), notified_at: 'x', reminded_at: null, state: { phase: 'lock', a: {} } });
const q = await runTick({ db, keys, subject: 'mailto:t@t', now: late, push, fetcher });
ok(q.skippedQuiet >= 1 && !!tables.profiles[6].reminded_at && !sent.some((s) => /Late/.test(s.body)), 'no reminder after 10:45 pm');
ok(q.due === 0, 'a missed chat time is not sent more than 2 hours late');
ok(clockIn('2026-10-28T16:30:00Z', 'Asia/Kolkata') === '10:00 pm', 'clock reads 10:00 pm in IST');
ok(chatMessage({ name: 'A', next_chat_n: 5, next_chat_at: at(0), tz: 'Asia/Kolkata', state: { a: {} } }).body.includes('one small step'), 'chat 5 message');
process.exit(fails ? 1 : 0);
