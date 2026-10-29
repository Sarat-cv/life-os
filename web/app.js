/*
 * Life OS pilot: connects the onboarding and chat screens to Supabase.
 * - Login with a 6-digit email code
 * - Saves where each person is (the story) after every change, so any device can pick up
 * - Saves each finished chat to the story file (save_chat)
 * - Real chat times, iPhone push notifications, the menu (report, download, delete)
 * The screens call into window.LIFEOS_REAL; on the design canvas it doesn't exist.
 */
(function () {
  'use strict';
  var CFG = window.LIFEOS_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var MIN = 60000, DAY = 864e5;

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  if (/[?&]test=1\b/.test(location.search)) { lsSet('lifeos_test', '1'); }
  if (/[?&]test=0\b/.test(location.search)) { lsDel('lifeos_test'); }

  // Keep the app the size of what's visible, so the iPhone keyboard doesn't cover the chat box.
  function fitViewport() {
    var root = $('root');
    if (!root || window.innerWidth >= 520) { if (root) { root.style.top = ''; root.style.height = ''; } return; }
    var vv = window.visualViewport;
    root.style.height = (vv ? vv.height : window.innerHeight) + 'px';
    root.style.top = (vv ? vv.offsetTop : 0) + 'px';
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('resize', fitViewport);
  fitViewport();

  if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase) {
    $('app').innerHTML = '<div class="boot" style="padding: 24px; text-align: center; line-height: 1.5">Life OS isn’t connected yet.<br>Add the Supabase URL and key in web/config.js.</div>';
    return;
  }

  var sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'lifeos-auth' }
  });

  // Pilot default: no email code. Each phone gets a private account on first open,
  // and the email is kept on the profile. Set loginWithCode: true in config.js to bring codes back.
  var NO_CODE = CFG.loginWithCode !== true;
  var session = null, profile = null, chats = null, emailLocal = '';
  var evq = [], evT = null, lastCtx = '', lastApp = '';
  var pushOnLocal = false, pushCache = null;
  var saveT = null, lastSaved = '', saving = false;
  var pending = [];
  try { pending = JSON.parse(lsGet('lifeos_pending') || '[]') || []; } catch (e) { pending = []; }
  var flushing = false;

  // ---------- time ----------
  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function fmtClock(d) {
    var h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }
  function dayWord(d, now) {
    var diff = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
    return diff === 0 ? 'Today' : (diff === 1 ? 'Tomorrow' : (diff === 2 ? 'Day after' : null));
  }
  // "Tomorrow, 7:00 pm (after work)" chosen at a moment -> an exact time
  function toISO(label, base) {
    var m = /^(Today|Tomorrow|Day after),?\s*(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(label || '');
    if (!m) { return null; }
    var add = { 'today': 0, 'tomorrow': 1, 'day after': 2 }[m[1].toLowerCase()];
    var d = startOfDay(base);
    d.setDate(d.getDate() + add);
    d.setHours((+m[2] % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0), +m[3], 0, 0);
    return d.toISOString();
  }
  function label(iso) {
    var d = new Date(iso), now = new Date();
    var diff = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
    var day = diff === 0 ? 'Today' : (diff === 1 ? 'Tomorrow' : (diff === -1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })));
    return day + ', ' + fmtClock(d);
  }
  function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch (e) { return 'Asia/Kolkata'; } }
  function testing() { return !!CFG.testing || lsGet('lifeos_test') === '1'; }

  // Test mode: every time on offer is 1 to 10 minutes away, so testers can go chat to chat.
  var TEST_MINUTES = [1, 3, 5, 10];
  function testSlots() {
    var now = new Date();
    return TEST_MINUTES.map(function (m) {
      var d = new Date(now.getTime() + m * MIN); d.setSeconds(0, 0);
      if (d - now < 40000) { d = new Date(d.getTime() + MIN); }
      return { d: d, day: dayWord(d, now) || 'Tomorrow', note: 'in ' + m + ' min' };
    });
  }
  function testTimes() {
    if (!testing()) { return null; }
    return testSlots().map(function (c) { return c.day + ', ' + fmtClock(c.d) + ' (' + c.note + ')'; });
  }
  // First chat times: after work or before bed, from now on.
  function onbSlots() {
    var now = new Date(), out = [];
    if (testing()) {
      return testSlots().map(function (c, i) {
        var clock = fmtClock(c.d);
        return { id: 't' + i, label: c.day + ', ' + clock + ' (' + c.note + ')', lower: c.day.toLowerCase() + ' at ' + clock, day: c.day, clock: clock.split(' ')[0] };
      });
    }
    [0, 1, 2].forEach(function (dd) {
      [[19, 30], [21, 0]].forEach(function (hm) {
        var d = startOfDay(now); d.setDate(d.getDate() + dd); d.setHours(hm[0], hm[1], 0, 0);
        if (d - now >= 20 * MIN) { out.push({ d: d, day: ['Today', 'Tomorrow', 'Day after'][dd] }); }
      });
    });
    return out.slice(0, 4).map(function (c, i) {
      var clock = fmtClock(c.d);
      return { id: 's' + i, label: c.day + ', ' + clock, lower: c.day.toLowerCase() + ' at ' + clock, day: c.day, clock: clock.split(' ')[0] };
    });
  }
  function whenFor(a, key) {
    if (!a || !a[key]) { return null; }
    var st = a[key + '@'];
    if (!st || st.label !== a[key]) {
      var iso = toISO(a[key], Date.now());
      if (!iso) { return null; }
      a[key + '@'] = { label: a[key], iso: iso };
      queueSave();
    }
    return a[key + '@'].iso;
  }
  function isDue(iso) { return !!iso && Date.now() >= Date.parse(iso) - (testing() ? 0 : 5 * MIN); }

  // ---------- errors ----------
  function friendly(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || '';
    if (/rate|seconds|security purposes|too many/i.test(m)) { return new Error('Please wait a minute before asking for another code.'); }
    if (/expired|invalid|token|otp/i.test(m)) { return new Error('That code didn’t work. Check the 6 digits, or tap Resend code.'); }
    if (/fetch|network|load failed/i.test(m)) { return new Error('I can’t reach the internet right now. Check your connection and try again.'); }
    if (/email/i.test(m)) { return new Error('That email doesn’t look right. Check it and try again.'); }
    return new Error('Something went wrong. Please try again in a moment.');
  }

  // ---------- login ----------
  function sendCode(email) {
    if (NO_CODE) {
      if (!/\S+@\S+\.\S+/.test(email)) { return Promise.reject(new Error('That email doesn’t look right. Check it and try again.')); }
      if (!session) { return Promise.reject(new Error('I can’t reach the internet right now. Check your connection and try again.')); }
      emailLocal = email.toLowerCase();
      track('action', 'email_given');
      return Promise.resolve();
    }
    return sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true } }).then(function (r) {
      if (r.error) { throw friendly(r.error); }
    }, function (e) { throw friendly(e); });
  }
  function verify(email, code) {
    return sb.auth.verifyOtp({ email: email, token: code, type: 'email' }).then(function (r) {
      if (r.error || !r.data || !r.data.session) { throw friendly(r.error || { message: 'invalid' }); }
      session = r.data.session;
      flush();
      return loadProfile().then(function () {
        if (profile && profile.state && profile.state.phase && profile.state.phase !== 'onb') {
          restore(profile.state);
          return { restored: true };
        }
        return { restored: false };
      });
    }, function (e) { throw friendly(e); });
  }
  function loadProfile() {
    if (!session) { profile = null; return Promise.resolve(null); }
    return sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(function (r) {
      profile = r.data || null;
      if (profile && profile.email) { emailLocal = profile.email; }
      pushOnLocal = !!(profile && profile.push_on);
      pushCache = null;
      return profile;
    });
  }

  // ---------- push ----------
  function urlB64(s) {
    var pad = '='.repeat((4 - (s.length % 4)) % 4);
    var raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) { out[i] = raw.charCodeAt(i); }
    return out;
  }
  function vapidKey() {
    return fetch(CFG.supabaseUrl.replace(/\/$/, '') + '/functions/v1/vapid', { headers: { apikey: CFG.supabaseKey } })
      .then(function (r) { if (!r.ok) { throw new Error('vapid ' + r.status); } return r.json(); })
      .then(function (j) { return j.publicKey; });
  }
  function subscribe() {
    if (!session) { return Promise.reject(new Error('not signed in')); }
    return swReady().then(function (reg) {
      return vapidKey().then(function (k) {
        return reg.pushManager.getSubscription().then(function (old) {
          return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(k) });
        });
      });
    }).then(function (sub) {
      var j = sub.toJSON();
      return sb.from('push_subscriptions').upsert({ user_id: session.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
    }).then(function (r) {
      if (r && r.error) { throw r.error; }
      pushOnLocal = true; pushCache = 'on';
      queueSave();
    });
  }
  function swReady(ms) {
    return Promise.race([navigator.serviceWorker.ready, new Promise(function (_, no) { setTimeout(function () { no(new Error('service worker not ready')); }, ms || 6000); })]);
  }
  function pushSupported() { return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window); }
  function pushState() {
    if (pushCache) { return pushCache; }
    if (isIOS && !standalone) { pushCache = 'install'; }
    else if (!pushSupported()) { pushCache = 'email'; }
    else if (Notification.permission === 'denied') { pushCache = 'blocked'; }
    else if (Notification.permission === 'granted' && pushOnLocal) { pushCache = 'on'; }
    else { pushCache = 'ask'; }
    return pushCache;
  }
  // Must be called straight from a tap: iPhone only shows the permission prompt then.
  function enablePush() {
    if (!pushSupported() || (isIOS && !standalone)) { pushCache = null; return Promise.resolve(false); }
    var asked;
    try { asked = Notification.requestPermission(); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(asked).then(function (p) {
      if (p !== 'granted') { pushCache = p === 'denied' ? 'blocked' : 'ask'; return false; }
      return subscribe().then(function () { return true; });
    }).catch(function (e) { console.warn('push', e); pushCache = null; return false; });
  }

  // ---------- saving ----------
  // Saves at most every half second while someone is tapping, and straight away when the app is closed.
  function queueSave() { if (saveT) { return; } saveT = setTimeout(function () { saveT = null; save(); }, 500); }
  function save() {
    if (leaving || !session || !chats || saving) { if (saving && !leaving) { queueSave(); } return; }
    var s = chats.state;
    if (s.phase === 'onb') { return; }
    var n = s.conv, key;
    if (s.phase === 'end' && !chats.isD(s.conv, s.a)) { n = s.conv + 1; }
    key = chats.lockKey(n);
    var waiting = (s.phase === 'lock' || s.phase === 'resched' || s.phase === 'end') && n <= 5;
    var row = {
      id: session.user.id,
      name: s.a.name || null,
      area: s.a.area || null,
      score: s.a.score || null,
      state: { conv: s.conv, phase: s.phase, step: s.step, msgs: s.msgs, a: s.a, lockNote: s.lockNote || '' },
      next_chat_n: waiting ? n : null,
      next_chat_at: waiting ? whenFor(s.a, key) : null,
      tz: tz(),
      push_on: pushOnLocal,
      email: emailLocal || null
    };
    var str = JSON.stringify(row);
    if (str === lastSaved) { return; }
    saving = true;
    sb.from('profiles').upsert(row).then(function (r) {
      saving = false;
      if (r.error) { console.warn('save', r.error); setTimeout(queueSave, 5000); return; }
      lastSaved = str;
    }, function () { saving = false; setTimeout(queueSave, 5000); });
  }
  function chatDone(info) {
    pending.push({ p_conv: info.conv, p_path: info.path, p_is_d: !!info.d, p_area: info.area, p_score: info.score, p_answers: info.a, p_messages: info.msgs });
    lsSet('lifeos_pending', JSON.stringify(pending));
    flush();
  }
  function flush() {
    if (!session || flushing || !pending.length) { return; }
    flushing = true;
    sb.rpc('save_chat', pending[0]).then(function (r) {
      flushing = false;
      if (r.error) { console.warn('save_chat', r.error); setTimeout(flush, 10000); return; }
      pending.shift();
      lsSet('lifeos_pending', JSON.stringify(pending));
      flush();
    }, function () { flushing = false; setTimeout(flush, 10000); });
  }
  function restore(st) {
    if (!chats) { return; }
    chats.state = Object.assign({}, chats.state, chats.fresh(st.conv || 2, st.a || {}), st, { sel: [], own: '', err: '' });
    if (chats.state.phase === 'end') { chats.renderVals().endAction(); }
    else if (chats.state.phase === 'resched') { chats.setState({ phase: 'lock' }); }
    else { chats.forceUpdate(); }
  }

  // ---------- menu ----------
  function where() {
    if (!chats) { return 'Starting up'; }
    var s = chats.state;
    if (s.phase === 'onb') {
      var app = chats._children && chats._children['child:App'];
      return 'Setup, screen: ' + ((app && app.state.step) || 'welcome');
    }
    return 'Chat ' + s.conv + ', ' + s.phase + (s.step ? ', step ' + s.step : '');
  }
  function panel(id) { ['menuMain', 'menuBug', 'menuDel'].forEach(function (p) { $(p).hidden = p !== id; }); }
  function openMenu() {
    var who = emailLocal || (session && session.user.email) || '';
    $('menuWho').textContent = who ? 'Your email: ' + who : '';
    $('mSignOut').hidden = NO_CODE;
    track('action', 'menu_open');
    $('menuMsg').textContent = '';
    panel('menuMain');
    $('menu').classList.add('on');
  }
  function closeMenu() { $('menu').classList.remove('on'); }
  var leaving = false;
  function clearLocal() { leaving = true; session = null; ['lifeos_pending', 'lifeos_onb', 'lifeos-auth'].forEach(lsDel); }

  $('mClose').addEventListener('click', closeMenu);
  $('menu').addEventListener('click', function (e) { if (e.target === $('menu')) { closeMenu(); } });
  $('mBug').addEventListener('click', function () { $('bugText').value = ''; $('bugErr').textContent = ''; panel('menuBug'); setTimeout(function () { $('bugText').focus(); }, 50); });
  $('bugBack').addEventListener('click', function () { panel('menuMain'); });
  $('bugSend').addEventListener('click', function () {
    var t = $('bugText').value.trim();
    if (!t) { $('bugErr').textContent = 'Write a few words about what went wrong.'; return; }
    if (!session) { $('bugErr').textContent = 'Please sign in first, so I can match your report.'; return; }
    $('bugErr').textContent = 'Sending…';
    sb.from('bug_reports').insert({ user_id: session.user.id, screen: where() + ' · ' + navigator.userAgent.slice(0, 120), note: t }).then(function (r) {
      if (r.error) { $('bugErr').textContent = 'Couldn’t send it. Check your connection and try again.'; return; }
      panel('menuMain'); $('menuMsg').textContent = 'Thank you. Your report is in.'; track('action', 'bug_report');
    });
  });
  $('mExport').addEventListener('click', function () {
    if (!session) { $('menuMsg').textContent = 'Sign in first.'; return; }
    $('menuMsg').textContent = 'Gathering your story…';
    var t = ['profiles', 'story_markers', 'chats', 'messages', 'safety_events', 'plan_steps', 'step_logs', 'quotes', 'events'];
    Promise.all(t.map(function (name) { return sb.from(name).select('*'); })).then(function (rs) {
      var out = { exported_at: new Date().toISOString(), email: emailLocal || session.user.email || '' };
      rs.forEach(function (r, i) { out[t[i]] = r.data || []; });
      var text = JSON.stringify(out, null, 2);
      var file = null;
      try { file = new File([text], 'life-os-my-story.json', { type: 'application/json' }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'My Life OS story' }).then(function () { $('menuMsg').textContent = 'Done.'; }, function () { $('menuMsg').textContent = ''; });
        return;
      }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = 'life-os-my-story.json';
      document.body.appendChild(a); a.click(); a.remove();
      $('menuMsg').textContent = 'Downloaded.';
    }, function () { $('menuMsg').textContent = 'Couldn’t download right now. Try again.'; });
  });
  $('mSignOut').addEventListener('click', function () {
    sb.auth.signOut().then(function () { clearLocal(); location.reload(); });
  });
  $('mDelete').addEventListener('click', function () { $('delErr').textContent = ''; panel('menuDel'); });
  $('delNo').addEventListener('click', function () { panel('menuMain'); });
  $('delYes').addEventListener('click', function () {
    if (!session) { $('delErr').textContent = 'Sign in first.'; return; }
    $('delErr').textContent = 'Deleting…';
    sb.rpc('delete_me').then(function (r) {
      if (r.error) { $('delErr').textContent = 'Couldn’t delete right now. Try again, or write to us.'; return; }
      var unsub = ('serviceWorker' in navigator) ? swReady(1500).then(function (reg) { return reg.pushManager && reg.pushManager.getSubscription(); }).then(function (s) { return s && s.unsubscribe(); }).catch(function () {}) : Promise.resolve();
      unsub.then(function () { return sb.auth.signOut(); }).then(function () { clearLocal(); location.reload(); }, function () { clearLocal(); location.reload(); });
    });
  });

  // ---------- landing (iPhone Safari, before Add to Home Screen) ----------
  if (isIOS && !standalone && lsGet('lifeos_browser_ok') !== '1') { $('landing').classList.add('on'); }
  if ($('landing').classList.contains('on')) { track('screen', 'landing'); }
  $('landStart').addEventListener('click', function () { track('screen', 'install_steps'); $('landA').hidden = true; $('landB').hidden = false; $('landing').scrollTop = 0; });
  $('landSkip').addEventListener('click', function () { track('action', 'continue_in_safari'); lsSet('lifeos_browser_ok', '1'); $('landing').classList.remove('on'); });

  // ---------- journey tracking: every screen, chat step and answer, in order ----------
  function track(kind, name, detail) {
    evq.push({ kind: kind, name: name, detail: detail || null, created_at: new Date().toISOString() });
    if (!evT) { evT = setTimeout(flushEvents, 1500); }
  }
  function flushEvents() {
    evT = null;
    if (!session || !evq.length) { if (evq.length) { evT = setTimeout(flushEvents, 3000); } return; }
    var batch = evq.splice(0, evq.length).map(function (e) { return Object.assign({ user_id: session.user.id }, e); });
    sb.from('events').insert(batch).then(function (r) {
      if (r && r.error) { console.warn('events', r.error); evq = batch.map(function (e) { delete e.user_id; return e; }).concat(evq); evT = setTimeout(flushEvents, 10000); }
    }, function () { evq = batch.concat(evq); evT = setTimeout(flushEvents, 10000); });
  }
  var hook = { run: null, _app: '', _ctx: null };
  Object.defineProperty(hook, 'appStep', {
    get: function () { return this._app; },
    set: function (v) {
      this._app = v;
      if (v && v !== lastApp) {
        var app = chats && chats._children && chats._children['child:App'], st = (app && app.state) || {};
        var d = { from: lastApp || null };
        if (lastApp === 'score') { d.score = st.score; }
        if (lastApp === 'area') { d.area = st.area; }
        if (lastApp === 'story') { d.picked = st.reasons; d.own_words = !!(st.story || '').trim(); }
        if (lastApp === 'time') { d.slot = st.slot; }
        lastApp = v;
        track('screen', 'setup_' + v, d);
      }
    }
  });
  Object.defineProperty(hook, 'ctx', {
    get: function () { return this._ctx; },
    set: function (c) {
      this._ctx = c;
      if (!c || c.phase === 'onb') { return; }
      var key = c.phase + '|' + c.chat + '|' + (c.step || '');
      if (key === lastCtx) { return; }
      var prev = lastCtx.split('|');
      lastCtx = key;
      var d = { chat: c.chat, path: c.path || null };
      if (prev[0] === 'chat' && prev[2] && chats) { d.answered = prev[2]; d.answer = chats.state.a[prev[2]] === undefined ? null : chats.state.a[prev[2]]; }
      var name = c.phase === 'chat' ? 'chat' + c.chat + '_' + c.step : ({ lock: 'home', resched: 'reschedule', end: 'chat_end' }[c.phase] || c.phase);
      track(c.phase === 'chat' ? 'chat_step' : 'screen', name, d);
    }
  });
  window.LIFEOS_HOOK = hook;
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') { track('action', 'app_closed', { at: lastCtx || lastApp }); flushEvents(); } });

  // ---------- the bridge the screens use ----------
  window.LIFEOS_REAL = {
    noCode: NO_CODE,
    signedIn: function () { return NO_CODE ? !!emailLocal : !!session; },
    sendCode: sendCode,
    verify: verify,
    onbSlots: onbSlots,
    testTimes: testTimes,
    onboarded: function () { queueSave(); },
    enablePush: enablePush,
    pushState: pushState,
    whenFor: whenFor,
    isDue: isDue,
    label: label,
    testing: testing,
    chatDone: chatDone,
    openMenu: openMenu,
    _debug: { toISO: toISO, save: save, get session() { return session; } }
  };

  function mount() {
    var host = $('app');
    host.innerHTML = '';
    var box = document.createElement('div');
    box.style.cssText = 'position: absolute; inset: 0';
    host.appendChild(box);
    chats = window.LIFEOS_MOUNT('Chats', box);
    var base = chats.setState;
    chats.setState = function (p) { base.call(chats, p); queueSave(); };
    window.LIFEOS_APP = chats;
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('sw', e); });
    navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'lifeos-open' && chats) { chats.forceUpdate(); } });
  }

  sb.auth.onAuthStateChange(function (_ev, s) { session = s; });

  sb.auth.getSession().then(function (r) {
    session = (r && r.data && r.data.session) || null;
    if (!session && NO_CODE) {
      return sb.auth.signInAnonymously().then(function (a) {
        if (a.error || !a.data || !a.data.session) { throw a.error || new Error('no session'); }
        session = a.data.session;
        track('action', 'first_open', { standalone: standalone, ios: isIOS });
        return null;
      });
    }
    return session ? loadProfile().catch(function () { return null; }) : null;
  }).then(function () {
    track('action', 'app_open', { standalone: standalone });
    mount();
    if (profile && profile.state && profile.state.phase && profile.state.phase !== 'onb') { restore(profile.state); }
    if (session && pushSupported() && Notification.permission === 'granted' && (!isIOS || standalone)) { subscribe().catch(function () {}); }
    flush();
  }, function (e) {
    console.warn('start', e);
    $('app').innerHTML = '<div class="boot" style="padding: 24px; text-align: center; line-height: 1.5">I can’t start right now. Check your internet connection, then close and reopen Life OS.</div>';
  });

  // Flip the home screen to "Let's talk now" when the time comes, and pick up changes from another device.
  setInterval(function () { if (chats && chats.state.phase === 'lock') { chats.forceUpdate(); } }, 30000);
  window.addEventListener('pagehide', function () { save(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { save(); return; }
    if (!chats || !session) { return; }
    if (chats.state.phase !== 'lock' || saveT || saving) { chats.forceUpdate(); return; }
    loadProfile().then(function () {
      var mine = JSON.stringify(chats.state.a), theirs = profile && profile.state ? JSON.stringify(profile.state.a) : mine;
      if (profile && profile.state && (theirs !== mine || profile.state.conv !== chats.state.conv)) { restore(profile.state); }
      else { chats.forceUpdate(); }
    }).catch(function () {});
    flush();
  });
  window.addEventListener('online', flush);
})();
