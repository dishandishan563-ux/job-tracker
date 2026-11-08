// Job Tracker — shared client logic. Separate pages, shared state in localStorage.
// Pages: index.html (home), login.html, settings.html, profile.html, admin.html — each is its own
// route; going into one page does not show the others. Login is a POPUP
// (#loginModal) on home/settings/admin — it never navigates away; login.html
// remains only as a standalone fallback page.
const BN = '০১২৩৪৫৬৭৮৯';
function bn(n) { return String(n).replace(/\d/g, d => BN[+d]); }
function bnNum(n) { return String(n).replace(/\d/g, d => BN[+d]); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
}
// দিন বাকি — Math.floor, যাতে মেয়াদ পার হওয়ার সঙ্গে সঙ্গেই -১ হয়।
// আগে Math.ceil ছিল: মেয়াদ ১০ মিনিট আগে পার হলেও ০ দিন দেখাত আর সার্কুলার
// "চলমান" থাকত, আর ২ ঘণ্টা বাকি থাকলেও "আর ১ দিন" দেখাত — এটাই টাইমের গলদ ছিল।
function daysLeft(iso) { return Math.floor((new Date(iso) - Date.now()) / 86400000); }
// বাকি সময় ভেঙে দিন/ঘণ্টা/মিনিট/সেকেন্ডে — লাইভ কাউন্টডাউনের জন্য।
function remainParts(iso) {
  let s = Math.floor((new Date(iso) - Date.now()) / 1000);
  if (s <= 0) return null;
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); const sec = s % 60;
  return { d, h, m, sec };
}
function store(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function read(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch { return d; } }
function getUser() { return read('jt_user', null); }
function isLoggedIn() { return !!getUser(); }

// ---------- সার্ভারে সেভ থাকা ব্যবহারকারীর ডেটা (Vercel KV) ----------
// একবার Gmail দিয়ে লগইন করলে প্রোফাইল, শর্টলিস্ট, আবেদন অবস্থা ও সেটিংস
// সার্ভারে সেভ থাকে — পরে অন্য ডিভাইস/ব্রাউজারে একই Gmail দিয়ে লগইন
// করলেই আগের সবকিছু ফিরে আসে, কিছুই ভোলা হয় না। localStorage শুধু
// দ্রুত ক্যাশ হিসেবে থাকে; সার্ভারের কপিই ডিভাইসের মধ্যে সত্য।
// সার্ভার স্টোরেজ (Vercel KV) চালু না থাকলে সিঙ্ক চুপচাপ বন্ধ থাকে আর
// আগের মতো শুধু এই ব্রাউজারের localStorage-ই চলে — কিছু ভাঙে না।
function getSessionToken() { return localStorage.getItem('jt_session') || ''; }
function collectUserData() {
  return { profile: read('jt_profile', {}), shortlist: read('jt_shortlist', []), status: read('jt_status', {}), fontSize: localStorage.getItem('jt_font_size') || 'medium' };
}
function applyUserData(d) {
  if (!d || typeof d !== 'object') return;
  if (d.profile && typeof d.profile === 'object') store('jt_profile', d.profile);
  if (Array.isArray(d.shortlist)) store('jt_shortlist', d.shortlist);
  if (d.status && typeof d.status === 'object') store('jt_status', d.status);
  if (typeof d.fontSize === 'string') localStorage.setItem('jt_font_size', d.fontSize);
  applyFontSize();
}
let syncTimer = null;
function syncToServer(now) {
  const token = getSessionToken();
  if (!token || !isLoggedIn()) return;
  clearTimeout(syncTimer);
  const run = () => {
    fetch('api/user-data', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action: 'save', data: collectUserData() }) }).catch(() => {});
  };
  // now=true হলে সঙ্গে সঙ্গে পাঠান (যেমন প্রোফাইল সেভ করে হোমে ফেরার আগে)।
  if (now) run(); else syncTimer = setTimeout(run, 800);
}
// লগইনের পর: সার্ভারে সেভ থাকা ডেটা থাকলে তা নামিয়ে নিন (অন্য ডিভাইসের
// কাজ ফিরে আসবে); না থাকলে এই ব্রাউজারে যা আছে তা সার্ভারে তুলে দিন।
async function syncFromServer() {
  const token = getSessionToken();
  if (!token || !isLoggedIn()) return false;
  try {
    const r = await fetch('api/user-data', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action: 'load' }) });
    const data = await r.json().catch(() => ({}));
    if (data.ok && data.exists && data.data) { applyUserData(data.data); return true; }
    if (data.ok && !data.exists) {
      await fetch('api/user-data', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action: 'save', data: collectUserData() }) }).catch(() => {});
      return true;
    }
    return false;
  } catch { return false; }
}
// Login gate: any gated action opens the LOGIN POPUP (#loginModal) on the
// current page — the user never leaves the page. Google sign-in itself happens
// in Google's real popup. Only on a page with no modal (login.html itself)
// does it fall back to the standalone login page.
// লগইন শুধু পপআপে আসে — হোম/সেটিংস/অ্যাডমিন পেইজে থাকা #loginModal
// মডালটাই পপআপ; আলাদা লগইন পেইজে যাওয়া লাগে না।
function openLoginPopup() {
  const modal = document.getElementById('loginModal');
  if (!modal) { location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search); return; }
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  initLoginPopup();
  // Google-এর স্ক্রিপ্ট async-এ লোড হয় — প্রথমবার না থাকলে, এলে আবার init।
  if (!window.google) {
    let tries = 0;
    const t = setInterval(() => {
      if (window.google || ++tries > 10) { clearInterval(t); if (window.google) { loginPopupInit = false; initLoginPopup(); } }
    }, 500);
  }
}
function closeLoginPopup() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}
function requireLogin() {
  if (isLoggedIn()) return true;
  openLoginPopup();
  return false;
}
// অ্যাডমিন PIN — শুধু SHA-256 হ্যাশ আকারে রাখা আছে (প্লেইন PIN কোডে কোথাও লেখা নেই)।
// মালিকের জন্য কোডে বসানো ডিফল্ট হ্যাশের PIN সবসময় চলবে — এমনকি এই ব্রাউজারে
// আগে অন্য কোনো PIN সেভ হয়ে থাকলেও। আগে jt_admin_pin_hash-এ পুরনো/ভুল হ্যাশ
// থাকলে সেটাই ডিফল্ট PIN-কে আটকে দিত — এটাই লাইভ সাইটে PIN না-চলার কারণ ছিল।
// PIN বদলালে নতুন হ্যাশও চলবে; ডিফল্ট PIN দিয়ে ঢুকলে পুরনো হ্যাশ মুছে যায়।
const ADMIN_PIN_HASH = '218abd57777a2be3aae18b1bf564193338fe30d96b5c105a0960c0a2b611287e';
async function pinMatches(pin) {
  const hash = await sha256(pin);
  const stored = localStorage.getItem('jt_admin_pin_hash');
  if (hash === ADMIN_PIN_HASH || (stored && hash === stored)) {
    if (hash === ADMIN_PIN_HASH && stored && stored !== ADMIN_PIN_HASH) localStorage.removeItem('jt_admin_pin_hash');
    return hash;
  }
  return null;
}
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }

