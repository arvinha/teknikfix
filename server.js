const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const pricing = require("./pricing");
const stripe = require("./stripe");
const notify = require("./notify");
const customer = require("./customer");
const buyback = require("./buyback");
const parts = require("./parts");
const vision = require("./vision");
const i18n = require("./i18n");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PARTIALS = path.join(ROOT, "partials");
const DATA = path.join(ROOT, "data");
const BOOKINGS = path.join(DATA, "bookings.json");
const CONFIG_PATH = path.join(ROOT, "site.config.json");

loadEnv(path.join(ROOT, ".env"));
const platform = require("./platform");
const shop = require("./shop");

const PORT = Number(process.env.PORT) || 4321;
const PASSWORD = process.env.ADMIN_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || "";
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

if (PASSWORD.length < 10 || SECRET.length < 16) {
  console.error("ADMIN_PASSWORD og SESSION_SECRET skal sættes i .env.");
  process.exit(1);
}

fs.mkdirSync(DATA, { recursive: true });
if (!fs.existsSync(BOOKINGS)) fs.writeFileSync(BOOKINGS, "[]\n");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const REF_RE = /^AX-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const DEVICES = ["telefon", "computer", "tablet", "andet"];
const VISITS = ["vaerksted", "hjemme", "post", "paa-stedet", "konsultation"];
const WHENS = ["hurtigst", "i-dag", "tidspunkt"];
const STATUSES = [
  "ny",
  "kontaktet",
  "bekraeftet",
  "tilbud",
  "godkendt",
  "i_gang",
  "afventer_betaling",
  "betaling_meldt",
  "betalt",
  "afsluttet",
  "kunne_ikke",
  "aflyst"
];
const STATUS_LABEL = {
  ny: "Ny sag",
  kontaktet: "Kontaktet",
  bekraeftet: "Tid bekræftet",
  tilbud: "Tilbud sendt",
  godkendt: "Pris godkendt",
  i_gang: "Reparation i gang",
  afventer_betaling: "Klar til betaling",
  betaling_meldt: "Kunden har meldt betaling",
  betalt: "Betalt",
  afsluttet: "Afsluttet",
  kunne_ikke: "Kunne ikke repareres",
  aflyst: "Aflyst"
};

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : "loopback");

const SITE_HOST = (() => {
  try {
    return new URL(process.env.SITE_URL || "").host.toLowerCase();
  } catch (error) {
    return "";
  }
})();
const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.|\[::1\])/;

app.use(i18n.middleware);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  const host = String(req.get("host") || "").toLowerCase();
  if (SITE_HOST && host === SITE_HOST && req.get("x-forwarded-proto") === "http") {
    return res.redirect(301, `https://${SITE_HOST}${req.originalUrl}`);
  }
  if (SITE_HOST && host && host !== SITE_HOST && !LOCAL_HOST.test(host)) {
    if (host === `www.${SITE_HOST}`) {
      return res.redirect(301, `${process.env.SITE_URL.replace(/\/$/, "")}${req.originalUrl}`);
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }
  return next();
});

app.use("/api", (req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(i18n.apiMiddleware);

app.post("/api/stripe/webhook", express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!stripe.verifyWebhook(raw, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: "signatur" });
  }
  try {
    const event = JSON.parse(raw);
    const okTypes = ["checkout.session.completed", "checkout.session.async_payment_succeeded"];
    if (okTypes.includes(event.type) && event.data && event.data.object) {
      const handled = (await platform.handleStripeSession(event.data.object, config)) || (await shop.handleStripeSession(event.data.object, config));
      if (!handled) await recordStripePayment(event.data.object);
    }
    return res.json({ received: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "server" });
  }
});

platform.registerEarly(app, { limited, clientIp });

app.use(express.json({ limit: "80kb" }));
app.use(express.urlencoded({ extended: false, limit: "80kb" }));

const hits = new Map();

function limited(key, max, windowMs) {
  const now = Date.now();
  const prev = hits.get(key) || [];
  const fresh = prev.filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    hits.set(key, fresh);
    return true;
  }
  fresh.push(now);
  hits.set(key, fresh);
  return false;
}

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || "local";
}

function cleanLine(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanText(value, max) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, max);
}

function readBookings() {
  const data = JSON.parse(fs.readFileSync(BOOKINGS, "utf8"));
  if (!Array.isArray(data)) throw new Error("Bookings file is not a list");
  return data;
}

