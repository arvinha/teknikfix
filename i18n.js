// Every page in more languages. Danish is the source; the rest are translated with Claude and kept on disk.
// Pages and scripts are translated as whole files when their Danish source changes (checked at start-up).
// Short server texts (prices, questions, status lines, e-mails) go through a string cache.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const OUT = path.join(ROOT, "i18n");
const MANIFEST = path.join(OUT, "manifest.json");
const STRINGS = path.join(OUT, "strings.json");
const VERSION = "3";
const MODEL = "claude-sonnet-5-5";
const FAST_MODEL = "claude-haiku-5-5";

const LANGS = {
  da: { name: "Dansk", english: "Danish", locale: "da-DK", og: "da_DK", country: "DK" },
  en: { name: "English", english: "English (British spelling, for readers all over Europe)", locale: "en-IE", og: "en_GB", country: "" },
  de: { name: "Deutsch", english: "German", locale: "de-DE", og: "de_DE", country: "DE" },
  sv: { name: "Svenska", english: "Swedish", locale: "sv-SE", og: "sv_SE", country: "SE" },
  fr: { name: "Français", english: "French", locale: "fr-FR", og: "fr_FR", country: "FR" },
  es: { name: "Español", english: "Spanish (Spain)", locale: "es-ES", og: "es_ES", country: "ES" },
  it: { name: "Italiano", english: "Italian", locale: "it-IT", og: "it_IT", country: "IT" },
  nl: { name: "Nederlands", english: "Dutch", locale: "nl-NL", og: "nl_NL", country: "NL" },
  pl: { name: "Polski", english: "Polish", locale: "pl-PL", og: "pl_PL", country: "PL" },
  fi: { name: "Suomi", english: "Finnish", locale: "fi-FI", og: "fi_FI", country: "FI" }
};
const CODES = Object.keys(LANGS);
const FOREIGN = CODES.filter((code) => code !== "da");

const EU = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];

const ROOTS = "book|sag|saelg|koeb|reservedele|priser|partner|kontakt|ydelser|om|betaling|handelsbetingelser|privatlivspolitik|[a-z0-9-]+-aalborg";
const PAGE_RE = new RegExp(`^/(?:${ROOTS})(?=[/?#]|$)`);
const LINK_RE = new RegExp(`(["'])/(${ROOTS})(?=[/?#"'&]|$)`, "g");

const SCRIPTS = ["site.js", "book.js", "finder.js", "labels.js", "reservedele.js", "saelg.js", "saelg-sag.js", "sag.js", "partner-opgaver.js"];
const FIRST_PAGES = ["index", "saelg", "reservedele", "book", "priser", "partner", "kontakt", "ydelser", "om", "betaling", "handelsbetingelser", "privatlivspolitik", "sag", "saelg-tak", "saelg-sag", "reservedele-tak", "book-tak", "404"];

function env(name) {
  return (process.env[name] || "").trim();
}

function enabled() {
  return env("ANTHROPIC_API_KEY").startsWith("sk-ant-");
}

// ---------- Paths ----------
function fromPath(urlPath) {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(urlPath || "");
  if (match && FOREIGN.includes(match[1])) return { lang: match[1], rest: match[2] || "" };
  return { lang: "da", rest: urlPath };
}

function isPagePath(p) {
  return p === "/" || PAGE_RE.test(p);
}

function pagePath(lang, p) {
  if (lang === "da" || !LANGS[lang]) return p;
  return p === "/" ? `/${lang}/` : `/${lang}${p}`;
}

function prefix(lang) {
  return lang && lang !== "da" && LANGS[lang] ? `/${lang}` : "";
}

function readCookie(req, name) {
  const match = new RegExp(`(?:^|;\\s*)${name}=([a-z]{2})`).exec(req.headers.cookie || "");
  return match ? match[1] : "";
}