// ---------- ইনলাইন টোস্ট — ব্রাউজার পপআপ (alert/confirm) নয় ----------
// পেইজের নিচে ছোট লাইনে বার্তা দেখায়, কয়েক সেকেন্ডে নিজে মিলিয়ে যায়।
let toastTimer = null;
function toast(msg) {
  let t = document.getElementById('jtToast');
  if (!t) { t = document.createElement('div'); t.id = 'jtToast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---------- অ্যান্ড্রয়েড অ্যাপ (APK) ডাউনলোড ও আপডেট ----------
// অ্যাপটি লাইভ সাইটের wrapper — সাইটের সব কনটেন্ট এমনিতেই লাইভ
// আপডেট হয়, APK ফাইল নিজে বদলায় শুধু wrapper বদলালে।
// GitHub-এ বাইনারি ফাইল পাঠানো যায় না, তাই APK base64 লেখা হিসেবে
// /job-tracker.apk.b64-এ থাকে; ডাউনলোডের সময় ব্রাউজারেই (বা অ্যাপের
// ভেতরে নেটিভভাবে) APK-তে ফিরিয়ে নেওয়া হয়।
// আপডেট চেকের নিয়ম: ফোনে ইনস্টল করা অ্যাপের সংস্করণ আসে তার
// User-Agent থেকে (অ্যাপ UA-এর শেষে "JobTrackerApp/1.0.0" যোগ করে)।
// /version.json-এর versionName তার চেয়ে নতুন হলেই হোমের উপরে বড়
// ব্যানার দেখায়: "🔔 নতুন আপডেট এসেছে — আপডেট করুন" + আপডেট বোতাম।
// ব্রাউজারে (UA-তে ওই চিহ্ন নেই) ব্যানার আসে না — ওয়েব ব্যবহারকারী
// এমনিতেই লাইভ সাইট পায়; তাদের জন্য হোমের ডাউনলোড বোতামই আছে।
// চেক চলে প্রতিবার পেইজ খুললে, আর অ্যাপ খোলা থাকলে প্রতি ৩০ মিনিটে।
// চেক না হলে (নেট নেই) চুপচাপ থাকে। সত্যি কথা: অ্যাপ বন্ধ থাকলে
// ব্যাকগ্রাউন্ডে নোটিফিকেশন আসে না (সেটা FCM লাগে, এতে নেই) —
// নোটিফিকেশন আসে অ্যাপ খোলার পর, পরের বার খুললেই।
const APP_APK_B64_URL = '/job-tracker.apk.b64';
const APP_APK_FILE_NAME = 'job-tracker.apk';
function installedAppVersion() {
  const m = (navigator.userAgent || '').match(/JobTrackerApp\/([\d.]+)/);
  return m ? m[1] : null;
}
function cmpVersion(a, b) {
  const pa = String(a).split('.').map(x => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}
let apkDownloading = false;
async function downloadAppApk() {
  if (apkDownloading) return;
  apkDownloading = true;
  toast('অ্যাপ ডাউনলোড হচ্ছে…');
  try {
    const r = await fetch(APP_APK_B64_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('apk missing');
    const b64 = (await r.text()).replace(/\s/g, '');
    // অ্যাপের ভেতরে থাকলে নেটিভ ইনস্টল পথ (PackageInstaller) ব্যবহার হয়।
    if (window.JobTrackerApp && typeof window.JobTrackerApp.downloadApk === 'function') {
      window.JobTrackerApp.downloadApk(b64);
      toast('ডাউনলোড হচ্ছে — শেষ হলে ইনস্টল চাপুন।');
      apkDownloading = false;
      return;
    }
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/vnd.android.package-archive' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = APP_APK_FILE_NAME;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
    toast('ডাউনলোড শুরু হয়েছে — শেষ হলে APK চাপলেই ইনস্টল হবে।');
  } catch (e) { toast('ডাউনলোড হয়নি — ইন্টারনেট দেখে আবার চাপুন।'); }
  apkDownloading = false;
}
window.downloadAppApk = downloadAppApk;
function showUpdateBanner(v) {
  let b = document.getElementById('jtUpdateBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'jtUpdateBanner';
    document.body.insertBefore(b, document.body.firstChild); // উপরে, যাতে sticky top:0 ধরে
  }
  b.innerHTML = '';
  const txt = document.createElement('span');
  txt.textContent = '🔔 নতুন আপডেট এসেছে' + (v.versionName ? ' (v' + v.versionName + ')' : '') + ' — আপডেট করুন';
  const btn = document.createElement('button');
  btn.className = 'btn green small'; btn.textContent = 'আপডেট করুন';
  btn.onclick = () => { downloadAppApk(); };
  const x = document.createElement('button');
  x.className = 'btn outline small'; x.textContent = '✕';
  x.setAttribute('aria-label', 'ব্যানার বন্ধ করুন');
  x.onclick = () => { b.remove(); try { sessionStorage.setItem('jt_update_dismissed', v.versionName); } catch (e) {} };
  b.append(txt, btn, x);
}
async function checkAppUpdate() {
  // শুধু অ্যাপের ভেতরেই ব্যানার — ব্রাউজারে নয়।
  const installed = installedAppVersion();
  if (!installed) return;
  try {
    const r = await fetch('/version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (!v || !v.versionName || cmpVersion(v.versionName, installed) <= 0) return;
    try { if (sessionStorage.getItem('jt_update_dismissed') === v.versionName) return; } catch (e) {}
    showUpdateBanner(v);
  } catch (e) { /* চুপচাপ — আপডেট চেক না হলেও সাইট চলবে */ }
}
function bindApkButtons() {
  document.querySelectorAll('[data-download-apk]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); downloadAppApk(); });
  });
}

// অ্যাডমিনে সার্কুলার মোছা — দুই চাপে নিশ্চিতকরণ (প্রথম চাপে বোতাম বদলায়,
// দ্বিতীয় চাপে মোছে; ৩ সেকেন্ডে না চাপলে আগের অবস্থায় ফেরে)।
window.confirmDeleteCircular = function (btn, id) {
  if (btn.dataset.armed) {
    const d = JSON.parse(localStorage.getItem('jt_deleted_circulars') || '[]');
    d.push(id);
    localStorage.setItem('jt_deleted_circulars', JSON.stringify(d));
    location.reload();
  } else {
    btn.dataset.armed = '1';
    btn.textContent = 'নিশ্চিত মুছুন?';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'মুছুন'; } }, 3000);
  }
};
function matchBadge(c) {
  const p = read('jt_profile', null);
  if (!p) return '';
  const eduOk = (p.edu || 'HSC') === 'HSC' || c.posts.some(x => x.qualification === p.edu);
  const typeOk = c.posts.some(x => (x.typingBn || 0) <= (p.typeBn || 0) && (x.typingEn || 0) <= (p.typeEn || 0));
  return (eduOk && typeOk) ? '<span class="badge">✓ CV অনুযায়ী মিলেছে</span>' : '';
}

// "নতুন" ব্যাজ — অটো যোগ হওয়ার ৭ দিনের মধ্যে।
function isNew(c) {
  if (!c.addedAt) return false;
  const t = new Date(c.addedAt).getTime();
  return !isNaN(t) && (Date.now() - t) < 7 * 86400000;
}

// ---------- "তৈরি করেছেন" (Made by) ----------
// অ্যাডমিনে বসানো তথ্য localStorage-এ সেভ থাকে (jt_creator) — ছবি বা লিংক
// কিছুই কোডে হার্ডকোড করা নেই; কিছু না বসালে এই সেকশন দেখায় না।
function getCreator() {
  const c = read('jt_creator', {});
  return {
    name: (c.name || '').trim(),
    photo: (c.photo || '').trim(),
    whatsapp: (c.whatsapp || '').trim(),
    facebook: (c.facebook || '').trim(),
  };
}
function normWhatsApp(v) {
  v = (v || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 10) return 'https://wa.me/' + digits;
  return v;
}
function renderMadeBy() {
  const box = document.getElementById('madeBy');
  if (!box) return;
  const c = getCreator();
  c.whatsapp = normWhatsApp(c.whatsapp);
  if (!c.name && !c.photo && !c.whatsapp && !c.facebook) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'block';
  box.innerHTML = `<h3>👤 তৈরি করেছেন</h3>
    <div class="made-by">
      ${c.photo ? `<img class="made-by-photo" src="${c.photo}" alt="তৈরি করেছেন" onerror="this.style.display='none'">` : ''}
      <div class="made-by-info">
        ${c.name ? `<p class="made-by-name">${c.name}</p>` : ''}
        <div class="made-by-links">
          ${c.whatsapp ? `<a class="btn green small" href="${c.whatsapp}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
          ${c.facebook ? `<a class="btn outline small" href="${c.facebook}" target="_blank" rel="noopener">📘 Facebook</a>` : ''}
        </div>
        ${!c.whatsapp && !c.facebook ? '<p style="font-size:14px;color:var(--muted)">যোগাযোগের লিংক এখনো দেওয়া হয়নি।</p>' : ''}
      </div>
    </div>`;
}

// ---------- HOME ----------
async function initHome() {
  const jobsEl = document.getElementById('jobs');
  jobsEl.innerHTML = Array.from({ length: 3 }, () => '<div class="skeleton"><div class="bar" style="width:55%"></div><div class="bar" style="width:90%"></div><div class="bar" style="width:70%"></div></div>').join('');
  const circulars = await loadCirculars();
  const state = { q: '', type: '', time: '', qual: '', grade: '', sort: 'deadline', shortlistOnly: false };
  const types = [...new Map(circulars.map(c => [c.type, c.typeBn])).entries()];
  const typeChips = document.getElementById('typeChips');
  typeChips.innerHTML = `<button class="chip active" data-v="">🌐 সব ধরনের (<span class="num">${bn(circulars.length)}</span>)</button>` +
    types.map(([v, l]) => `<button class="chip" data-v="${v}">${l} (<span class="num">${bn(circulars.filter(c => c.type === v).length)}</span>)</button>`).join('');
  const timeChips = document.getElementById('timeChips');
  [['', 'চলমান'], ['soon', 'শেষ হতে চলেছে (৭ দিন)'], ['expired', 'মেয়াদ শেষ'], ['all', 'সব']].forEach(([v, l]) => {
    timeChips.appendChild(el(`<button class="chip${v === '' ? ' active' : ''}" data-v="${v}">${l}</button>`));
  });
  const qualChips = document.getElementById('qualChips');
  ['HSC', 'SSC', 'স্নাতক', 'JSC'].forEach(q => qualChips.appendChild(el(`<button class="chip" data-v="${q}">${q}</button>`)));
  function bindChips(container, key) {
    container.querySelectorAll('.chip').forEach(ch => ch.onclick = () => {
      container.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active'); state[key] = ch.dataset.v; render();
    });
  }
  bindChips(typeChips, 'type'); bindChips(timeChips, 'time'); bindChips(qualChips, 'qual');
  document.getElementById('q').oninput = e => { state.q = e.target.value; render(); };
  document.getElementById('gradeSel').onchange = e => { state.grade = e.target.value.replace(/\d/g, d => BN[+d]); render(); };
  document.getElementById('sortSel').onchange = e => { state.sort = e.target.value; render(); };
  document.getElementById('shortlistOnlyBtn').onclick = () => { state.shortlistOnly = !state.shortlistOnly; render(); };
  document.getElementById('clearFiltersBtn').onclick = () => location.reload();
  document.getElementById('refreshBtn').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin">⟳</span> অনলাইনে যাচাই হচ্ছে…';
    // সার্ভার থেকে প্রতিটি আবেদন পোর্টাল লাইভ যাচাই করে, তারপর তালিকা আবার টানে।
    try {
      const r = await fetch('api/online-check', { cache: 'no-store' });
      const data = await r.json().catch(() => ({}));
      if (data.ok) sessionStorage.setItem('jt_online_check', JSON.stringify({ live: data.live, unknown: data.unknown || 0, portals: data.portals, at: data.checkedAt, added: (data.discovered && data.discovered.added) || 0 }));
    } catch {}
    location.reload(); // পেইজ আবার লোড হলে সার্ভার থেকে নতুন সার্কুলার আসে
  };
  // আগের অনলাইন যাচাইয়ের ফল দেখান (থাকলে)।
  try {
    const oc = JSON.parse(sessionStorage.getItem('jt_online_check') || 'null');
    if (oc) {
      const t = new Date(oc.at).toLocaleTimeString('bn-BD', { hour: 'numeric', minute: '2-digit' });
      const unk = oc.unknown ? `, ${bn(oc.unknown)}টির অবস্থা যাচাই হয়নি` : '';
      const addedTxt = oc.added ? ` • নতুন ${bn(oc.added)}টি সার্কুলার যোগ হয়েছে` : '';
      document.getElementById('lastCheck').textContent = `অনলাইনে যাচাই: ${bn(oc.live)}/${bn(oc.portals)}টি পোর্টাল চালু${unk}${addedTxt} • ${t}`;
    }
  } catch {}
  const user = getUser();
  // লগইন করা থাকলে প্রতিবার পেইজ খুললেই Gmail-টা সার্ভারে প্রাপক হিসেবে
  // আবার নথিভুক্ত হয় — KV চালু হওয়ার আগে লগইন করা ব্যবহারকারীরাও
  // (যেমন Lina Das) এতে পরেরবার পেইজ খুললেই প্রাপক তালিকায় চলে আসে।
  if (user && user.email) fetch('api/register-recipient', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email }) }).catch(() => {});
  // হোমে কোনো আলাদা লগইন বাটন নেই — লগইন শুধু পপআপে, আবেদন/বিস্তারিত/
  // শর্টলিস্ট চাপলেই সরাসরি পপআপ আসে। লগইন করা থাকলে প্রোফাইল ছবি+নাম দেখায়।
  const prof = getProfile();
  const chipName = (prof.name || (user && user.name) || '');
  const chipPhoto = prof.photo || '';
  document.getElementById('userChip').innerHTML = user ? `${chipPhoto ? `<img class="chip-photo" src="${chipPhoto}" alt="" onerror="this.style.display='none'">` : ''}<span class="pill" style="background:rgba(255,255,255,.2);color:#fff">${chipName} • ${user.email}</span> <button class="btn ghost small" id="logoutBtn">লগআউট</button>` : '';
  const lb = document.getElementById('logoutBtn'); if (lb) lb.onclick = () => { localStorage.removeItem('jt_user'); localStorage.removeItem('jt_session'); location.reload(); };
  document.getElementById('loginNote').textContent = user ? '' : 'লগইন না করলে আবেদন বা ভেতরের কিছু করা যাবে না — শুধু তালিকা দেখা ও খোঁজা যাবে।';
  const open = circulars.filter(c => daysLeft(c.deadline) >= 0);
  document.getElementById('heroStats').innerHTML = `সবার জন্য উন্মুক্ত • চলমান <span class="num">${bn(open.length)}</span>টি • মোট <span class="num">${bn(circulars.length)}</span>টি`;
  // লাইভ কাউন্টডাউন — প্রতি সেকেন্ডে সবচেয়ে কাছের চলমান ডেডলাইন আবার
  // বের করা হয়, তাই ডেডলাইন পার হলে পরেরটায় চলে যায়, ০-তে আটকে থাকে না।
  const cd = document.getElementById('countdown');
  if (cd) {
    const heroTick = () => {
      const openNow = circulars.filter(c => daysLeft(c.deadline) >= 0)
        .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];
      if (!openNow) { cd.innerHTML = '<div>কোনো চলমান সার্কুলার নেই</div>'; return; }
      const r = remainParts(openNow.deadline);
      if (!r) { cd.innerHTML = '<div>ডেডলাইন শেষ হয়েছে</div>'; return; }
      cd.innerHTML = `<div><b class="num">${bn(r.d)}</b>দিন</div><div><b class="num">${bn(r.h)}</b>ঘণ্টা</div><div><b class="num">${bn(r.m)}</b>মিনিট</div><div><b class="num">${bn(r.sec)}</b>সেকেন্ড</div><div style="min-width:0">⏰ ${openNow.org}</div>`;
    };
    heroTick(); setInterval(heroTick, 1000);
  }
  if (open.length) {
    document.getElementById('deadlineList').innerHTML = open.filter(c => daysLeft(c.deadline) <= 3)
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .map(c => `<p><b>${daysLeft(c.deadline) === 0 ? 'আজই শেষ' : daysLeft(c.deadline) === 1 ? 'আগামীকাল শেষ' : 'আর ' + bn(daysLeft(c.deadline)) + ' দিন বাকি'}</b> — ${c.org} (<span class="num">${fmtDate(c.deadline)}</span>) • <span style="color:var(--red);font-weight:700">এখনো আবেদন করেননি</span></p>`).join('') || '<p>শেষ ৩ দিনের মধ্যে কোনো ডেডলাইন নেই।</p>';
  }
  function render() {
    const shortlist = read('jt_shortlist', []);
    const status = read('jt_status', {});
    let list = circulars.filter(c => {
      if (state.q && !(c.org + ' ' + c.posts.map(p => p.title).join(' ')).includes(state.q)) return false;
      if (state.type && c.type !== state.type) return false;
      if (state.qual && !c.posts.some(p => p.qualification === state.qual)) return false;
      if (state.grade && !c.posts.some(p => bn(p.grade) === state.grade)) return false;
      if (state.shortlistOnly && !shortlist.includes(c.id)) return false;
      const dl = daysLeft(c.deadline);
      if (state.time === 'soon' && !(dl >= 0 && dl <= 7)) return false;
      if (state.time === 'expired' && dl >= 0) return false;
      if (state.time === '' && dl < 0) return false;
      return true;
    });
    if (state.sort === 'posts') list.sort((a, b) => b.totalPosts - a.totalPosts);
    else if (state.sort === 'name') list.sort((a, b) => a.org.localeCompare(b.org, 'bn'));
    else list.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    document.getElementById('resultCount').innerHTML = `পাওয়া গেছে <span class="num">${bn(list.length)}</span>টি`;
    jobsEl.innerHTML = '';
    list.forEach((c, i) => {
      const dl = daysLeft(c.deadline);
      const card = el(`<article class="card job ${dl < 0 ? 'closed' : ''}">
        <span class="pill grey">${c.source === 'secondary' ? 'দ্বিতীয় সূত্র' : 'অফিসিয়াল'}</span> ${isNew(c) ? '<span class="badge">🆕 নতুন</span>' : ''} ${matchBadge(c)}
        <h2>${c.org}</h2>
        <div class="meta"><span>HSC পদ: ${c.hscPosts == null ? 'উল্লেখ নেই' : '<b class="num">' + bn(c.hscPosts) + '</b>টি'}</span><span>মোট পদ: ${c.totalPosts == null ? 'উল্লেখ নেই' : '<span class="num">' + bn(c.totalPosts) + '</span>টি'}</span><span>ফি: ${c.fee ? '<span class="num">' + bn(c.fee) + '</span> টাকা' : 'উল্লেখ নেই'}</span><span>গ্রেড: ${c.grade == null ? 'উল্লেখ নেই' : '<span class="num">' + bn(c.grade) + '</span>'}</span></div>
        <p><span class="pill ${dl < 0 ? 'grey' : dl <= 3 ? 'red' : 'green'}">${dl < 0 ? 'মেয়াদ শেষ' : dl === 0 ? 'আজই শেষ' : 'আর ' + bn(dl) + ' দিন'}</span> শেষ: <span class="num">${fmtDate(c.deadline)}</span><br><span class="live-cd" data-dl="${c.deadline}"></span></p>
        <div class="actions">
          <button class="btn outline small" data-act="shortlist">☆ শর্টলিস্ট</button>
          <button class="btn green small" data-act="apply">আবেদন করুন ↗</button>
          <button class="btn outline small" data-act="status">আবেদন করেছি</button>
          <button class="btn outline small" data-act="details">বিস্তারিত ▾</button>
        </div>
        <div class="details" style="display:none">
          <table>${c.posts.map(p => `<tr><td>${p.title}</td><td>${p.count == null ? '—' : '<span class="num">' + bn(p.count) + '</span>টি'}</td><td>${p.grade == null ? '—' : 'গ্রেড <span class="num">' + bn(p.grade) + '</span>'}</td><td>${p.qualification || '—'}</td><td>${p.typingBn || p.typingEn ? 'টাইপিং: বাংলা <span class="num">' + bn(p.typingBn || 0) + '</span> / ইংরেজি <span class="num">' + bn(p.typingEn || 0) + '</span>' : ''}</td></tr>`).join('')}</table>
          <p>বেতন: ${c.salary} • বয়স: ${c.age} • জেলা: ${c.districts}</p>
          ${c.autoAdded ? '' : `<div class="warn">⚠️ ${c.sourceNote}</div>`}
        </div>
      </article>`);
      card.querySelector('[data-act=shortlist]').onclick = () => { if (!requireLogin()) return; const s = read('jt_shortlist', []); const i = s.indexOf(c.id); i >= 0 ? s.splice(i, 1) : s.push(c.id); store('jt_shortlist', s); syncToServer(); render(); };
      card.querySelector('[data-act=apply]').onclick = () => { if (!requireLogin()) return; window.open(c.applyUrl, '_blank'); };
      card.querySelector('[data-act=status]').onclick = () => { if (!requireLogin()) return; const s = read('jt_status', {}); s[c.id] = 'applied'; store('jt_status', s); syncToServer(); render(); };
      card.querySelector('[data-act=details]').onclick = (e) => { if (!requireLogin()) return; const d = card.querySelector('.details'); d.style.display = d.style.display === 'none' ? 'block' : 'none'; };
      if (shortlist.includes(c.id)) card.querySelector('[data-act=shortlist]').textContent = '★ শর্টলিস্টে আছে';
      if (status[c.id] === 'applied') card.querySelector('[data-act=status]').textContent = '✓ আবেদন করেছি';
      if (!isLoggedIn()) card.querySelectorAll('[data-act]').forEach(b => b.classList.add('locked'));
      card.style.animationDelay = Math.min(i * 60, 480) + 'ms';
      jobsEl.appendChild(card);
    });
    if (!list.length) jobsEl.innerHTML = '<div class="card"><p>কোনো সার্কুলার পাওয়া যায়নি। ফিল্টার বদলে দেখুন।</p></div>';
    updateLiveCds();
  }
  // প্রতিটি কার্ডের লাইভ কাউন্টডাউন — প্রতি সেকেন্ডে একবার সব কার্ড আপডেট হয়।
  // ইন্টারভাল একবারই বসে (render বারবার চললেও ডুপ্লিকেট হয় না)।
  function updateLiveCds() {
    document.querySelectorAll('.live-cd').forEach(el => {
      const r = remainParts(el.dataset.dl);
      el.textContent = r ? `⏱ ${bn(r.d)} দিন ${bn(r.h)} ঘণ্টা ${bn(r.m)} মিনিট ${bn(r.sec)} সেকেন্ড বাকি` : '⏱ মেয়াদ শেষ';
    });
  }
  if (!window.__jtCdTimer) window.__jtCdTimer = setInterval(updateLiveCds, 1000);
  render();
  renderMadeBy();
  showProfileGuide();
}

// ---------- লগইনের পর প্রোফাইল সেট করার নির্দেশনা ----------
// সাইডবারের (☰ মেনু) দিকে তির (➡️) দিয়ে দেখায় — "প্রোফাইল সেট করুন"।
// শুধু তখনই আসে যখন লগইনের পর প্রোফাইল অসম্পূর্ণ (নাম/ঠিকানা/ছবি নেই)।
// একবার দেখানোর পর ফ্ল্যাগ মুছে যায়; প্রোফাইল সম্পূর্ণ হলে আর আসে না।
function showProfileGuide() {
  let flag = false;
  try { flag = sessionStorage.getItem('jt_profile_guide') === '1'; sessionStorage.removeItem('jt_profile_guide'); } catch {}
  if (!flag || !isLoggedIn()) return;
  const p = read('jt_profile', {});
  if (p.name && p.address && p.photo) return;
  if (document.getElementById('profileGuide')) return;
  const g = el(`<div class="profile-guide" id="profileGuide">
    <div class="guide-arrow">➡️</div>
    <div class="guide-text"><b>👤 প্রোফাইল সেট করুন</b><br>নাম, ঠিকানা ও ছবি দিন — আপনার যোগ্যতা অনুযায়ী সার্কুলার মিলবে।<br><span style="font-size:13px;opacity:.85">☰ মেনু চাপুন → আমার প্রোফাইল</span></div>
    <button class="btn green small" id="profileGuideGo">এখনই সেট করুন</button>
    <button class="btn outline small" id="profileGuideLater">পরে করব</button>
  </div>`);
  document.body.appendChild(g);
  document.getElementById('profileGuideGo').onclick = () => { location.href = 'profile.html'; };
  document.getElementById('profileGuideLater').onclick = () => g.remove();
}

// ---------- USER PROFILE (নাম, ঠিকানা, ছবি) ----------
// jt_profile-এ থাকে: নাম, ঠিকানা, মোবাইল, ছবি (আপলোড/data URL বা লিংক),
// জেলা, জন্ম তারিখ, শিক্ষা, টাইপিং, অন্যান্য তথ্য। সেটিংসে বদলানো যায়;
// ড্রয়ার মেনুতে ছবি+নাম দেখায়।
function getProfile() { return read('jt_profile', {}); }
function profileComplete() { const p = getProfile(); return !!(p.name && p.address && p.photo); }
// Google লগইন: কোনো অ্যাকাউন্ট আগে থেকে ভরা থাকবে না। লগইন বাটন চাপলে
// Google-এর অ্যাকাউন্ট বাছাই (chooser) খুলবে — প্রত্যেকে নিজের Gmail
// বেছে নেবে। আগে google.accounts.id-এর personalized "Sign in as …"
// বাটন + One Tap prompt ব্যবহার হতো, তাই ব্রাউজারে লগইন করা অ্যাকাউন্ট
// (যেমন মালিকের Gmail) আগে থেকে দেখাত। এখন OAuth2 code client
// (popup, prompt: 'select_account') ব্যবহার হয় — কোডটা সার্ভারের
// api/auth-google-এ গিয়ে যাচাই হয় (আগের ID-token পথটাও fallback হিসেবে আছে)।
let loginPopupInit = false;
let googleCodeClient = null;
async function initLoginPopup() {
  if (loginPopupInit) return; loginPopupInit = true;
  const lm = document.getElementById('loginModal');
  if (lm) lm.onclick = e => { if (e.target === lm) closeLoginPopup(); };
  const lc = document.getElementById('loginModalClose');
  if (lc) lc.onclick = closeLoginPopup;
  const cfg = await fetch('api/config').then(r => r.json()).catch(() => ({ googleClientId: '' }));
  const note = document.getElementById('gisNote');
  const finishLogin = async (name, email, token) => {
    store('jt_user', { name, email });
    if (token) localStorage.setItem('jt_session', token);
    fetch('api/register-recipient', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => {});
    // লগইন/রেজিস্টারের পরেই প্রোফাইল সেট করার নির্দেশনা দেখাতে ফ্ল্যাগ —
    // হোমে গিয়ে প্রোফাইল অসম্পূর্ণ থাকলে সাইডবারের দিকে তিরসহ গাইড আসবে।
    try { sessionStorage.setItem('jt_profile_guide', '1'); } catch {}
    // সার্ভারে সেভ থাকা ডেটা থাকলে তা নামিয়ে নিন (অন্য ডিভাইসে করা কাজ
    // ফিরে আসবে); না থাকলে এই ব্রাউজারের ডেটা সার্ভারে তুলে দিন।
    try { await Promise.race([syncFromServer(), new Promise(r => setTimeout(r, 6000))]); } catch {}
    location.reload();
  };
  if (!cfg.googleClientId) {
    if (note) note.textContent = 'Google OAuth এখনো সেট করা হয়নি — Vercel-এ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET সেট করুন (README দেখুন)। ততক্ষণ নিচের ম্যানুয়াল লগইন ব্যবহার করুন।';
  } else if (window.google && !googleCodeClient) {
    // Popup মোডে redirect_uri ডিফল্টভাবে পেইজের origin হয় — Google-এর
    // ডক অনুযায়ী exchange-এর সময়ও একই origin পাঠাতে হয়, তাই কোডের
    // সঙ্গে window.location.origin পাঠানো হয়।
    googleCodeClient = google.accounts.oauth2.initCodeClient({
      client_id: cfg.googleClientId,
      scope: 'openid email profile',
      ux_mode: 'popup',
      prompt: 'select_account',
      callback: async (resp) => {
        if (resp.error) {
          if (resp.error === 'popup_closed_by_user') return;
          if (note) note.textContent = 'Google লগইন হয়নি: ' + resp.error;
          return;
        }
        if (!resp.code) return;
        if (note) note.textContent = 'Google যাচাই করা হচ্ছে…';
        const r = await fetch('api/auth-google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: resp.code, redirectUri: window.location.origin }) });
        const data = await r.json().catch(() => ({}));
        if (data.ok || data.email) finishLogin(data.name || 'Google ব্যবহারকারী', data.email, data.token);
        else if (note) note.textContent = 'Google যাচাই ব্যর্থ হয়েছে: ' + (data.error || 'আবার চেষ্টা করুন।');
      }
    });
  }
  const gc = document.getElementById('googleConnectBtn');
  if (gc) gc.onclick = () => { if (googleCodeClient) googleCodeClient.requestCode(); else if (note) note.textContent = 'Google OAuth সেট করা নেই — Vercel-এ GOOGLE_CLIENT_ID সেট করুন, অথবা ম্যানুয়াল লগইন ব্যবহার করুন।'; };
  const ml = document.getElementById('manualLoginBtn');
  if (ml) ml.onclick = async () => {
    const name = document.getElementById('manualName').value.trim();
    const emailRaw = document.getElementById('manualEmail').value.trim();
    const email = emailRaw.toLowerCase();
    const pass = document.getElementById('manualPass').value;
    if (!name || !email || !pass) { toast('নাম, Gmail ও পাসওয়ার্ড — তিনটাই দিন।'); return; }
    const hash = await sha256(email + ':' + pass);
    const accounts = read('jt_accounts', {});
    const localAcc = accounts[emailRaw] || accounts[email];
    // আগের লোকাল অ্যাকাউন্ট থাকলে তার হ্যাশও মেনে নিন (আগে বড় হাতের
    // অক্ষরে টাইপ করে বানানো অ্যাকাউন্টের হ্যাশ আলাদা হতে পারে)।
    if (localAcc && localAcc.hash !== hash && localAcc.hash !== await sha256(emailRaw + ':' + pass)) { toast('ভুল পাসওয়ার্ড।'); return; }
    // সার্ভারে অ্যাকাউন্ট থাকলে (Vercel KV) সেখানেই যাচাই হবে — তাহলে একই
    // Gmail + পাসওয়ার্ড অন্য ডিভাইসেও চলবে। KV না থাকলে আগের মতো এই
    // ব্রাউজারের লোকাল অ্যাকাউন্টেই লগইন হবে।
    try {
      const r = await fetch('api/auth-manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name, hash }) });
      const data = await r.json().catch(() => ({}));
      if (data.ok && data.token) {
        accounts[email] = { name: data.name || name, hash };
        store('jt_accounts', accounts);
        finishLogin(data.name || name, email, data.token);
        return;
      }
      if (data.error === 'wrong_password') { toast('ভুল পাসওয়ার্ড।'); return; }
    } catch {}
    if (!accounts[email]) accounts[email] = { name, hash };
    store('jt_accounts', accounts);
    finishLogin(accounts[email].name, email);
  };
  // ---------- পাসওয়ার্ড ভুলে গেছেন? (Gmail-এ কোড → নতুন পাসওয়ার্ড) ----------
  const fl = document.getElementById('forgotLink');
  if (fl) fl.onclick = (e) => { e.preventDefault(); const p = document.getElementById('forgotPanel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
  const fpSend = document.getElementById('fpSendBtn');
  if (fpSend) fpSend.onclick = async () => {
    const email = document.getElementById('fpEmail').value.trim().toLowerCase();
    const st = document.getElementById('fpStatus');
    if (!email) { st.textContent = 'Gmail ঠিকানাটা দিন।'; return; }
    st.textContent = 'কোড পাঠানো হচ্ছে…';
    try {
      const r = await fetch('api/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'request', email }) });
      const data = await r.json().catch(() => ({}));
      st.textContent = data.ok ? (data.note || 'কোড পাঠানো হয়েছে।') : '✗ ' + (data.error || 'পাঠানো যায়নি।');
      if (data.ok) {
        document.getElementById('fpStep2').style.display = 'block';
        const acc = read('jt_accounts', {})[email];
        if (acc) document.getElementById('fpName').value = acc.name;
      }
    } catch { st.textContent = '✗ পাঠানো যায়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
  };
  const fpReset = document.getElementById('fpResetBtn');
  if (fpReset) fpReset.onclick = async () => {
    const email = document.getElementById('fpEmail').value.trim().toLowerCase();
    const code = document.getElementById('fpCode').value.trim();
    const newPass = document.getElementById('fpNewPass').value;
    const name = document.getElementById('fpName').value.trim();
    const st = document.getElementById('fpStatus');
    if (!code || !newPass) { st.textContent = 'কোড ও নতুন পাসওয়ার্ড — দুটোই দিন।'; return; }
    st.textContent = 'যাচাই করা হচ্ছে…';
    try {
      // সার্ভারের অ্যাকাউন্টের হ্যাশও বদলে দিন (KV চালু থাকলে) — তাহলে
      // নতুন পাসওয়ার্ড অন্য ডিভাইসেও চলবে। newHash = SHA-256("email:pass"),
      // প্লেইন পাসওয়ার্ড সার্ভারে যায় না।
      const newHash = await sha256(email + ':' + newPass);
      const r = await fetch('api/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'verify', email, code, newPassword: newPass, newHash, name }) });
      const data = await r.json().catch(() => ({}));
      if (!data.ok) { st.textContent = '✗ ' + (data.error || 'যাচাই হয়নি।'); return; }
      // কোড মিলেছে — এই ব্রাউজারে অ্যাকাউন্টের পাসওয়ার্ড-হ্যাশ বদলে দিন।
      // পুরনো পাসওয়ার্ড কোথাও পাঠানো হয় না, নতুন পাসওয়ার্ডও সার্ভারে যায় না।
      const accounts = read('jt_accounts', {});
      const accName = (accounts[email] && accounts[email].name) || name;
      if (!accName) { st.textContent = 'নামটা দিন — এই ব্রাউজারে এই Gmail-এর কোনো অ্যাকাউন্ট পাওয়া যায়নি।'; return; }
      accounts[email] = { name: accName, hash: await sha256(email + ':' + newPass) };
      store('jt_accounts', accounts);
      st.textContent = '✓ নতুন পাসওয়ার্ড সেট হয়েছে — লগইন হচ্ছে…';
      finishLogin(accName, email);
    } catch { st.textContent = '✗ যাচাই হয়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
  };
}
async function initLogin() { initLoginPopup(); }

// ---------- আমার প্রোফাইল (profile.html) ----------
// নাম, ঠিকানা, মোবাইল, ছবি (আপলোড ≤৫০০ KB বা লিংক), জেলা, জন্ম তারিখ,
// শিক্ষা, টাইপিং, অন্যান্য তথ্য — সব jt_profile-এ সেভ থাকে।
// রিমাইন্ডার পছন্দ: সবার উপরে হ্যাঁ/না (remindersEnabled — না থাকলে হ্যাঁ
// ধরা হয়, যাতে আগের ব্যবহারকারীদের মেইল বন্ধ না হয়), তার নিচে ধরণ +
// যোগ্যতার চিপ — অপশনগুলো সার্ভারের /api/config থেকে আসে; ফেচ না হলে
// নিচের কপিটা ব্যবহার হয়। কিছু না বাছলে সব ধরণের রিমাইন্ডার যাবে
// (সার্ভারেও একই নিয়ম)।
const REMINDER_OPTIONS_FALLBACK = {
  types: [
    { key: 'govt', label: 'সরকারি' }, { key: 'ministry', label: 'মন্ত্রণালয় / অধিদপ্তর' },
    { key: 'bank', label: 'ব্যাংক' }, { key: 'police', label: 'পুলিশ / সেনা / প্রতিরক্ষা' },
    { key: 'teacher', label: 'শিক্ষক / শিক্ষা' }, { key: 'health', label: 'স্বাস্থ্য' },
    { key: 'railway', label: 'রেলওয়ে' }, { key: 'district', label: 'জেলা প্রশাসন' },
    { key: 'tax', label: 'কর / রাজস্ব / অডিট' }, { key: 'court', label: 'আদালত' },
    { key: 'private', label: 'বেসরকারি' }, { key: 'ngo', label: 'এনজিও' },
    { key: 'other', label: 'অন্যান্য' },
  ],
  quals: [
    { key: 'HSC', label: 'HSC' }, { key: 'SSC', label: 'SSC' }, { key: 'GRAD', label: 'স্নাতক' },
    { key: 'COMPUTER_TYPIST', label: 'কম্পিউটার টাইপিস্ট' }, { key: 'COMPUTER_OPERATOR', label: 'কম্পিউটার অপারেটর' },
  ],
};
async function renderPrefChips() {
  const boxT = document.getElementById('prefTypes'); const boxQ = document.getElementById('prefQuals');
  if (!boxT || !boxQ) return;
  let opts = REMINDER_OPTIONS_FALLBACK;
  try {
    const r = await fetch('api/config', { cache: 'no-store' });
    const d = await r.json();
    if (d.reminderOptions && Array.isArray(d.reminderOptions.types) && Array.isArray(d.reminderOptions.quals)) opts = d.reminderOptions;
  } catch {}
  const p = read('jt_profile', {});
  const rem = (p.reminders && typeof p.reminders === 'object') ? p.reminders : { types: [], quals: [] };
  const mk = (box, list, sel) => {
    box.innerHTML = '';
    list.forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + ((sel || []).includes(o.key) ? ' active' : '');
      b.textContent = o.label;
      b.dataset.key = o.key;
      b.onclick = () => b.classList.toggle('active');
      box.appendChild(b);
    });
  };
  mk(boxT, opts.types, rem.types);
  mk(boxQ, opts.quals, rem.quals);
}
function collectPrefs() {
  const sel = id => [...document.querySelectorAll('#' + id + ' .chip.active')].map(b => b.dataset.key);
  return { types: sel('prefTypes'), quals: sel('prefQuals') };
}
function setRemToggle(enabled) {
  document.querySelectorAll('#remToggle .yn-btn').forEach(b => b.classList.toggle('active', (b.dataset.yn === 'yes') === !!enabled));
  const note = document.getElementById('remToggleNote');
  if (note) note.textContent = enabled ? 'হ্যাঁ — ডেডলাইনের রিমাইন্ডার আপনার Gmail-এ যাবে (নিচের পছন্দ অনুযায়ী)।' : 'না — কোনো রিমাইন্ডার ইমেইল যাবে না। চাইলে পরে আবার হ্যাঁ করতে পারবেন।';
}
function getRemindersEnabled() {
  const yes = document.querySelector('#remToggle .yn-btn[data-yn="yes"]');
  return !yes || yes.classList.contains('active');
}
// খালি প্রোফাইল (রিসেটের ডিফল্ট): টাইপিং ২০/২০, শিক্ষা HSC, রিমাইন্ডার হ্যাঁ।
function emptyProfile() {
  return { name: '', address: '', permAddress: '', phone: '', email: '', photo: '', district: '', dob: '', edu: 'HSC', typeBn: 20, typeEn: 20, notes: '', fatherName: '', motherName: '', skills: '', experience: '', languages: '', remindersEnabled: true, reminders: { types: [], quals: [] } };
}

// প্রোফাইল ফর্মে সেভ থাকা মান বসানো (পেইজ লোড + রিসেটের পর দুই জায়গাতেই লাগে)।
function fillProfileForm() {
  const p = read('jt_profile', {});
  const map = { pName: 'name', pAddress: 'address', pPermAddress: 'permAddress', pPhone: 'phone', pEmail: 'email', pPhotoUrl: 'photo', pDistrict: 'district', pDob: 'dob', pEdu: 'edu', pTypeBn: 'typeBn', pTypeEn: 'typeEn', pNotes: 'notes', pFather: 'fatherName', pMother: 'motherName', pSkills: 'skills', pExp: 'experience', pLang: 'languages' };
  Object.entries(map).forEach(([id, key]) => { const f = document.getElementById(id); if (f) f.value = (p[key] === undefined || p[key] === null) ? '' : p[key]; });
  renderPrefChips();
  setRemToggle(p.remindersEnabled !== false);
  const prev = document.getElementById('pPhotoPreview');
  if (prev) { prev.src = p.photo || ''; prev.style.display = p.photo ? 'block' : 'none'; }
  const info = document.getElementById('cvInfo');
  if (info) info.textContent = cvStatusText() || 'এখনো কোনো CV আপলোড করা হয়নি — সেটিংস থেকে CV আপলোড করলে তার তথ্য এখানে বসে যাবে।';
  const rm = document.getElementById('removeCvBtnProfile');
  if (rm) rm.style.display = (p.cv && p.cv.name) ? '' : 'none';
}
function initProfile() {
  if (!requireLogin()) return;
  fillProfileForm();
  const photoFile = document.getElementById('pPhotoFile');
  if (photoFile) photoFile.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 500 * 1024) { toast('ছবি ৫০০ KB-এর মধ্যে রাখুন।'); return; }
    const r = new FileReader();
    r.onload = () => {
      document.getElementById('pPhotoUrl').value = String(r.result);
      const pv = document.getElementById('pPhotoPreview'); pv.src = String(r.result); pv.style.display = 'block';
    };
    r.readAsDataURL(f);
  };
  const photoUrl = document.getElementById('pPhotoUrl');
  if (photoUrl) photoUrl.oninput = () => { const pv = document.getElementById('pPhotoPreview'); if (pv) { pv.src = photoUrl.value.trim(); pv.style.display = photoUrl.value.trim() ? 'block' : 'none'; } };
  const rmBtn = document.getElementById('removeCvBtnProfile');
  if (rmBtn) rmBtn.onclick = () => armConfirm(rmBtn, 'নিশ্চিত মুছবেন?', () => { removeCvFromProfile(); fillProfileForm(); toast('CV মোছা হয়েছে।'); });
  document.getElementById('saveProfileBtn').onclick = () => {
    const old = read('jt_profile', {});
    const np = {
      name: document.getElementById('pName').value.trim(),
      address: document.getElementById('pAddress').value.trim(),
      permAddress: document.getElementById('pPermAddress').value.trim(),
      phone: document.getElementById('pPhone').value.trim(),
      email: document.getElementById('pEmail').value.trim(),
      photo: document.getElementById('pPhotoUrl').value.trim(),
      district: document.getElementById('pDistrict').value,
      dob: document.getElementById('pDob').value,
      edu: document.getElementById('pEdu').value,
      typeBn: (+document.getElementById('pTypeBn').value) || 20,
      typeEn: (+document.getElementById('pTypeEn').value) || 20,
      notes: document.getElementById('pNotes').value.trim(),
      fatherName: document.getElementById('pFather').value.trim(),
      motherName: document.getElementById('pMother').value.trim(),
      skills: document.getElementById('pSkills').value.trim(),
      experience: document.getElementById('pExp').value.trim(),
      languages: document.getElementById('pLang').value.trim(),
      remindersEnabled: getRemindersEnabled(),
      reminders: collectPrefs(),
    };
    if (old.cv) np.cv = old.cv; // হাতে সেভ করলে আপলোড করা CV হারাবে না
    store('jt_profile', np);
    syncToServer(true);
    toast('✓ প্রোফাইল সেভ হয়েছে।');
    setTimeout(() => { location.href = 'index.html'; }, 900);
  };
  const resetBtn = document.getElementById('resetProfileBtn');
  if (resetBtn) resetBtn.onclick = () => armConfirm(resetBtn, 'নিশ্চিত রিসেট করবেন?', () => {
    // শুধু প্রোফাইল + CV খালি হয় — লগইন/অ্যাকাউন্ট, শর্টলিস্ট ও
    // আবেদনের অবস্থা ছোঁয়া হয় না (ওগুলো jt_profile-এ থাকে না)।
    store('jt_profile', emptyProfile());
    try { localStorage.removeItem('jt_cv_data'); } catch {}
    syncToServer(true); // সার্ভারেও খালি প্রোফাইল সেভ হয় — রিসেট সব ডিভাইসে থাকে
    fillProfileForm();
    toast('প্রোফাইল রিসেট হয়েছে।');
  });
  document.getElementById('profileCloseBtn').onclick = () => location.href = 'index.html';
}
// ---------- CV আপলোড → প্রোফাইল ----------
// আগে: শুধু readAsText(f) থেকে জেলা খুঁজত — PDF-এ সেটা বাইনারি আবর্জনা,
// তাই প্রায় কখনো মিলত না; আর জেলা ছাড়া কিছুই প্রোফাইলে যেত না,
// ফাইলটাও কোথাও সেভ হতো না। এখন: PDF (pdf.js, ফলব্যাক raw stream),
// টেক্সট ও ছবি (OCR) থেকে লেখা পড়ে cv-parse.js দিয়ে সব ফিল্ড বের করে
// প্রোফাইলে বসায়; ফাইল + তথ্য প্রোফাইলে (cv) সেভ থাকে।
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + src + '"]')) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('script load failed'));
    document.head.appendChild(s);
  });
}
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

async function extractPdfText(buf) {
  try {
    await loadScript(PDFJS_URL);
    const lib = window.pdfjsLib;
    if (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const pdf = await lib.getDocument({ data: buf }).promise;
      let out = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        let lastY = null;
        for (const it of tc.items) {
          const y = it.transform ? it.transform[5] : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += '\n';
          out += (it.str || '') + ' ';
          lastY = y;
        }
        out += '\n';
      }
      if (out.trim()) return out;
    }
  } catch {}
  try { return await extractPdfTextRaw(buf); } catch { return ''; }
}

async function extractCvText(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (name.endsWith('.txt') || type.startsWith('text/')) return await file.text();
  if (name.endsWith('.pdf') || type === 'application/pdf') return await extractPdfText(await file.arrayBuffer());
  if (type.startsWith('image/') || /\.(png|jpe?g)$/.test(name)) {
    // ছবির CV — OCR চেষ্টা (ইংরেজি + বাংলা)। না পারলে খালি ফেরে।
    try {
      await Promise.race([loadScript(TESS_URL), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]);
      if (!window.Tesseract) return '';
      let worker = null;
      try { worker = await window.Tesseract.createWorker(['eng', 'ben']); }
      catch { worker = await window.Tesseract.createWorker('eng'); }
      const r = await Promise.race([
        worker.recognize(file),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ocr timeout')), 90000)),
      ]);
      try { await worker.terminate(); } catch {}
      return (r && r.data && r.data.text) || '';
    } catch { return ''; }
  }
  return '';
}

const CV_FIELD_LABELS = { name: 'নাম', phone: 'মোবাইল', email: 'ইমেইল', dob: 'জন্ম তারিখ', district: 'জেলা', edu: 'শিক্ষা', typeBn: 'টাইপিং (বাংলা)', typeEn: 'টাইপিং (ইংরেজি)', address: 'ঠিকানা', permAddress: 'স্থায়ী ঠিকানা', fatherName: 'পিতার নাম', motherName: 'মাতার নাম', skills: 'দক্ষতা', experience: 'কর্ম অভিজ্ঞতা', languages: 'ভাষা' };

// CV-র তথ্য প্রোফাইলে বসানো (খালি ঘর + আগের CV-র ঘরই বদলায়;
// নিজে হাতে বদলানো ঘর ছোঁয়া হয় না)। বসানো ফিল্ডের নাম ফেরে।
function applyCvFieldsToProfile(fields, meta) {
  const p = read('jt_profile', {});
  const old = (p.cv && p.cv.fields) || {};
  const merged = (typeof mergeCvFields === 'function')
    ? mergeCvFields(p, fields, old)
    : { profile: p, filled: [] };
  const np = merged.profile;
  np.cv = { name: meta.name, size: meta.size, uploadedAt: new Date().toISOString(), text: (meta.text || '').slice(0, 4000), fields };
  store('jt_profile', np);
  syncToServer(true);
  return merged.filled.map(k => CV_FIELD_LABELS[k] || k);
}

// CV মোছা: স্ন্যাপশটের সাথে হুবহু মেলা ঘরগুলোই খালি হয়
// (হাতে বদলানো ঘর থেকে যায়)।
function removeCvFromProfile() {
  const p = read('jt_profile', {});
  const snap = (p.cv && p.cv.fields) || {};
  const np = (typeof removeCvFields === 'function') ? removeCvFields(p, snap) : p;
  if (np.cv) delete np.cv;
  store('jt_profile', np);
  try { localStorage.removeItem('jt_cv_data'); } catch {}
  syncToServer(true);
}

function cvStatusText() {
  const p = read('jt_profile', {});
  if (!p.cv || !p.cv.name) return '';
  const when = p.cv.uploadedAt ? new Date(p.cv.uploadedAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const size = p.cv.size ? ' (' + Math.round(p.cv.size / 1024) + ' KB)' : '';
  return '📄 ' + p.cv.name + size + (when ? ' — ' + when : '');
}

// দুই চাপে নিশ্চিত করা (প্রথম চাপে বোতামের লেখা বদলায়, ৩ সেকেন্ডে
// দ্বিতীয় চাপ না এলে আগের অবস্থায় ফেরে) — alert/confirm নয়।
function armConfirm(btn, armedText, fn) {
  if (!btn) return;
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    btn.textContent = btn.dataset.orig || '';
    fn();
  } else {
    btn.dataset.orig = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = armedText;
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig || ''; } }, 3000);
  }
}

function initSettings() {
  if (!requireLogin()) return;
  const cv = document.getElementById('cvFile');
  const status = document.getElementById('cvStatus');
  const rmBtn = document.getElementById('removeCvBtn');
  function renderCvStatus() {
    const p = read('jt_profile', {});
    if (status) status.textContent = cvStatusText() || 'এখনো কোনো CV আপলোড করা হয়নি।';
    if (rmBtn) rmBtn.style.display = (p.cv && p.cv.name) ? '' : 'none';
  }
  renderCvStatus();
  if (rmBtn) rmBtn.onclick = () => armConfirm(rmBtn, 'নিশ্চিত মুছবেন?', () => { removeCvFromProfile(); renderCvStatus(); toast('CV মোছা হয়েছে।'); });
  if (cv) cv.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    toast('CV পড়া হচ্ছে…');
    let text = '';
    try { text = await extractCvText(f); } catch { text = ''; }
    const fields = (typeof parseCvText === 'function') ? parseCvText(text || '') : {};
    const filled = applyCvFieldsToProfile(fields, { name: f.name, size: f.size, text });
    try {
      if (f.size <= 1500000) {
        const r = new FileReader();
        r.onload = () => { try { localStorage.setItem('jt_cv_data', String(r.result)); } catch {} };
        r.readAsDataURL(f);
      }
    } catch {}
    renderCvStatus();
    if (filled.length) toast('✓ CV থেকে প্রোফাইলে বসেছে: ' + filled.join(', ') + '।');
    else if ((text || '').trim()) toast('CV আপলোড হয়েছে, তবে কোনো তথ্য মেলানো যায়নি — প্রোফাইলে নিজে বসান।');
    else toast('CV আপলোড হয়েছে (' + f.name + ') — লেখা পড়া যায়নি, প্রোফাইলে নিজে বসান।');
    e.target.value = '';
  };
  const close = document.getElementById('settingsCloseBtn');
  if (close) close.onclick = () => location.href = 'index.html';
}

// ---------- ADMIN ----------
async function initAdmin() {
  const setupNote = document.getElementById('adminSetupNote');
  setupNote.textContent = '';
  document.getElementById('adminLoginBtn').onclick = async () => {
    const pin = document.getElementById('adminPin').value;
    if (pin.length < 4) { toast('কমপক্ষে ৪ অঙ্কের PIN দিন।'); return; }
    const hash = await pinMatches(pin);
    if (!hash) { toast('ভুল PIN।'); return; }
    sessionStorage.setItem('jt_admin_ok', '1');
    sessionStorage.setItem('jt_admin_hash', hash);
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    renderAdmin();
  };
  // ---------- অ্যাডমিন PIN ভুলে গেছেন? (সেন্ডার Gmail-এ কোড → নতুন PIN) ----------
  const afl = document.getElementById('adminForgotLink');
  if (afl) afl.onclick = (e) => { e.preventDefault(); const p = document.getElementById('adminResetPanel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
  const aprSend = document.getElementById('aprSendBtn');
  if (aprSend) aprSend.onclick = async () => {
    const st = document.getElementById('aprStatus');
    st.textContent = 'কোড পাঠানো হচ্ছে…';
    try {
      const r = await fetch('api/admin-pin-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'request' }) });
      const data = await r.json().catch(() => ({}));
      st.textContent = data.ok ? (data.note || 'কোড পাঠানো হয়েছে।') : '✗ ' + (data.error || 'পাঠানো যায়নি।');
      if (data.ok) document.getElementById('aprStep2').style.display = 'block';
    } catch { st.textContent = '✗ পাঠানো যায়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
  };
  const aprReset = document.getElementById('aprResetBtn');
  if (aprReset) aprReset.onclick = async () => {
    const code = document.getElementById('aprCode').value.trim();
    const newPin = document.getElementById('aprNewPin').value;
    const st = document.getElementById('aprStatus');
    if (!code || !newPin) { st.textContent = 'কোড ও নতুন PIN — দুটোই দিন।'; return; }
    st.textContent = 'যাচাই করা হচ্ছে…';
    try {
      const r = await fetch('api/admin-pin-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'verify', code, newPin }) });
      const data = await r.json().catch(() => ({}));
      if (!data.ok) { st.textContent = '✗ ' + (data.error || 'যাচাই হয়নি।'); return; }
      // কোড মিলেছে — নতুন PIN শুধু হ্যাশ আকারে এই ব্রাউজারে সেভ হবে।
      const hash = await sha256(newPin);
      localStorage.setItem('jt_admin_pin_hash', hash);
      sessionStorage.setItem('jt_admin_ok', '1');
      sessionStorage.setItem('jt_admin_hash', hash);
      document.getElementById('aprHashNote').textContent = 'নতুন PIN-এর হ্যাশ: ' + hash + ' — Vercel-এ ADMIN_PIN_HASH সেট করা থাকলে সেখানে এই হ্যাশটি বসাতে হবে।';
      st.textContent = '✓ নতুন PIN সেট হয়েছে — অ্যাডমিন পোর্টাল খুলছে…';
      document.getElementById('adminLogin').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      renderAdmin();
    } catch { st.textContent = '✗ যাচাই হয়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
  };
  if (sessionStorage.getItem('jt_admin_ok') === '1') { document.getElementById('adminLogin').style.display = 'none'; document.getElementById('adminPanel').style.display = 'block'; renderAdmin(); }
  // ---------- নথিভুক্ত প্রাপক তালিকা (শুধু অ্যাডমিন দেখবে) ----------
  // ইমেইল ট্যাব খুললে PIN দিয়ে সার্ভার থেকে প্রাপকদের Gmail আনে।
  async function loadRecipients() {
    const list = document.getElementById('recipientsList');
    const countEl = document.getElementById('recipientsCount');
    if (!list) return;
    list.textContent = 'লোড হচ্ছে…';
    try {
      const r = await fetch('api/admin-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinHash: sessionStorage.getItem('jt_admin_hash') || '' }) });
      const data = await r.json().catch(() => ({}));
      if (!data.ok) { list.textContent = '✗ দেখা যায়নি: ' + (data.error || 'আবার চেষ্টা করুন।'); return; }
      if (countEl) countEl.textContent = bn(data.count || 0);
      if (!data.recipients || !data.recipients.length) { list.textContent = 'এখনো কেউ লগইন করেনি — কেউ লগইন করলেই এখানে তার Gmail আসবে।'; return; }
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      list.innerHTML = data.recipients.map(e => `<div class="num" style="padding:4px 0;border-bottom:1px solid var(--border)">${esc(e)}</div>`).join('');
    } catch { list.textContent = '✗ দেখা যায়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
  }
  // ---------- পাঠানো ইমেইল (See Email — শুধু অ্যাডমিন দেখবে) ----------
  // বাটন চাপলে PIN দিয়ে সার্ভার থেকে পাঠানো ইমেইলের লগ আনে: কাকে, কোন বিষয়ে, কখন।
  let sentListShown = false;
  async function loadSentEmails() {
    const box = document.getElementById('sentList');
    if (!box) return;
    sentListShown = true;
    box.textContent = 'লোড হচ্ছে…';
    try {
      const r = await fetch('api/admin-recipients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinHash: sessionStorage.getItem('jt_admin_hash') || '', action: 'sent' }) });
      const data = await r.json().catch(() => ({}));
      if (!data.ok) { box.textContent = '✗ দেখা যায়নি: ' + (data.error || 'আবার চেষ্টা করুন।'); return; }
      if (!data.sent || !data.sent.length) { box.textContent = 'এখনো কোনো ইমেইল পাঠানো হয়নি।'; return; }
      const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const fmt = iso => { try { return new Date(iso).toLocaleString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
      box.innerHTML = data.sent.map(e => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div class="num">${esc(e.to)}</div><div>${esc(e.subject)}</div><div style="color:var(--muted);font-size:13px"><span class="num">${esc(fmt(e.sentAt))}</span> • ${e.source === 'daily' ? 'অটো' : 'ম্যানুয়াল'}</div></div>`).join('');
    } catch { box.textContent = '✗ দেখা যায়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
  }
  const seeSentBtn = document.getElementById('seeSentBtn');
  if (seeSentBtn) seeSentBtn.onclick = () => { loadSentEmails(); };
  document.querySelectorAll('#adminPanel .tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#adminPanel .tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ['dash', 'circulars', 'email', 'pin', 'creator', 'contact'].forEach(t => document.getElementById('tab-' + t).style.display = t === b.dataset.tab ? 'block' : 'none');
    if (b.dataset.tab === 'email') loadRecipients();
    if (b.dataset.tab === 'contact') loadContactForm();
  });
  // ---------- "যোগাযোগ" ট্যাব — মেনুতে দেখানো WhatsApp / Telegram ----------
  // সার্ভারে (KV) সেভ হয়, তাই সব ভিজিটর দেখতে পায়; PIN ছাড়া বদলানো যায় না।
  async function loadContactForm() {
    try {
      const r = await fetch('api/config', { cache: 'no-store' });
      const d = await r.json();
      if (d.contact) {
        document.getElementById('ctWhatsapp').value = d.contact.whatsapp || '';
        document.getElementById('ctTelegram').value = d.contact.telegram || '';
      }
    } catch {}
  }
  const ctSave = document.getElementById('ctSaveBtn');
  if (ctSave) ctSave.onclick = async () => {
    const st = document.getElementById('ctStatus');
    st.textContent = 'সেভ হচ্ছে…';
    try {
      const r = await fetch('api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinHash: sessionStorage.getItem('jt_admin_hash') || '', contact: { whatsapp: document.getElementById('ctWhatsapp').value, telegram: document.getElementById('ctTelegram').value } }) });
      const data = await r.json().catch(() => ({}));
      if (!data.ok) { st.textContent = '✗ ' + (data.error || 'সেভ হয়নি।'); return; }
      if (data.contact) {
        document.getElementById('ctWhatsapp').value = data.contact.whatsapp || '';
        document.getElementById('ctTelegram').value = data.contact.telegram || '';
      }
      st.textContent = '✓ সেভ হয়েছে — মেনুতে “আবেদন করতে চাইলে যোগাযোগ করুন” দেখাবে।';
    } catch { st.textContent = '✗ সেভ হয়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
  };
  // মেনু থেকে "সার্কুলার যোগ করুন" চাপলে admin.html#circulars নিয়ে আসে —
  // PIN দেওয়ার পর সরাসরি সার্কুলার ট্যাবটাই খুলবে।
  if (location.hash === '#circulars') {
    const tabBtn = document.querySelector('#adminPanel .tabs button[data-tab="circulars"]');
    if (tabBtn) tabBtn.click();
  }
  document.getElementById('adminCloseBtn').onclick = () => location.href = 'index.html';
  // অ্যাডমিন লগআউট — সেশন মুছে পোর্টাল আবার লক করে হোমে ফেরত যায়।
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');
  if (adminLogoutBtn) adminLogoutBtn.onclick = () => {
    sessionStorage.removeItem('jt_admin_ok');
    sessionStorage.removeItem('jt_admin_hash');
    location.href = 'index.html';
  };
  const sendNowBtn = document.getElementById('sendNowBtn');
  if (sendNowBtn) sendNowBtn.onclick = async () => {
    const st = document.getElementById('manualSendStatus');
    sendNowBtn.disabled = true; st.textContent = 'পাঠানো হচ্ছে…';
    try {
      const r = await fetch('api/send-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinHash: sessionStorage.getItem('jt_admin_hash') || '' }) });
      const data = await r.json().catch(() => ({}));
      if (data.ok) st.textContent = data.sent > 0 ? `✓ ${bn(data.sent)}টি ইমেইল পাঠানো হয়েছে।` : '✓ ' + (data.note || 'আজকের রিমাইন্ডার আগেই পাঠানো হয়েছে।');
      else st.textContent = '✗ পাঠানো যায়নি: ' + (data.error || 'আবার চেষ্টা করুন।');
    } catch { st.textContent = '✗ পাঠানো যায়নি — নেটওয়ার্ক/সার্ভার দেখুন।'; }
    sendNowBtn.disabled = false;
    loadRecipients();
    if (sentListShown) loadSentEmails();
  };
  document.getElementById('changePinBtn').onclick = async () => {
    const oldHash = await pinMatches(document.getElementById('oldPin').value);
    if (!oldHash) { toast('বর্তমান PIN ভুল।'); return; }
    const np = document.getElementById('newPin').value;
    if (np.length < 4) { toast('নতুন PIN কমপক্ষে ৪ অঙ্কের হতে হবে।'); return; }
    localStorage.setItem('jt_admin_pin_hash', await sha256(np));
    toast('PIN বদলে গেছে।');
  };
  // ---------- "তৈরি করেছেন" ট্যাব — নাম, ছবি, WhatsApp / Facebook লিংক ----------
  const creatorForm = () => {
    const c = getCreator();
    const set = (id, v) => { const f = document.getElementById(id); if (f) f.value = v; };
    set('crName', c.name); set('crPhotoUrl', c.photo); set('crWhatsapp', c.whatsapp); set('crFacebook', c.facebook);
    const prev = document.getElementById('crPhotoPreview');
    if (prev) { prev.src = c.photo || ''; prev.style.display = c.photo ? 'block' : 'none'; }
  };
  creatorForm();
  const crPhotoFile = document.getElementById('crPhotoFile');
  if (crPhotoFile) crPhotoFile.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 500 * 1024) { toast('ছবি ৫০০ KB-এর মধ্যে রাখুন।'); return; }
    const r = new FileReader();
    r.onload = () => {
      document.getElementById('crPhotoUrl').value = String(r.result);
      const p = document.getElementById('crPhotoPreview'); p.src = String(r.result); p.style.display = 'block';
    };
    r.readAsDataURL(f);
  };
  const crSave = document.getElementById('crSaveBtn');
  if (crSave) crSave.onclick = () => {
    store('jt_creator', {
      name: document.getElementById('crName').value.trim(),
      photo: document.getElementById('crPhotoUrl').value.trim(),
      whatsapp: normWhatsApp(document.getElementById('crWhatsapp').value),
      facebook: document.getElementById('crFacebook').value.trim(),
    });
    document.getElementById('crStatus').textContent = '✓ সেভ হয়েছে — হোম পেইজে “তৈরি করেছেন” সেকশনে দেখাবে।';
  };
  async function renderAdmin() {
    const cs = await loadCirculars();
    document.getElementById('tab-dash').innerHTML = `<p>মোট সার্কুলার: <span class="num">${bn(cs.length)}</span>টি • চলমান: <span class="num">${bn(cs.filter(c => daysLeft(c.deadline) >= 0).length)}</span>টি</p><p>অফিসিয়াল সেন্ডার Gmail: <span class="num">jobtrackerbd@gmail.com</span></p><p>ডেইলি ক্রন: প্রতিদিন সকাল ৮টা (ঢাকা) — /api/daily-check • নতুন সার্কুলার Teletalk-এর তালিকা থেকে অটো যোগ হয়</p>`;
    document.getElementById('tab-circulars').innerHTML = '<h4 style="margin-bottom:8px">সার্কুলার তালিকা</h4>' + cs.map(c => {
      const dl = daysLeft(c.deadline);
      return `<div class="admin-row"><div class="info"><h4>${c.org}</h4><p>মোট পদ: ${c.totalPosts == null ? 'উল্লেখ নেই' : '<span class="num">' + bn(c.totalPosts) + '</span>টি'} • শেষ: <span class="num">${fmtDate(c.deadline)}</span> • <span class="pill ${dl < 0 ? 'grey' : 'green'}">${dl < 0 ? 'মেয়াদ শেষ' : 'চলমান'}</span></p></div><button class="btn outline small" onclick="confirmDeleteCircular(this,'${c.id}')">মুছুন</button></div>`;
    }).join('') +
      `<h4 style="margin:14px 0 4px">নতুন সার্কুলার যোগ করুন</h4><div class="field"><label>প্রতিষ্ঠান</label><input id="newOrg" placeholder="প্রতিষ্ঠানের নাম"></div><div class="field"><label>মোট পদ</label><input id="newPosts" type="number"></div><div class="field"><label>শেষ তারিখ</label><input id="newDeadline" type="date"></div><button class="btn green" id="addCircularBtn">যোগ করুন</button>`;
    document.getElementById('addCircularBtn').onclick = () => {
      if (!document.getElementById('newOrg').value.trim() || !document.getElementById('newDeadline').value) { toast('প্রতিষ্ঠানের নাম ও শেষ তারিখ — দুটোই দিন।'); return; }
      const extra = JSON.parse(localStorage.getItem('jt_admin_circulars') || '[]');
      extra.push({ id: 'custom-' + Date.now(), org: document.getElementById('newOrg').value, totalPosts: +document.getElementById('newPosts').value || 0, hscPosts: 0, grade: 16, fee: null, deadline: document.getElementById('newDeadline').value + 'T17:00:00+06:00', posts: [], salary: '', age: '', districts: '', source: 'secondary', sourceNote: 'অ্যাডমিন যোগ করেছেন — অফিসিয়াল সার্কুলার যাচাই করুন।', type: 'ministry', typeBn: 'মন্ত্রণালয় / অধিদপ্তর', applyUrl: '#' });
      localStorage.setItem('jt_admin_circulars', JSON.stringify(extra));
      toast('✓ সার্কুলার যোগ হয়েছে।'); setTimeout(() => location.reload(), 900);
    };
  }
}