function writeBookings(list) {
  const tmp = `${BOOKINGS}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
  fs.rmSync(BOOKINGS, { force: true });
  fs.renameSync(tmp, BOOKINGS);
}

let chain = Promise.resolve();

function withBookings(mutator) {
  const run = chain.then(() => {
    const list = readBookings();
    const result = mutator(list);
    if (result && result.save) writeBookings(list);
    return result ? result.value : undefined;
  });
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function makeRef(list) {
  for (let i = 0; i < 30; i += 1) {
    const bytes = crypto.randomBytes(4);
    let body = "";
    for (const byte of bytes) body += ALPHABET[byte % ALPHABET.length];
    const ref = `AX-${body}`;
    if (!list.some((item) => item.ref === ref)) return ref;
  }
  throw new Error("Could not make a case number");
}

function normRef(input) {
  let ref = cleanLine(input, 20).toUpperCase().replace(/\s/g, "");
  if (/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(ref)) ref = `AX-${ref}`;
  return REF_RE.test(ref) ? ref : "";
}

function sameEmail(a, b) {
  return cleanLine(a, 160).toLowerCase() === cleanLine(b, 160).toLowerCase();
}

function publicView(booking) {
  return {
    ref: booking.ref,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    name: booking.name,
    device: booking.device,
    model: booking.model,
    problem: booking.problem,
    visit: booking.visit,
    address: booking.address,
    when: booking.when,
    timeNote: booking.timeNote,
    status: booking.status,
    priceDkk: booking.priceDkk,
    estimate: booking.estimate || null,
    paidDkk: paidTotal(booking),
    events: (booking.events || [])
      .filter((event) => event.public)
      .map((event) => ({ at: event.at, text: event.text }))
  };
}

const TIME_SLOTS = { formiddag: "formiddag (9–12)", eftermiddag: "eftermiddag (12–17)", aften: "aften (17–22)" };

function slotNote(rawDate, rawSlot) {
  const date = cleanLine(rawDate, 10);
  const slot = TIME_SLOTS[cleanLine(rawSlot, 20)];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slot) return "";
  const day = new Date(`${date}T12:00:00`);
  if (Number.isNaN(day.getTime())) return "";
  const text = new Intl.DateTimeFormat("da-DK", { weekday: "long", day: "numeric", month: "long" }).format(day);
  return `${text}, ${slot}`;
}

function parseBooking(body, { withTest = false } = {}) {
  const device = cleanLine(body.device, 40);
  const visit = cleanLine(body.visit, 40);
  const when = cleanLine(body.when, 40) || "hurtigst";
  const name = cleanLine(body.name, 80);
  const email = cleanLine(body.email, 120).toLowerCase();
  const phone = cleanLine(body.phone, 30);
  const model = cleanLine(body.model, 80);
  const problem = cleanText(body.problem, 2000);
  const address = cleanText(body.address, 200);
  const timeNote = cleanLine(body.timeNote, 160) || slotNote(body.timeDate, body.timeSlot);
  const consent = cleanLine(body.consent, 10);
  const phoneDigits = phone.replace(/\D/g, "");
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const rawRepairs = body.repairIds ?? body.repairId ?? [];
  const repairIds = (Array.isArray(rawRepairs) ? rawRepairs : String(rawRepairs).split(","))
    .slice(0, 12)
    .map((id) => cleanLine(id, 40))
    .filter(Boolean);
  const estimate = pricing.estimateMany(cleanLine(body.modelId, 60), repairIds, { withTest });
  const other = cleanLine(body.other, 10) === "ja";
  const payNow = cleanLine(body.payWhen, 10) === "nu";

  if (!DEVICES.includes(device) || !VISITS.includes(visit) || !WHENS.includes(when)) {
    return { error: "oplysninger" };
  }
  if (estimate && estimate.device !== device) return { error: "oplysninger" };
  if (name.length < 2 || !emailOk || phoneDigits.length < 8) return { error: "oplysninger" };
  if ((!estimate || other) && problem.length < 8) return { error: "oplysninger" };
  if ((visit === "hjemme" || visit === "post") && address.replace(/\s/g, "").length < 5) return { error: "oplysninger" };
  if (when === "tidspunkt" && timeNote.length < 3) return { error: "oplysninger" };
  if (consent !== "ja") return { error: "oplysninger" };
  if (payNow && (!estimate || estimate.from || estimate.priceDkk <= 0 || other || !stripe.enabled())) {
    return { error: "betaling" };
  }

  return {
    value: {
      device,
      visit,
      when,
      name,
      email,
      phone,
      model: estimate ? estimate.modelName : model,
      problem: problem ? (estimate && other ? `${estimate.label}. Desuden: ${problem}` : problem) : estimate ? estimate.label : "",
      address,
      timeNote,
      estimate: estimate
        ? {
            modelId: estimate.modelId,
            repairIds: estimate.repairIds,
            label: estimate.label,
            time: estimate.time,
            from: estimate.from,
            priceDkk: estimate.priceDkk,
            items: estimate.items
          }
        : null,
      payWhen: payNow ? "nu" : "efter"
    }
  };
}

function paidTotal(booking) {
  return (booking.payments || []).reduce((sum, payment) => sum + payment.amountDkk, 0);
}

function amountDue(booking) {
  if (!Number.isInteger(booking.priceDkk) || booking.priceDkk <= 0) return 0;
  return Math.max(0, booking.priceDkk - paidTotal(booking));
}

function checkoutTitle(booking) {
  const what = booking.estimate ? `${booking.model}, ${booking.estimate.label.toLowerCase()}` : "reparation";
  return `TeknikFix ${what} · sag ${booking.ref}`;
}

async function recordStripePayment(session) {
  if (!session || session.payment_status !== "paid") return null;
  const ref = normRef(session.metadata && session.metadata.ref);
  if (!ref) return null;
  const amountDkk = Math.round(Number(session.amount_total) / 100);
  let added = false;
  const result = await withBookings((list) => {
    const booking = list.find((item) => item.ref === ref);
    if (!booking) return { save: false, value: null };
    booking.payments = booking.payments || [];
    if (booking.payments.some((payment) => payment.sessionId === session.id)) {
      return { save: false, value: booking };
    }
    const now = new Date().toISOString();
    const prepaid = session.metadata && session.metadata.kind === "forud";
    booking.payments.push({ at: now, method: "stripe", amountDkk, sessionId: session.id, kind: prepaid ? "forud" : "efter" });
    if (!Number.isInteger(booking.priceDkk)) booking.priceDkk = amountDkk;
    booking.updatedAt = now;
    if (prepaid) {
      booking.events.push({
        at: now,
        public: true,
        text: `Forudbetalt ${pricing.formatKr(amountDkk)}. Kan vi ikke reparere den, får du pengene tilbage.`
      });
    } else {
      booking.events.push({ at: now, public: true, text: `Betalt ${pricing.formatKr(amountDkk)}. Tak.` });
    }
    if (amountDue(booking) === 0 && ["afventer_betaling", "betaling_meldt"].includes(booking.status)) {
      booking.status = "betalt";
    }
    console.log(`Betaling ${ref} · ${amountDkk} kr · ${prepaid ? "forud" : "efter"}`);
    added = true;
    return { save: true, value: booking };
  });
  if (added && result) {
    const prepaid = session.metadata && session.metadata.kind === "forud";
    void notify.paid(result, amountDkk, prepaid);
    const paymentId = typeof session.payment_intent === "string" ? session.payment_intent : "";
    void customer.paymentReceived(result, { amountDkk, prepaid, paymentId }, config);
  }
  return result;
}

function wantsJson(req) {
  const type = req.headers["content-type"] || "";
  return type.includes("application/json");
}

function failBooking(req, res, status, code) {
  if (wantsJson(req)) {
    const message =
      code === "mange"
        ? "Der er sendt mange forespørgsler. Vent lidt, eller ring til os."
        : code === "betaling"
          ? "Betal nu kan kun vælges ved en fast pris. Vælg at betale bagefter."
          : "Tjek felterne og prøv igen.";
    return res.status(status).json({ error: code, message });
  }
  return res.redirect(303, `${i18n.prefix(req.lang)}/book?fejl=${encodeURIComponent(code)}`);
}

app.post("/api/bookings", async (req, res) => {
  try {
    if (limited(`book:${clientIp(req)}`, 8, 60 * 60 * 1000)) {
      return failBooking(req, res, 429, "mange");
    }
    const parsed = parseBooking(req.body || {}, { withTest: isAdmin(req) });
    if (parsed.error) return failBooking(req, res, 400, parsed.error);
    const now = new Date().toISOString();
    const booking = await withBookings((list) => {
      const created = {
        ref: makeRef(list),
        createdAt: now,
        updatedAt: now,
        status: "ny",
        priceDkk: null,
        ...parsed.value,
        lang: req.lang || "da",
        notes: [],
        events: [
          {
            at: now,
            public: true,
            text:
              parsed.value.visit === "post"
                ? "Sag modtaget. Vi mailer dig, hvordan du pakker og sender enheden."
                : "Sag modtaget. Vi bekræfter tiden på sms eller e-mail."
          }
        ]
      };
      list.push(created);
      return { save: true, value: created };
    });
    console.log(`Ny sag ${booking.ref} · ${booking.device} · ${booking.visit}`);
    void notify.newBooking(booking);
    void customer.bookingReceived(booking, config);
    let payUrl = "";
    if (booking.payWhen === "nu") {
      try {
        const session = await stripe.createCheckout({
          ref: booking.ref,
          email: booking.email,
          amountDkk: booking.estimate.priceDkk,
          title: checkoutTitle(booking),
          kind: "forud",
          origin: originOf(req) + i18n.prefix(req.lang),
          lang: req.lang
        });
        payUrl = session.url;
      } catch (error) {
        console.error(`Stripe ${booking.ref}: ${error.message}`);
      }
    }
    if (wantsJson(req)) return res.status(201).json({ ok: true, ref: booking.ref, payUrl });
    if (payUrl) return res.redirect(303, payUrl);
    return res.redirect(303, `${i18n.prefix(req.lang)}/book/tak?ref=${encodeURIComponent(booking.ref)}`);
  } catch (error) {
    console.error(error);
    return failBooking(req, res, 500, "server");
  }
});

app.get("/api/sag", async (req, res) => {
  const ref = normRef(req.query.ref);
  const email = cleanLine(req.query.email, 120);
  if (!ref || !email) {
    return res.status(400).json({ error: "oplysninger", message: "Skriv sagsnummer og e-mail." });
  }
  const list = await withBookings((items) => ({ save: false, value: items }));
  const booking = list.find((item) => item.ref === ref);
  if (!booking || !sameEmail(booking.email, email)) {
    return res.status(404).json({
      error: "ikke_fundet",
      message: "Vi kan ikke finde den sag. Tjek sagsnummer og e-mail."
    });
  }
  return res.json(publicView(booking));
});

app.post("/api/sag/accept", async (req, res) => {
  const ref = normRef(req.body && req.body.ref);
  const email = cleanLine(req.body && req.body.email, 120);
  let changed = null;
  const updated = await withBookings((list) => {
    const booking = list.find((item) => item.ref === ref);
    if (!booking || !sameEmail(booking.email, email)) return { save: false, value: { missing: true } };
    if (booking.priceDkk === null || booking.priceDkk === undefined) {
      return { save: false, value: { bad: "Der er ikke sat en pris endnu." } };
    }
    if (booking.status !== "tilbud" && booking.status !== "godkendt") {
      return { save: false, value: { bad: "Der ligger ikke et tilbud til godkendelse." } };
    }
    if (booking.status !== "godkendt") {
      const now = new Date().toISOString();
      booking.status = "godkendt";
      booking.updatedAt = now;
      booking.events.push({ at: now, public: true, text: "Du har godkendt prisen. Vi går i gang." });
      changed = booking;
    }
    return { save: true, value: publicView(booking) };
  });
  if (!updated || updated.missing) {
    return res.status(404).json({ error: "ikke_fundet", message: "Vi kan ikke finde den sag." });
  }
  if (updated.bad) return res.status(409).json({ error: "status", message: updated.bad });
  if (changed) void notify.accepted(changed);
  return res.json(updated);
});

app.post("/api/sag/betalt", async (req, res) => {
  const ref = normRef(req.body && req.body.ref);
  const email = cleanLine(req.body && req.body.email, 120);
  const method = req.body && req.body.method === "bank" ? "bank" : "paypal";
  let changed = null;
  const updated = await withBookings((list) => {
    const booking = list.find((item) => item.ref === ref);
    if (!booking || !sameEmail(booking.email, email)) return { save: false, value: { missing: true } };
    if (booking.status !== "afventer_betaling" && booking.status !== "betaling_meldt") {
      return { save: false, value: { bad: "Sagen er ikke klar til betaling endnu." } };
    }
    if (booking.status !== "betaling_meldt") {
      const now = new Date().toISOString();
      booking.status = "betaling_meldt";
      booking.updatedAt = now;
      booking.events.push({
        at: now,
        public: true,
        text:
          method === "bank"
            ? "Du har oplyst, at bankoverførslen er sendt. Vi registrerer den, når den er gået ind."
            : "Du har oplyst, at PayPal-betalingen er sendt. Vi registrerer den, når den er gået ind."
      });
      changed = booking;
    }
    return { save: true, value: publicView(booking) };
  });
  if (!updated || updated.missing) {
    return res.status(404).json({ error: "ikke_fundet", message: "Vi kan ikke finde den sag." });
  }
  if (updated.bad) return res.status(409).json({ error: "status", message: updated.bad });
  if (changed) void notify.paymentReported(changed, method);
  return res.json(updated);
});

app.post("/api/sag/kort", async (req, res) => {
  if (!stripe.enabled()) {
    return res.status(503).json({ error: "kort", message: "Betaling på nettet virker ikke lige nu. Ring til os, så finder vi en løsning." });
  }
  if (limited(`kort:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
    return res.status(429).json({ error: "mange", message: "Vent lidt, og prøv igen." });
  }
  const ref = normRef(req.body && req.body.ref);
  const email = cleanLine(req.body && req.body.email, 120);
  const list = await withBookings((items) => ({ save: false, value: items }));
  const booking = list.find((item) => item.ref === ref);
  if (!booking || !sameEmail(booking.email, email)) {
    return res.status(404).json({ error: "ikke_fundet", message: "Vi kan ikke finde den sag." });
  }
  const due = amountDue(booking);
  if (booking.status !== "afventer_betaling" || due <= 0) {
    return res.status(409).json({ error: "status", message: "Der er ikke noget at betale lige nu." });
  }
  try {
    const session = await stripe.createCheckout({
      ref: booking.ref,
      email: booking.email,
      amountDkk: due,
      title: checkoutTitle(booking),
      kind: "efter",
      origin: originOf(req) + i18n.prefix(req.lang),
      lang: req.lang
    });
    return res.json({ url: session.url });
  } catch (error) {
    console.error(`Stripe ${booking.ref}: ${error.message}`);
    return res.status(502).json({ error: "kort", message: "Betalingen kunne ikke startes. Prøv igen om lidt." });
  }
});

