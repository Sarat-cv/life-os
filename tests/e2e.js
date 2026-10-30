// End-to-end test of the real app against a mock backend.
// Run from the repo root: node tests/e2e.js   (needs Playwright with Chromium)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'web');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  async function newPage(storage) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, serviceWorkers: 'block', hasTouch: true });
    await ctx.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
    await ctx.route('**/fonts.googleapis.com/**', (r) => r.abort());
    await ctx.route('**/fonts.gstatic.com/**', (r) => r.abort());
    await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.LIFEOS_CONFIG = { supabaseUrl: 'https://demo.supabase.co', supabaseKey: 'sb_publishable_demo', testing: false };" }));
    if (storage) { await ctx.addInitScript((s) => { if (!sessionStorage.getItem('__seeded')) { Object.keys(s).forEach((k) => localStorage.setItem(k, s[k])); sessionStorage.setItem('__seeded', '1'); } }, storage); }
    const page = await ctx.newPage();
    page.errs = [];
    page.on('pageerror', (e) => page.errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) page.errs.push(m.text()); });
    return page;
  }
  const p = await newPage();
  const app = p.locator('#app');
  const tap = async (t) => { await app.getByRole('button', { name: t, exact: true }).first().click({ timeout: 4000 }); await p.waitForTimeout(80); };
  const text = () => app.innerText();
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem('__mockdb') || '{}'));

  // 1. Safari landing
  await p.goto(base);
  await p.waitForTimeout(300);
  ok(await p.locator('#landing').isVisible(), 'iPhone Safari shows the landing page first');
  await p.click('#landStart');
  ok(/Add Life OS to your Home Screen/.test(await p.locator('#landB').innerText()), 'Get started shows the Home Screen steps');
  await p.click('#landSkip');
  ok(!(await p.locator('#landing').isVisible()), 'Continue in Safari opens the app');

  // 2. Onboarding with real login
  await app.locator('#name').fill('Asha'); await tap('Let’s begin');
  await tap('3 out of 10'); await tap('Continue');
  await tap('Continue');
  await tap('Body and health'); await tap('Continue');
  await tap('I have no energy to do anything'); await tap('Continue');
  await tap('Okay, what’s next?');
  const slots = await app.locator('button').allInnerTexts();
  const first = slots.find((s) => /^(Today|Tomorrow), \d/.test(s));
  ok(!!first, 'chat times are real times from now: ' + first);
  await tap(first); await tap('Book it');
  ok(/stored securely in India/.test(await text()) && /Where can I reach you/.test(await text()), 'email screen explains storage and AI');
  await app.locator('#email').fill('asha'); await tap('Continue');
  ok(/Enter your email/.test(await text()), 'a mistyped email gets a friendly note');
  await app.locator('#email').fill('asha@example.com'); await tap('Continue');
  ok(/Can I reach you/.test(await text()), 'email goes straight on to notifications, no code');
  await tap('Allow notifications');
  await p.waitForTimeout(900);
  let t = await text();
  ok(/Our next chat · 2 of 5/.test(t), 'home screen shows the next chat');
  ok(/add Life OS to your Home Screen/i.test(t), 'in Safari it explains that push needs the Home Screen app');
  let d = await db();
  const prof = (d.profiles || [])[0] || {};
  ok(prof.name === 'Asha' && prof.email === 'asha@example.com' && prof.next_chat_n === 2 && !!prof.next_chat_at, 'profile saved with the chat 2 time: ' + prof.next_chat_at);

  const makeDue = async () => { await p.evaluate(() => { const c = window.LIFEOS_APP; const k = c.lockKey(c.state.conv); c.whenFor = null; const R = window.LIFEOS_REAL; R.whenFor(c.state.a, k); c.state.a[k + '@'].iso = new Date(Date.now() - 60000).toISOString(); c.forceUpdate(); }); await p.waitForTimeout(100); };
  // 3. Chat comes due
  await p.evaluate(() => { const c = window.LIFEOS_APP; c.state.a['onb_time@'].iso = new Date(Date.now() - 60000).toISOString(); c.forceUpdate(); });
  ok(await app.getByRole('button', { name: 'Let’s talk now' }).count() > 0, 'at the chat time, Let’s talk now appears');
  await tap('Let’s talk now');

  async function drive(stopRe, avoid) {
    for (let i = 0; i < 260; i++) {
      const tx = await text();
      if (stopRe.test(tx)) return true;
      if (await app.locator('#txt').count()) {
        const prompt = tx.split('\n').filter(Boolean).slice(-6).join(' ');
        const answer = /real reason|What’s yours|worst day/.test(prompt) ? 'My daughter Anya is 6. I want to run with her at the park.'
          : /three months/.test(prompt) ? 'Run with Anya at the park on Sunday mornings'
          : /and not a/.test(prompt) ? 'Because she won’t be 6 forever'
          : /keeps you going/.test(prompt) ? 'Her laugh. Sunday mornings.' : 'Something I want to add';
        await app.locator('#txt').fill(answer); await tap('Send'); continue;
      }
      const chips = app.locator('button[aria-pressed]');
      if (await chips.count()) {
        const labels = await chips.allInnerTexts();
        let k = labels.findIndex((l) => !(avoid || /Not great|^Low$|Out with people/).test(l));
        await chips.nth(Math.max(k, 0)).click(); await p.waitForTimeout(40);
        await tap('Send'); continue;
      }
      const btns = app.locator('div[style*="border-top: 1px solid #E3DCD0"] button');
      const labels = await btns.allInnerTexts();
      const k = labels.findIndex((l) => !/Later is better|Something’s changed|Wrap up|Not today|answer next time|^Not yet$|^Send$/.test(l));
      if (k >= 0) { if (labels[k] === 'Done for today') return true; await btns.nth(k).click(); await p.waitForTimeout(40); continue; }
      console.log('STUCK:', tx.split('\n').slice(-5).join(' | ')); return false;
    }
    return false;
  }
  ok(await drive(/Done for today/), 'chat 2 runs to the end');
  t = await text();
  ok(!/BEHIND THE SCENES/.test(t), 'no behind-the-scenes cards in the real app');
  await p.waitForTimeout(1000);
  d = await db();
  ok((d.chats || []).length === 1 && d.chats[0].n === 2 && d.chats[0].messages.length > 10, 'chat 2 saved to the story file with its messages');
  ok(!d.chats[0].messages.some((m) => m.k === 'status'), 'saved chat has no internal status cards');
  ok(!/Arjun/.test(JSON.stringify(d.chats[0].messages)), 'saved chat uses the person’s name, not the sample name');
  ok(d.profiles[0].next_chat_n === 3 && !!d.profiles[0].next_chat_at, 'chat 3 is scheduled even before tapping Done');
  await tap('Done for today');
  t = await text();
  ok(/Our next chat · 3 of 5/.test(t) && /Change the time/.test(t), 'home shows chat 3 and lets you change the time');

  // 4. Reschedule
  const before = (await db()).profiles[0].next_chat_at;
  await tap('Change the time');
  const opts = await app.locator('button').allInnerTexts();
  const pick = opts.find((s) => /\(in 10 min\)/.test(s)) || opts.find((s) => /^(Tomorrow|Day after), /.test(s) && !/after work/.test(s));
  await tap(pick);
  await p.waitForTimeout(900);
  t = await text();
  ok(/Moved to/.test(t) && !/Here’s how it will look/.test(t), 'reschedule confirms the new time kindly: ' + (t.match(/Moved to[^\n]*/) || [''])[0]);
  ok((await db()).profiles[0].next_chat_at !== before, 'new time saved for the scheduler');

  // 5. Reload keeps everything
  await p.reload(); await p.waitForTimeout(800);
  ok(/Our next chat · 3 of 5/.test(await text()), 'after closing and reopening, it picks up at chat 3');

  // 6. Mid-chat reload resumes the same step
  await makeDue(); await tap('Let’s talk now');
  const chips = app.locator('button[aria-pressed]');
  if (await chips.count()) { await chips.first().click(); await tap('Send'); }
  await p.waitForTimeout(800);
  const stepBefore = await p.evaluate(() => window.LIFEOS_APP.state.step);
  await p.reload(); await p.waitForTimeout(800);
  const stepAfter = await p.evaluate(() => window.LIFEOS_APP.state.step);
  ok(stepBefore === stepAfter && /Your life buddy/.test(await text()), 'mid-chat reload resumes at ' + stepAfter);

  // 7. Chats 3 to 5
  for (const n of [3, 4, 5]) {
    if (n > 3) { await makeDue(); await tap('Let’s talk now'); }
    const done = await drive(/Done for today/);
    await tap('Done for today');
    ok(done, 'chat ' + n + ' runs to the end');
  }
  t = await text();
  ok(/Week 1 starts tomorrow/.test(t), 'after chat 5 the home screen says week 1 starts tomorrow');
  d = await db();
  ok(d.chats.length === 4 && d.chats.map((c) => c.n).join(',') === '2,3,4,5', 'all four chats are in the story file');
  ok(d.profiles[0].next_chat_at == null, 'nothing more scheduled until week 1 is built');
  const all = d.chats.map((c) => c.messages.map((m) => (m.t || '') + ' ' + (m.rows || []).map((r) => r.t).join(' ')).join(' | ')).join(' || ');
  const a5 = d.chats[3].answers;
  ok(/I’m an AI, but I was made by someone/.test(d.chats[0].messages.map((m) => m.t).join(' ')), 'chat 2 has the founder story');
  ok(/Since I’ve shared mine/.test(all) && a5.c2_why === 'My daughter Anya is 6. I want to run with her at the park.', 'chat 2 asks the deep question and keeps their exact words');
  ok(!d.chats[0].answers.c2_k1 && !!a5.c3_pic, 'light questions left chat 2; chat 3 asks for the picture');
  ok(/Last time you told me: “My daughter Anya/.test(all), 'chat 3 opens with their own reason');
  ok(!!a5.c4_word && !!a5.c4_imp && !!a5.c4_impwhy && !!a5.c4_keep, 'chat 4 asks how life feels, how much it matters, why, and what keeps them going');
  ok(!/I’m an AI/.test(d.chats[2].messages.map((m) => m.t).join(' ')), 'the founder story is no longer in chat 4');
  ok(/So that: Run with Anya/.test(all) && !!a5.c5_perm, 'chat 5 ties the step to their picture and asks permission');

  // 8. Menu: report a problem
  await app.getByRole('button', { name: 'Menu' }).click();
  ok(/Your email: asha@example.com/.test(await p.locator('#menu').innerText()) && !(await p.locator('#mSignOut').isVisible()), 'menu shows the email and has no sign out');
  await p.click('#mBug'); await p.fill('#bugText', 'The chat felt long'); await p.click('#bugSend');
  await p.waitForTimeout(300);
  d = await db();
  ok((d.bug_reports || []).length === 1 && /Chat 6/.test(d.bug_reports[0].screen), 'problem report saved with the screen');
  await p.click('#mClose');
  const snapshot = await p.evaluate(() => localStorage.getItem('__mockdb'));

  // 9. Journey tracking
  await p.waitForTimeout(2000);
  d = await db();
  const ev = (d.events || []).map((e) => e.name);
  ok(ev.includes('landing') && ev.includes('setup_score') && ev.includes('setup_area') && ev.includes('email_given'), 'journey has the setup screens in order');
  const area = (d.events || []).find((e) => e.name === 'setup_story');
  ok(area && area.detail && area.detail.area === 'body', 'journey records the area picked');
  const ans = (d.events || []).filter((e) => e.kind === 'chat_step' && e.detail && e.detail.answered);
  ok(ans.length > 30 && ans.some((e) => e.detail.answered === 'c2_tried'), 'journey records each chat answer (' + ans.length + ')');
  ok(ev.includes('menu_open') && ev.includes('bug_report'), 'journey records menu taps');

  // 10. Safety path on a fresh account
  const p3 = await newPage({ lifeos_browser_ok: '1', lifeos_test: '1' });
  const app3 = p3.locator('#app');
  const tap3 = async (x) => { await app3.getByRole('button', { name: x, exact: true }).first().click({ timeout: 4000 }); await p3.waitForTimeout(80); };
  await p3.goto(base); await p3.waitForTimeout(400);
  await app3.locator('#name').fill('Dev'); await tap3('Let’s begin'); await tap3('2 out of 10'); await tap3('Continue'); await tap3('Continue');
  await tap3('Mind and mood'); await tap3('Continue'); await tap3('I feel low most days'); await tap3('Continue'); await tap3('Okay, what’s next?');
  const s3 = (await app3.locator('button').allInnerTexts()).find((s) => /^(Today|Tomorrow), \d/.test(s));
  await tap3(s3); await tap3('Book it');
  await app3.locator('#email').fill('dev@example.com'); await tap3('Continue');
  await tap3('Not now, email me instead'); await p3.waitForTimeout(400);
  ok(/how are you doing/i.test(await app3.innerText()), 'test mode: setup goes straight into chat 2, no waiting');
  await app3.getByRole('button', { name: 'Not great, honestly' }).click(); await tap3('Send');
  const safeQ = await app3.innerText();
  ok(/safe/i.test(safeQ), 'a hard day leads to the safety question');
  const unsure = app3.locator('button[aria-pressed]');
  const ul = await unsure.allInnerTexts();
  const ki = ul.findIndex((l) => /not sure|No/i.test(l));
  if (ki >= 0) { await unsure.nth(ki).click(); await tap3('Send'); } else { const b = app3.locator('div[style*="border-top: 1px solid #E3DCD0"] button'); const bl = await b.allInnerTexts(); const kb = bl.findIndex((l) => /not sure|No/i.test(l)); await b.nth(Math.max(kb, 0)).click(); }
  await p3.waitForTimeout(200);
  ok(await app3.locator('a[href="tel:14416"]').count() === 1 && await app3.locator('a[href="tel:112"]').count() === 1, 'Tele-MANAS 14416 and 112 appear as call buttons');

  // 10b. Test mode end to end without waiting
  const p4 = await newPage({ lifeos_browser_ok: '1', lifeos_test: '1' });
  const app4 = p4.locator('#app');
  const tap4 = async (x) => { await app4.getByRole('button', { name: x, exact: true }).first().click({ timeout: 4000 }); await p4.waitForTimeout(80); };
  await p4.goto(base); await p4.waitForTimeout(400);
  await app4.locator('#name').fill('Mo'); await tap4('Let’s begin'); await tap4('5 out of 10'); await tap4('Continue'); await tap4('Continue');
  await tap4('Work and career'); await tap4('Continue'); await tap4('I’m burnt out'); await tap4('Continue'); await tap4('Okay, what’s next?');
  const t4 = (await app4.locator('button').allInnerTexts()).filter((x) => /\(in \d+ min\)/.test(x));
  ok(t4.length === 4, 'test mode: the four first-chat times are 1 to 10 minutes away');
  await tap4(t4[0]); await tap4('Book it'); await app4.locator('#email').fill('mo@example.com'); await tap4('Continue'); await tap4('Not now, email me instead'); await p4.waitForTimeout(300);
  const ends = [];
  for (let i = 0; i < 700; i++) {
    const tx = await app4.innerText();
    if (/Week 1 starts tomorrow/.test(tx)) break;
    const start = app4.getByRole('button', { name: /^Start chat \d now$/ });
    if (await start.count()) { ends.push(await start.innerText()); await start.click(); await p4.waitForTimeout(80); continue; }
    if (await app4.getByRole('button', { name: 'Done for today' }).count()) { await tap4('Done for today'); continue; }
    if (await app4.locator('#txt').count()) { await app4.locator('#txt').fill('For my mother'); await tap4('Send'); continue; }
    const ch = app4.locator('button[aria-pressed]');
    if (await ch.count()) { const L = await ch.allInnerTexts(); const k = L.findIndex((l) => !/Not great|^Low$|Out with/.test(l)); await ch.nth(Math.max(k, 0)).click(); await tap4('Send'); continue; }
    const bb = app4.locator('div[style*="border-top: 1px solid #E3DCD0"] button'); const BL = await bb.allInnerTexts();
    const kb = BL.findIndex((l) => !/Later is better|Something’s changed|Wrap up|Not today|answer next time|^Not yet$|^Send$/.test(l));
    if (kb < 0) { console.log('P4 STUCK', tx.slice(-200)); break; }
    await bb.nth(kb).click(); await p4.waitForTimeout(40);
  }
  ok(ends.join(',') === 'Start chat 3 now,Start chat 4 now,Start chat 5 now' && /Week 1 starts tomorrow/.test(await app4.innerText()), 'test mode runs chat 2 to 5 back to back: ' + ends.join(', '));

  // 11. Delete everything
  await app.getByRole('button', { name: 'Menu' }).click();
  await p.click('#mDelete'); await p.click('#delYes'); await p.waitForTimeout(2800);
  d = await p.evaluate(() => JSON.parse(localStorage.getItem('__mockdb') || '{}'));
  ok(!(d.profiles || []).some((r) => r.name === 'Asha') && !(d.chats || []).some((c) => c.messages && JSON.stringify(c.messages).includes('Asha')), 'delete removes the profile and chats');
  const fresh = await text();
  if (!/Hi. I’m glad you’re here/.test(fresh)) { console.log('AFTER DELETE:', fresh.slice(0, 200)); }
  ok(/Hi. I’m glad you’re here/.test(fresh), 'after deleting, the app starts fresh');

  for (const pg of [p, p3, p4]) { ok(pg.errs.length === 0, 'no page errors' + (pg.errs.length ? ': ' + pg.errs.join(' | ') : '')); }
  await p.setViewportSize({ width: 375, height: 667 });
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
