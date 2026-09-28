/*
 * SADIN evaluation corpus v1
 * Synthetic prompts written to resemble what employees paste into AI tools.
 * All secrets, IPs and names are fabricated. Two sets:
 *   SENSITIVE: each item lists the values that must not leave (expect)
 *   CLEAN:     ordinary business prompts that must pass untouched,
 *              including deliberate look-alikes (public IPs, versions, dates,
 *              the word "password" in normal sentences, Arabic words that
 *              contain the letters of "سري", UUIDs, IBANs, phone numbers).
 * Generated items use a fixed seed so the benchmark is reproducible.
 */
"use strict";

// ---------- seeded RNG ----------
let seed = 20260922;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function int(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
function chars(set, n) { let s = ""; for (let i = 0; i < n; i++) s += set[Math.floor(rnd() * set.length)]; return s; }
const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", az = "abcdefghijklmnopqrstuvwxyz", D = "0123456789";
const ALNUM = AZ + az + D;
function privIp() {
  const k = int(0, 2);
  if (k === 0) return `10.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`;
  if (k === 1) return `172.${int(16, 31)}.${int(0, 255)}.${int(1, 254)}`;
  return `192.168.${int(0, 255)}.${int(1, 254)}`;
}
function pwd() { return pick(["Riyadh", "Najd", "Falcon", "Summer", "Admin", "Qassim", "Tuwaiq"]) + int(10, 99) + pick(["!", "@", "#", "$"]) + chars(ALNUM, 4); }

const S = []; // sensitive
const C = []; // clean
let n = 0;
function s(lang, text, expect, action) { S.push({ id: "S" + (++n), lang, text, expect, expectAction: action || null }); }
let m = 0;
function c(lang, text) { C.push({ id: "C" + (++m), lang, text }); }

// =====================================================================
// SENSITIVE: hand-written
// =====================================================================
s("en", `Why does this tunnel keep dropping?
crypto isakmp policy 10
 encr aes 256
crypto isakmp key Vpn$Share2026 address 203.0.113.10
crypto map OUTSIDE_MAP 10 match address 110
access-list 110 permit ip 10.40.0.0 0.0.255.255 172.20.0.0 0.0.255.255`,
  [["CREDENTIAL", "Vpn$Share2026"], ["NETWORK", "203.0.113.10"], ["NETWORK", "10.40.0.0"], ["NETWORK", "172.20.0.0"]]);

s("en", `Can you fix this docker compose? It won't start.
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: Wd9#kLp2Qz
    ports:
      - "5432:5432"
  api:
    environment:
      DATABASE_URL: postgres://erp_app:Wd9#kLp2Qz@db-prod-01.corp.example.sa:5432/erp`,
  [["CREDENTIAL", "Wd9#kLp2Qz"], ["NETWORK", "db-prod-01.corp.example.sa"]]);

s("en", `Explain this error from our script:
import boto3
s3 = boto3.client("s3", aws_access_key_id="AKIAQ3EGRT6YH7LMNWPA", aws_secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY1")`,
  [["CREDENTIAL", "AKIAQ3EGRT6YH7LMNWPA"], ["CREDENTIAL", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY1"]]);

s("en", `Nmap scan report for 10.12.4.20
PORT     STATE SERVICE
22/tcp   open  ssh
445/tcp  open  microsoft-ds
3389/tcp open  ms-wbt-server
Which of these should we close first?`,
  [["NETWORK", "10.12.4.20"], ["NETWORK", "3389"], ["NETWORK", "445"]]);

s("en", `Summarise this for the board.
TOP SECRET
Project Najm: acquisition target list and bid ceilings for Q1.`,
  [["CLASSIFIED", "TOP SECRET"]], "block");

s("en", `Classification: Restricted
Draft tender evaluation for the new data centre cabling contract. Rewrite in formal Arabic.`,
  [["CLASSIFIED", "Classification: Restricted"]], "block");

s("ar", `التصنيف: سري
مسودة خطة الاستجابة للحوادث للربع القادم. لخّصها في خمس نقاط.`,
  [["CLASSIFIED", "التصنيف: سري"]], "block");

s("ar", `سري للغاية
محضر اجتماع اللجنة التنفيذية بخصوص إعادة هيكلة الإدارات. أعد صياغته بأسلوب رسمي.`,
  [["CLASSIFIED", "سري للغاية"]], "block");

s("ar", `ساعدني أفهم سبب فشل الاتصال بالخادم. عنوانه 192.168.50.12 والمنفذ 8443 واسم المستخدم svc_backup وكلمة المرور: Qx7!mz92Lp`,
  [["NETWORK", "192.168.50.12"], ["NETWORK", "8443"], ["CREDENTIAL", "Qx7!mz92Lp"]]);

s("ar", `هذا ملف .env لتطبيقنا، لماذا لا يقرأ المتغيرات؟
DB_HOST=10.8.1.5
DB_PASSWORD=Ma3zul#2026
OPENAI_API_KEY=sk-proj-7hGk29LmQpZx81NvBw4RtYu6`,
  [["NETWORK", "10.8.1.5"], ["CREDENTIAL", "Ma3zul#2026"], ["CREDENTIAL", "sk-proj-7hGk29LmQpZx81NvBw4RtYu6"]]);

s("en", `Our GitHub Action fails at checkout. Token is ghp_9aZkL3mQ7rT2xV8bN1cW4yH6jP0sD5fG2eK1 — is it expired?`,
  [["CREDENTIAL", "ghp_9aZkL3mQ7rT2xV8bN1cW4yH6jP0sD5fG2eK1"]]);

s("en", `Write a PowerShell script that adds users to the group on DC01 and SRV-FILE-02. Run it as CORP\\svc_admin.`,
  [["NETWORK", "DC01"], ["NETWORK", "SRV-FILE-02"], ["ACCOUNT", "CORP\\svc_admin"]]);

s("en", `Here is the SIEM alert, what does it mean?
SIEM alert 4625: failed logon for a.alharbi@corp.example.sa from 10.30.2.77 to ex-mail-01.corp.example.sa`,
  [["ACCOUNT", "a.alharbi@corp.example.sa"], ["NETWORK", "10.30.2.77"], ["NETWORK", "ex-mail-01.corp.example.sa"]]);

s("en", `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBc3m9Vx1fQ1Zx0Yg8m2kJ7w0mY3yWJ2r3rK9h8pXo1kQAAAJDl0m2k5dJt
-----END OPENSSH PRIVATE KEY-----
Why does ssh say "invalid format" with this key?`,
  [["CREDENTIAL", "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW"]]);

s("en", `The Slack bot token xoxb-2291846-8820417-Kf82Lm0QzPa91Xs keeps returning invalid_auth.`,
  [["CREDENTIAL", "xoxb-2291846-8820417-Kf82Lm0QzPa91Xs"]]);

s("en", `Check this JWT for me: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlbXAtNDQyMSIsInJvbGUiOiJhZG1pbiJ9.x7Qm2LpZr8Vn4KsT1wYe9bHc`,
  [["CREDENTIAL", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlbXAtNDQyMSIsInJvbGUiOiJhZG1pbiJ9.x7Qm2LpZr8Vn4KsT1wYe9bHc"]]);

s("en", `Pentest findings summary: the jump host jmp.corp.example.sa (10.1.1.9) allows SMBv1, CVSS 9.8. Write the executive summary.`,
  [["NETWORK", "jmp.corp.example.sa"], ["NETWORK", "10.1.1.9"]]);

s("en", `Router config for review:
hostname RTR-BR-07
enable secret 5 $1$Kd8a$3nq8ZcXv1TtrqP9WmQe0w.
username netops privilege 15 password 7 0822455D0A165A
snmp-server community R3adOnlyC0m RO
ip route 0.0.0.0 0.0.0.0 172.18.0.1`,
  [["NETWORK", "RTR-BR-07"], ["CREDENTIAL", "$1$Kd8a$3nq8ZcXv1TtrqP9WmQe0w."], ["CREDENTIAL", "0822455D0A165A"], ["CREDENTIAL", "R3adOnlyC0m"], ["NETWORK", "172.18.0.1"]]);

s("ar", `وثيقة سرية: قائمة الموردين المعتمدين وأسعار العقود. حوّلها إلى جدول.`,
  [["CLASSIFIED", "وثيقة سرية"]], "block");

s("ar", `مقيد
تقرير مراجعة صلاحيات المستخدمين في نظام الموارد البشرية. اقترح تحسينات.`,
  [["CLASSIFIED", "مقيد"]], "block");

s("en", `Employee EMP-104522 cannot log in to the VPN from home. Draft a reply to IT.`,
  [["ACCOUNT", "EMP-104522"]]);

s("en", `Stripe says my key is invalid: sk_live_51Hq8XkLmP2vR9tYz4Wc7Bn3`,
  [["CREDENTIAL", "sk_live_51Hq8XkLmP2vR9tYz4Wc7Bn3"]]);

s("en", `Connection string from web.config, why does it time out?
Server=sql-hr-01.corp.example.sa,1433;Database=HR;User Id=hr_reader;Password=Pa55w0rd!HR;`,
  [["NETWORK", "sql-hr-01.corp.example.sa"], ["CREDENTIAL", "Pa55w0rd!HR"]]);

s("en", `Our Google Maps widget broke. Key: AIzaSyD8kP2mQ7xV3rN9bL4wT6yH1cJ5sF0gE2a`,
  [["CREDENTIAL", "AIzaSyD8kP2mQ7xV3rN9bL4wT6yH1cJ5sF0gE2a"]]);

s("ar", `ما الخطأ في قاعدة الجدار الناري هذه؟ نريد السماح بالوصول من 10.60.0.0/16 إلى الخادم 10.60.5.20 على المنفذ 1433 فقط.`,
  [["NETWORK", "10.60.0.0"], ["NETWORK", "10.60.5.20"], ["NETWORK", "1433"]]);

s("en", `Wi-Fi config for the new branch: SSID HQ-STAFF, wpa-psk Br4nch!Wifi2026, gateway 192.168.88.1`,
  [["CREDENTIAL", "Br4nch!Wifi2026"], ["NETWORK", "192.168.88.1"]]);

s("en", `STRICTLY CONFIDENTIAL — draft salary bands for 2027. Turn into a slide.`,
  [["CLASSIFIED", "STRICTLY CONFIDENTIAL"]], "block");

s("en", `kubectl says unauthorized. My kubeconfig has token: 8f3kLq92ZxPm7VtR4nWc1YbH6sJ0dG5a and server https://10.0.12.4:6443`,
  [["CREDENTIAL", "8f3kLq92ZxPm7VtR4nWc1YbH6sJ0dG5a"], ["NETWORK", "10.0.12.4"], ["NETWORK", "6443"]]);

s("en", `Our backup job logs in with ldaps://svc_bkp:Bkp#Secure77@ldap.corp.example.sa — why is the bind failing?`,
  [["CREDENTIAL", "Bkp#Secure77"], ["NETWORK", "ldap.corp.example.sa"]]);

// =====================================================================
// SENSITIVE: generated from templates (varied phrasing, EN + AR)
// =====================================================================
const enNet = [
  (ip, p) => [`Why can't I ping ${ip} from my laptop? The service listens on port ${p}.`, [["NETWORK", ip], ["NETWORK", String(p)]]],
  (ip, p) => [`Firewall rule: allow tcp from any to ${ip} dport ${p}. Is this too open?`, [["NETWORK", ip], ["NETWORK", String(p)]]],
  (ip, p) => [`The app at http://${ip}:${p}/login returns 502 after the update.`, [["NETWORK", ip], ["NETWORK", String(p)]]],
  (ip) => [`Set a static route to ${ip} via the core switch, what's the command?`, [["NETWORK", ip]]],
  (ip, p) => [`Grafana shows high latency between ${ip} and the DB on ${p}/tcp. Ideas?`, [["NETWORK", ip], ["NETWORK", String(p)]]]
];
const arNet = [
  (ip, p) => [`لماذا لا يستجيب الخادم ${ip} على المنفذ ${p}؟`, [["NETWORK", ip], ["NETWORK", String(p)]]],
  (ip) => [`أريد إعداد قاعدة تسمح بالوصول إلى ${ip} من شبكة الفرع فقط.`, [["NETWORK", ip]]],
  (ip, p) => [`الموقع الداخلي http://${ip}:${p} لا يفتح بعد التحديث، ما السبب؟`, [["NETWORK", ip], ["NETWORK", String(p)]]]
];
for (let i = 0; i < 20; i++) {
  const ip = privIp(), p = pick([22, 443, 1433, 3306, 3389, 5432, 5985, 8080, 8443, 9200]);
  const [t, e] = (i % 3 === 2 ? pick(arNet) : pick(enNet))(ip, p);
  s(i % 3 === 2 ? "ar" : "en", t, e);
}

const enCred = [
  (v) => [`My password is ${v} but the portal rejects it, why?`, [["CREDENTIAL", v]]],
  (v) => [`config.yaml:\n  smtp:\n    user: alerts\n    password: ${v}\nIs the YAML valid?`, [["CREDENTIAL", v]]],
  (v) => [`export DB_PASS=${v}\nnpm run migrate  # fails with auth error`, [["CREDENTIAL", v]]],
  (v) => [`{"client_id": "portal", "client_secret": "${v}"} — why does the OAuth call return 401?`, [["CREDENTIAL", v]]]
];
const arCred = [
  (v) => [`كلمة المرور: ${v} لا تعمل على بوابة الموظفين، ما السبب؟`, [["CREDENTIAL", v]]],
  (v) => [`هذا إعداد البريد، هل فيه خطأ؟ password=${v}`, [["CREDENTIAL", v]]]
];
for (let i = 0; i < 16; i++) {
  const v = pwd();
  const [t, e] = (i % 4 === 3 ? pick(arCred) : pick(enCred))(v);
  s(i % 4 === 3 ? "ar" : "en", t, e);
}

const keys = [
  () => "sk-proj-" + chars(ALNUM, 32),
  () => "ghp_" + chars(ALNUM, 36),
  () => "AKIA" + chars(AZ + D, 16),
  () => "xoxp-" + chars(D, 10) + "-" + chars(ALNUM, 16),
  () => "AIza" + chars(ALNUM + "_-", 35),
  () => "sk-ant-api03-" + chars(ALNUM, 40)
];
const keyTpl = [
  (k) => `Why am I getting 401 with this key ${k} ?`,
  (k) => `const client = new Client({ apiKey: "${k}" });\n// throws on init, help`,
  (k) => `المفتاح ${k} توقف عن العمل فجأة، كيف أتحقق من صلاحيته؟`,
  (k) => `curl -H "Authorization: Bearer ${k}" https://api.vendor.com/v1/items`
];
for (let i = 0; i < 16; i++) {
  const k = pick(keys)(); const ti = i % 4;
  s(ti === 2 ? "ar" : "en", keyTpl[ti](k), [["CREDENTIAL", k]]);
}

const hosts = () => pick(["app", "hr", "erp", "git", "wiki", "vault", "ci", "mon"]) + "-" + pick(["prod", "dev", "stg"]) + "-0" + int(1, 9) + "." + pick(["corp.example.sa", "internal", "lan"]);
for (let i = 0; i < 10; i++) {
  const h = hosts();
  const t = i % 2 ? `The certificate on ${h} expired, how do I renew it with certbot?` : `لا أستطيع الوصول إلى ${h} من الشبكة الافتراضية، ساعدني في التشخيص.`;
  s(i % 2 ? "en" : "ar", t, [["NETWORK", h]]);
}

const users = () => pick(["m.alqahtani", "s.alotaibi", "f.alharbi", "n.alghamdi", "a.alshehri"]);
for (let i = 0; i < 8; i++) {
  const u = users() + "@corp.example.sa";
  const t = i % 2 ? `Draft an email to ${u} about the locked account.` : `الحساب ${u} مقفل منذ الأمس، اكتب رسالة للدعم الفني.`;
  s(i % 2 ? "en" : "ar", t, [["ACCOUNT", u]]);
}

const enCls = ["TOP SECRET", "SECRET", "CONFIDENTIAL", "RESTRICTED", "INTERNAL USE ONLY"];
const arCls = ["سري للغاية", "سري", "مقيد", "سري جداً"];
for (let i = 0; i < 12; i++) {
  if (i % 2) {
    const l = pick(enCls);
    s("en", `${l}\n${pick(["Merger timeline", "Board minutes", "Security architecture review", "Vendor risk register"])} for ${pick(["Q3", "2027", "the new branch"])}. Summarise it.`, [["CLASSIFIED", l]], "block");
  } else {
    const l = pick(arCls);
    s("ar", `${l}\n${pick(["محضر اجتماع", "خطة استمرارية الأعمال", "تقرير تقييم المخاطر", "مسودة الميزانية"])} ${pick(["للإدارة العامة", "للربع الثالث", "للفرع الجديد"])}. أعد كتابته باختصار.`, [["CLASSIFIED", l]], "block");
  }
}

// =====================================================================
// CLEAN: hand-written look-alikes and ordinary work prompts
// =====================================================================
[
  "How do I reset my password on the employee portal? I forgot it.",
  "Write a password policy for our company: minimum length, rotation and MFA.",
  "What is the difference between TCP and UDP? Explain like I'm new to networking.",
  "Our public DNS resolvers are 8.8.8.8 and 1.1.1.1. Which is faster in Riyadh?",
  "We upgraded to Python 3.12.1 and Node 22.4.0 last week. Any breaking changes?",
  "The meeting is on 10.12.2025 at 10:30 in the main hall.",
  "Summarise the key points of Vision 2030 for the tourism sector.",
  "Draft a polite reminder email about the quarterly report deadline.",
  "What port does HTTPS use by default and why?",
  "Translate this sentence into Arabic: our team delivered the project on time.",
  "Explain what a VPN is to a non-technical manager.",
  "Create a training plan for new SOC analysts, 8 weeks long.",
  "The secret to a good presentation is practice. Give me five more tips.",
  "Our IBAN is SA0380000000608010167519, can you format it for the invoice?",
  "Call the front desk on +966 11 234 5678 to book the room.",
  "The order ID is 4f9c2a1e-8b7d-4e3a-9c1f-2d5e6a7b8c9d, can you write a tracking message?",
  "What does CVE mean and how are CVE IDs assigned?",
  "Rewrite this job ad for a network engineer role in Jeddah.",
  "Give me a regex that matches Saudi mobile numbers.",
  "How many employees should an IT helpdesk have for a 500-person company?",
  "The Port of Jeddah handled more containers this year. Write a short news summary.",
  "Is it safe to store passwords in the browser? Explain the risks.",
  "Compare Microsoft Purview and Google Workspace DLP at a high level.",
  "Write a SQL query that counts orders per month from a table called orders.",
  "Explain CIDR notation with the example 203.0.114.0/24.",
  "What is an API key and how should developers keep it safe?",
  "Write a function in JavaScript that checks if a string is a palindrome.",
  "Our internal newsletter needs a headline about the new cafeteria.",
  "How do I configure SSH to use key-based authentication instead of passwords?",
  "Summarise the NCA Essential Cybersecurity Controls in plain language.",
  "Explain the four NDMO data classification levels.",
  "What's a good naming convention for servers in a mid-size company?",
  "Write a short LinkedIn post celebrating our team's graduation from the training program.",
  "The token economy in the game rewards players for daily logins. Explain how it works.",
  "Convert 36 by 48 inches to centimetres.",
  "Here is our public website: https://www.example.sa — suggest SEO improvements.",
  "Generate a table of the GCC countries and their capitals.",
  "My laptop fan is loud when I open 40 browser tabs. Any advice?",
  "Explain what Zero Trust architecture means.",
  "Write unit tests for a function add(a, b) in Python.",
  "What does the HTTP status code 502 mean?",
  "The contract value is 1,250,000 SAR over 3 years. Calculate the annual amount.",
  "Suggest a secret Santa gift under 100 riyals.",
  "List the OWASP Top 10 for LLM applications.",
  "What is the default port for PostgreSQL? I'm studying for an exam.",
  "Explain what 'pre-shared key' means in VPNs, in general terms.",
  "Write a function that validates an IPv4 address.",
  "Our release is version 2.10.3.4 of the mobile app. Draft release notes.",
  "Plan a team-building day for 25 people in Abha.",
  "How do I cite an NCA document in APA style?"
].forEach(t => c("en", t));

[
  "كيف أعيد تعيين كلمة المرور في بوابة الموظفين؟",
  "اكتب سياسة لكلمات المرور تتضمن الطول الأدنى والتحقق الثنائي.",
  "ما الفرق بين بروتوكول TCP وUDP؟ اشرح بشكل مبسط.",
  "لخّص أهداف رؤية 2030 في قطاع الصحة.",
  "اكتب رسالة تذكير مهذبة بموعد تسليم التقرير الربعي.",
  "الشحن سريع جداً هذا الأسبوع، اكتب رسالة شكر لشركة التوصيل.",
  "ما أهمية سرية المعلومات في الأمن السيبراني؟ اشرح المفهوم.",
  "اكتب خطة تدريب لمحللي مركز العمليات الأمنية لمدة ثمانية أسابيع.",
  "ترجم هذه الفقرة إلى الإنجليزية: أنجز الفريق المشروع في الموعد المحدد.",
  "اشرح مفهوم الشبكة الافتراضية الخاصة لمدير غير تقني.",
  "ما هي مستويات تصنيف البيانات الأربعة لدى مكتب إدارة البيانات الوطنية؟",
  "اقترح أسماء لفريق العمل في مسابقة الابتكار.",
  "اكتب منشوراً قصيراً عن يوم التأسيس.",
  "كم عدد الموظفين المناسب لمكتب الدعم الفني في شركة من 500 موظف؟",
  "اشرح معنى الثغرة الأمنية وكيف يتم تقييم خطورتها.",
  "هذا الموضوع سريع التغير، لخّص آخر اتجاهات الذكاء الاصطناعي.",
  "الاجتماع يوم 10.12.2025 الساعة 10:30 في القاعة الرئيسية.",
  "رقم الآيبان الخاص بالشركة SA0380000000608010167519، رتّبه في الفاتورة.",
  "كيف أحمي حسابي في وسائل التواصل من الاختراق؟",
  "اكتب إعلان وظيفة لمهندس شبكات في الرياض.",
  "ما هو المنفذ الافتراضي لبروتوكول HTTPS؟",
  "اقترح طريقة لتنظيم ملفات القسم على الشبكة المشتركة.",
  "اكتب فقرة عن أهمية التوعية الأمنية للموظفين.",
  "ساعدني في كتابة خطة مشروع التخرج بشكل منظم.",
  "ما هو السر في نجاح فرق العمل عن بعد؟",
  "صمم جدولاً للمناوبات الأسبوعية لفريق من ستة أشخاص.",
  "اشرح الفرق بين التشفير المتماثل وغير المتماثل.",
  "العقد قيمته 1,250,000 ريال على ثلاث سنوات، احسب القيمة السنوية.",
  "الرقم المرجعي للطلب 4f9c2a1e-8b7d-4e3a-9c1f-2d5e6a7b8c9d، اكتب رسالة متابعة.",
  "اقترح أفكاراً لحملة توعية بالتصيد الاحتيالي في الجامعة."
].forEach(t => c("ar", t));

// generated clean look-alikes
for (let i = 0; i < 10; i++) {
  const pub = `${int(11, 99)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`; // not private, not org range
  c("en", pick([
    `Is ${pub} a known public resolver? I saw it in a blog post.`,
    `Explain what happens when a browser connects to ${pub}.`,
    `The vendor's public status page lists ${pub} as their CDN edge.`
  ]));
}
for (let i = 0; i < 10; i++) {
  c(i % 2 ? "en" : "ar", pick([
    `Version ${int(1, 9)}.${int(0, 20)}.${int(0, 40)} of the library adds dark mode.`,
    `الإصدار ${int(1, 9)}.${int(0, 20)}.${int(0, 40)} من التطبيق يحتوي على تحسينات في الأداء.`,
    `Chapter ${int(1, 12)}.${int(1, 9)} covers firewall basics.`,
    `Our budget grew by ${int(2, 30)}.${int(0, 9)}% compared to last year.`
  ]));
}

module.exports = { SENSITIVE: S, CLEAN: C };