app.get("/api/sag/kort/bekraeft", async (req, res) => {
  const ref = normRef(req.query.ref);
  const sessionId = cleanLine(req.query.session_id, 200);
  if (!stripe.enabled() || !ref || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return res.status(400).json({ error: "oplysninger", message: "Betalingen kunne ikke findes." });
  }
  try {
    const session = await stripe.getCheckout(sessionId);
    if (normRef(session.metadata && session.metadata.ref) !== ref) {
      return res.status(404).json({ error: "ikke_fundet", message: "Betalingen kunne ikke findes." });
    }
    if (session.payment_status !== "paid") {
      return res.status(202).json({ pending: true, message: "Betalingen er ikke gennemført endnu. Vi opdaterer sagen, når den er." });
    }
    const booking = await recordStripePayment(session);
    if (!booking) return res.status(404).json({ error: "ikke_fundet", message: "Sagen kunne ikke findes." });
    return res.json({ ...publicView(booking), email: booking.email });
  } catch (error) {
    console.error(`Stripe bekræft ${ref}: ${error.message}`);
    return res.status(502).json({ error: "kort", message: "Vi kunne ikke tjekke betalingen lige nu. Den bliver registreret alligevel." });
  }
});

function readCookie(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|; )axiom_admin=([^;]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch (error) {
    return "";
  }
}

