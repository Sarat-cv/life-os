// Plays thousands of random people through chats 2 to 5 using the real chat script,
// and fails on broken text (undefined, NaN, placeholders), dead ends or loops.
// Run: node tests/sim.js [runs]
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../design/Chats.dc.html', 'utf8');
const code = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/)[1];
global.window = {}; global.localStorage = { getItem: () => null, setItem() {} };
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(x) { this.state = Object.assign({}, this.state, typeof x === 'function' ? x(this.state) : x); } forceUpdate() {} }
const Component = new Function('DCLogic', code + '\nreturn Component;')(DCLogic);
const RUNS = +process.argv[2] || 3000;
const areas = ['mind', 'body', 'work', 'money', 'rel', 'dir', 'sleep', 'other'];
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const texts = ['For my kids', 'My mother. I want her to stop worrying about me.', 'To prove it to myself', 'Because I’m tired of being tired', 'I want to feel proud again'];
let bad = 0, stats = { runs: 0, paths: {}, d: 0, why: 0, skipped: 0 };
for (let r = 0; r < RUNS; r++) {
  const c = new Component({});
  c.logChat = () => {};
  const area = pick(areas);
  const a0 = c.sample(2, { area, score: 1 + Math.floor(Math.random() * 9), name: 'Meera', areaOther: area === 'other' ? 'my studies' : '' });
  c.state = Object.assign(c.fresh(2, a0), { pv: {} });
  let conv = 2, steps = 0, out = [];
  c.goTo('c2_hi', c.state.a, []);
  while (conv <= 5 && steps < 400) {
    steps++;
    const s = c.state;
    if (s.phase === 'end') { out.push(...s.msgs); if (c.isD(conv, s.a)) { stats.d++; const clean = {}; Object.keys(s.a).forEach((k) => { if (k.indexOf('c' + conv + '_') !== 0) clean[k] = s.a[k]; }); clean['dprev' + conv] = true; c.state = Object.assign(c.state, c.fresh(conv, clean)); } else { conv++; c.state = Object.assign(c.state, c.fresh(conv, s.a)); } if (conv > 5) break; c.goTo('c' + conv + '_hi', c.state.a, []); continue; }
    if (s.phase === 'resched') { c.state = Object.assign(c.state, { phase: 'lock' }); c.goTo('c' + conv + '_hi', c.state.a, []); continue; }
    const st = c.def(s.step, s.a);
    let v;
    if (st.kind === 'text') { v = (st.skip && Math.random() < 0.25) ? st.skip : pick(texts); if (v === st.skip) stats.skipped++; c.answer(v, v); continue; }
    let opts = st.options.filter((o) => !/Later is better/.test(o));
    if (Math.random() > 0.03) opts = opts.filter((o) => !/Not great|^Low$/.test(o));
    if (st.kind === 'multi' && Math.random() < 0.5) { const vs = opts.filter(() => Math.random() < 0.5); v = vs.length ? vs : [opts[0]]; c.answer(v, v.join(', ')); continue; }
    v = pick(opts); c.answer(v, v);
  }
  const a = c.state.a;
  stats.runs++; stats.paths[c.pathOf(a)] = (stats.paths[c.pathOf(a)] || 0) + 1; if (c.whyOf(a)) stats.why++;
  const txt = out.filter((m) => m.k !== 'status').map((m) => (m.t || '') + ' ' + (m.title || '') + ' ' + (m.rows || []).map((x) => x.t).join(' ')).join('\n');
  const probs = [];
  if (steps >= 400) probs.push('loop');
  if (/undefined|NaN|\[object|\{m\}|null/.test(txt)) probs.push('broken text: ' + (txt.match(/.{0,60}(undefined|NaN|\[object|\{m\}|null).{0,30}/) || [''])[0]);
  if (/I’m an AI/.test(out.filter((m) => m.k === 'bot').map((m) => m.t).join(' ').split('Chat 4')[1] || '')) probs.push('story repeated');
  if (/Why an? \d+, and not a/.test(txt) && /Why a 8|Why an [0-79]/.test(txt)) probs.push('a/an');
  if (c.whyOf(a) && !/So that:/.test(txt) && !/Done\. We’ll start/.test(txt) && a.c5_plan) probs.push('plan missing reason');
  if (probs.length) { bad++; if (bad <= 5) console.log('RUN', r, area, c.pathOf(a), probs); }
}
console.log(JSON.stringify(stats));
console.log(bad ? bad + ' runs with problems' : 'ALL ' + RUNS + ' RUNS CLEAN');
process.exit(bad ? 1 : 0);
