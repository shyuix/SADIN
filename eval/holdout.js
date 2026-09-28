/*
 * SADIN held-out corpus v1  (FROZEN)
 * Written after the engine was tuned on corpus.js and run exactly once.
 * Do not tune detectors against this file; report its numbers as-is.
 * New phrasings and formats not present in the development corpus.
 */
"use strict";
const S = [], C = [];
let n = 0, m = 0;
const s = (lang, text, expect, expectAction) => S.push({ id: "H" + (++n), lang, text, expect, expectAction: expectAction || null });
const c = (lang, text) => C.push({ id: "HC" + (++m), lang, text });

s("en", `Windows IP Configuration
Ethernet adapter Ethernet0:
   IPv4 Address. . . . . . . . . . . : 10.201.14.33
   Default Gateway . . . . . . . . . : 10.201.14.1
   DNS Servers . . . . . . . . . . . : 10.201.0.10
Why is DNS so slow on this machine?`, [["NETWORK", "10.201.14.33"], ["NETWORK", "10.201.14.1"], ["NETWORK", "10.201.0.10"]]);

s("en", `apiVersion: v1
kind: Secret
metadata:
  name: payments-db
stringData:
  username: pay_svc
  password: Tr!pleSec_4410
Is this manifest correct?`, [["CREDENTIAL", "Tr!pleSec_4410"]]);

s("en", `{"ts":"2026-09-20T10:14:02Z","level":"error","msg":"auth failed","user":"k.almutairi@corp.example.sa","src_ip":"172.24.9.61"}
explain this log line`, [["ACCOUNT", "k.almutairi@corp.example.sa"], ["NETWORK", "172.24.9.61"]]);

s("en", `ssh -i ~/.ssh/id_rsa deploy@192.168.200.14 -p 2222 fails with "connection refused"`, [["NETWORK", "192.168.200.14"], ["NETWORK", "2222"]]);

s("en", `Here's our nginx upstream block, why 504?
upstream backend {
  server app-prod-02.internal:8081;
  server app-prod-03.internal:8081;
}`, [["NETWORK", "app-prod-02.internal"], ["NETWORK", "app-prod-03.internal"], ["NETWORK", "8081"]]);

s("en", `mysql -h 10.9.3.3 -u root -pKh4lid!Root2026 inventory`, [["NETWORK", "10.9.3.3"], ["CREDENTIAL", "Kh4lid!Root2026"]]);

s("en", `Anthropic key sk-ant-api03-Q9xLm2Kp7Vn4Rt8Wz1Yb5Hc3Jd6Fg0Sa2Qe4Rt6Yu8Io keeps hitting rate limits`,
  [["CREDENTIAL", "sk-ant-api03-Q9xLm2Kp7Vn4Rt8Wz1Yb5Hc3Jd6Fg0Sa2Qe4Rt6Yu8Io"]]);

s("en", `CONFIDENTIAL
Q4 penetration test report: 3 critical findings on the payment gateway. Rewrite for executives.`, [["CLASSIFIED", "CONFIDENTIAL"]], "block");

s("en", `Security classification - Secret. Minutes of the crisis committee. Please shorten.`, [["CLASSIFIED", "Security classification - Secret"]], "block");

s("en", `The shared mailbox password was changed to Summer#2026ops yesterday, but Outlook still prompts.`, [["CREDENTIAL", "Summer#2026ops"]]);

s("en", `Terraform output:
db_endpoint = "erp-db.cluster.internal"
db_admin_password = "Zx8#vB2!nM4q"`, [["NETWORK", "erp-db.cluster.internal"], ["CREDENTIAL", "Zx8#vB2!nM4q"]]);

s("en", `ACL on the core switch:
permit tcp 10.50.0.0 0.0.255.255 host 10.50.1.25 eq 22
deny ip any any log`, [["NETWORK", "10.50.0.0"], ["NETWORK", "10.50.1.25"], ["NETWORK", "22"]]);

