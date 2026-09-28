/*
 * SADIN detection and redaction engine
 * ------------------------------------
 * Pure JavaScript, no dependencies. The same file runs in three places:
 *   - the browser extension (content script, attaches to globalThis.SadinEngine)
 *   - the on-prem inspection server (Node, require())
 *   - the evaluation harness (Node, require())
 *
 * It never sends content anywhere. It returns findings and a redacted copy.
 * Findings carry the category, detector id and character span, but the log
 * layer only records categories and counts, never the matched values.
 */
(function (root) {
  "use strict";

  // Arabic letters (used instead of \b, which does not work for Arabic script)
  var AR = "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF";
  var NOT_AR_BEFORE = "(?<![" + AR + "])";
  var NOT_AR_AFTER = "(?![" + AR + "])";

  // ---------------------------------------------------------------------------
  // Default policy. Organisations override it through Chrome managed storage
  // (see managed_schema.json) or the policy server.
  // ---------------------------------------------------------------------------
  var DEFAULT_POLICY = {
    version: "0.4.0",
    // Organisation-specific identifiers. Example values only.
    orgDomains: ["corp.example.sa", "example.sa"],
    orgPublicCidrs: ["203.0.113.0/24"],
    employeeIdPattern: "\\bEMP-?\\d{5,6}\\b",
    // What happens per category
    actions: {
      CLASSIFIED: "block",
      CREDENTIAL: "redact",
      NETWORK: "redact",
      ACCOUNT: "redact",
      SECURITY_FINDING: "warn"
    },
    // Content SADIN cannot inspect locally (e.g. images when the OCR service
    // is unreachable) is blocked, not waved through.
    failClosed: true,
    ocrTolerant: false,
    entropy: { minLength: 24, minBits: 4.0 }
  };

  var CATEGORY_LABELS = {
    CLASSIFIED: { en: "Classified document", ar: "وثيقة مصنفة" },
    CREDENTIAL: { en: "Credential or secret", ar: "بيانات اعتماد أو مفتاح" },
    NETWORK: { en: "Internal network detail", ar: "تفاصيل الشبكة الداخلية" },
    ACCOUNT: { en: "Account identifier", ar: "معرّف حساب" },
    SECURITY_FINDING: { en: "Security finding", ar: "نتيجة أمنية" }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function ipToInt(ip) {
    var p = ip.split(".");
    if (p.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(p[i])) return null;
      var v = parseInt(p[i], 10);
      if (v > 255) return null;
      if (p[i].length > 1 && p[i][0] === "0") return null; // 010.1.1.1 is not an IP we trust
      n = n * 256 + v;
    }
    return n;
  }

  function inCidr(ip, cidr) {
    var parts = cidr.split("/");
    var base = ipToInt(parts[0]);
    var bits = parseInt(parts[1] || "32", 10);
    var v = ipToInt(ip);
    if (base === null || v === null) return false;
    var size = Math.pow(2, 32 - bits);
    return Math.floor(v / size) === Math.floor(base / size);
  }

  var PRIVATE_CIDRS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16"];

  function isPrivateIp(ip) {
    for (var i = 0; i < PRIVATE_CIDRS.length; i++) if (inCidr(ip, PRIVATE_CIDRS[i])) return true;
    return false;
  }

  function shannonBits(s) {
    var freq = {};
    for (var i = 0; i < s.length; i++) freq[s[i]] = (freq[s[i]] || 0) + 1;
    var h = 0;
    for (var k in freq) {
      var p = freq[k] / s.length;
      h -= p * Math.log2(p);
    }
    return h;
  }

  // Arabic-Indic (U+0660-0669) and Eastern Arabic-Indic (U+06F0-06F9) digits map
  // one-to-one to ASCII digits, and the Arabic decimal separator (U+066B) to ".".
  // The mapping keeps every character at the same offset, so spans found in the
  // normalised text redact the right characters in the original.
  function normalizeDigits(t) {
    return t.replace(/[\u0660-\u0669\u06F0-\u06F9\u066B]/g, function (ch) {
      var c = ch.charCodeAt(0);
      if (c === 0x066B) return ".";
      return String.fromCharCode(48 + (c >= 0x06F0 ? c - 0x06F0 : c - 0x0660));
    });
  }
  // Arabic word that tolerates optional diacritics (tashkeel) between letters
  var DIA = "[\\u064B-\\u0652\\u0670]*";
  function arw(word) { return word.split("").map(function (ch) { return ch === " " ? "\\s+" : ch + DIA; }).join(""); }
  function arAny(words) { return "(?:" + words.map(arw).join("|") + ")"; }
  // up to N Arabic words in between (e.g. "حق حساب الخدمة", "للواي فاي الداخلي")
  function arGap(n) { return "(?:\\s+[" + AR + "\\u064B-\\u0652]+){0," + n + "}"; }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ---------------------------------------------------------------------------
  // Detectors. Each returns spans {start, end} of the part to redact.
  //   group: which capture group is the sensitive value (0 = whole match)
  //   validate: optional check on the value / full match
  // ---------------------------------------------------------------------------
  function buildDetectors(policy) {
    var d = [];

    // ----- CREDENTIALS ------------------------------------------------------
    d.push({ id: "private_key_block", cat: "CREDENTIAL", label: "PRIVATE_KEY",
      re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/g });
    d.push({ id: "aws_access_key", cat: "CREDENTIAL", label: "AWS_KEY", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g });
    d.push({ id: "aws_secret", cat: "CREDENTIAL", label: "AWS_SECRET",
      re: /aws_secret_access_key\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, group: 1 });
    d.push({ id: "github_token", cat: "CREDENTIAL", label: "API_KEY", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g });
    d.push({ id: "openai_anthropic_key", cat: "CREDENTIAL", label: "API_KEY", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g });
    d.push({ id: "stripe_key", cat: "CREDENTIAL", label: "API_KEY", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g });
    d.push({ id: "slack_token", cat: "CREDENTIAL", label: "API_KEY", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g });
    d.push({ id: "google_api_key", cat: "CREDENTIAL", label: "API_KEY", re: /\bAIza[0-9A-Za-z_-]{35}\b/g });
    d.push({ id: "azure_conn", cat: "CREDENTIAL", label: "SECRET",
      re: /\b(?:AccountKey|SharedAccessKey|Password|Pwd)\s*=\s*([^;\s"']{6,})/gi, group: 1 });
    d.push({ id: "jwt", cat: "CREDENTIAL", label: "TOKEN", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g });
    d.push({ id: "bearer", cat: "CREDENTIAL", label: "TOKEN", re: /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{20,})/g, group: 1 });
    d.push({ id: "url_credentials", cat: "CREDENTIAL", label: "SECRET",
      re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|rediss|amqp|mssql|sqlserver|ftp|sftp|ldap|ldaps|https?):\/\/[^\s:@\/]+:([^\s@\/]+)@/gi, group: 1 });
    // key = value style secrets in configs, .env files, scripts
    d.push({ id: "assignment_secret", cat: "CREDENTIAL", label: "SECRET",
      re: /(?:\b|(?<=_))(?:password|passwd|pwd|pass|passphrase|secret|secret_key|client_secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|db_pass(?:word)?|psk|token)\b["']?\s*[:=]\s*["']?([^\s"',;]{4,})/gi, group: 1,
      validate: function (v) { return !/^(?:\*+|x{3,}|<[^>]*>|\$\{?[A-Z_]+\}?|null|none|true|false|changeme\?|required|optional|\[redacted\]|redacted)$/i.test(v); } });
    // Cisco / network device secrets: "password 7 0822455D0A16", "secret 5 $1$...", "pre-shared-key cisco123"
    d.push({ id: "device_secret", cat: "CREDENTIAL", label: "SECRET",
      re: /\b(?:enable\s+)?(?:password|secret)\s+[0-9]\s+(\S+)/gi, group: 1 });
    d.push({ id: "psk", cat: "CREDENTIAL", label: "SECRET",
      re: /\b(?:pre-shared-key|pre-share-key|key-string|ikev2 authentication key|wpa-psk|wpa2-psk)\s+(?:(?:address\s+\S+\s+)?(?:key\s+)?(?:[0-9]\s+)?)(\S+)/gi, group: 1 });
    d.push({ id: "device_key", cat: "CREDENTIAL", label: "SECRET",
      re: /\b(?:crypto isakmp key|tacacs-server key|radius-server key|authentication-key|message-digest-key\s+\d+\s+md5|key\s+[0-9]\s+(?=\S{6,}))\s*(?:[0-9]\s+)?(\S+)/gi, group: 1 });
    d.push({ id: "snmp_community", cat: "CREDENTIAL", label: "SECRET",
      re: /\bsnmp-server\s+community\s+(\S+)/gi, group: 1 });
    d.push({ id: "username_password_line", cat: "CREDENTIAL", label: "SECRET",
      re: /\busername\s+\S+\s+(?:privilege\s+\d+\s+)?(?:password|secret)\s+(?:[0-9]\s+)?(\S+)/gi, group: 1 });
    // Natural language: "my password is X", "كلمة المرور هي X"
    d.push({ id: "password_is", cat: "CREDENTIAL", label: "SECRET",
      re: /\b(?:password|passcode|pin|passphrase)\s+(?:(?:was |is |has been )?(?:changed|set|reset|updated) to|will be|should be|is|was|=|:)\s+["'“]?([^\s"'”,;]{6,})/gi, group: 1,
      validate: function (v) { return /[\d\W_]/.test(v) && !/^(?:required|incorrect|expired|wrong|correct|changed|reset)$/i.test(v); } });
    d.push({ id: "ar_password_is", cat: "CREDENTIAL", label: "SECRET",
      re: new RegExp("(?:كلمة\\s*(?:المرور|السر)|الرقم\\s*السري)\\s+(?:هي|هو|كانت|الجديدة)\\s+([^\\s،,]{6,})", "g"), group: 1,
      validate: function (v) { return /[A-Za-z0-9]/.test(v); } });
    // Command-line secrets: mysql -pSECRET, --password=SECRET, basic auth user / pass
    d.push({ id: "cli_password", cat: "CREDENTIAL", label: "SECRET",
      re: /(?:\bmysql(?:dump)?\b[^\n]*?\s-p([^\s-][^\s]{3,})|--password[= ]([^\s]{4,})|\bbasic auth\s+\S+\s*[\/:]\s*(\S{4,}))/gi, group: -1 });
    // Arabic: "كلمة المرور: X" (colon required, to avoid matching ordinary sentences)
    d.push({ id: "ar_password", cat: "CREDENTIAL", label: "SECRET",
      re: new RegExp("(?:كلمة\\s*(?:المرور|السر)|الرقم\\s*السري|الرمز\\s*السري)\\s*[:：=]\\s*(\\S+)", "g"), group: 1 });

    // ----- NETWORK ----------------------------------------------------------
    d.push({ id: "private_ipv4", cat: "NETWORK", label: "INTERNAL_IP",
      re: /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?:\/(?:[12]?\d|3[0-2]))?(?![\d.]*\d)/g,
      validate: function (v, m) { var ip = m[1]; return ipToInt(ip) !== null && isPrivateIp(ip); } });
    d.push({ id: "org_public_ip", cat: "NETWORK", label: "ORG_IP",
      re: /(?<![\d.])((?:\d{1,3}\.){3}\d{1,3})(?:\/(?:[12]?\d|3[0-2]))?(?![\d.]*\d)/g,
      validate: function (v, m) {
        var ip = m[1];
        if (ipToInt(ip) === null || isPrivateIp(ip)) return false;
        for (var i = 0; i < policy.orgPublicCidrs.length; i++) if (inCidr(ip, policy.orgPublicCidrs[i])) return true;
        return false;
      } });
    d.push({ id: "ipv6_ula", cat: "NETWORK", label: "INTERNAL_IP", re: /\bf[cd][0-9a-f]{2}:[0-9a-f:]{2,}\b/gi });
    d.push({ id: "mac_address", cat: "NETWORK", label: "MAC", re: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b|\b(?:[0-9a-f]{4}\.){2}[0-9a-f]{4}\b/g });
    var orgDom = policy.orgDomains.map(escapeRe).join("|");
    d.push({ id: "internal_hostname", cat: "NETWORK", label: "HOSTNAME",
      re: new RegExp("\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:local|lan|corp|internal|intranet|localdomain|home\\.arpa|" + orgDom + ")\\b(?![.-]?[a-z0-9])", "gi"),
      validate: function (v) {
        // public web addresses of the organisation (www.example.sa) are not secrets
        return !/^(?:www|mail|portal)\.(?:[a-z0-9-]+\.)?(?:sa|com)$/i.test(v) || /\.(local|lan|corp|internal|intranet)$/i.test(v);
      } });
    // Host naming conventions: DC01, SRV-DB-02, fw-core-1, esxi-03
    d.push({ id: "host_convention", cat: "NETWORK", label: "HOSTNAME",
      re: /\b(?:(?:srv|dc|db|fw|sw|rtr|vpn|esxi?|vc|sql|ad|exch|nas|san|hq|br)-[a-z0-9-]*\d+|[a-z]{2,8}-(?:prod|dev|stg|stage|test|uat|qa|dr|core|edge|node)-?\d+|(?:dc|srv|fw|sw|rtr|esx|nas)\d{2,})\b/gi });
    d.push({ id: "port_context", cat: "NETWORK", label: "PORT",
      re: /\b(?:port|ports|dport|sport|dst-port|src-port|eq|range|listen|expose|bind)\s*[:=]?\s*(\d{1,5})\b/gi, group: 1,
      validate: function (v) { var n = parseInt(v, 10); return n > 0 && n <= 65535; } });
    d.push({ id: "ar_port", cat: "NETWORK", label: "PORT",
      re: new RegExp("(?:^|[^" + AR + "]|و|ب|ل|على\\s)(?:ال)?(?:منفذ|منافذ)\\s*(?:رقم\\s*)?[:=]?\\s*(\\d{1,5})(?!\\d)", "g"), group: 1,
      validate: function (v) { var n = parseInt(v, 10); return n > 0 && n <= 65535; } });
    d.push({ id: "host_port", cat: "NETWORK", label: "PORT",
      re: /(?:(?:\d{1,3}\.){3}\d{1,3}|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:local|lan|corp|internal)|\blocalhost):(\d{2,5})\b/gi, group: 1 });
    d.push({ id: "proto_port_rev", cat: "NETWORK", label: "PORT", re: /\b(?:tcp|udp)\/(\d{1,5})\b/gi, group: 1 });
    d.push({ id: "cli_port", cat: "NETWORK", label: "PORT", re: /\b(?:ssh|scp|sftp|psql|mysql|nc|telnet)\b[^\n]*?\s-[pP]\s*(\d{1,5})\b/g, group: 1 });
    d.push({ id: "proto_port", cat: "NETWORK", label: "PORT", re: /\b(\d{1,5})\/(?:tcp|udp)\b/gi, group: 1 });

    if (policy.ocrTolerant) {
      // OCR adds or drops digits; inside an image a private-range dotted quad is
      // still a private address even if an octet came back malformed
      d.push({ id: "ocr_private_ip", cat: "NETWORK", label: "INTERNAL_IP",
        re: /(?<![\d.])(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,4}){2,3}(?![\d.]*[a-z])/gi });
    }

    // ----- ACCOUNT ----------------------------------------------------------
    d.push({ id: "org_email", cat: "ACCOUNT", label: "ACCOUNT",
      re: new RegExp("(?<![^\\s<(\"'\\[,;])[a-z0-9._%+-]+@(?:[a-z0-9-]+\\.)*(?:" + orgDom + ")\\b", "gi") });
    d.push({ id: "domain_account", cat: "ACCOUNT", label: "ACCOUNT", re: /\b[A-Z][A-Z0-9-]{1,14}\\[A-Za-z][A-Za-z0-9._-]{1,30}\b/g });
    d.push({ id: "employee_id", cat: "ACCOUNT", label: "EMPLOYEE_ID", re: new RegExp(policy.employeeIdPattern, "gi") });
    d.push({ id: "ar_username", cat: "ACCOUNT", label: "ACCOUNT",
      re: /(?:اسم\s*المستخدم|المستخدم|الحساب)\s*[:：]\s*([A-Za-z0-9._\\-]{3,})/g, group: 1 });
    d.push({ id: "config_username", cat: "ACCOUNT", label: "ACCOUNT",
      re: /\b(?:username|user(?:name)?\s*[:=]|login\s*[:=]|uid\s*[:=])\s*["']?([A-Za-z0-9._\\-]{3,})/gi, group: 1,
      validate: function (v) { return !/^(?:password|secret|privilege|admin_required|name|the|your|and|to)$/i.test(v); } });

    // ----- CLASSIFIED -------------------------------------------------------
    // NDMO levels: Top Secret / Secret / Restricted (Public is not sensitive)
    d.push({ id: "label_en_caps", cat: "CLASSIFIED", label: "CLASSIFIED",
      re: /\b(?:TOP SECRET|SECRET|CONFIDENTIAL|STRICTLY CONFIDENTIAL|RESTRICTED|INTERNAL USE ONLY|FOR OFFICIAL USE ONLY)\b(?!\s*[:=]\s*\S)/g,
      validate: function (v, m, text) {
        // only when written as a marking: all caps and not inside a code identifier
        var before = text.slice(Math.max(0, m.index - 1), m.index);
        return !/[A-Za-z_]/.test(before);
      } });
    d.push({ id: "label_en_field", cat: "CLASSIFIED", label: "CLASSIFIED",
      re: /\b(?:classification|classified as|security classification|sensitivity|marking)\s*[:\-]?\s*(top secret|secret|confidential|restricted)\b/gi });
    d.push({ id: "label_ar_top", cat: "CLASSIFIED", label: "CLASSIFIED",
      re: new RegExp(NOT_AR_BEFORE + "سري\\s+(?:للغاية|جدا|جداً|جدًا)" + NOT_AR_AFTER, "g") });
    d.push({ id: "label_ar_field", cat: "CLASSIFIED", label: "CLASSIFIED",
      re: new RegExp("(?:التصنيف|درجة\\s*السرية|مستوى\\s*التصنيف|تصنيف\\s*الوثيقة)\\s*[:：\\-]?\\s*(?:سري\\s*للغاية|سري|مقيد|محدود)" + NOT_AR_AFTER, "g") });
    // A standalone marking line, e.g. a stamp "سري" or "مقيد" alone on a line
    d.push({ id: "label_ar_line", cat: "CLASSIFIED", label: "CLASSIFIED",
      re: new RegExp("(?:^|\\n)[\\s\\-–—*«»\"()]*(?:سري|مقيد|سري ومحدود|سري وشخصي)[\\s\\-–—*«»\"()]*(?=\\n|$)", "g") });
    d.push({ id: "label_ar_inline", cat: "CLASSIFIED", label: "CLASSIFIED",
      re: new RegExp("(?:وثيقة|مستند|ملف|خطاب|تقرير|معلومات)\\s+(?:سرية|مصنفة|مصنف|سري)" + NOT_AR_AFTER, "g") });

    // ----- SECURITY FINDINGS -----------------------------------------------
    d.push({ id: "scan_output", cat: "SECURITY_FINDING", label: "FINDING",
      re: /(?:Nmap scan report for\s+\S+|\b\d{1,5}\/(?:tcp|udp)\s+open\b|\bVULNERABLE\b|\bCVSS(?:v3)?\s*[:=]?\s*\d+(?:\.\d)?|\bCVE-\d{4}-\d{4,7}\b(?=[\s\S]{0,120}(?:unpatched|vulnerable|affected|not patched|غير مرقع|مصاب)))/gi,
      redact: false });
    d.push({ id: "pentest_marker", cat: "SECURITY_FINDING", label: "FINDING",
      re: /\b(?:penetration test(?:ing)? (?:report|findings)|pentest findings|vulnerability assessment report|incident report|SIEM alert)\b|تقرير\s+(?:اختبار\s+الاختراق|الثغرات|الحادثة)/gi,
      redact: false });

    // ----- ARABIC (v0.4.0) ------------------------------------------------
    // Saudi workplace phrasing, formal and colloquial. Values are the Latin/ASCII
    // token that follows the keyword, possibly after a few Arabic words.
    var AR_PW = arAny(["كلمة المرور", "كلمة مرور", "كلمة السر", "كلمة سر", "كلمات المرور", "الرقم السري", "الرمز السري",
                       "الباسوورد", "باسوورد", "الباسورد", "باسورد", "الباس", "رمز الدخول"]);
    d.push({ id: "ar_password_ctx", cat: "CREDENTIAL", label: "SECRET",
      re: new RegExp(NOT_AR_BEFORE + "(?:و|ب|ل)?" + AR_PW + NOT_AR_AFTER + arGap(4) + "\\s*(?:[:：=]\\s*|\\s+(?:" + arAny(["هو", "هي", "كانت", "كان", "صار", "صارت"]) + "\\s+)?)[\"'«]?([!-~]{6,})", "g"), group: 1,
      validate: function (v) {
        v = v.replace(/[\"'»،,.؟?]+$/, "");
        if (v.length < 6 || PLACEHOLDER.test(v)) return false;
        var cls = (/[A-Za-z]/.test(v) ? 1 : 0) + (/\d/.test(v) ? 1 : 0) + (/[^A-Za-z0-9]/.test(v) ? 1 : 0);
        return cls >= 2 && !/^https?:/i.test(v);
      } });
    var AR_USER = arAny(["اسم المستخدم", "المستخدم", "اليوزر", "يوزر", "اليوزرنيم", "الحساب", "حساب", "اسم الدخول"]);
    d.push({ id: "ar_account_ctx", cat: "ACCOUNT", label: "ACCOUNT",
      re: new RegExp(NOT_AR_BEFORE + "(?:و|ب|ل|على\\s)?" + AR_USER + NOT_AR_AFTER + arGap(3) + "\\s*(?:[:：=]\\s*|\\s+(?:" + arAny(["هو", "هي"]) + "\\s+)?)([A-Za-z][A-Za-z0-9._-]{2,40})", "g"), group: 1,
      validate: function (v) { return /[._\d]/.test(v) && !/^(?:e\.g|i\.e)$/i.test(v); } });
    d.push({ id: "ar_hostname_ctx", cat: "NETWORK", label: "HOSTNAME",
      re: new RegExp("(?:" + arAny(["اسم الجهاز", "اسم الخادم", "اسم السيرفر", "اسم المضيف"]) + "|" + arAny(["الجهاز", "الخادم", "السيرفر"]) + "\\s+" + arw("اسمه") + ")\\s*[:：]?\\s*([A-Za-z][A-Za-z0-9-]{2,62})", "g"), group: 1,
      validate: function (v) { return /\d/.test(v) || /-/.test(v); } });
    // Port lists: "المنافذ 21 و22 و3389", "البورتات: 22، 80، 443"
    d.push({ id: "ar_port_list", cat: "NETWORK", label: "PORT",
      re: new RegExp(arAny(["المنافذ", "منافذ", "البورتات", "بورتات", "المنفذين"]) + arGap(4) + "\\s*[:：]?\\s*((?:\\d{1,5}\\s*(?:[،,]|و|and)\\s*)+\\d{1,5})(?!\\d)", "g"), group: 1,
      multi: true });
    d.push({ id: "ar_port_colloquial", cat: "NETWORK", label: "PORT",
      re: new RegExp(NOT_AR_BEFORE + "(?:و|ب|ل)?(?:ال)?" + arAny(["بورت"]) + "\\s*(?:رقم\\s*)?[:=]?\\s*(\\d{1,5})(?!\\d)", "g"), group: 1,
      validate: function (v) { var n = parseInt(v, 10); return n > 0 && n <= 65535; } });
    // Arabic security findings: a CVE next to "unpatched / vulnerability" wording,
    // and Arabic report titles
    d.push({ id: "ar_cve_context", cat: "SECURITY_FINDING", label: "FINDING",
      re: new RegExp("CVE-\\d{4}-\\d{4,7}(?=[\\s\\S]{0,120}(?:رق" + DIA + "ع|ثغر|مصاب|قابل" + DIA + "ة? للاستغلال))|(?:رق" + DIA + "ع|ثغر" + DIA + "ة|ثغرات|مصاب)[\\s\\S]{0,120}?(CVE-\\d{4}-\\d{4,7})", "gi"), group: -1,
      redact: false });
    d.push({ id: "ar_finding_title", cat: "SECURITY_FINDING", label: "FINDING",
      re: new RegExp(arAny(["تقرير", "نتائج", "نتيجة", "مخرجات", "ملخص"]) + "\\s+" + arAny(["اختبار الاختراق", "اختبارات الاختراق", "فحص الثغرات", "الثغرات", "الحادثة", "الحادثة الأمنية", "تقييم الثغرات"]), "g"),
      redact: false });

    // ----- High-entropy fallback ------------------------------------------
    d.push({ id: "high_entropy", cat: "CREDENTIAL", label: "SECRET",
      re: /(?<![A-Za-z0-9_\-\/+=.])[A-Za-z0-9_\-+\/=]{24,}(?![A-Za-z0-9_\-\/+=])/g,
      validate: function (v) {
        if (v.length < policy.entropy.minLength) return false;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return false; // UUID
        if (/^[A-Za-z]+$/.test(v) || /^\d+$/.test(v)) return false; // plain words / numbers
        if (/^[a-z]+(?:[-_][a-z]+)+$/i.test(v)) return false;        // kebab/snake words
        if (/\//.test(v) && /^[\w\-]+(?:\/[\w\-.]+)+$/.test(v) && !/\d.*[A-Z]|[A-Z].*\d/.test(v)) return false; // paths
        var classes = (/[a-z]/.test(v) ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) + (/\d/.test(v) ? 1 : 0);
        if (classes < 3) return false;
        return shannonBits(v) >= policy.entropy.minBits;
      } });

    // hasIndices ("d") gives exact capture-group offsets
    d.forEach(function (x) { if (x.re.flags.indexOf("d") < 0) x.re = new RegExp(x.re.source, x.re.flags + "d"); });
    return d;
  }

  // ---------------------------------------------------------------------------
  // Scan
  // ---------------------------------------------------------------------------
  function scan(text, policyOverride) {
    var t0 = now();
    var policy = mergePolicy(policyOverride);
    var detectors = getDetectors(policy);
    var findings = [];
    if (typeof text !== "string" || text.length === 0) return result(text || "", [], policy, t0);

    var src = normalizeDigits(text);
    for (var i = 0; i < detectors.length; i++) {
      var det = detectors[i];
      det.re.lastIndex = 0;
      var m;
      var guard = 0;
      while ((m = det.re.exec(src)) !== null && guard++ < 20000) {
        if (m[0].length === 0) { det.re.lastIndex++; continue; }
        var g = det.group || 0;
        if (g === -1) { g = 0; for (var gi = 1; gi < m.length; gi++) if (m[gi] !== undefined) { g = gi; break; } }
        var value = m[g];
        if (value === undefined) continue;
        if (PLACEHOLDER.test(value)) continue;          // never re-flag our own placeholders
        if (det.validate && !det.validate(value, m, src)) continue;
        var start = (m.indices && m.indices[g]) ? m.indices[g][0] : m.index + m[0].lastIndexOf(value);
        if (det.multi) {
          // one finding per number inside a matched list
          var nre = /\d{1,5}/g, nm;
          while ((nm = nre.exec(value)) !== null) {
            var pv = parseInt(nm[0], 10);
            if (pv < 1 || pv > 65535) continue;
            findings.push({ detector: det.id, category: det.cat, label: det.label,
              start: start + nm.index, end: start + nm.index + nm[0].length, redact: det.redact !== false });
          }
          continue;
        }
        // trailing punctuation is not part of a secret
        if (det.cat === "CREDENTIAL" && /^ar_/.test(det.id)) value = value.replace(/[\"'»،,.؟?]+$/, "");
        findings.push({
          detector: det.id, category: det.cat, label: det.label,
          start: start, end: start + value.length,
          redact: det.redact !== false
        });
      }
    }
    findings = resolveOverlaps(findings);
    return result(text, findings, policy, t0);
  }

  var PLACEHOLDER = /^\[[A-Z_]+_\d+\]$/;

  var CAT_PRIORITY = { CLASSIFIED: 5, CREDENTIAL: 4, ACCOUNT: 3, NETWORK: 2, SECURITY_FINDING: 1 };

  function resolveOverlaps(f) {
    // keep non-redacting findings (they mark context), dedupe redacting spans:
    // longer span wins, then higher category priority
    var ctx = f.filter(function (x) { return !x.redact; });
    var red = f.filter(function (x) { return x.redact; }).sort(function (a, b) {
      return (b.end - b.start) - (a.end - a.start) || CAT_PRIORITY[b.category] - CAT_PRIORITY[a.category];
    });
    var kept = [];
    for (var i = 0; i < red.length; i++) {
      var r = red[i], clash = false;
      for (var j = 0; j < kept.length; j++) {
        if (r.start < kept[j].end && kept[j].start < r.end) { clash = true; break; }
      }
      if (!clash) kept.push(r);
    }
    return kept.concat(ctx).sort(function (a, b) { return a.start - b.start; });
  }

  var ACTION_RANK = { allow: 0, warn: 1, redact: 2, block: 3 };

  function result(text, findings, policy, t0) {
    var cats = {};
    findings.forEach(function (x) { cats[x.category] = (cats[x.category] || 0) + 1; });
    var action = "allow";
    Object.keys(cats).forEach(function (c) {
      var a = policy.actions[c] || "warn";
      if (ACTION_RANK[a] > ACTION_RANK[action]) action = a;
    });
    // if the only findings are redactable, redact wins over warn
    var redacted = redact(text, findings);
    return {
      action: action,
      categories: cats,
      findings: findings,
      redactedText: action === "block" ? null : redacted.text,
      placeholders: redacted.count,
      ms: now() - t0
    };
  }

  function redact(text, findings) {
    var counters = {}, seen = {}, out = "", pos = 0, count = 0;
    var spans = findings.filter(function (x) { return x.redact; }).sort(function (a, b) { return a.start - b.start; });
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      if (s.start < pos) continue;
      var val = text.slice(s.start, s.end);
      var key = s.label + "\u0000" + val;
      if (!seen[key]) {
        counters[s.label] = (counters[s.label] || 0) + 1;
        seen[key] = "[" + s.label + "_" + counters[s.label] + "]";
      }
      out += text.slice(pos, s.start) + seen[key];
      pos = s.end;
      count++;
    }
    out += text.slice(pos);
    return { text: out, count: count };
  }

  // ---------------------------------------------------------------------------
  // Policy plumbing
  // ---------------------------------------------------------------------------
  var _cache = { key: null, detectors: null };
  function getDetectors(policy) {
    var key = JSON.stringify([policy.orgDomains, policy.orgPublicCidrs, policy.employeeIdPattern, policy.entropy, policy.ocrTolerant]);
    if (_cache.key !== key) { _cache.key = key; _cache.detectors = buildDetectors(policy); }
    return _cache.detectors;
  }

  function mergePolicy(p) {
    if (!p) return DEFAULT_POLICY;
    var out = JSON.parse(JSON.stringify(DEFAULT_POLICY));
    Object.keys(p).forEach(function (k) {
      if (k === "actions" || k === "entropy") out[k] = Object.assign({}, out[k], p[k]);
      else if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
    });
    return out;
  }

  function now() {
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  }

  var api = {
    scan: scan,
    DEFAULT_POLICY: DEFAULT_POLICY,
    CATEGORY_LABELS: CATEGORY_LABELS,
    _internals: { ipToInt: ipToInt, inCidr: inCidr, isPrivateIp: isPrivateIp, shannonBits: shannonBits }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SadinEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
