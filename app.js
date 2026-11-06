// Job Tracker — shared client logic. Separate pages, shared state in localStorage.
// Pages: index.html (home), login.html, settings.html, admin.html — each is its own
// route; going into one page does not show the others.
const BN = '০১২৩৪৫৬৭৮৯';
function bn(n) { return String(n).replace(/\d/g, d => BN[+d]); }
function bnNum(n) { return String(n).replace(/\d/g, d => BN[+d]); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
}
function daysLeft(iso) { return Math.ceil((new Date(iso) - new Date()) / 86400000); }
function store(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function read(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch { return d; } }
function getUser() { return read('jt_user', null); }
function isLoggedIn() { return !!getUser(); }
// Login gate: any gated action redirects to the separate login page (popup equivalent
// on this static build is the dedicated /login.html route with the real Google popup).
// Login lives on its OWN separate page (login.html) — nothing is mixed into the
// home page. The Google sign-in itself happens in Google's real popup, opened
// from the login page; the manual option (Gmail + name + password) is on that
// same login page. Gated actions send the user to login.html and back.
function openLoginPopup() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = 'login.html?next=' + next;
}
function requireLogin() {
  if (isLoggedIn()) return true;
  openLoginPopup();
  return false;
}
// অ্যাডমিন PIN — শুধু SHA-256 হ্যাশ আকারে রাখা আছে (প্লেইন PIN কোডে কোথাও লেখা নেই)।
// বদলানো PIN localStorage-এ হ্যাশ আকারে সেভ হয়; সেটা মুছলে আবার এই ডিফল্ট হ্যাশের PIN-ই চলবে।
const ADMIN_PIN_HASH = '218abd57777a2be3aae18b1bf564193338fe30d96b5c105a0960c0a2b611287e';
function activePinHash() { return localStorage.getItem('jt_admin_pin_hash') || ADMIN_PIN_HASH; }
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function matchBadge(c) {
  const p = read('jt_profile', null);
  if (!p) return '';
  const eduOk = (p.edu || 'HSC') === 'HSC' || c.posts.some(x => x.qualification === p.edu);
  const typeOk = c.posts.some(x => (x.typingBn || 0) <= (p.typeBn || 0) && (x.typingEn || 0) <= (p.typeEn || 0));
  return (eduOk && typeOk) ? '<span class="badge">✓ CV অনুযায়ী মিলেছে</span>' : '';
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
  document.getElementById('refreshBtn').onclick = (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin">⟳</span> খোঁজা হচ্ছে…';
    document.getElementById('lastCheck').textContent = '';
    setTimeout(() => location.reload(), 500); // পেইজ আবার লোড হলে সার্ভার থেকে নতুন সার্কুলার আসে
  };
  const user = getUser();
  document.getElementById('userChip').innerHTML = user ? `<span class="pill" style="background:rgba(255,255,255,.2);color:#fff">${user.name} • ${user.email}</span> <button class="btn ghost small" id="logoutBtn">লগআউট</button>` : '';
  const lb = document.getElementById('logoutBtn'); if (lb) lb.onclick = () => { localStorage.removeItem('jt_user'); location.reload(); };
  document.getElementById('loginNote').textContent = user ? '' : 'লগইন না করলে আবেদন বা ভেতরের কিছু করা যাবে না — শুধু তালিকা দেখা ও খোঁজা যাবে।';
  const open = circulars.filter(c => daysLeft(c.deadline) >= 0);
  document.getElementById('heroStats').innerHTML = `সবার জন্য উন্মুক্ত • চলমান <span class="num">${bn(open.length)}</span>টি • মোট <span class="num">${bn(circulars.length)}</span>টি`;
  const nearest = [...open].sort((a, b) => new Date(a.deadline) - new Date(b.deadline))[0];
  if (nearest) {
    const cd = document.getElementById('countdown');
    const tick = () => {
      let s = Math.max(0, Math.floor((new Date(nearest.deadline) - new Date()) / 1000));
      const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); const sec = s % 60;
      cd.innerHTML = `<div><b class="num">${bn(d)}</b>দিন</div><div><b class="num">${bn(h)}</b>ঘণ্টা</div><div><b class="num">${bn(m)}</b>মিনিট</div><div><b class="num">${bn(sec)}</b>সেকেন্ড</div>`;
    };
    tick(); setInterval(tick, 1000);
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
        <span class="pill grey">${c.source === 'secondary' ? 'দ্বিতীয় সূত্র' : 'অফিসিয়াল'}</span> ${matchBadge(c)}
        <h2>${c.org}</h2>
        <div class="meta"><span>HSC পদ: <b class="num">${bn(c.hscPosts)}টি</b></span><span>মোট পদ: <span class="num">${bn(c.totalPosts)}টি</span></span><span>ফি: ${c.fee ? '<span class="num">' + bn(c.fee) + '</span> টাকা' : 'উল্লেখ নেই'}</span><span>গ্রেড: <span class="num">${bn(c.grade)}</span></span></div>
        <p><span class="pill ${dl < 0 ? 'grey' : dl <= 3 ? 'red' : 'green'}">${dl < 0 ? 'মেয়াদ শেষ' : dl === 0 ? 'আজই শেষ' : 'আর ' + bn(dl) + ' দিন'}</span> শেষ: <span class="num">${fmtDate(c.deadline)}</span></p>
        <div class="actions">
          <button class="btn outline small" data-act="shortlist">☆ শর্টলিস্ট</button>
          <button class="btn green small" data-act="apply">আবেদন করুন ↗</button>
          <button class="btn outline small" data-act="status">আবেদন করেছি</button>
          <button class="btn outline small" data-act="details">বিস্তারিত ▾</button>
        </div>
        <div class="details" style="display:none">
          <table>${c.posts.map(p => `<tr><td>${p.title}</td><td><span class="num">${bn(p.count)}</span>টি</td><td>গ্রেড <span class="num">${bn(p.grade)}</span></td><td>${p.qualification}</td><td>${p.typingBn || p.typingEn ? 'টাইপিং: বাংলা <span class="num">' + bn(p.typingBn || 0) + '</span> / ইংরেজি <span class="num">' + bn(p.typingEn || 0) + '</span>' : ''}</td></tr>`).join('')}</table>
          <p>বেতন: ${c.salary} • বয়স: ${c.age} • জেলা: ${c.districts}</p>
          <div class="warn">⚠️ ${c.sourceNote}</div>
        </div>
      </article>`);
      card.querySelector('[data-act=shortlist]').onclick = () => { if (!requireLogin()) return; const s = read('jt_shortlist', []); const i = s.indexOf(c.id); i >= 0 ? s.splice(i, 1) : s.push(c.id); store('jt_shortlist', s); render(); };
      card.querySelector('[data-act=apply]').onclick = () => { if (!requireLogin()) return; window.open(c.applyUrl, '_blank'); };
      card.querySelector('[data-act=status]').onclick = () => { if (!requireLogin()) return; const s = read('jt_status', {}); s[c.id] = 'applied'; store('jt_status', s); render(); };
      card.querySelector('[data-act=details]').onclick = (e) => { if (!requireLogin()) return; const d = card.querySelector('.details'); d.style.display = d.style.display === 'none' ? 'block' : 'none'; };
      if (shortlist.includes(c.id)) card.querySelector('[data-act=shortlist]').textContent = '★ শর্টলিস্টে আছে';
      if (status[c.id] === 'applied') card.querySelector('[data-act=status]').textContent = '✓ আবেদন করেছি';
      if (!isLoggedIn()) card.querySelectorAll('[data-act]').forEach(b => b.classList.add('locked'));
      card.style.animationDelay = Math.min(i * 60, 480) + 'ms';
      jobsEl.appendChild(card);
    });
    if (!list.length) jobsEl.innerHTML = '<div class="card"><p>কোনো সার্কুলার পাওয়া যায়নি। ফিল্টার বদলে দেখুন।</p></div>';
  }
  render();
}

// ---------- LOGIN (popup only) ----------
let loginPopupInit = false;
async function initLoginPopup() {
  if (loginPopupInit) return; loginPopupInit = true;
  const cfg = await fetch('api/config').then(r => r.json()).catch(() => ({ googleClientId: '' }));
  const note = document.getElementById('gisNote');
  const finishLogin = (name, email) => {
    store('jt_user', { name, email });
    fetch('api/register-recipient', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => {});
    location.reload();
  };
  if (!cfg.googleClientId) {
    if (note) note.textContent = 'Google OAuth এখনো সেট করা হয়নি — Vercel-এ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET সেট করুন (README দেখুন)। ততক্ষণ নিচের ম্যানুয়াল লগইন ব্যবহার করুন।';
  } else if (window.google) {
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: async (resp) => {
      const r = await fetch('api/auth-google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: resp.credential }) });
      const data = await r.json().catch(() => ({}));
      if (data.ok || data.email) finishLogin(data.name || 'Google ব্যবহারকারী', data.email);
      else if (note) note.textContent = 'Google যাচাই ব্যর্থ হয়েছে: ' + (data.error || 'আবার চেষ্টা করুন।');
    }});
    const gb = document.getElementById('gisButton');
    if (gb) google.accounts.id.renderButton(gb, { theme: 'outline', size: 'large', text: 'signin_with', width: 360 });
  }
  const gc = document.getElementById('googleConnectBtn');
  if (gc) gc.onclick = () => { if (window.google && cfg.googleClientId) google.accounts.id.prompt(); else if (note) note.textContent = 'Google OAuth সেট করা নেই — Vercel-এ GOOGLE_CLIENT_ID সেট করুন, অথবা ম্যানুয়াল লগইন ব্যবহার করুন।'; };
  const ml = document.getElementById('manualLoginBtn');
  if (ml) ml.onclick = async () => {
    const name = document.getElementById('manualName').value.trim();
    const email = document.getElementById('manualEmail').value.trim();
    const pass = document.getElementById('manualPass').value;
    if (!name || !email || !pass) { alert('নাম, Gmail ও পাসওয়ার্ড — তিনটাই দিন।'); return; }
    const hash = await sha256(email + ':' + pass);
    const accounts = read('jt_accounts', {});
    if (accounts[email] && accounts[email].hash !== hash) { alert('ভুল পাসওয়ার্ড।'); return; }
    if (!accounts[email]) accounts[email] = { name, hash };
    store('jt_accounts', accounts);
    finishLogin(accounts[email].name, email);
  };
}
async function initLogin() { initLoginPopup(); }

// ---------- SETTINGS ----------
function initSettings() {
  if (!requireLogin()) return;
  const p = read('jt_profile', {});
  const map = { pDistrict: 'district', pDob: 'dob', pEdu: 'edu', pTypeBn: 'typeBn', pTypeEn: 'typeEn' };
  Object.entries(map).forEach(([id, key]) => { const f = document.getElementById(id); if (f && p[key] !== undefined && p[key] !== '') f.value = p[key]; });
  document.getElementById('cvFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { let found = false; try { const t = String(r.result); const m = t.match(/(ঢাকা|চট্টগ্রাম|খুলনা|রাজশাহী|বরিশাল|সিলেট|রংপুর|ময়মনসিংহ|কুমিল্লা|নারায়ণগঞ্জ|পটুয়াখালী)/); if (m) { document.getElementById('pDistrict').value = m[1]; found = true; } } catch {} alert(found ? 'CV আপলোড হয়েছে: ' + f.name + ' — জেলা পাওয়া গেছে।' : 'CV আপলোড হয়েছে: ' + f.name + ' — জেলা পাওয়া যায়নি, নিজে বসান।'); };
    r.readAsText(f);
  };
  document.getElementById('saveProfileBtn').onclick = () => {
    store('jt_profile', { district: document.getElementById('pDistrict').value, dob: document.getElementById('pDob').value, edu: document.getElementById('pEdu').value, typeBn: +document.getElementById('pTypeBn').value, typeEn: +document.getElementById('pTypeEn').value });
    alert('প্রোফাইল সেভ হয়েছে। এখন হোম পেইজে মিলে যাওয়া সার্কুলারে “✓ CV অনুযায়ী মিলেছে” ব্যাজ দেখাবে।');
    location.href = 'index.html';
  };
  document.getElementById('settingsCloseBtn').onclick = () => location.href = 'index.html';
}

// ---------- ADMIN ----------
async function initAdmin() {
  const setupNote = document.getElementById('adminSetupNote');
  setupNote.textContent = '';
  document.getElementById('adminLoginBtn').onclick = async () => {
    const pin = document.getElementById('adminPin').value;
    if (pin.length < 4) { alert('কমপক্ষে ৪ অঙ্কের PIN দিন।'); return; }
    const hash = await sha256(pin);
    if (hash !== activePinHash()) { alert('ভুল PIN।'); return; }
    sessionStorage.setItem('jt_admin_ok', '1');
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    renderAdmin();
  };
  if (sessionStorage.getItem('jt_admin_ok') === '1') { document.getElementById('adminLogin').style.display = 'none'; document.getElementById('adminPanel').style.display = 'block'; renderAdmin(); }
  document.querySelectorAll('#adminPanel .tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#adminPanel .tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    ['dash', 'circulars', 'email', 'pin'].forEach(t => document.getElementById('tab-' + t).style.display = t === b.dataset.tab ? 'block' : 'none');
  });
  document.getElementById('adminCloseBtn').onclick = () => location.href = 'index.html';
  document.getElementById('changePinBtn').onclick = async () => {
    const oldHash = await sha256(document.getElementById('oldPin').value);
    if (oldHash !== activePinHash()) { alert('বর্তমান PIN ভুল।'); return; }
    const np = document.getElementById('newPin').value;
    if (np.length < 4) { alert('নতুন PIN কমপক্ষে ৪ অঙ্কের হতে হবে।'); return; }
    localStorage.setItem('jt_admin_pin_hash', await sha256(np));
    alert('PIN বদলে গেছে।');
  };
  async function renderAdmin() {
    const cs = await loadCirculars();
    document.getElementById('tab-dash').innerHTML = `<p>মোট সার্কুলার: <span class="num">${bn(cs.length)}</span>টি • চলমান: <span class="num">${bn(cs.filter(c => daysLeft(c.deadline) >= 0).length)}</span>টি</p><p>অফিসিয়াল সেন্ডার Gmail: <span class="num">jobtrackerbd@gmail.com</span></p><p>ডেইলি ক্রন: প্রতিদিন সকাল ৮টা (ঢাকা) — /api/daily-check</p>`;
    document.getElementById('tab-circulars').innerHTML = '<h4 style="margin-bottom:8px">সার্কুলার তালিকা</h4>' + cs.map(c => {
      const dl = daysLeft(c.deadline);
      return `<div class="admin-row"><div class="info"><h4>${c.org}</h4><p>মোট পদ: <span class="num">${bn(c.totalPosts)}</span>টি • শেষ: <span class="num">${fmtDate(c.deadline)}</span> • <span class="pill ${dl < 0 ? 'grey' : 'green'}">${dl < 0 ? 'মেয়াদ শেষ' : 'চলমান'}</span></p></div><button class="btn outline small" onclick="if(confirm('মুছবেন?')){const d=JSON.parse(localStorage.getItem('jt_deleted_circulars')||'[]');d.push('${c.id}');localStorage.setItem('jt_deleted_circulars',JSON.stringify(d));location.reload();}">মুছুন</button></div>`;
    }).join('') +
      `<h4 style="margin:14px 0 4px">নতুন সার্কুলার যোগ করুন</h4><div class="field"><label>প্রতিষ্ঠান</label><input id="newOrg" placeholder="প্রতিষ্ঠানের নাম"></div><div class="field"><label>মোট পদ</label><input id="newPosts" type="number"></div><div class="field"><label>শেষ তারিখ</label><input id="newDeadline" type="date"></div><button class="btn green" id="addCircularBtn">যোগ করুন</button>`;
    document.getElementById('addCircularBtn').onclick = () => {
      if (!document.getElementById('newOrg').value.trim() || !document.getElementById('newDeadline').value) { alert('প্রতিষ্ঠানের নাম ও শেষ তারিখ — দুটোই দিন।'); return; }
      const extra = JSON.parse(localStorage.getItem('jt_admin_circulars') || '[]');
      extra.push({ id: 'custom-' + Date.now(), org: document.getElementById('newOrg').value, totalPosts: +document.getElementById('newPosts').value || 0, hscPosts: 0, grade: 16, fee: null, deadline: document.getElementById('newDeadline').value + 'T17:00:00+06:00', posts: [], salary: '', age: '', districts: '', source: 'secondary', sourceNote: 'অ্যাডমিন যোগ করেছেন — অফিসিয়াল সার্কুলার যাচাই করুন।', type: 'ministry', typeBn: 'মন্ত্রণালয় / অধিদপ্তর', applyUrl: '#' });
      localStorage.setItem('jt_admin_circulars', JSON.stringify(extra));
      alert('সার্কুলার যোগ হয়েছে।'); location.reload();
    };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page === 'home') initHome();
  if (page === 'login') initLogin();
  if (page === 'settings') initSettings();
  if (page === 'admin') initAdmin();
});