// ---------- লেখার সাইজ (বড়-ছোট) — সব পেইজে, পছন্দ সেভ থাকে ----------
function applyFontSize() {
  const s = localStorage.getItem('jt_font_size') || 'medium';
  document.body.classList.remove('fs-small', 'fs-large', 'fs-xl');
  if (s !== 'medium') document.body.classList.add('fs-' + s);
  document.querySelectorAll('.fontsize-ctl button').forEach(b => b.classList.toggle('active', b.dataset.fs === s));
}
function bindFontSize() {
  document.querySelectorAll('.fontsize-ctl button').forEach(b => b.onclick = () => { localStorage.setItem('jt_font_size', b.dataset.fs); applyFontSize(); syncToServer(); });
}

// ---------- স্লাইড মেনু (ড্রয়ার) — লগইন, সেটিংস, অ্যাডমিন, সার্কুলার যোগ ----------
function openDrawer() {
  const d = document.getElementById('drawer'); const o = document.getElementById('drawerOverlay');
  if (!d) return;
  renderDrawerUser();
  d.classList.add('open'); if (o) o.classList.add('open');
}
function closeDrawer() {
  const d = document.getElementById('drawer'); const o = document.getElementById('drawerOverlay');
  if (d) d.classList.remove('open'); if (o) o.classList.remove('open');
}
function renderDrawerUser() {
  const box = document.getElementById('drawerUser'); if (!box) return;
  const user = getUser();
  const prof = getProfile();
  if (user) {
    const name = prof.name || user.name;
    const photo = prof.photo || '';
    box.innerHTML = `<div class="drawer-profile">
      ${photo ? `<img class="drawer-photo" src="${photo}" alt="" onerror="this.style.display='none'">` : '<span class="drawer-photo-fallback">👤</span>'}
      <div><b>${name}</b><br><span style="font-size:13px;color:var(--muted)">${user.email}</span>${prof.address ? `<br><span style="font-size:13px;color:var(--muted)">${prof.address}</span>` : ''}</div>
    </div>
    <button class="drawer-item" id="drawerLogoutBtn">🚪 লগআউট</button>`;
  } else {
    // লগইন বাটন নেই — লগইন শুধু পপআপে আসে, আবেদন/বিস্তারিত/শর্টলিস্ট চাপলে।
    box.innerHTML = `<p style="font-size:13px;color:var(--muted);margin:4px 2px">লগইন করতে যেকোনো সার্কুলারের <b>আবেদন করুন</b> / <b>বিস্তারিত</b> চাপুন — লগইন পপআপ সরাসরি আসবে।</p>`;
  }
  const lo = document.getElementById('drawerLogoutBtn');
  if (lo) lo.onclick = () => { localStorage.removeItem('jt_user'); localStorage.removeItem('jt_session'); location.reload(); };
}
function bindDrawer() {
  const burger = document.getElementById('menuBtn'); if (burger) burger.onclick = openDrawer;
  const ov = document.getElementById('drawerOverlay'); if (ov) ov.onclick = closeDrawer;
  const x = document.getElementById('drawerCloseBtn'); if (x) x.onclick = closeDrawer;
  const li = document.getElementById('drawerLoginBtn'); if (li) li.onclick = () => { closeDrawer(); openLoginPopup(); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeLoginPopup(); } });
}