function fromAcceptLanguage(header) {
  const wanted = String(header || "")
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { base: tag.split("-")[0].toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((item) => item.base && item.base !== "*")
    .sort((a, b) => b.q - a.q);
  if (!wanted.length) return "";
  for (const item of wanted) {
    if (LANGS[item.base]) return item.base;
    if (["nb", "nn", "no"].includes(item.base)) return "da";
  }
  return "en";
}

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse/i;

/** URL prefix (/en/...) decides the language of a page. API calls follow the page they were sent from. */
function middleware(req, res, next) {
  const { lang, rest } = fromPath(req.path);
  if (lang !== "da") {
    if (!rest) return res.redirect(301, `/${lang}/${req.url.slice(lang.length + 1)}`);
    req.lang = lang;
    req.url = rest + req.url.slice(lang.length + 1 + rest.length);
    return next();
  }
  if (req.path.startsWith("/api/")) {
    let fromRef = "";
    try {
      const ref = new URL(req.get("referer") || "");
      if (ref.host === req.get("host")) fromRef = fromPath(ref.pathname).lang;
    } catch (error) {
      fromRef = "";
    }
    req.lang = fromRef || readCookie(req, "tf_lang") || "da";
    if (!LANGS[req.lang]) req.lang = "da";
    return next();
  }
  req.lang = "da";
  if (req.method === "GET" && req.path === "/" && !readCookie(req, "tf_lang") && !BOT.test(req.get("user-agent") || "")) {
    const best = fromAcceptLanguage(req.get("accept-language"));
    if (best && best !== "da") {
      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      return res.redirect(302, `/${best}/${query}`);
    }
  }
  return next();
}

function rememberLang(res, lang) {
  res.append("Set-Cookie", `tf_lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`);
}

// ---------- Files ----------
let manifest = {};
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
} catch (error) {
  manifest = {};
}

function saveManifest() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = `${MANIFEST}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.rmSync(MANIFEST, { force: true });
  fs.renameSync(tmp, MANIFEST);
}

const hashMemo = new Map();
function sourceHash(rel) {
  const file = path.join(ROOT, rel);
  const stat = fs.statSync(file);
  const memo = hashMemo.get(rel);
  if (memo && memo.mtime === stat.mtimeMs) return memo.hash;
  const hash = crypto.createHash("sha256").update(VERSION).update(fs.readFileSync(file)).digest("hex").slice(0, 16);
  hashMemo.set(rel, { mtime: stat.mtimeMs, hash });
  return hash;
}

function outFile(lang, rel) {
  return path.join(OUT, lang, rel);
}

function fresh(lang, rel) {
  try {
    return Boolean(manifest[lang] && manifest[lang][rel] === sourceHash(rel) && fs.existsSync(outFile(lang, rel)));
  } catch (error) {
    return false;
  }
}

/** The file to read for this language: the translation when it is up to date, otherwise the Danish source. */
function source(lang, rel) {
  if (lang !== "da" && fresh(lang, rel)) return outFile(lang, rel);
  return path.join(ROOT, rel);
}

function read(lang, rel) {
  return fs.readFileSync(source(lang, rel), "utf8");
}

function assetTag(lang, rel) {
  return fresh(lang, rel) ? manifest[lang][rel].slice(0, 6) : "da";
}

// ---------- Claude ----------
let active = 0;
const waiting = [];
async function slot(fn) {
  if (active >= 6) await new Promise((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const nextUp = waiting.shift();
    if (nextUp) nextUp();
  }
}

async function claude({ system, user, maxTokens, model = MODEL }) {
  if (!enabled()) throw new Error("ANTHROPIC_API_KEY mangler");
  return slot(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system,
          thinking: { type: model === FAST_MODEL ? "disabled" : "between_tools" },
          messages: [{ role: "user", content: user }]
        }),
        signal: AbortSignal.timeout(600_000)
      }).catch((error) => ({ ok: false, status: 0, text: async () => error.message }));
      if (res.ok) {
        const body = await res.json();
        if (body.stop_reason === "max_tokens") throw new Error("svaret blev for langt");
        return (body.content || []).filter((block) => block.type === "text").map((block) => block.text).join("");
      }
      const detail = await res.text().catch(() => "");
      if (![0, 429, 500, 502, 503, 529].includes(res.status)) throw new Error(`Claude ${res.status}: ${detail.slice(0, 200)}`);
      await new Promise((resolve) => setTimeout(resolve, 4000 * 2 ** attempt));
    }
    throw new Error("Claude svarer ikke");
  });
}

function rules(lang) {
  const info = LANGS[lang];
  return [
    "You translate the website of TeknikFix, a small electronics repair workshop in Aalborg, Denmark.",
    "TeknikFix repairs phones, tablets and computers, buys used and broken devices from people and companies all over the EU, and sells spare parts with delivery across the EU.",
    `The source is Danish. Translate it into ${info.english}.`,
    "",
    "Style: plain, warm and short, like a friendly local shop that is easy to deal with. Use the form of address a modern consumer brand uses in that language. Sound natural, never like a word-for-word translation.",
    "Keep exactly as they are: HTML tags and attributes, {{TOKENS}}, @@PLACEHOLDERS@@, numbers, model and brand names (iPhone, Galaxy, Pixel, MacBook, iPad, Face ID, Touch ID), MobilePay, Klarna, PayPal, Apple Pay, Stripe, the name TeknikFix, the company name Axiom, Danish street and place names (Aalborg, Aalborg Øst, Nordjylland), e-mail addresses, phone numbers, URLs, keyboard codes like *#06#, and case numbers like AX-7K2P, SL-4FQ2 or RD-8QZWCY.",
    "Money is Danish kroner: write DKK instead of kr (\"499 kr\" becomes \"499 DKK\", \"fra 499 kr\" becomes the word for \"from\" plus \"499 DKK\").",
    "CVR is the Danish company register number. When it is TeknikFix's own number, keep \"CVR 46840992\". When the customer must type their company number, say company or VAT number in the target language.",
    "iPhone menu paths (Indstillinger → Generelt → Om) must use the names Apple uses in the target language.",
    "Repairs in person happen in Aalborg; that stays true in the translation. Do not invent new promises, prices or facts."
  ].join("\n");
}

// ---------- Markup checks ----------
function skeleton(html) {
  const parts = String(html).match(/<!--[\s\S]*?-->|<[^>]*>|<[^>]*$|^[^<]*>/g) || [];
  return parts.map((tag) =>
    tag
      .replace(/\s(alt|title|placeholder|aria-label|content|lang|label)="[^"]*"/g, ' $1=""')
      .replace(/\s+/g, " ")
      .trim()
  );
}

function tokens(text) {
  return (String(text).match(/\{\{[A-Z0-9_]+\}\}|@@[A-Z]+_\d+@@/g) || []).sort().join(",");
}

function sameMarkup(a, b) {
  const left = skeleton(a);
  const right = skeleton(b);
  if (left.length !== right.length) return `antal tags ${left.length} mod ${right.length}`;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return `tag ${i + 1}: ${left[i].slice(0, 120)} blev til ${right[i].slice(0, 120)}`;
  }
  if (tokens(a) !== tokens(b)) return "pladsholdere ({{...}}) blev ændret";
  return "";
}

// ---------- String cache ----------
let strings = {};
try {
  strings = JSON.parse(fs.readFileSync(STRINGS, "utf8"));
} catch (error) {
  strings = {};
}
const memory = new Map();
let saveTimer = null;

function saveStrings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(OUT, { recursive: true });
    const tmp = `${STRINGS}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(strings, null, 1) + "\n");
    fs.rmSync(STRINGS, { force: true });
    fs.renameSync(tmp, STRINGS);
  }, 1500);
  saveTimer.unref();
}

