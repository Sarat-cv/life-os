// A stand-in for supabase-js used only by tests/e2e.js. It keeps a tiny database
// in localStorage so reloads behave like the real backend.
(function () {
  function load() { try { return JSON.parse(localStorage.getItem('__mockdb') || '{}'); } catch (e) { return {}; } }
  function store(db) { localStorage.setItem('__mockdb', JSON.stringify(db)); }
  function uidFor(email) { var h = 0; for (var i = 0; i < email.length; i++) { h = (h * 31 + email.charCodeAt(i)) >>> 0; } return '00000000-0000-0000-0000-' + ('000000000000' + h.toString(16)).slice(-12); }
  function sess() { try { return JSON.parse(localStorage.getItem('__mocksession') || 'null'); } catch (e) { return null; } }
  window.__mockLog = [];
  function table(db, t) { db[t] = db[t] || []; return db[t]; }

  function builder(t) {
    var filters = [], mode = 'select', payload = null, single = false;
    var b = {
      select: function () { return b; },
      eq: function (c, v) { filters.push([c, v]); return b; },
      maybeSingle: function () { single = true; return b; },
      upsert: function (row, opts) { mode = 'upsert'; payload = { row: row, key: (opts && opts.onConflict) || 'id' }; return b; },
      insert: function (row) { mode = 'insert'; payload = row; return b; },
      update: function (obj) { mode = 'update'; payload = obj; return b; },
      then: function (ok, bad) { return Promise.resolve().then(run).then(ok, bad); }
    };
    function run() {
      var db = load(), s = sess(), rows = table(db, t);
      window.__mockLog.push([mode, t]);
      if (!s) { return { data: null, error: { message: 'not signed in' } }; }
      var uid = s.user.id;
      var mine = function (r) { return (r.id === uid && t === 'profiles') || r.user_id === uid; };
      if (mode === 'select') {
        var out = rows.filter(mine).filter(function (r) { return filters.every(function (f) { return r[f[0]] === f[1]; }); });
        return { data: single ? (out[0] || null) : out, error: null };
      }
      if (mode === 'upsert') {
        var r = payload.row;
        if ((t === 'profiles' ? r.id : r.user_id) !== uid) { return { error: { message: 'row-level security' } }; }
        var at = rows.findIndex(function (x) { return x[payload.key] === r[payload.key]; });
        if (at >= 0) { rows[at] = Object.assign({}, rows[at], r, { updated_at: new Date().toISOString() }); } else { rows.push(Object.assign({ created_at: new Date().toISOString() }, r)); }
        store(db); return { error: null };
      }
      if (mode === 'insert') {
        var list = Array.isArray(payload) ? payload : [payload];
        if (list.some(function (x) { return x.user_id !== uid; })) { return { error: { message: 'row-level security' } }; }
        list.forEach(function (x) { rows.push(Object.assign({ id: rows.length + 1, created_at: new Date().toISOString() }, x)); }); store(db); return { error: null };
      }
      if (mode === 'update') {
        rows.filter(mine).forEach(function (x) { Object.assign(x, payload); }); store(db); return { error: null };
      }
    }
    return b;
  }

  window.supabase = {
    createClient: function () {
      var listeners = [];
      return {
        auth: {
          signInWithOtp: function (o) { window.__mockLog.push(['otp', o.email]); return Promise.resolve({ error: /@/.test(o.email) ? null : { message: 'invalid email' } }); },
          verifyOtp: function (o) {
            if (o.token === '000000') { return Promise.resolve({ data: {}, error: { message: 'Token has expired or is invalid' } }); }
            var s = { access_token: 't', user: { id: uidFor(o.email), email: o.email } };
            localStorage.setItem('__mocksession', JSON.stringify(s));
            listeners.forEach(function (cb) { cb('SIGNED_IN', s); });
            return Promise.resolve({ data: { session: s }, error: null });
          },
          signInAnonymously: function () {
            var id = '00000000-0000-0000-0000-' + ('000000000000' + Math.floor(Math.random() * 1e12).toString(16)).slice(-12);
            var s = { access_token: 't', user: { id: id, email: '', is_anonymous: true } };
            localStorage.setItem('__mocksession', JSON.stringify(s));
            return Promise.resolve({ data: { session: s }, error: null });
          },
          getSession: function () { return Promise.resolve({ data: { session: sess() } }); },
          onAuthStateChange: function (cb) { listeners.push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: function () { localStorage.removeItem('__mocksession'); return Promise.resolve({ error: null }); }
        },
        from: builder,
        rpc: function (name, p) {
          var db = load(), s = sess();
          window.__mockLog.push(['rpc', name]);
          if (!s) { return Promise.resolve({ error: { message: 'not signed in' } }); }
          if (name === 'save_chat') { table(db, 'chats').push({ user_id: s.user.id, n: p.p_conv, path: p.p_path, is_d: p.p_is_d, area: p.p_area, score: p.p_score, answers: p.p_answers, messages: p.p_messages }); store(db); return Promise.resolve({ data: 1, error: null }); }
          if (name === 'delete_me') { Object.keys(db).forEach(function (k) { db[k] = db[k].filter(function (r) { return r.user_id !== s.user.id && r.id !== s.user.id; }); }); store(db); return Promise.resolve({ error: null }); }
          return Promise.resolve({ error: { message: 'unknown rpc' } });
        }
      };
    }
  };
})();
