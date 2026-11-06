# জব ট্র্যাকার — Job Tracker (Vercel)

বাংলাদেশের সব ধরনের সরকারি চাকরির সার্কুলার এক জায়গায় — বাংলা UI, সঠিক বাংলা সংখ্যা (০–৯), ফিল্টার, আবেদন ট্র্যাকিং, CV মিল, PIN-লক অ্যাডমিন পোর্টাল, আর অটোমেটিক Gmail রিমাইন্ডার। Vercel-এ হোস্ট করার জন্য বানানো — Muse ছাড়াই নিজে থেকে চলে।

## আলাদা পেইজ (রাউট)

| পেইজ | ফাইল | কাজ |
|---|---|---|
| হোম / সার্কুলার তালিকা | `index.html` | সব সার্কুলার, খোঁজা, ফিল্টার, ডেডলাইন |
| লগইন | `login.html` (আলাদা পেইজ) | Google-এর আসল পপআপ এখান থেকে খোলে + ম্যানুয়াল লগইন |
| সেটিংস | `settings.html` | CV আপলোড ও প্রোফাইল |
| অ্যাডমিন | `admin.html` | PIN-লক অ্যাডমিন পোর্টাল |

একটা পেইজের ভেতরে গেলে বাকিগুলো থাকে না — প্রতিটা আলাদা রাউট।

## লগইন (আলাদা পেইজে, Google পপআপসহ)

লগইন আলাদা পেইজে থাকে (`login.html`) — হোম পেইজে কিছু মেশানো নেই। লগইন পেইজে দুটো অপশনই থাকে:

1. **Google কানেক্ট করুন** — আসল Google পপআপ (Google Identity Services + সার্ভারে OAuth code exchange, `api/auth-google.js`)। কোনো নাম/ইমেইল হাতে লেখার ফর্ম নয়।
2. **ম্যানুয়াল লগইন / রেজিস্টার** — Gmail + নাম + পাসওয়ার্ড সেট করে লগইন/রেজিস্টার।

লগইন গেট: লগইন ছাড়া আবেদন, শর্টলিস্ট, বিস্তারিত, নোট, সেভ, সেটিংস, সার্কুলার যোগ — যেকোনো কিছুতে চাপ দিলেই লগইন পপআপ আসে। শুধু তালিকা দেখা, খোঁজা ও ফিল্টার সবার জন্য খোলা।

## অটোমেটিক ইমেইল (Muse ছাড়া, নিজে থেকে)

- **সেন্ডার:** অফিসিয়াল Gmail `jobtrackerbd@gmail.com` — শুধু অ্যাডমিন পোর্টালের ভেতরে সেট করা যায়। অ্যাডমিন যে Google দিয়ে লগইন করুক, তাতে এর কোনো এফেক্ট পড়ে না।
- **প্রাপক:** প্রতিটি ব্যবহারকারী যে Google দিয়ে সাইন-ইন করবে, রিমাইন্ডার সেই Gmail-এই যাবে।
- **ডেইলি চেক:** Vercel Cron (`vercel.json` — প্রতিদিন `0 2 * * *`, অর্থাৎ সকাল ৮টা ঢাকা সময়) `/api/daily-check` চালায় — নতুন সার্কুলার, ডেডলাইন (৩ দিন / ১ দিন আগে), অ্যাডমিট ও রেজাল্টের আপডেট নিজে থেকে পাঠায়। একই ইমেইল দুবার যায় না (fingerprint dedupe)। মালিককে কিছু চাপতে হয় না।

## সেটআপ (Vercel)

### ১. Gmail App Password (সেন্ডার)
1. `jobtrackerbd@gmail.com` দিয়ে Google-এ সাইন-ইন করুন।
2. Google Account → Security → 2-Step Verification চালু করুন।
3. Security → App passwords → নতুন অ্যাপ পাসওয়ার্ড তৈরি করুন (১৬ অক্ষর)।
4. Vercel → Project → Settings → Environment Variables-এ বসান:
   - `GMAIL_USER=jobtrackerbd@gmail.com`
   - `GMAIL_APP_PASSWORD=<১৬ অক্ষরের পাসওয়ার্ড, স্পেস ছাড়া>`

### ২. Google OAuth
1. Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application।
2. Authorized JavaScript origins: `https://<আপনার-vercel-ডোমেইন>`
3. Authorized redirect URIs: `https://<আপনার-vercel-ডোমেইন>/api/auth-google`
4. Vercel env vars-এ বসান: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### ৩. অ্যাডমিন PIN
প্রথমবার অ্যাডমিন পেইজে গিয়ে যেকোনো ৪–১২ অঙ্কের PIN দিলেই সেটা আপনার PIN হবে। সার্ভার-এনফোর্সড PIN চাইলে Vercel-এ `ADMIN_PIN_HASH` (PIN-এর SHA-256 hex) সেট করুন। PIN কোডে কোথাও লেখা নেই।

### ৪. ডেপ্লয়
```bash
# Vercel CLI দিয়ে
vercel --prod
# অথবা: Vercel ড্যাশবোর্ড → Add New Project → এই GitHub রিপো Import করুন,
# তারপর উপরের Environment Variables গুলো বসিয়ে Deploy করুন।
```
অন্যান্য env var: `EMAIL_RECIPIENTS` (ক্রনের ফলব্যাক প্রাপক, কমা দিয়ে আলাদা), `CRON_SECRET` (ঐচ্ছিক)। `.env.example` দেখুন।

## সার্কুলার ডেটা

`data/circulars.json`-এ ১০টি সার্কুলার সিড করা আছে (CAG, ITIIU, কর অঞ্চল-৬, BPATC, কর অঞ্চল-৩, DMP, NSD, CID, সুপ্রীম কোর্ট, পটুয়াখালী জেলা প্রশাসন)। **সব তথ্য দ্বিতীয় সূত্রের** — আবেদন বা টাকা দেওয়ার আগে অফিসিয়াল সার্কুলার / টেলিটক পোর্টাল যাচাই করতে হবে।

## সীমা (সৎভাবে)

- আসল Google OAuth পপআপ ও আসল Gmail পাঠানো যাচাই করা হয়নি — এগুলো চলে শুধু মালিকের Google Cloud credentials ও Gmail App Password দিয়ে, যা এই রিপোতে নেই (থাকতেও পারে না)।
- এই ভার্সনে ব্যবহারকারীর ডেটা (শর্টলিস্ট, আবেদন অবস্থা, প্রোফাইল) ব্রাউজারের localStorage-এ থাকে, আর প্রাপকের তালিকা `EMAIL_RECIPIENTS` env var দিয়ে চলে। প্রোডাকশনে অনেক ব্যবহারকারীর জন্য Vercel KV / Postgres লাগবে — `api/register-recipient.js` ও `api/daily-check.js`-এ সেই জায়গা চিহ্নিত করা আছে।
- বাংলা সংখ্যা সব জায়গায় LTR-isolated `.num` স্প্যানে থাকে, তাই মোবাইলে উল্টে/জড়িয়ে যায় না।