/** Strings with case numbers or amounts are one-offs: keep them in memory only. */
function oneOff(text) {
  return /\d{3,}|\b[A-Z]{2}-[A-Z0-9]{4,6}\b|@/.test(text);
}

function cached(lang, text) {
  const book = strings[lang];
  if (book && Object.prototype.hasOwnProperty.call(book, text)) return book[text];
  const key = `${lang}\u0000${text}`;
  return memory.has(key) ? memory.get(key) : undefined;
}

function remember(lang, text, value) {
  if (oneOff(text)) {
    if (memory.size > 3000) memory.delete(memory.keys().next().value);
    memory.set(`${lang}\u0000${text}`, value);
    return;
  }
  (strings[lang] = strings[lang] || {})[text] = value;
  saveStrings();
}

function worthTranslating(text) {
  return typeof text === "string" && /[A-Za-zÆØÅæøåÉé]{2,}/.test(text.replace(/<[^>]*>/g, " "));
}

/** The first complete JSON object in a reply, ignoring any text around it. */
function firstJsonObject(text) {
  let start = text.indexOf("{");
  while (start >= 0) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i += 1;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "{") depth += 1;
      else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1));
          } catch (error) {
            break;
          }
        }
      }
    }
    start = text.indexOf("{", start + 1);
  }
  return null;
}