function signToken(exp) {
  const body = `v1.${exp}`;
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  return `${body}.${sig}`;
}

function isAdmin(req) {
  const raw = readCookie(req);
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  const left = Buffer.from(parts[2]);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp > Date.now();
}

function setAdminCookie(req, res) {
  const token = signToken(Date.now() + 12 * 60 * 60 * 1000);
  const secure = req.protocol === "https" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `axiom_admin=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${secure}`
  );
}

function clearAdminCookie(res) {
  res.setHeader("Set-Cookie", "axiom_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

function passwordsMatch(input) {
  const left = crypto.createHash("sha256").update(String(input)).digest();
  const right = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "login" });
  if (req.method !== "GET") pageCache.clear();
  return next();
}

app.post("/api/admin/login", async (req, res) => {
  if (limited(`login:${clientIp(req)}`, 8, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "mange", message: "Vent et kvarter, og prøv igen." });
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!passwordsMatch(req.body && req.body.password)) {
    return res.status(401).json({ error: "login", message: "Forkert adgangskode." });
  }
  setAdminCookie(req, res);
  return res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  clearAdminCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/sager", requireAdmin, async (req, res) => {
  const list = await withBookings((items) => ({ save: false, value: items }));
  const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(sorted);
});

app.patch("/api/admin/sager/:ref", requireAdmin, async (req, res) => {
  const ref = normRef(req.params.ref);
  const body = req.body || {};
  const customerMessage = typeof body.customerMessage === "string" ? cleanText(body.customerMessage, 600).trim() : "";
  let newStatus = "";
  const updated = await withBookings((list) => {
    const booking = list.find((item) => item.ref === ref);
    if (!booking) return { save: false, value: null };
    const now = new Date().toISOString();
    if (typeof body.status === "string" && body.status) {
      if (!STATUSES.includes(body.status)) return { save: false, value: { bad: true } };
      if (booking.status !== body.status) {
        booking.status = body.status;
        newStatus = body.status;
        booking.events.push({
          at: now,
          public: true,
          text: `Status: ${STATUS_LABEL[body.status] || body.status}`
        });
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, "priceDkk")) {
      if (body.priceDkk === null || body.priceDkk === "") {
        booking.priceDkk = null;
      } else {
        const price = Number(body.priceDkk);
        if (!Number.isInteger(price) || price < 0 || price > 200000) {
          return { save: false, value: { bad: true } };
        }
        if (booking.priceDkk !== price) {
          booking.priceDkk = price;
          booking.events.push({
            at: now,
            public: true,
            text: price === 0 ? "Pris: 0 kr." : `Pris: ${price} kr.`
          });
        }
      }
    }
    if (typeof body.note === "string" && body.note.trim()) {
      booking.notes = booking.notes || [];
      booking.notes.push({ at: now, text: cleanText(body.note, 2000) });
    }
    if (customerMessage) {
      booking.events.push({ at: now, public: true, text: customerMessage });
    }
    booking.updatedAt = now;
    return { save: true, value: booking };
  });
  if (!updated) return res.status(404).json({ error: "ikke_fundet" });
  if (updated.bad) return res.status(400).json({ error: "oplysninger" });
  if (body.notifyCustomer !== false) {
    void customer.caseUpdated(updated, { status: newStatus, message: customerMessage }, config);
  }
  return res.json(updated);
});

