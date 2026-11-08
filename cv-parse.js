// CV লেখা থেকে তথ্য পড়া — খাঁটি ফাংশন, DOM লাগে না।
// app.js (ব্রাউজার) ব্যবহার করে; node হারনেসও require করতে পারে।
// ফিল্ডগুলো প্রোফাইলের ফিল্ডের নামেই ফেরে: name, phone, email, dob,
// district, edu, typeBn, typeEn, address, permAddress, fatherName,
// motherName, skills, experience, languages।

const BN_D = '০১২৩৪৫৬৭৮৯';
function bnToEn(s) { return String(s || '').replace(/[০-৯]/g, d => String(BN_D.indexOf(d))); }

// বাংলাদেশের ৬৪ জেলা।
const DISTRICTS = ['ঢাকা', 'গাজীপুর', 'কিশোরগঞ্জ', 'মানিকগঞ্জ', 'মুন্সিগঞ্জ', 'নারায়ণগঞ্জ', 'নরসিংদী', 'টাঙ্গাইল', 'ফরিদপুর', 'গোপালগঞ্জ', 'মাদারীপুর', 'রাজবাড়ী', 'শরীয়তপুর', 'চট্টগ্রাম', 'কক্সবাজার', 'বান্দরবান', 'রাঙামাটি', 'খাগড়াছড়ি', 'কুমিল্লা', 'চাঁদপুর', 'লক্ষ্মীপুর', 'নোয়াখালী', 'ফেনী', 'ব্রাহ্মণবাড়িয়া', 'খুলনা', 'যশোর', 'সাতক্ষীরা', 'মেহেরপুর', 'নড়াইল', 'চুয়াডাঙ্গা', 'কুষ্টিয়া', 'মাগুরা', 'বাগেরহাট', 'ঝিনাইদহ', 'রাজশাহী', 'নওগাঁ', 'নাটোর', 'চাঁপাইনবাবগঞ্জ', 'পাবনা', 'সিরাজগঞ্জ', 'বগুড়া', 'জয়পুরহাট', 'বরিশাল', 'ভোলা', 'পটুয়াখালী', 'বরগুনা', 'ঝালকাঠি', 'পিরোজপুর', 'সিলেট', 'হবিগঞ্জ', 'মৌলভীবাজার', 'সুনামগঞ্জ', 'রংপুর', 'দিনাজপুর', 'গাইবান্ধা', 'কুড়িগ্রাম', 'লালমনিরহাট', 'নীলফামারী', 'পঞ্চগড়', 'ঠাকুরগাঁও', 'ময়মনসিংহ', 'জামালপুর', 'শেরপুর', 'নেত্রকোণা'];

// জেলার ইংরেজি নাম → বাংলা (ইংরেজি CV-তে "Dhaka" লেখা থাকে)।
const DISTRICTS_EN = { dhaka: 'ঢাকা', gazipur: 'গাজীপুর', kishoreganj: 'কিশোরগঞ্জ', manikganj: 'মানিকগঞ্জ', munshiganj: 'মুন্সিগঞ্জ', narayanganj: 'নারায়ণগঞ্জ', narsingdi: 'নরসিংদী', tangail: 'টাঙ্গাইল', faridpur: 'ফরিদপুর', gopalganj: 'গোপালগঞ্জ', madaripur: 'মাদারীপুর', rajbari: 'রাজবাড়ী', shariatpur: 'শরীয়তপুর', chattogram: 'চট্টগ্রাম', chittagong: 'চট্টগ্রাম', "cox's bazar": 'কক্সবাজার', bandarban: 'বান্দরবান', rangamati: 'রাঙামাটি', khagrachari: 'খাগড়াছড়ি', cumilla: 'কুমিল্লা', comilla: 'কুমিল্লা', chandpur: 'চাঁদপুর', lakshmipur: 'লক্ষ্মীপুর', noakhali: 'নোয়াখালী', feni: 'ফেনী', brahmanbaria: 'ব্রাহ্মণবাড়িয়া', khulna: 'খুলনা', jessore: 'যশোর', satkhira: 'সাতক্ষীরা', meherpur: 'মেহেরপুর', narail: 'নড়াইল', chuadanga: 'চুয়াডাঙ্গা', kushtia: 'কুষ্টিয়া', magura: 'মাগুরা', bagerhat: 'বাগেরহাট', jhenaidah: 'ঝিনাইদহ', rajshahi: 'রাজশাহী', naogaon: 'নওগাঁ', natore: 'নাটোর', chapainawabganj: 'চাঁপাইনবাবগঞ্জ', pabna: 'পাবনা', sirajganj: 'সিরাজগঞ্জ', bogura: 'বগুড়া', bogra: 'বগুড়া', joypurhat: 'জয়পুরহাট', barishal: 'বরিশাল', barisal: 'বরিশাল', bhola: 'ভোলা', patuakhali: 'পটুয়াখালী', barguna: 'বরগুনা', jhalokati: 'ঝালকাঠি', pirojpur: 'পিরোজপুর', sylhet: 'সিলেট', habiganj: 'হবিগঞ্জ', moulvibazar: 'মৌলভীবাজার', sunamganj: 'সুনামগঞ্জ', rangpur: 'রংপুর', dinajpur: 'দিনাজপুর', gaibandha: 'গাইবান্ধা', kurigram: 'কুড়িগ্রাম', lalmonirhat: 'লালমনিরহাট', nilphamari: 'নীলফামারী', panchagarh: 'পঞ্চগড়', thakurgaon: 'ঠাকুরগাঁও', mymensingh: 'ময়মনসিংহ', jamalpur: 'জামালপুর', sherpur: 'শেরপুর', netrokona: 'নেত্রকোণা' };