function keepEdges(source, value) {
  const lead = /^\s*/.exec(source)[0];
  const trail = /\s*$/.exec(source)[0];
  return lead + String(value).trim() + trail;
}

/** Translates a list of Danish strings. Returns translations in the same order; anything that fails stays Danish. */
async function translateList(lang, list, { context = "", model = MODEL, store = true, strict = false } = {}) {
  const out = list.slice();
  if (lang === "da" || !LANGS[lang]) return out;
  const todo = [];
  list.forEach((text, index) => {
    if (!worthTranslating(text)) return;
    const hit = cached(lang, text);
    if (hit !== undefined) out[index] = hit;
    else todo.push(index);
  });
  if (!todo.length) return out;
  if (!enabled()) {
    if (strict) throw new Error("ANTHROPIC_API_KEY mangler");
    return out;
  }
  let failure = null;
  const unique = [...new Set(todo.map((index) => list[index]))];
  const batches = [];
  let current = [];
  let size = 0;
  for (const text of unique) {
    if (current.length && (current.length >= 80 || size + text.length > 9000)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += text.length;
  }
  if (current.length) batches.push(current);
  const done = new Map();
  await Promise.all(
    batches.map(async (batch) => {
      const system =
        rules(lang) +
        "\n\nYou get a JSON object of numbered Danish strings. Return a JSON object with exactly the same keys, each value translated. " +
        "Keep leading and trailing spaces. Some strings are fragments that are joined with code, so translate them so they still fit together, but never merge or split entries. " +
        "If a string is code, an identifier, CSS or only a brand or model name, return it unchanged. Output only the JSON object.";
      const numbered = Object.fromEntries(batch.map((text, i) => [String(i + 1), text]));
      const user = (context ? `For context, the strings come from this file:\n<file>\n${context}\n</file>\n\n` : "") + JSON.stringify(numbered, null, 1);
      try {
        let parsed = null;
        for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
          const text = await claude({ system, user, model, maxTokens: Math.min(32000, Math.ceil(JSON.stringify(batch).length / 1.6) + 1000) });
          const reply = firstJsonObject(text);
          const keys = reply ? batch.filter((source, i) => typeof reply[String(i + 1)] === "string").length : 0;
          if (keys === batch.length) parsed = batch.map((source, i) => reply[String(i + 1)]);
          else if (attempt === 1) throw new Error(`fik ${keys} af ${batch.length} svar`);
        }
        batch.forEach((source, i) => {
          const value = typeof parsed[i] === "string" ? keepEdges(source, parsed[i]) : source;
          const ok = !sameMarkup(source, value);
          done.set(source, ok ? value : source);
          if (ok && store) remember(lang, source, value);
        });
      } catch (error) {
        failure = error;
        if (!strict) console.error(`Oversættelse ${lang}: ${error.message}`);
      }
    })
  );
  if (failure && strict) throw failure;
  todo.forEach((index) => {
    if (done.has(list[index])) out[index] = done.get(list[index]);
  });
  return out;
}

const queue = new Map();
let queueTimer = null;

function flushQueue() {
  queueTimer = null;
  for (const [lang, set] of queue) {
    queue.delete(lang);
    void translateList(lang, [...set]);
  }
}

/** Synchronous lookup for rendering. A miss returns Danish now and is translated in the background. */
function t(lang, text) {
  if (!lang || lang === "da" || !worthTranslating(text)) return text;
  const hit = cached(lang, text);
  if (hit !== undefined) return hit;
  if (enabled()) {
    if (!queue.has(lang)) queue.set(lang, new Set());
    queue.get(lang).add(text);
    if (!queueTimer) {
      queueTimer = setTimeout(flushQueue, 2000);
      queueTimer.unref();
    }
  }
  return text;
}

const DATA_KEYS = new Set(["label", "note", "name", "time", "text", "title", "message", "statusLabel", "deliveryText", "lines", "groupName", "variantTitle"]);
const API_KEYS = new Set(["label", "note", "time", "text", "title", "message", "statusLabel", "deliveryText", "lines", "storageLabel", "variantLabel"]);

function walk(value, keys, fn, key = "") {
  if (typeof value === "string") return keys.has(key) ? fn(value) : value;
  if (Array.isArray(value)) return value.map((item) => walk(item, keys, fn, key));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, keys, fn, k);
    return out;
  }
  return value;
}