app.get("/api/admin/priser", requireAdmin, (req, res) => {
  res.json({
    ...pricing.adminView(),
    cardEnabled: stripe.enabled(),
    mailEnabled: customer.mailEnabled(),
    smsEnabled: customer.smsEnabled()
  });
});

app.put("/api/admin/priser", requireAdmin, (req, res) => {
  try {
    const result = pricing.updateFromAdmin(req.body || {});
    if (result.error) return res.status(400).json({ error: "oplysninger", message: result.error });
    return res.json({ ...pricing.adminView(), cardEnabled: stripe.enabled() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "server", message: "Priserne blev ikke gemt." });
  }
});

app.get("/api/priser", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(pricing.catalog());
});

function originOf(req) {
  const configured = (process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function businessTokens() {
  const phoneDigits = String(config.phone || "").replace(/\D/g, "");
  const tel = phoneDigits.startsWith("45") ? `+${phoneDigits}` : `+45${phoneDigits}`;
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${config.street}, ${config.postal} ${config.city}`
  )}`;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${config.lat},${config.lng}`;
  return {
    PHONE: config.phoneDisplay || config.phone,
    PHONE_TEL: tel,
    EMAIL: config.email,
    PAYPAL: config.paypal,
    IBAN: config.iban,
    IBAN_PRETTY: config.ibanPretty,
    BIC: config.bic,
    BANK: config.bank,
    HOLDER: config.accountHolder,
    CVR: String(config.cvr),
    STREET: config.street,
    POSTAL: String(config.postal),
    CITY: config.city,
    LAT: String(config.lat),
    LNG: String(config.lng),
    MAPS_URL: maps,
    MAPS_URL_HTML: maps.replace(/&/g, "&amp;"),
    DIR_URL: dir,
    DIR_URL_HTML: dir.replace(/&/g, "&amp;"),
    TRUSTPILOT_URL: config.trustpilotUrl || `https://dk.trustpilot.com/review/${config.domain}`
  };
}

const TOKENS = businessTokens();

function assetVersion(url) {
  try {
    return Math.round(fs.statSync(path.join(PUBLIC, url)).mtimeMs).toString(36);
  } catch (err) {
    return "0";
  }
}

const TRANSLATED_TOKENS = ["PAY_LIST", "PAY_LIST_CAP", "PAY_ACCEPTED", "PARTS_DELIVERY"];

function countryOptions(lang) {
  const names = new Intl.DisplayNames([i18n.LANGS[lang].locale], { type: "region" });
  const list = i18n.EU.map((code) => ({ code, name: names.of(code) })).sort((a, b) => a.name.localeCompare(b.name, i18n.LANGS[lang].locale));
  return `<option value="">${i18n.t(lang, "Vælg land")}</option>` + list.map((item) => `<option value="${item.code}">${item.name}</option>`).join("");
}

function payTokens(paypal) {
  return {
    PAY_LIST: paypal ? "kort, MobilePay, Klarna, Apple Pay eller PayPal" : "kort, MobilePay, Klarna eller Apple Pay",
    PAY_LIST_CAP: paypal ? "Kort, MobilePay, Klarna, Apple Pay eller PayPal" : "Kort, MobilePay, Klarna eller Apple Pay",
    PAY_ACCEPTED: paypal ? "Kort, MobilePay, Klarna, Apple Pay, Google Pay, PayPal" : "Kort, MobilePay, Klarna, Apple Pay, Google Pay"
  };
}

/** Every short server text a page can show, so the translations exist before anyone asks. */
function translationStrings() {
  const out = ["Fragt", "Vælg land", parts.publicData().deliveryText, platform.DELIVERY_NOTE, ...Object.values(platform.PARTS_TEXT), ...Object.values(BOOK_ERRORS), ...shop.strings()];
  out.push("Dit sagsnummer er <strong>{{REF}}</strong>. Gem det sammen med den e-mail, du skrev.");
  out.push("Hvis du netop har sendt en sag, så gem sagsnummeret fra kvitteringen.");
  for (const paypal of [true, false]) out.push(...Object.values(payTokens(paypal)));
  out.push(...i18n.collect(buyback.publicData()), ...i18n.collect(parts.publicData()), ...i18n.collect(pricing.catalog()));
  pricing.priceTablesHtml((text) => {
    out.push(text);
    return text;
  });
  for (const part of parts.list()) out.push(`${part.label} til ${part.modelName}`);
  const sell = buyback.publicData();
  for (const group of sell.groups) {
    for (const model of group.models) {
      const tries = [{}];
      for (const question of sell.questions) {
        for (const option of question.options) tries.push(question.multi ? { [question.id]: [option.id] } : { [question.id]: option.id });
      }
      for (const answers of tries) {
        const variant = model.variants.length ? model.variants[0].id : "";
        const quote = buyback.quote({ modelId: model.id, variant, answers });
        if (quote) out.push(...quote.lines);
      }
      if (model.variants.length) out.push(...buyback.quote({ modelId: model.id, answers: {} }).lines);
    }
  }
  return out;
}

function render(file, req, extra = {}) {
  const lang = req.lang || "da";
  const tr = (text) => i18n.t(lang, text);
  const page = file === "admin.html" ? path.join(PUBLIC, file) : i18n.source(lang, `public/${file}`);
  let html = fs.readFileSync(page, "utf8");
  const header = i18n.read(lang, "partials/header.html");
  const footer = i18n.read(lang, "partials/footer.html");
  html = html.replace("{{HEADER}}", header).replace("{{FOOTER}}", footer);
  const payLogos = i18n.read(lang, "partials/pay-logos.html");
  html = html.replaceAll("{{PAY_LOGOS}}", payLogos);
  html = html.replace(/(href|src)="(\/(?:css|js)\/[\w.-]+\.(?:css|js))"/g, (match, attr, url) => {
    return `${attr}="${url}?v=${assetVersion(url)}"`;
  });
  const card = stripe.enabled();
  const paypal = stripe.paypalEnabled();
  html = html
    .replace(/<!--IF_CARD-->([\s\S]*?)<!--END_IF_CARD-->/g, card ? "$1" : "")
    .replace(/<!--IF_NOCARD-->([\s\S]*?)<!--END_IF_NOCARD-->/g, card ? "" : "$1")
    .replace(/<!--IF_PAYPAL-->([\s\S]*?)<!--END_IF_PAYPAL-->/g, paypal ? "$1" : "");
  const origin = originOf(req);
  const tokens = {
    ORIGIN: origin,
    YEAR: String(new Date().getFullYear()),
    BOOK_ERROR: "",
    REF_HTML: "",
    CARD_ENABLED: card ? "1" : "",
    PAYPAL_ENABLED: paypal ? "1" : "",
    ...payTokens(paypal),
    ...TOKENS,
    ...pricing.rangeTokens()
  };
  const json = (data) => JSON.stringify(i18n.deep(lang, data)).replace(/</g, "\\u003c");
  if (html.includes("{{PRICE_JSON}}")) tokens.PRICE_JSON = json(pricing.catalog({ withTest: isAdmin(req) }));
  if (html.includes("{{PRICE_TABLES}}")) tokens.PRICE_TABLES = pricing.priceTablesHtml(tr);
  if (html.includes("{{PRICE_LD}}")) tokens.PRICE_LD = pricing.offerCatalogJson(origin);
  if (html.includes("{{PRICE_UPDATED}}")) {
    const updated = pricing.adminView().marketUpdated;
    tokens.PRICE_UPDATED = new Intl.DateTimeFormat(i18n.LANGS[lang].locale, { dateStyle: "long" }).format(new Date(updated));
  }
  if (html.includes("{{SELL_JSON}}")) tokens.SELL_JSON = json(buyback.publicData());
  if (html.includes("{{SELL_EU_SHIP}}")) tokens.SELL_EU_SHIP = String(buyback.publicData().euShippingDkk);
  if (html.includes("{{PARTS_JSON}}")) tokens.PARTS_JSON = json(parts.publicData());
  if (html.includes("{{PARTS_DELIVERY}}")) tokens.PARTS_DELIVERY = parts.publicData().deliveryText;
  tokens.VISION_ENABLED = vision.enabled() ? "1" : "";
  for (const key of ["ydelser", "priser", "betaling", "om", "kontakt", "sag", "book", "saelg", "koeb", "reservedele", "partner"]) {
    tokens[`NAV_${key}`] = extra.nav === key ? 'aria-current="page"' : "";
  }
  for (const key of TRANSLATED_TOKENS) tokens[key] = tr(tokens[key]);
  if (html.includes("{{EU_COUNTRIES}}")) tokens.EU_COUNTRIES = countryOptions(lang);
  tokens.LANG_MENU = "<!--LANG_MENU-->";
  Object.assign(tokens, extra.tokens || {});
  for (const [key, value] of Object.entries(tokens)) {
    html = html.replaceAll(`{{${key}}}`, String(value));
  }
  const verify = String(config.googleSiteVerification || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (verify) {
    html = html.replace("</head>", `  <meta name="google-site-verification" content="${verify}">\n</head>`);
  }
  const left = html.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (left) console.warn(`Mangler erstatning i ${file}: ${left.join(", ")}`);
  if (file === "admin.html") return html;
  const pathName = extra.path || req.path;
  const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  html = i18n.localizeHtml(html, lang, { origin, pathName });
  return html.replace("<!--LANG_MENU-->", i18n.langMenu(lang, pathName, search));
}

/** Rendered pages are the same for every visitor, so each one is built at most once per PAGE_TTL_MS. */
const pageCache = new Map();
const PAGE_TTL_MS = 15 * 1000;
const PAGE_CACHE_MAX = 2000;

function cachedRender(file, req, extra) {
  if (file === "admin.html" || isAdmin(req)) return render(file, req, extra);
  const key = [file, req.lang || "da", originOf(req), req.path, req.url, extra.nav, JSON.stringify(extra.tokens || {})].join("\n");
  const now = Date.now();
  const hit = pageCache.get(key);
  if (hit && hit.until > now) return hit.html;
  const html = render(file, req, extra);
  if (pageCache.size >= PAGE_CACHE_MAX) pageCache.clear();
  pageCache.set(key, { html, until: now + PAGE_TTL_MS });
  return html;
}

function send(req, res, file, nav, tokens) {
  if (file === "admin.html" || file === "book-tak.html" || platform.NOINDEX.includes(file) || shop.NOINDEX.includes(file)) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }
  res.setHeader("Cache-Control", "no-cache");
  if (file !== "admin.html") i18n.rememberLang(res, req.lang || "da");
  res.type("html").send(cachedRender(file, req, { nav, tokens }));
}

const BOOK_ERRORS = {
  oplysninger: "Tjek felterne og prøv igen. Navn, telefon, e-mail og en kort beskrivelse af fejlen skal udfyldes.",
  mange: "Der er sendt mange forespørgsler lige nu. Vent lidt, eller ring {{PHONE}}.",
  betaling: "Betal nu kan kun vælges ved en fast pris. Vælg at betale bagefter.",
  server: "Sagen blev ikke gemt. Ring {{PHONE}}, så vi tager den alligevel."
};

platform.register(app, { config, limited, clientIp, cleanLine, cleanText, sameEmail, requireAdmin, originOf, send });
shop.register(app, { config, limited, clientIp, cleanLine, cleanText, requireAdmin, originOf, send });

app.get("/", (req, res) => send(req, res, "index.html", ""));
app.get("/ydelser", (req, res) => send(req, res, "ydelser.html", "ydelser"));
app.get("/priser", (req, res) => send(req, res, "priser.html", "priser"));
app.get("/betaling", (req, res) => send(req, res, "betaling.html", "betaling"));
app.get("/om", (req, res) => send(req, res, "om.html", "om"));
app.get("/handelsbetingelser", (req, res) => send(req, res, "handelsbetingelser.html", ""));
app.get("/privatlivspolitik", (req, res) => send(req, res, "privatlivspolitik.html", ""));
app.get("/kontakt", (req, res) => send(req, res, "kontakt.html", "kontakt"));
app.get("/sag", (req, res) => send(req, res, "sag.html", "sag"));
app.get("/admin", (req, res) => send(req, res, "admin.html", ""));

const LANDING_PAGES = [
  "iphone-reparation-aalborg",
  "skaermskift-aalborg",
  "computer-reparation-aalborg",
  "ipad-reparation-aalborg",
  "samsung-reparation-aalborg",
  "batteriskift-aalborg",
  "macbook-reparation-aalborg",
  "google-pixel-reparation-aalborg",
  "android-reparation-aalborg",
  "vandskade-aalborg"
];
for (const page of LANDING_PAGES) {
  app.get(`/${page}`, (req, res) => send(req, res, `${page}.html`, "ydelser"));
}
app.get("/book", (req, res) => {
  const code = cleanLine(req.query.fejl, 40);
  const message = BOOK_ERRORS[code] ? i18n.t(req.lang, BOOK_ERRORS[code]).replace("{{PHONE}}", TOKENS.PHONE) : "";
  const box = message ? `<p class="form-error" role="alert">${message}</p>` : "";
  send(req, res, "book.html", "book", { BOOK_ERROR: box });
});
app.get("/book/tak", (req, res) => {
  const ref = normRef(req.query.ref);
  const html = ref
    ? i18n.t(req.lang, "Dit sagsnummer er <strong>{{REF}}</strong>. Gem det sammen med den e-mail, du skrev.").replace("{{REF}}", ref)
    : i18n.t(req.lang, "Hvis du netop har sendt en sag, så gem sagsnummeret fra kvitteringen.");
  send(req, res, "book-tak.html", "book", { REF_HTML: html });
});

app.get("/i18n/:lang/js/:file", (req, res, next) => {
  const { lang, file } = req.params;
  if (!i18n.FOREIGN.includes(lang) || !i18n.SCRIPTS.includes(file)) return next();
  res.type("application/javascript");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(i18n.localizeScript(i18n.read(lang, `public/js/${file}`), lang));
});

app.get("/robots.txt", (req, res) => {
  const origin = originOf(req);
  res.type("text/plain").send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /book/tak\nDisallow: /saelg/tak\nDisallow: /saelg/sag\nDisallow: /reservedele/tak\nDisallow: /koeb/tak\n\nSitemap: ${origin}/sitemap.xml\n`
  );
});

app.get(/^\/google[0-9a-f]+\.html$/, (req, res, next) => {
  const name = req.path.slice(1);
  if (name !== config.googleVerificationFile) return next();
  res.type("text/html").send(`google-site-verification: ${name}`);
});

app.get("/sitemap.xml", async (req, res) => {
  const origin = originOf(req);
  const pages = [
    ["/", "index.html", "1.0"],
    ["/priser", "priser.html", "0.9"],
    ["/saelg", "saelg.html", "0.9"],
    ["/koeb", "koeb.html", "0.9"],
    ...(await shop.sitemapPaths()).map((page) => [page, "koeb-vare.html", "0.7"]),
    ["/reservedele", "reservedele.html", "0.8"],
    ["/partner", "partner.html", "0.6"],
    ["/iphone-reparation-aalborg", "iphone-reparation-aalborg.html", "0.9"],
    ["/samsung-reparation-aalborg", "samsung-reparation-aalborg.html", "0.9"],
    ["/google-pixel-reparation-aalborg", "google-pixel-reparation-aalborg.html", "0.8"],
    ["/android-reparation-aalborg", "android-reparation-aalborg.html", "0.8"],
    ["/vandskade-aalborg", "vandskade-aalborg.html", "0.8"],
    ["/skaermskift-aalborg", "skaermskift-aalborg.html", "0.9"],
    ["/batteriskift-aalborg", "batteriskift-aalborg.html", "0.9"],
    ["/computer-reparation-aalborg", "computer-reparation-aalborg.html", "0.9"],
    ["/macbook-reparation-aalborg", "macbook-reparation-aalborg.html", "0.8"],
    ["/ipad-reparation-aalborg", "ipad-reparation-aalborg.html", "0.9"],
    ["/ydelser", "ydelser.html", "0.8"],
    ["/book", "book.html", "0.8"],
    ["/kontakt", "kontakt.html", "0.8"],
    ["/betaling", "betaling.html", "0.6"],
    ["/om", "om.html", "0.6"],
    ["/handelsbetingelser", "handelsbetingelser.html", "0.3"],
    ["/privatlivspolitik", "privatlivspolitik.html", "0.3"],
    ["/sag", "sag.html", "0.3"],
    ...parts.publicData().groups.flatMap((group) => group.models.map((model) => [`/reservedele/${model.id}`, "reservedele.html", "0.7"]))
  ];
  const body = pages
    .flatMap(([page, file, priority]) => {
      const lastmod = fs.statSync(path.join(PUBLIC, file)).mtime.toISOString().slice(0, 10);
      const alternates = i18n.CODES.map((code) => `<xhtml:link rel="alternate" hreflang="${code}" href="${origin}${i18n.pagePath(code, page)}"/>`).join("");
      return i18n.CODES.map((code) => {
        const weight = code === "da" ? priority : (Number(priority) * 0.8).toFixed(1);
        return `  <url><loc>${origin}${i18n.pagePath(code, page)}</loc><lastmod>${lastmod}</lastmod><priority>${weight}</priority>${alternates}</url>`;
      });
    })
    .join("\n");
  res
    .type("application/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`);
});