// ---------- মেনুতে "আবেদন করতে চাইলে যোগাযোগ করুন" ----------
// অ্যাডমিন যা সেভ করেছেন (সার্ভার, KV) তা সব পেইজের ড্রয়ারে দেখায়।
// কিছু সেভ না থাকলে লেখাটা লুকানোই থাকে — ভিজিটর কিছু দেখবে না।
async function loadContact() {
  const btn = document.getElementById('drawerContactBtn'); const box = document.getElementById('drawerContactBox');
  if (!btn || !box) return;
  let contact = null;
  try {
    const r = await fetch('api/config', { cache: 'no-store' });
    const d = await r.json();
    contact = d.contact || null;
  } catch {}
  if (!contact || (!contact.whatsapp && !contact.telegram)) { btn.style.display = 'none'; return; }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  box.innerHTML = `<p style="font-size:13px;color:var(--muted);margin:2px 0 8px">আবেদন করতে চাইলে যোগাযোগ করুন:</p><div style="display:flex;gap:8px;flex-wrap:wrap">${contact.whatsapp ? `<a class="btn green small" href="${esc(contact.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}${contact.telegram ? `<a class="btn outline small" href="${esc(contact.telegram)}" target="_blank" rel="noopener">✈️ Telegram</a>` : ''}</div>`;
  btn.style.display = '';
  btn.onclick = e => { e.preventDefault(); box.style.display = box.style.display === 'none' ? 'block' : 'none'; };
}

document.addEventListener('DOMContentLoaded', () => {
  applyFontSize(); bindFontSize(); bindDrawer(); loadContact();
  bindApkButtons(); checkAppUpdate();
  // অ্যাপ খোলা থাকলে প্রতি ৩০ মিনিটে আবার আপডেট চেক — নতুন আপডেট
  // এলে খোলা অ্যাপেই ব্যানার দেখাবে, অ্যাপ বন্ধ করে খুলতে হবে না।
  setInterval(checkAppUpdate, 30 * 60 * 1000);
  const page = document.body.dataset.page;
  if (page === 'home') initHome();
  if (page === 'login') initLogin();
  if (page === 'settings') initSettings();
  if (page === 'profile') initProfile();
  if (page === 'admin') initAdmin();
});