function collect(value, keys = DATA_KEYS) {
  const found = [];
  walk(value, keys, (text) => {
    found.push(text);
    return text;
  });
  return found;
}

function deep(lang, value, keys = DATA_KEYS) {
  if (lang === "da") return value;
  return walk(value, keys, (text) => t(lang, text));
}

async function deepAsync(lang, value, keys = API_KEYS) {
  if (lang === "da") return value;
  const found = [];
  walk(value, keys, (text) => {
    found.push(text);
    return text;
  });
  const translated = await translateList(lang, found);
  const map = new Map(found.map((text, i) => [text, translated[i]]));
  return walk(value, keys, (text) => (map.has(text) ? map.get(text) : text));
}

/** Wraps res.json on public API routes so messages and labels come back in the page's language. */
function apiMiddleware(req, res, next) {
  if (!req.lang || req.lang === "da" || !req.path.startsWith("/api/") || req.path.startsWith("/api/admin") || req.path.startsWith("/api/stripe")) return next();
  const original = res.json.bind(res);
  res.json = (body) => {
    deepAsync(req.lang, body)
      .then((translated) => original(translated))
      .catch(() => original(body));
    return res;
  };
  return next();
}

/** For e-mails and SMS: always fresh, through the fast model. */
async function translateNow(lang, list) {
  if (!lang || lang === "da") return list;
  return translateList(lang, list, { model: FAST_MODEL, store: false });
}

// ---------- JavaScript ----------
const REGEX_AFTER = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "=>", "&&", "||", "??", "==", "===", "!=", "!==", "+=", "-=", "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw"]);
const PUNCT3 = ["===", "!==", "...", "**=", "<<=", ">>=", ">>>"];
const PUNCT2 = ["==", "!=", "<=", ">=", "&&", "||", "??", "=>", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "?."];

function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote) {
    if (src[j] === "\\") j += 1;
    else if (src[j] === "\n") throw new Error(`streng uden slutning ved ${i}`);
    j += 1;
  }
  if (j >= src.length) throw new Error(`streng uden slutning ved ${i}`);
  return j + 1;
}

function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") j += 2;
    else if (c === "`") return j + 1;
    else if (c === "$" && src[j + 1] === "{") {
      let depth = 1;
      j += 2;
      while (j < src.length && depth) {
        const d = src[j];
        if (d === '"' || d === "'") j = skipString(src, j);
        else if (d === "`") j = skipTemplate(src, j);
        else {
          if (d === "{") depth += 1;
          if (d === "}") depth -= 1;
          j += 1;
        }
      }
    } else j += 1;
  }
  throw new Error(`template uden slutning ved ${i}`);
}

function lexJs(src) {
  const list = [];
  let prev = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    let token;
    if (c === '"' || c === "'") token = { type: "str", start: i, end: skipString(src, i) };
    else if (c === "`") token = { type: "tpl", start: i, end: skipTemplate(src, i) };
    else if (c === "/" && REGEX_AFTER.has(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "\n") throw new Error(`regex uden slutning ved ${i}`);
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
        j += 1;
      }
      j += 1;
      while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
      token = { type: "re", start: i, end: j };
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j += 1;
      token = { type: "id", start: i, end: j };
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1]))) {
      let j = i;
      while (j < src.length && /[\w.]/.test(src[j])) j += 1;
      token = { type: "num", start: i, end: j };
    } else {
      const three = src.slice(i, i + 3);
      const two = src.slice(i, i + 2);
      const p = PUNCT3.includes(three) ? three : PUNCT2.includes(two) ? two : c;
      token = { type: "punct", start: i, end: i + p.length };
    }
    token.raw = src.slice(token.start, token.end);
    prev = token.type === "id" || token.type === "punct" ? token.raw : token.type;
    list.push(token);
    i = token.end;
  }
  return list;
}

const DOM_CALLS = new Set([
  "querySelector", "querySelectorAll", "getElementById", "getAttribute", "setAttribute", "removeAttribute", "hasAttribute", "toggleAttribute",
  "addEventListener", "removeEventListener", "getItem", "setItem", "removeItem", "closest", "matches", "createElement", "NumberFormat",
  "DateTimeFormat", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "dispatchEvent", "CustomEvent", "Event", "get", "set",
  "has", "delete", "getAll", "toggle", "contains", "fetch", "scrollIntoView", "insertAdjacentHTML"
]);

