'use strict';

// car-common.js — the machinery shared by BOTH family car pages.
//
//   cars.html   + cars.js    → Kate's Mach-E shortlist
//   jordyn.html + jordyn.js  → Jordyn's first-car roster
//
// The two pages rank cars completely differently (Kate's on trim and options,
// Jordyn's on safety tier and cost-to-own), but everything UNDERNEATH that was
// duplicated line-for-line: the crypto, the access gate, remembered keys,
// 👍/👎 and note storage, the share-link builder and the toast. Two copies of
// security-relevant code is one copy too many — a fix to one silently misses the
// other. This is the single implementation; each page supplies its own config.
//
// Access model (unchanged): the key lives in the URL fragment `#k=<key>`, which
// browsers never send to the server. Each page has its OWN key and decrypts ONLY
// its own bundle, so a link to one car page can never open the other — or the
// trip itinerary, tickets, or contacts.
//
// Crypto: PBKDF2(SHA-256, 250000) → AES-GCM-256.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64ToU8 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
// NOTE: number formatters deliberately stay in each page. cars.js's `money()`
// returns null for null (its render code branches on that) while jordyn.js wants
// an em-dash — declaring either here would collide at top-level scope and break
// both pages.

/**
 * Build the shared app shell.
 *
 * @param {object} cfg
 * @param {string} cfg.dataUrl     encrypted bundle, e.g. 'data/cars.enc.json'
 * @param {string} cfg.storagePrefix  localStorage namespace, e.g. 'kate-cars'
 * @param {string} cfg.publicUrl   canonical page URL used to build share links
 * @param {string} cfg.shareTitle  title for the native share sheet
 * @param {string} cfg.shareText   blurb for the native share sheet
 * @param {string} cfg.gateFail    message shown when a key doesn't decrypt
 * @param {function} cfg.onReady   called with the decrypted data once open
 */
function createCarApp(cfg) {
  const app = {
    KEY: null,
    DATA: null,
    VOTES: {},
    COMMENTS: {},
  };
  const K_VOTES = `${cfg.storagePrefix}-votes-v1`;
  const K_COMMENTS = `${cfg.storagePrefix}-comments-v1`;
  const K_KEY = `${cfg.storagePrefix}-key-v1`;

  // ---------- crypto ----------
  async function decryptPayload(payload) {
    const salt = b64ToU8(payload.salt);
    const iv = b64ToU8(payload.iv);
    const ct = b64ToU8(payload.ct);
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(app.KEY), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: payload.kdf.iterations, hash: payload.kdf.hash },
      km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(buf));
  }

  async function tryLoadData() {
    try {
      const res = await fetch(cfg.dataUrl, { cache: 'no-cache' });
      app.DATA = await decryptPayload(await res.json());
      return true;
    } catch { return false; }
  }

  // ---------- local state ----------
  function loadVotes() { try { app.VOTES = JSON.parse(localStorage.getItem(K_VOTES) || '{}') || {}; } catch { app.VOTES = {}; } }
  function saveVotes() { try { localStorage.setItem(K_VOTES, JSON.stringify(app.VOTES)); } catch { /* private mode */ } }
  function loadComments() { try { app.COMMENTS = JSON.parse(localStorage.getItem(K_COMMENTS) || '{}') || {}; } catch { app.COMMENTS = {}; } }
  function saveComments() { try { localStorage.setItem(K_COMMENTS, JSON.stringify(app.COMMENTS)); } catch { /* private mode */ } }
  function setComment(vin, text) {
    const t = (text || '').trim();
    if (t) app.COMMENTS[vin] = t; else delete app.COMMENTS[vin];
    saveComments();
  }
  function setVote(vin, v) {
    if (app.VOTES[vin] === v) delete app.VOTES[vin]; else app.VOTES[vin] = v;
    saveVotes();
  }

  // Remembered key: once a link with #k= has opened the page (or the code was
  // typed once), stash it so a pull-to-refresh or PWA relaunch — which reload
  // WITHOUT the fragment — reopen straight to the cars instead of the gate.
  function rememberKey(k) { try { localStorage.setItem(K_KEY, k); } catch { /* private mode */ } }
  function forgetKey() { try { localStorage.removeItem(K_KEY); } catch { /* ignore */ } }
  function currentKey() {
    if (app.KEY) return app.KEY;
    try { return localStorage.getItem(K_KEY) || ''; } catch { return ''; }
  }

  // ---------- toast ----------
  function toast(msg) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('on'), 2600);
  }

  // ---------- share ----------
  /**
   * Build the FULL shareable URL, including the `#k=` decrypt key.
   * Without the fragment the recipient just gets an access-code box, so the key
   * is the whole point of the button.
   */
  function shareUrl() {
    const k = currentKey();
    return k ? `${cfg.publicUrl}#k=${k}` : '';
  }

  async function shareLink() {
    const url = shareUrl();
    if (!url) { toast('No link to share yet — open this page from your own invite first'); return; }
    if (navigator.share) {
      try { await navigator.share({ title: cfg.shareTitle, text: cfg.shareText, url }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; /* else fall through */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied — it includes the access key 🔗');
    } catch {
      // Clipboard can be blocked (insecure context / permissions). Show the URL
      // so it can still be copied by hand rather than failing silently.
      window.prompt('Copy this link — it includes the access key:', url);
    }
  }

  // ---------- gate + boot ----------
  async function onGate(e) {
    e.preventDefault();
    const code = $('#gate-code').value.trim();
    const err = $('#gate-error');
    err.hidden = true;
    if (!code) return;
    app.KEY = code;
    $('#gate-btn').textContent = 'Opening…';
    if (await tryLoadData()) {
      rememberKey(app.KEY);
      $('#gate').hidden = true;
      openApp(true);
    } else {
      app.KEY = null;
      err.textContent = cfg.gateFail || 'That code didn’t work. Check it and try again.';
      err.hidden = false;
      $('#gate-btn').textContent = 'View cars';
    }
  }

  function showGate() {
    $('#gate').hidden = false;
    $('#gate-form').addEventListener('submit', onGate);
  }

  async function openApp(alreadyLoaded) {
    $('#app').hidden = false;
    if (!alreadyLoaded && !(await tryLoadData())) {
      const s = $('#cars-status');
      if (s) s.innerHTML = '<div class="big">🔒</div>Couldn’t open this link. Ask Jonathan to resend it.';
      return;
    }
    // Wire the share button here — it only makes sense once a key is known.
    const btn = $('#share-btn');
    if (btn) { btn.hidden = false; btn.addEventListener('click', shareLink); }
    cfg.onReady(app.DATA, app);
  }

  async function boot() {
    loadVotes();
    loadComments();
    const m = /[#&]k=([^&]+)/.exec(location.hash || '');
    if (m) {
      app.KEY = decodeURIComponent(m[1]).trim();
      rememberKey(app.KEY);
      // Strip the key from the visible URL bar (it stays in memory) so a casual
      // over-the-shoulder glance or screenshot doesn't reveal it.
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
      openApp();
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(K_KEY); } catch { /* ignore */ }
    if (saved) {
      app.KEY = saved;
      if (await tryLoadData()) { openApp(true); return; }
      app.KEY = null;
      forgetKey(); // remembered key no longer works (rotated) — fall back to the gate
    }
    showGate();
  }

  return Object.assign(app, {
    boot, openApp, showGate, tryLoadData,
    setVote, setComment, saveVotes, saveComments,
    currentKey, shareUrl, shareLink, toast,
  });
}