s("en", `Our VPN portal is vpn.corp.example.sa and my badge is EMP-220913. Write a ticket saying I can't log in.`,
  [["NETWORK", "vpn.corp.example.sa"], ["ACCOUNT", "EMP-220913"]]);

s("en", `Grafana datasource: url http://prometheus.monitoring.lan:9090 basic auth grafana / Gr@fana!77`,
  [["NETWORK", "prometheus.monitoring.lan"], ["NETWORK", "9090"], ["CREDENTIAL", "Gr@fana!77"]]);

s("en", `git remote -v shows https://ci-bot:glpat-x8Hk2Lm9Qz3Vn7Rt1Wb4@git.corp.example.sa/infra/net.git — how do I rotate this?`,
  [["CREDENTIAL", "glpat-x8Hk2Lm9Qz3Vn7Rt1Wb4"], ["NETWORK", "git.corp.example.sa"]]);

s("en", `Firewall export row: 1042, allow, 172.29.4.0/24, 172.29.8.12, TCP/5985, WinRM for admins`,
  [["NETWORK", "172.29.4.0"], ["NETWORK", "172.29.8.12"], ["NETWORK", "5985"]]);

s("en", `The ESXi host esxi-07 at 10.77.0.27 lost its datastore. Troubleshooting steps?`,
  [["NETWORK", "esxi-07"], ["NETWORK", "10.77.0.27"]]);

s("en", `Azure storage: DefaultEndpointsProtocol=https;AccountName=corpbackups;AccountKey=Qm9vX2tleV9mb3JfdGVzdGluZ19vbmx5X2RvX25vdF91c2U=;EndpointSuffix=core.windows.net`,
  [["CREDENTIAL", "Qm9vX2tleV9mb3JfdGVzdGluZ19vbmx5X2RvX25vdF91c2U="]]);

s("en", `RESTRICTED
Access review for the finance share, list of users with write permission. Make it a table.`, [["CLASSIFIED", "RESTRICTED"]], "block");

s("en", `radius-server key R4d!usKey2026 — the WLC won't authenticate clients, why?`, [["CREDENTIAL", "R4d!usKey2026"]]);

// Arabic
s("ar", `هذا ناتج أمر ipconfig على جهازي: عنوان IPv4 هو 192.168.15.44 والبوابة 192.168.15.1. لماذا لا أصل للإنترنت؟`,
  [["NETWORK", "192.168.15.44"], ["NETWORK", "192.168.15.1"]]);

s("ar", `اسم المستخدم: t.alshammari
كلمة السر: Najran#8821
لا أستطيع الدخول إلى نظام الحضور.`, [["ACCOUNT", "t.alshammari"], ["CREDENTIAL", "Najran#8821"]]);

s("ar", `سري
خطة نقل مركز البيانات إلى الموقع الاحتياطي. استخرج الجدول الزمني فقط.`, [["CLASSIFIED", "سري"]], "block");

s("ar", `درجة السرية: سري للغاية — تقرير عن الحادثة الأمنية الأخيرة. لخصه.`, [["CLASSIFIED", "درجة السرية: سري للغاية"]], "block");

s("ar", `مستند مصنف يحتوي على عقود التوريد، أريد ترجمته للإنجليزية.`, [["CLASSIFIED", "مستند مصنف"]], "block");

s("ar", `الخادم الداخلي hr-prod-02.corp.example.sa يعطي خطأ 500 عند رفع الملفات، ما الحل؟`, [["NETWORK", "hr-prod-02.corp.example.sa"]]);

s("ar", `أعطني أمر لفتح المنفذ رقم 3389 على الجهاز 10.14.2.8 فقط لفريق الدعم.`, [["NETWORK", "3389"], ["NETWORK", "10.14.2.8"]]);

s("ar", `مفتاح الـ API الخاص بنا هو AKIAZ7Q2MLK4RT9XNB3W ويظهر خطأ في الصلاحيات.`, [["CREDENTIAL", "AKIAZ7Q2MLK4RT9XNB3W"]]);

s("ar", `أرسل تذكيراً إلى r.aldosari@corp.example.sa بخصوص تحديث كلمة المرور.`, [["ACCOUNT", "r.aldosari@corp.example.sa"]]);