function decodeLiteral(raw) {
  // Our own source files, never user input.
  return new Function(`return ${raw};`)();
}

function encodeLiteral(value, quote) {
  const body = String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return quote + (quote === '"' ? body.replace(/"/g, '\\"') : body.replace(/'/g, "\\'")) + quote;
}

function visibleText(value) {
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/<[^>]*$/, " ")
    .replace(/^[^<]*?>/, " ")
    .replace(/\s[\w:-]+="[^"]*("|$)/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
}

function isUiText(value) {
  const plain = visibleText(value).trim();
  if (!/[A-Za-zÆØÅæøåÉé]{2,}/.test(plain)) return false;
  if (/^(https?:|mailto:|tel:|\/|#|\.|\[|application\/)/.test(plain)) return false;
  if (/^[a-z][\w-]*(\[|\.[a-z]|#[a-z]|:[a-z]|\s*>\s*[a-z.#])/.test(plain)) return false;
  if (/^[\w.$-]+$/.test(plain)) return /^[A-ZÆØÅ][a-zæøåé]+$/.test(plain) || /[æøå]/i.test(plain);
  const words = plain.split(/\s+/);
  if (words.every((word) => /^[a-z][a-z0-9-]*$/.test(word)) && words.some((word) => word.includes("-"))) return false;
  return /\s/.test(plain) || /[æøå]/i.test(plain);
}

/** Picks the string literals in a script that are text for people, never keys, selectors or compared values. */
function uiStrings(src) {
  const list = lexJs(src);
  const found = [];
  list.forEach((token, index) => {
    if (token.type !== "str") return;
    const before = list[index - 1] ? list[index - 1].raw : "";
    const before2 = list[index - 2] ? list[index - 2].raw : "";
    const after = list[index + 1] ? list[index + 1].raw : "";
    if (after === ":" && (before === "{" || before === ",")) return;
    if (["===", "!==", "==", "!=", "case", "in"].includes(before) || ["===", "!==", "==", "!=", "in"].includes(after)) return;
    if (before === "(" && DOM_CALLS.has(before2)) return;
    if (before === "=" && ["className", "type", "name", "id", "value", "href"].includes(before2)) return;
    if (before === "[" && after === "]") return;
    const value = decodeLiteral(token.raw);
    if (isUiText(value)) found.push({ token, value });
  });
  return found;
}

async function translateScript(lang, src, model = MODEL) {
  const found = uiStrings(src);
  if (!found.length) return src;
  const values = found.map((item) => item.value);
  const translated = await translateList(lang, values, { context: src.length < 60000 ? src : "", model, store: false, strict: true });
  let out = "";
  let last = 0;
  found.forEach((item, i) => {
    out += src.slice(last, item.token.start) + encodeLiteral(translated[i], item.token.raw[0]);
    last = item.token.end;
  });
  out += src.slice(last);
  const before = lexJs(src).filter((token) => token.type !== "str").map((token) => token.raw).join(" ");
  const after = lexJs(out).filter((token) => token.type !== "str").map((token) => token.raw).join(" ");
  if (before !== after) throw new Error("koden blev ændret");
  return out;
}

/** Page and inline scripts: Danish links get the language prefix, numbers and dates the right format. */
function localizeScript(src, lang) {
  if (lang === "da") return src;
  return src
    .replace(LINK_RE, `$1/${lang}/$2`)
    .replace(/(["'])da-DK\1/g, `$1${LANGS[lang].locale}$1`)
    .replace(/(["']) kr\1/g, "$1 DKK$1");
}

// ---------- HTML ----------
function maskScripts(html) {
  const blocks = [];
  const masked = html.replace(/<(script|style)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, body) => {
    if (!body.trim() || /ld\+json/i.test(attrs)) return match;
    blocks.push({ tag, body, json: /application\/json/i.test(attrs) || tag.toLowerCase() === "style" });
    return `<${tag}${attrs}>@@SCRIPT_${blocks.length - 1}@@</${tag}>`;
  });
  return { masked, blocks };
}

function jsonShape(value, key = "") {
  if (Array.isArray(value)) return `[${value.map((item) => jsonShape(item, key)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).map((k) => `${k}:${jsonShape(value[k], k)}`).join(",")}}`;
  if (typeof value === "string" && (key.startsWith("@") || /^(https?:|mailto:|tel:|\/|[\d\s+().:-]+$)/.test(value))) return JSON.stringify(value);
  return typeof value;
}

function fixLdJson(source, translated) {
  const sourceBlocks = source.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  let index = 0;
  return translated.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, (block) => {
    const original = sourceBlocks[index++] || block;
    const body = (text) => text.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "").replace(/\{\{[A-Z0-9_]+\}\}/g, "0");
    try {
      const a = JSON.parse(body(original));
      try {
        const b = JSON.parse(body(block));
        return jsonShape(a) === jsonShape(b) ? block : original;
      } catch (error) {
        return original;
      }
    } catch (error) {
      return block;
    }
  });
}

async function translateHtml(lang, src) {
  const { masked, blocks } = maskScripts(src);
  const system =
    rules(lang) +
    "\n\nYou get a complete HTML template. Return the complete template with every human-visible text translated: text between tags, <title>, " +
    "the content of the meta description, og:title and og:description, the alt, title, placeholder, label and aria-label attributes, and the human-readable values inside JSON-LD. " +
    "Change nothing else: the same tags in the same order, the same classes, ids, href, src, name, value, type, for and data-* attributes, the same HTML comments, " +
    `{{TOKENS}} and @@SCRIPT_0@@ placeholders. In JSON-LD keep keys, @type values, URLs, numbers and tokens. Set lang="${lang}" on <html>. ` +
    "Output only the template, without code fences or explanations.";
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await claude({
      system,
      user: masked + (feedback ? `\n\n<!-- Your last answer was rejected: ${feedback}. Keep every tag and attribute identical. -->` : ""),
      maxTokens: Math.min(32000, Math.ceil(masked.length / 2.2) + 2000)
    });
    let out = text.trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "");
    if (src.trimEnd().length && !out.endsWith("\n")) out += "\n";
    const problem = sameMarkup(masked.replace(/<html lang="[^"]*"/, "<html"), out.replace(/<html lang="[^"]*"/, "<html"));
    if (problem) {
      feedback = problem;
      continue;
    }
    out = fixLdJson(masked, out);
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const body = block.json ? block.body : await translateScript(lang, block.body).catch(() => block.body);
      out = out.replace(`@@SCRIPT_${i}@@`, () => body);
    }
    return out;
  }
  throw new Error(`markup ændret (${feedback})`);
}

/** Shared by server rendering: language attribute, links with prefix, DKK, alternate languages. */
function localizeHtml(html, lang, { origin, pathName }) {
  const info = LANGS[lang] || LANGS.da;
  html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}" data-country="${info.country}"`);
  if (lang !== "da") {
    html = html.replace(/(<meta property="og:locale" content=")[^"]*/, `$1${info.og}`);
    html = html.split(`${origin}/og.png"`).join(`${origin}/og-en.png"`);
    html = localizeScript(html, lang);
    html = html.replace(/((?:href|action)=")\/(?=["?#])/g, `$1/${lang}/`);
    const own = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`((?:href|content)=")${own}(/[^"]*)"`, "g"), (match, attr, p) =>
      isPagePath(p.split(/[?#]/)[0]) ? `${attr}${origin}${pagePath(lang, p)}"` : match
    );
    html = html.replace(/(\d)( |&nbsp;|\u00a0)kr\b(?!\.\w)/g, "$1$2DKK");
    html = html.replace(/src="\/js\/([\w.-]+\.js)\?v=([\w]+)"/g, (match, file, version) =>
      SCRIPTS.includes(file) ? `src="/i18n/${lang}/js/${file}?v=${version}${assetTag(lang, `public/js/${file}`)}"` : match
    );
  }
  if (isPagePath(pathName) && !/noindex/.test(html)) {
    const links = CODES.map((code) => `  <link rel="alternate" hreflang="${code}" href="${origin}${pagePath(code, pathName)}">`);
    links.push(`  <link rel="alternate" hreflang="x-default" href="${origin}${pagePath("en", pathName)}">`);
    html = html.replace("</head>", `${links.join("\n")}\n</head>`);
  }
  return html;
}

function langMenu(lang, pathName, search) {
  const here = isPagePath(pathName) ? pathName : "/";
  const query = search && isPagePath(pathName) ? search : "";
  const items = CODES.map((code) => {
    const current = code === lang ? ' aria-current="true"' : "";
    return `<li><a href="${pagePath(code, here)}${query.replace(/"/g, "&quot;")}" hreflang="${code}" lang="${code}"${current}>${LANGS[code].name}</a></li>`;
  }).join("");
  return (
    `<details class="lang-menu"><summary aria-label="Language: ${LANGS[lang].name}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 3.9 5.7 3.9 9s-1.3 6.3-3.9 9c-2.6-2.7-3.9-5.7-3.9-9s1.3-6.3 3.9-9z"/></svg>` +
    `<span>${lang.toUpperCase()}</span></summary><ul>${items}</ul></details>`
  );
}

// ---------- Build ----------
function pageFiles() {
  const all = fs
    .readdirSync(path.join(ROOT, "public"))
    .filter((file) => file.endsWith(".html") && file !== "admin.html")
    .map((file) => file.replace(/\.html$/, ""));
  const ordered = [...FIRST_PAGES.filter((page) => all.includes(page)), ...all.filter((page) => !FIRST_PAGES.includes(page))];
  return ordered.map((page) => `public/${page}.html`);
}

function buildList() {
  const pages = pageFiles();
  const list = ["partials/header.html", "partials/footer.html", "partials/pay-logos.html"];
  const scriptFor = { saelg: "saelg.js", reservedele: "reservedele.js", book: "book.js", sag: "sag.js", "saelg-sag": "saelg-sag.js", priser: "finder.js" };
  list.push("public/js/site.js");
  for (const page of pages) {
    list.push(page);
    const name = path.basename(page, ".html");
    if (scriptFor[name]) list.push(`public/js/${scriptFor[name]}`);
  }
  for (const script of SCRIPTS) if (!list.includes(`public/js/${script}`)) list.push(`public/js/${script}`);
  return list;
}

let building = null;

async function buildOne(lang, rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const hash = sourceHash(rel);
  const out = rel.endsWith(".js") ? await translateScript(lang, src) : await translateHtml(lang, src);
  const file = outFile(lang, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  manifest[lang] = manifest[lang] || {};
  manifest[lang][rel] = hash;
  saveManifest();
}

/** Translates every page and script whose Danish source changed. Safe to call again; runs once at a time. */
function build({ langs = FOREIGN, files = null, log = console.log } = {}) {
  if (building) return building;
  if (!enabled()) return Promise.resolve({ skipped: true });
  const list = files || buildList();
  const jobs = [];
  for (const lang of langs) for (const rel of list) if (!fresh(lang, rel)) jobs.push({ lang, rel });
  if (!jobs.length) return Promise.resolve({ done: 0, failed: 0 });
  log(`Oversætter ${jobs.length} filer (${langs.join(", ")})…`);
  let done = 0;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await buildOne(job.lang, job.rel);
        done += 1;
        if (done % 10 === 0 || done === jobs.length) log(`Oversat ${done}/${jobs.length}`);
      } catch (error) {
        failed += 1;
        log(`Kunne ikke oversætte ${job.lang}/${job.rel}: ${error.message}`);
      }
    }
  }
  building = Promise.all(Array.from({ length: 5 }, worker)).then(() => {
    building = null;
    log(`Oversættelse færdig: ${done} ok, ${failed} fejl`);
    return { done, failed };
  });
  return building;
}

function status() {
  const list = buildList();
  const out = {};
  for (const lang of FOREIGN) out[lang] = { fresh: list.filter((rel) => fresh(lang, rel)).length, total: list.length };
  return { building: Boolean(building), langs: out };
}

/** Fills the string cache for every language up front, so rendering never waits. */
async function prewarm(list) {
  const unique = [...new Set(list.filter(worthTranslating))];
  for (const lang of FOREIGN) {
    const missing = unique.filter((text) => cached(lang, text) === undefined);
    if (missing.length) await translateList(lang, missing);
  }
}

module.exports = {
  LANGS,
  CODES,
  FOREIGN,
  EU,
  SCRIPTS,
  enabled,
  fromPath,
  isPagePath,
  pagePath,
  prefix,
  middleware,
  apiMiddleware,
  rememberLang,
  source,
  read,
  t,
  collect,
  deep,
  deepAsync,
  translateList,
  translateNow,
  localizeHtml,
  localizeScript,
  langMenu,
  build,
  status,
  prewarm,
  uiStrings,
  lexJs,
  sameMarkup
};