app.get(/\.html$/, (req, res) => {
  let clean = req.path.replace(/\.html$/, "");
  if (clean === "/index") clean = "/";
  res.redirect(301, clean || "/");
});
app.get("/favicon.ico", (req, res) => res.redirect("/favicon.svg"));
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/admin/sprog", requireAdmin, (req, res) => res.json(i18n.status()));
app.post("/api/admin/sprog", requireAdmin, (req, res) => {
  void i18n.build();
  res.json(i18n.status());
});

app.use(
  express.static(PUBLIC, {
    index: false,
    maxAge: "1d",
    setHeaders: (res, file) => {
      if (/\.(js|css|html|json|webmanifest|xml|txt)$/i.test(file)) res.setHeader("Cache-Control", "no-cache");
    }
  })
);
app.use("/api", (req, res) => res.status(404).json({ error: "findes_ikke" }));
app.use((req, res) => {
  res.status(404);
  send(req, res, "404.html", "");
});

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (entry.family === "IPv4" && !entry.internal) urls.push(`http://${entry.address}:${PORT}`);
    }
  }
  return urls;
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`TeknikFix kører på http://localhost:${PORT}`);
  console.log(`Sager: http://localhost:${PORT}/admin`);
  for (const url of lanUrls()) console.log(`Samme netværk: ${url}`);
  console.log("Luk ikke dette vindue, mens siden skal være i gang.");
  stripe.watchMethods();
  if (i18n.enabled() && process.env.TRANSLATE !== "0") {
    setTimeout(() => {
      i18n
        .prewarm(translationStrings())
        .then(() => i18n.build())
        .catch((error) => console.error(`Oversættelse: ${error.message}`));
    }, 2000).unref();
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} er optaget. Luk det andet vindue, eller skift PORT i .env.`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