s("ar", `إعدادات الراوتر: hostname FW-EDGE-01 و enable secret 5 $1$aB3d$Qw9Zx7Vn2Lm4Kp8Rt1Yb0.`,
  [["NETWORK", "FW-EDGE-01"], ["CREDENTIAL", "$1$aB3d$Qw9Zx7Vn2Lm4Kp8Rt1Yb0."]]);

// ---------------- CLEAN ----------------
[
  "What is the capital of Japan and its population?",
  "Explain how DHCP assigns addresses on a home network.",
  "Write a password strength meter in JavaScript.",
  "Our office moved to King Fahd Road, write an announcement.",
  "What's the typical salary range for a SOC analyst in Saudi Arabia? Just general info.",
  "Summarise the article about renewable energy in NEOM.",
  "Use 10 bullet points to explain phishing to employees.",
  "How do I change the default port of an Apache server in general?",
  "Convert this to a table: Monday gym, Tuesday study, Wednesday rest.",
  "What does the error 'permission denied (publickey)' usually mean?",
  "Draft a thank-you note to the hackathon organisers.",
  "Explain the OSI model layers with one example each.",
  "Recommend three books on leadership.",
  "The secret ingredient in kabsa is loomi. Share a recipe.",
  "What is the difference between a public and a private IP address?",
  "Write an email declining a meeting politely.",
  "Explain what a hash function is and give SHA-256 as an example.",
  "Plan a study schedule for the CCNA exam over 10 weeks.",
  "How does MFA reduce account takeover?",
  "Our Wi-Fi is slow in the afternoon. What general causes should I check?",
  "Make a checklist for onboarding a new employee.",
  "What is the time difference between Riyadh and London?",
  "Write a haiku-free short poem about the desert.",
  "Explain 'least privilege' with a simple example.",
  "Give me Excel formulas to calculate a running total."
].forEach(t => c("en", t));
[
  "ما الفرق بين عنوان IP العام والخاص؟",
  "اكتب رسالة ترحيب بالموظفين الجدد.",
  "اشرح طريقة عمل الجدار الناري بشكل مبسط.",
  "ما هي أفضل الممارسات لإنشاء كلمة مرور قوية؟",
  "لخص لي فوائد الحوسبة السحابية للشركات الصغيرة.",
  "اقترح عناوين لورشة عمل عن الأمن السيبراني.",
  "كيف أكتب سيرة ذاتية مناسبة لوظيفة محلل أمن؟",
  "ما هي سرية البيانات وسلامتها وتوافرها؟",
  "المشروع سري التنفيذ بطبيعته لأنه مفاجأة للمدير؟ لا، أقصد أنه مفاجأة. اكتب دعوة للحفل.",
  "اشرح ما هو المنفذ في الشبكات بشكل عام.",
  "رتب لي جدول مذاكرة للاختبارات النهائية.",
  "ما معنى التصنيف في تعلم الآلة؟",
  "اكتب تغريدة عن اليوم الوطني.",
  "ما هي خطوات الاستجابة للحوادث بشكل عام؟",
  "كيف أحسن سرعة الإنترنت في المنزل؟",
  "الحد الأقصى لحجم الملف 20 ميجابايت، كيف أضغط ملف PDF؟",
  "اشرح بروتوكول HTTPS وكيف يحمي البيانات.",
  "ما هي أشهر لغات البرمجة لتحليل البيانات؟",
  "اكتب ملخصاً عن تاريخ مدينة أبها.",
  "كيف أتعامل مع ضغط العمل في نهاية الفصل؟",
  "ما الفرق بين الفيروس ودودة الحاسوب؟",
  "اقترح أسماء عربية لتطبيق أمني.",
  "حوّل هذه القائمة إلى جدول: قهوة، شاي، ماء.",
  "اشرح مفهوم انعدام الثقة في الشبكات.",
  "ما هي مزايا التوقيع الرقمي؟"
].forEach(t => c("ar", t));

module.exports = { SENSITIVE: S, CLEAN: C };