function findDistrict(text) {
  if (!text) return null;
  for (const d of DISTRICTS) { if (text.includes(d)) return d; }
  const low = ' ' + text.toLowerCase().replace(/[^a-z' ]/g, ' ') + ' ';
  for (const [en, bn] of Object.entries(DISTRICTS_EN)) {
    if (low.includes(' ' + en + ' ')) return bn;
  }
  return null;
}

// CV-তে থাকা ফিল্ড (প্রোফাইলের ফিল্ডের নামে)।
const CV_FIELDS = ['name', 'phone', 'email', 'dob', 'district', 'edu', 'typeBn', 'typeEn', 'address', 'permAddress', 'fatherName', 'motherName', 'skills', 'experience', 'languages'];

const MONTHS = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };

function cleanLines(text) {
  // Word থেকে আসা PDF-এ কার্লি অ্যাপোস্ট্রফি (’) থাকে — "Father’s Name"
  // মিলত না, তাই সোজা ' বানিয়ে নিই; বাংলা সংখ্যাও ইংরেজি করি।
  return bnToEn(String(text || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"')).replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

// লেবেলের পরের লেখা (যেমন "Name: Ashish" → "Ashish")।
// লেবেল লাইনের শুরুতেই থাকতে হয় — নইলে "Father's Name"-এর
// "Name" ভুল করে নাম ধরে নিত।
function afterLabel(lines, labels) {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const low = t.toLowerCase();
    for (const lab of labels) {
      if (low.startsWith(lab.toLowerCase())) {
        const v = t.slice(lab.length).replace(/^[:\-–—\s]+/, '').trim();
        return { value: v, index: i };
      }
    }
  }
  return null;
}

// সেকশন হেডার কিনা (পরের সেকশন শুরু হলে সংগ্রহ থামে)।
function isHeader(line) {
  return /^(education|academic|experience|work experience|skills|technical skills|computer skills|languages|language|address|contact|objective|career objective|personal|personal information|training|reference|references|profile|summary|শিক্ষা|শিক্ষাগত|অভিজ্ঞতা|কর্ম অভিজ্ঞতা|দক্ষতা|ভাষা|ঠিকানা|যোগাযোগ|ব্যক্তিগত|প্রশিক্ষণ|রেফারেন্স|উদ্দেশ্য)/i.test(line.trim());
}

// হেডার লাইনের পরের লাইনগুলো সংগ্রহ (পরের হেডার পর্যন্ত, সর্বোচ্চ max লাইন)।
function sectionLines(lines, startIdx, max) {
  const out = [];
  for (let i = startIdx + 1; i < lines.length && out.length < (max || 5); i++) {
    if (isHeader(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

function validDate(y, m, d) {
  y = +y; m = +m; d = +d;
  if (!(y >= 1950 && y <= 2010 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function parseDateStr(s) {
  s = (s || '').trim();
  let m = s.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return validDate(m[1], m[2], m[3]);
  m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) {
    // বাংলাদেশে dd/mm/yyyy চলে: 15/03/2001 মানে ১৫ মার্চ।
    // প্রথম সংখ্যা ১২-এর বেশি হলে সেটা দিনই — বদলানো যাবে না।
    // দ্বিতীয় সংখ্যা ১২-এর বেশি হলে তবেই mm/dd ধরে বদলাতে হয়।
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; }
    return validDate(m[3], mo, d);
  }
  m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return validDate(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  return null;
}

function parseCvText(text) {
  const lines = cleanLines(text);
  const out = {};
  const full = lines.join('\n');
  const low = full.toLowerCase();

  // ---- নাম ----
  const nameLab = afterLabel(lines, ['full name', 'name', 'নাম']);
  if (nameLab && nameLab.value && /^[A-Za-z\u0980-\u09FF .'-]{2,50}$/.test(nameLab.value) && !/\d/.test(nameLab.value)) {
    out.name = nameLab.value.split(/[,|]/)[0].trim();
  } else {
    for (const l of lines) {
      if (/^(curriculum vitae|cv|resume|résumé|বায়োডাটা|জীবনবৃত্তান্ত|bio-?data|personal information|ব্যক্তিগত তথ্য)/i.test(l)) continue;
      if (l.endsWith(':')) continue;
      const words = l.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && !/\d/.test(l) && !/@/.test(l) && l.length <= 45 &&
          words.every(w => /^[A-Za-z\u0980-\u09FF.'-]+$/.test(w))) { out.name = l; break; }
    }
  }

  // ---- মোবাইল ----
  // নম্বরে মাঝখানে - বা স্পেস থাকে (01712-345678) — সেগুলো সহ মিলিয়ে
  // শুধু সংখ্যাগুলো নিই; শেষে ০১ দিয়ে শুরু ১১ সংখ্যার নম্বর হতে হবে।
  const ph = full.match(/(?:\+?880[\s\-]?|0)1[3-9][\d\s\-]{7,12}/);
  if (ph) {
    let d = ph[0].replace(/\D/g, '');
    if (d.startsWith('880')) d = '0' + d.slice(3);
    if (/^01[3-9]\d{8}$/.test(d)) out.phone = d;
  }

  // ---- ইমেইল ----
  // TLD-র পর আর অক্ষর থাকলে সেটা জোড়া লেখা (লাইন ভাঙা পড়েনি) —
  // তখন মিলবে না, ভুল ইমেইল বসবে না।
  const em = full.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z])/);
  if (em) out.email = em[0];

  // ---- জন্ম তারিখ ----
  const dobLab = afterLabel(lines, ['date of birth', 'dob', 'জন্ম তারিখ', 'জন্মতারিখ', 'birth date']);
  if (dobLab) {
    out.dob = parseDateStr(dobLab.value) || (lines[dobLab.index + 1] ? parseDateStr(lines[dobLab.index + 1]) : null);
  }
  if (!out.dob) {
    const dm = full.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (dm) out.dob = parseDateStr(dm[0]);
  }
  if (!out.dob) {
    const dm2 = full.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{4})/i);
    if (dm2) out.dob = parseDateStr(dm2[0]);
  }
  if (!out.dob) delete out.dob;

  // ---- জেলা ----
  const distLab = afterLabel(lines, ['district', 'জেলা']);
  if (distLab && distLab.value) out.district = findDistrict(distLab.value);
  if (!out.district) out.district = findDistrict(full);

  // ---- শিক্ষা (প্রোফাইলের অপশনের মানেই) ----
  if (/স্নাতক|bachelor|honou?rs|\bb\.?\s?a\b|\bb\.?\s?sc\b|\bbba\b|graduate/i.test(full)) out.edu = 'স্নাতক';
  else if (/এইচএসসি|\bhsc\b|higher secondary/i.test(full)) out.edu = 'HSC';
  else if (/এসএসসি|\bssc\b|secondary school/i.test(full)) out.edu = 'SSC';
  else if (/\bjsc\b/.test(full)) out.edu = 'JSC';

  // ---- টাইপিং (শব্দ/মিনিট) ----
  // \b লাগে: "Bangladesh"-এর ভেতরের "Bangla" ধরে পরের ১৫ (জন্ম তারিখ)
  // টাইপিং ভেবে বসত — শব্দের সীমানা থাকলে সেটা হয় না।
  const tb = full.match(/\b(বাংলা|bangla)\b[^0-9\n]{0,25}(\d{1,3})/i);
  if (tb && +tb[2] >= 5 && +tb[2] <= 80) out.typeBn = +tb[2];
  const te = full.match(/\b(ইংরেজি|english)\b[^0-9\n]{0,25}(\d{1,3})/i);
  if (te && +te[2] >= 5 && +te[2] <= 80) out.typeEn = +te[2];

  // ---- ঠিকানা ----
  const presLab = afterLabel(lines, ['present address', 'বর্তমান ঠিকানা', 'current address']);
  if (presLab) {
    let v = presLab.value;
    if (v.length < 12) { const extra = sectionLines(lines, presLab.index, 2); if (extra.length) v = (v + ' ' + extra.join(' ')).trim(); }
    if (v) out.address = v;
  }
  const permLab = afterLabel(lines, ['permanent address', 'স্থায়ী ঠিকানা']);
  if (permLab) {
    let v = permLab.value;
    if (v.length < 12) { const extra = sectionLines(lines, permLab.index, 2); if (extra.length) v = (v + ' ' + extra.join(' ')).trim(); }
    if (v) out.permAddress = v;
  }
  if (!out.address) {
    const aLab = afterLabel(lines, ['address', 'ঠিকানা']);
    if (aLab && aLab.value) out.address = aLab.value;
  }

  // ---- পিতা / মাতা ----
  const fa = afterLabel(lines, ["father's name", 'father name', 'পিতার নাম']);
  if (fa && fa.value) out.fatherName = fa.value.split(/[,|]/)[0].trim();
  const mo = afterLabel(lines, ["mother's name", 'mother name', 'মাতার নাম']);
  if (mo && mo.value) out.motherName = mo.value.split(/[,|]/)[0].trim();

  // ---- দক্ষতা ----
  const skIdx = lines.findIndex(l => /^(skills|technical skills|computer skills|দক্ষতা)/i.test(l.trim()));
  if (skIdx >= 0) {
    const v = lines[skIdx].includes(':') ? lines[skIdx].split(':').slice(1).join(':').trim() : '';
    const rest = sectionLines(lines, skIdx, 5);
    const joined = [v, ...rest].filter(Boolean).join(', ');
    if (joined) out.skills = joined;
  }

  // ---- কর্ম অভিজ্ঞতা ----
  const exIdx = lines.findIndex(l => /^(experience|work experience|employment|অভিজ্ঞতা|কর্ম অভিজ্ঞতা)/i.test(l.trim()));
  if (exIdx >= 0) {
    const v = lines[exIdx].includes(':') ? lines[exIdx].split(':').slice(1).join(':').trim() : '';
    const rest = sectionLines(lines, exIdx, 6);
    const joined = [v, ...rest].filter(Boolean).join('\n');
    if (joined) out.experience = joined;
  }

  // ---- ভাষা ----
  const lg = afterLabel(lines, ['languages', 'language', 'ভাষা']);
  if (lg && lg.value) out.languages = lg.value;

  return out;
}

// CV আপলোডে CV-ই শেষ কথা: CV-তে যা আছে, প্রোফাইলের সব ঘরে তা-ই বসবে —
// আগে কোনো মান থাকলেও CV-র মান জিতবে (ASHISH-এর নির্দেশ: A-Z সব বসবে)।
// বসানো ফিল্ডের নাম ফেরে; স্ন্যাপশট আলাদা করে রাখা হয় যাতে CV মুছলে
// এই মানগুলো আবার খালি করা যায়।
function overwriteCvFields(profile, fields) {
  const next = Object.assign({}, profile);
  const filled = [];
  CV_FIELDS.forEach(k => {
    const v = fields[k];
    if (v === undefined || v === '' || v === null) return;
    next[k] = v; filled.push(k);
  });
  return { profile: next, filled };
}

// CV-র পুরনো স্ন্যাপশটের সাথে মিলিয়ে প্রোফাইলে বসানো:
// খালি ঘর বসে; যে ঘরের মান আগের CV-র মানের সমান, সেটাও নতুন মানে বদলায়;
// অ্যাপের ডিফল্ট মান (টাইপিং ২০/২০, শিক্ষা HSC) থাকলেও CV-র মান বসে —
// ডিফল্ট তো হাতে বসানো নয়। নিজে হাতে বদলানো ঘর ছোঁয়া হয় না।
const CV_DEFAULTS = { typeBn: 20, typeEn: 20, edu: 'HSC' };
function mergeCvFields(profile, fields, oldSnap) {
  const next = Object.assign({}, profile);
  const filled = [];
  CV_FIELDS.forEach(k => {
    const v = fields[k];
    if (v === undefined || v === '' || v === null) return;
    const cur = next[k];
    if (cur === undefined || cur === '' || cur === null || String(cur) === String((oldSnap || {})[k]) ||
        (k in CV_DEFAULTS && String(cur) === String(CV_DEFAULTS[k]))) {
      next[k] = v; filled.push(k);
    }
  });
  return { profile: next, filled };
}

// CV মোছা: স্ন্যাপশটের মানের সাথে হুবহু মেলা ঘরগুলোই খালি হয়
// (হাতে বদলানো ঘর থেকে যায়)। টাইপিং ঘর ডিফল্ট ২০-এ ফেরে।
function removeCvFields(profile, snap) {
  const next = Object.assign({}, profile);
  Object.keys(snap || {}).forEach(k => {
    if (next[k] !== undefined && String(next[k]) === String(snap[k])) {
      next[k] = (k === 'typeBn' || k === 'typeEn') ? 20 : '';
    }
  });
  delete next.cv;
  return next;
}

// PDF-র raw stream থেকে লেখা তোলা (pdf.js CDN না চললে ফলব্যাক)।
// stream ব্লকগুলো FlateDecode হলে DecompressionStream দিয়ে খোলে,
// তারপর ( ... ) Tj ও [ ... ] TJ অপারেটর থেকে স্ট্রিং তোলে।
function unescapePdfString(s) {
  // "(...)" গ্রুপের শেষের বন্ধনী পর্যন্ত নাও — ম্যাচে " Tj" জুড়ে থাকতে পারে।
  const end = s.lastIndexOf(')');
  const inner = (end >= 0 ? s.slice(0, end) : s).replace(/^\(/, '');
  return inner.replace(/\\([()\\])/g, '$1').replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ');
}
// বাইট-নির্ভুল latin1 স্ট্রিং: TextDecoder('iso-8859-1') আসলে
// windows-1252 হিসেবে ডিকোড করে (০x৮০–০x৯F বাইট বদলে যায়), তাই
// stream-এর বাইট আর ফিরে পাওয়া যেত না — DecompressionStream ফেল করত।
function bytesToLatin1(bytes) {
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}
async function extractPdfTextRaw(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const raw = bytesToLatin1(bytes);
  const parts = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const sb = new Uint8Array(m[1].length);
    for (let i = 0; i < m[1].length; i++) sb[i] = m[1].charCodeAt(i) & 0xff;
    let text = null;
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate');
        const out = await new Response(new Blob([sb]).stream().pipeThrough(ds)).arrayBuffer();
        text = bytesToLatin1(new Uint8Array(out));
      } catch { text = null; }
    }
    if (text === null) text = m[1];
    // Tj/TJ রানগুলো ক্রমে নাও; মাঝে Td/T*/TD/Tm (নতুন লাইন/অবস্থান)
    // থাকলে লাইন ভাঙো — নইলে সব লাইন জোড়া লেগে একটাই লাইন হয়ে যায়
    // (Word থেকে আসা PDF-এ লাইন সাজাতে Tm-ই বেশি ব্যবহৃত হয়)।
    const segs = [];
    const mm = [...text.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\]])*\]\s*TJ/g)];
    let prevEnd = 0;
    for (const hit of mm) {
      const gap = text.slice(prevEnd, hit.index);
      if (segs.length && /(^|\s)(Td|TD|T\*|Tm)/.test(gap)) segs.push('\n');
      const s = hit[0];
      if (s.trimEnd().endsWith('Tj')) segs.push(unescapePdfString(s));
      else {
        const inner = s.match(/\((?:\\.|[^\\()])*\)/g) || [];
        segs.push(inner.map(unescapePdfString).join(''));
      }
      prevEnd = hit.index + hit[0].length;
    }
    parts.push(segs.join(''));
  }
  return parts.join('\n').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCvText, mergeCvFields, overwriteCvFields, removeCvFields, extractPdfTextRaw, bnToEn, DISTRICTS, CV_FIELDS };
}
