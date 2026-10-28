// Repair jobs for partner repairers. The owner offers a booking as a job with a fixed payout, approved
// partners log in with a one-time code sent by e-mail, take the job and report progress. Customer details
// are only shown to the partner who took the job.
const path = require("path");
const crypto = require("crypto");
const notify = require("./notify");
const customer = require("./customer");
const { createStore, makeRef, normRef } = require("./store");

const DATA = path.join(__dirname, "data");
const jobs = createStore(path.join(DATA, "jobs.json"));
const partners = createStore(path.join(DATA, "partners.json"));

const JOB_STATUS = {
  aaben: "Ledig",
  taget: "Taget",
  i_gang: "I gang",
  faerdig: "Færdig, venter på udbetaling",
  kunne_ikke: "Kunne ikke laves",
  udbetalt: "Udbetalt",
  annulleret: "Trukket tilbage"
};
const DEVICE_LABEL = { telefon: "Telefon", tablet: "Tablet", computer: "Computer", andet: "Andet" };
const VISIT_TEXT = {
  hjemme: "Hos kunden",
  vaerksted: "Hent og aflever hos TeknikFix, Aalborg Øst",
  post: "Hent og aflever hos TeknikFix, Aalborg Øst",
  "paa-stedet": "Hos kunden",
  konsultation: "Aftales med kunden"
};
const PAYOUT_SHARE = 0.5;
const CODE_TTL_MS = 15 * 60 * 1000;
const COOKIE_DAYS = 30;
const OPEN_FOR_PARTNER = ["taget", "i_gang"];
const BOOKING_PAYABLE = ["ny", "kontaktet", "bekraeftet", "tilbud", "godkendt", "i_gang"];

const codes = new Map();

function secret() {
  return process.env.SESSION_SECRET || "";
}

function sign(body) {
  return crypto.createHmac("sha256", secret()).update(`partner.${body}`).digest("hex");
}

function partnerToken(ref) {
  const body = `${ref}.${Date.now() + COOKIE_DAYS * 24 * 60 * 60 * 1000}`;
  return `${body}.${sign(body)}`;
}

function partnerFromCookie(req) {
  if (!secret()) return "";
  const match = (req.headers.cookie || "").match(/(?:^|; )tf_partner=([^;]+)/);
  if (!match) return "";
  const parts = decodeURIComponent(match[1]).split(".");
  if (parts.length !== 3) return "";
  const body = `${parts[0]}.${parts[1]}`;
  const left = Buffer.from(parts[2]);
  const right = Buffer.from(sign(body));
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return "";
  if (!(Number(parts[1]) > Date.now())) return "";
  return normRef("RP", parts[0]);
}

function hashCode(email, code) {
  return crypto.createHash("sha256").update(`${secret()}:${email}:${code}`).digest("hex");
}

function kr(amount) {
  return `${new Intl.NumberFormat("da-DK").format(amount)} kr`;
}

function bookingPrice(booking) {
  if (Number.isInteger(booking.priceDkk) && booking.priceDkk > 0) return booking.priceDkk;
  if (booking.estimate && !booking.estimate.from && Number.isInteger(booking.estimate.priceDkk)) return booking.estimate.priceDkk;
  return null;
}

function suggestPayout(booking) {
  const price = bookingPrice(booking) || (booking.estimate && booking.estimate.priceDkk) || 0;
  return Math.max(0, Math.round((price * PAYOUT_SHARE) / 50) * 50);
}

function areaOf(booking) {
  if (booking.visit === "hjemme" || booking.visit === "paa-stedet") {
    const match = String(booking.address || "").match(/\b(\d{4})\s+([A-Za-zÆØÅæøåÉéÖöÄäÜü .-]{2,30})/);
    return match ? `${VISIT_TEXT[booking.visit]}, ${match[1]} ${match[2].trim()}` : VISIT_TEXT[booking.visit];
  }
  return VISIT_TEXT[booking.visit] || "Aftales med kunden";
}

function jobFromBooking(booking, payoutDkk, note) {
  return {
    bookingRef: booking.ref,
    device: booking.device,
    model: booking.model || DEVICE_LABEL[booking.device] || "",
    task: booking.estimate ? booking.estimate.label : String(booking.problem || "").slice(0, 300),
    area: areaOf(booking),
    when: booking.when === "tidspunkt" ? booking.timeNote : booking.when === "i-dag" ? "I dag" : "Hurtigst muligt",
    priceDkk: bookingPrice(booking),
    payoutDkk,
    note
  };
}

function openView(job) {
  return {
    ref: job.ref,
    createdAt: job.createdAt,
    device: job.device,
    deviceLabel: DEVICE_LABEL[job.device] || "",
    model: job.model,
    task: job.task,
    area: job.area,
    when: job.when,
    payoutDkk: job.payoutDkk,
    note: job.note,
    status: job.status,
    statusLabel: JOB_STATUS[job.status]
  };
}

function mineView(job, booking) {
  return {
    ...openView(job),
    takenAt: job.takenAt,
    doneAt: job.doneAt || null,
    paidAt: job.paidAt || null,
    priceDkk: job.priceDkk,
    customer: booking && OPEN_FOR_PARTNER.includes(job.status)
      ? { name: booking.name, phone: booking.phone, email: booking.email, address: booking.address || "", problem: booking.problem, timeNote: booking.timeNote || "" }
      : null
  };
}

function event(job, text) {
  job.events = job.events || [];
  job.events.push({ at: new Date().toISOString(), text });
  job.updatedAt = new Date().toISOString();
}

function fits(partner, device) {
  return device === "andet" || (partner.skills || []).includes(device);
}

function register(app, ctx) {
  const { config, limited, clientIp, cleanLine, cleanText, requireAdmin, send, bookings, statusLabel } = ctx;

  async function approvedPartner(ref) {
    if (!ref) return null;
    const list = await partners.all();
    return list.find((entry) => entry.ref === ref && entry.status === "godkendt") || null;
  }

  async function requirePartner(req, res, next) {
    const partner = await approvedPartner(partnerFromCookie(req));
    if (!partner) return res.status(401).json({ error: "login", message: "Log ind igen." });
    req.partner = partner;
    return next();
  }

  function setCookie(req, res, value, maxAge) {
    const secure = req.protocol === "https" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `tf_partner=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  }

  async function mailNewJob(job) {
    const list = await partners.all();
    const targets = list.filter((partner) => partner.status === "godkendt" && fits(partner, job.device));
    const origin = (process.env.SITE_URL || "").replace(/\/$/, "");
    for (const partner of targets) {
      void customer.sendMailTo(
        { ref: job.ref, name: partner.name, email: partner.email, lang: partner.lang },
        `Ny opgave: ${job.model} · ${kr(job.payoutDkk)}`,
        [`${job.task}`, `${job.area}. ${job.when}.`, `Du får ${kr(job.payoutDkk)} for opgaven. Den første, der siger ja, får den.`],
        config,
        origin ? { label: "Se opgaven", url: `${origin}/partner/opgaver` } : null
      );
    }
    return targets.length;
  }

  // ---------- Partner login ----------
  app.post("/api/partner/kode", async (req, res) => {
    if (!secret()) return res.status(503).json({ error: "server", message: "Login er ikke sat op endnu." });
    if (limited(`partnerkode:${clientIp(req)}`, 6, 60 * 60 * 1000)) return res.status(429).json({ error: "mange", message: "Vent lidt, og prøv igen." });
    const email = cleanLine(req.body && req.body.email, 120).toLowerCase();
    const reply = { ok: true, message: "Er du godkendt som reparatør, har vi sendt en kode til din e-mail." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "oplysninger", message: "Skriv en gyldig e-mail." });
    const list = await partners.all();
    const partner = list.find((entry) => entry.email === email);
    if (!partner) return res.json(reply);
    if (partner.status !== "godkendt") return res.json({ ok: true, message: "Din profil er ikke godkendt endnu. Vi ringer, når den er." });
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    codes.set(email, { hash: hashCode(email, code), exp: Date.now() + CODE_TTL_MS, tries: 0, ref: partner.ref });
    if (customer.mailEnabled()) {
      void customer.sendMailTo(
        { ref: partner.ref, name: partner.name, email: partner.email, lang: partner.lang },
        `Din kode: ${code}`,
        [`Din kode til TeknikFix er ${code}. Den virker i 15 minutter.`, "Har du ikke bedt om den, kan du bare slette mailen."],
        config,
        null
      );
    } else {
      console.log(`Partner-kode til ${partner.ref}: ${code} (mail er ikke sat op)`);
    }
    return res.json(reply);
  });

  app.post("/api/partner/login", async (req, res) => {
    if (!secret()) return res.status(503).json({ error: "server", message: "Login er ikke sat op endnu." });
    if (limited(`partnerlogin:${clientIp(req)}`, 20, 60 * 60 * 1000)) return res.status(429).json({ error: "mange", message: "Vent lidt, og prøv igen." });
    const email = cleanLine(req.body && req.body.email, 120).toLowerCase();
    const code = cleanLine(req.body && req.body.code, 10).replace(/\D/g, "");
    const entry = codes.get(email);
    const wrong = { error: "login", message: "Koden passer ikke, eller den er for gammel. Bed om en ny." };
    if (!entry || entry.exp < Date.now() || entry.tries >= 5) {
      codes.delete(email);
      return res.status(401).json(wrong);
    }
    entry.tries += 1;
    const left = Buffer.from(entry.hash);
    const right = Buffer.from(hashCode(email, code));
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return res.status(401).json(wrong);
    codes.delete(email);
    if (!(await approvedPartner(entry.ref))) return res.status(401).json(wrong);
    setCookie(req, res, partnerToken(entry.ref), COOKIE_DAYS * 24 * 60 * 60);
    return res.json({ ok: true });
  });

  app.post("/api/partner/logud", (req, res) => {
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  // ---------- Partner job board ----------
  app.get("/api/partner/opgaver", requirePartner, async (req, res) => {
    const partner = req.partner;
    const list = await jobs.all();
    const mine = list.filter((job) => job.partnerRef === partner.ref);
    const bookingList = await Promise.all(mine.map((job) => (OPEN_FOR_PARTNER.includes(job.status) ? bookings.get(job.bookingRef) : null)));
    res.json({
      partner: { ref: partner.ref, name: partner.name, city: partner.city },
      open: list
        .filter((job) => job.status === "aaben" && fits(partner, job.device))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map(openView),
      mine: mine
        .map((job, i) => mineView(job, bookingList[i]))
        .sort((a, b) => (a.takenAt < b.takenAt ? 1 : -1)),
      earned: {
        waiting: mine.filter((job) => job.status === "faerdig").reduce((sum, job) => sum + job.payoutDkk, 0),
        paid: mine.filter((job) => job.status === "udbetalt").reduce((sum, job) => sum + job.payoutDkk, 0)
      }
    });
  });

  app.post("/api/partner/opgaver/:ref/tag", requirePartner, async (req, res) => {
    const partner = req.partner;
    const ref = normRef("OP", req.params.ref);
    const taken = await jobs.withList((list) => {
      const job = list.find((entry) => entry.ref === ref);
      if (!job) return { save: false, value: null };
      if (job.status !== "aaben" || !fits(partner, job.device)) return { save: false, value: { gone: true } };
      job.status = "taget";
      job.partnerRef = partner.ref;
      job.partnerName = partner.name;
      job.takenAt = new Date().toISOString();
      event(job, `Taget af ${partner.name} (${partner.ref})`);
      return { save: true, value: job };
    });
    if (!taken) return res.status(404).json({ error: "ikke_fundet", message: "Opgaven findes ikke." });
    if (taken.gone) return res.status(409).json({ error: "taget", message: "En anden har lige taget opgaven." });
    const toCustomer = `${String(partner.name).split(" ")[0]} fra TeknikFix laver din reparation og kontakter dig for at aftale tid.`;
    const booking = await bookings.change(taken.bookingRef, (item) => {
      const now = new Date().toISOString();
      item.events.push({ at: now, public: false, text: `Partner ${partner.name} (${partner.ref}) har taget opgaven ${taken.ref}.` });
      item.events.push({ at: now, public: true, text: toCustomer });
    });
    if (booking) void customer.caseUpdated(booking, { message: toCustomer }, config);
    void notify.send({
      title: `Opgave taget · ${taken.ref}`,
      message: `${partner.name} tog ${taken.model}: ${taken.task}\nSag ${taken.bookingRef} · ${kr(taken.payoutDkk)} til partneren`,
      tags: ["handshake"],
      booking: { ref: taken.bookingRef, phone: partner.phone }
    });
    return res.json({ ok: true });
  });

  const PARTNER_MOVES = {
    i_gang: ["taget"],
    faerdig: ["taget", "i_gang"],
    kunne_ikke: ["taget", "i_gang"],
    aaben: ["taget"]
  };

  app.post("/api/partner/opgaver/:ref/status", requirePartner, async (req, res) => {
    const partner = req.partner;
    const ref = normRef("OP", req.params.ref);
    const status = cleanLine(req.body && req.body.status, 20);
    const note = cleanText(req.body && req.body.note, 600);
    if (!PARTNER_MOVES[status]) return res.status(400).json({ error: "oplysninger", message: "Ukendt status." });
    if (status === "kunne_ikke" && note.length < 5) return res.status(400).json({ error: "oplysninger", message: "Skriv kort, hvorfor den ikke kunne laves." });
    const job = await jobs.withList((list) => {
      const found = list.find((entry) => entry.ref === ref && entry.partnerRef === partner.ref);
      if (!found) return { save: false, value: null };
      if (!PARTNER_MOVES[status].includes(found.status)) return { save: false, value: { bad: true } };
      if (status === "aaben") {
        event(found, `${partner.name} gav opgaven tilbage${note ? `: ${note}` : ""}`);
        found.partnerRef = null;
        found.partnerName = null;
        found.takenAt = null;
      } else {
        event(found, `${JOB_STATUS[status]}${note ? `: ${note}` : ""}`);
      }
      found.status = status;
      if (status === "faerdig") found.doneAt = new Date().toISOString();
      return { save: true, value: found };
    });
    if (!job) return res.status(404).json({ error: "ikke_fundet", message: "Opgaven findes ikke." });
    if (job.bad) return res.status(409).json({ error: "status", message: "Opgaven er allerede flyttet. Opdater siden." });

    let newStatus = "";
    let price = null;
    let prepaid = false;
    const booking = await bookings.change(job.bookingRef, (item) => {
      const now = new Date().toISOString();
      prepaid = item.status === "betalt";
      item.events.push({ at: now, public: false, text: `Partner ${partner.name}: ${JOB_STATUS[status]}${note ? ` (${note})` : ""} · ${job.ref}` });
      if (status === "i_gang" && BOOKING_PAYABLE.includes(item.status) && item.status !== "i_gang") newStatus = "i_gang";
      price = bookingPrice(item);
      if (status === "faerdig" && BOOKING_PAYABLE.includes(item.status) && price) {
        newStatus = "afventer_betaling";
        item.priceDkk = price;
      }
      if (newStatus) {
        item.status = newStatus;
        item.events.push({ at: now, public: true, text: `Status: ${statusLabel[newStatus] || newStatus}` });
      }
    });
    if (booking && newStatus) void customer.caseUpdated(booking, { status: newStatus }, config);

    const lines = { i_gang: "er gået i gang", faerdig: "er færdig", kunne_ikke: "kunne ikke lave den", aaben: "gav den tilbage" };
    let extra = "";
    if (status === "faerdig") {
      if (newStatus) extra = `Kunden har fået betalingslink på ${kr(price)}. Udbetal ${kr(job.payoutDkk)}, når kunden har betalt.`;
      else if (prepaid) extra = `Kunden har betalt på forhånd. Udbetal ${kr(job.payoutDkk)} til partneren.`;
      else extra = "Sæt prisen på sagen, så kunden kan betale.";
    }
    if (status === "aaben") extra = "Opgaven er ledig igen for andre partnere.";
    if (status === "kunne_ikke") extra = "Tag stilling til sagen.";
    void notify.send({
      title: `${partner.name} ${lines[status]} · ${job.ref}`,
      message: [`${job.model}: ${job.task}`, note, extra].filter(Boolean).join("\n"),
      tags: [status === "faerdig" ? "white_check_mark" : status === "i_gang" ? "wrench" : "warning"],
      priority: status === "i_gang" ? 2 : 4,
      booking: { ref: job.bookingRef, phone: partner.phone }
    });
    if (status === "aaben") void mailNewJob(job);
    return res.json({ ok: true });
  });

  // ---------- Admin ----------
  app.get("/api/admin/opgaver", requireAdmin, async (req, res) => {
    const list = await jobs.all();
    const partnerList = await partners.all();
    res.json({
      items: [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      statuses: JOB_STATUS,
      approvedPartners: partnerList.filter((partner) => partner.status === "godkendt").length
    });
  });

  app.get("/api/admin/opgaver/forslag/:bookingRef", requireAdmin, async (req, res) => {
    const booking = await bookings.get(cleanLine(req.params.bookingRef, 20).toUpperCase());
    if (!booking) return res.status(404).json({ error: "ikke_fundet" });
    const list = await jobs.all();
    const existing = list.find((job) => job.bookingRef === booking.ref && job.status !== "annulleret");
    res.json({ payoutDkk: suggestPayout(booking), priceDkk: bookingPrice(booking), existing: existing ? { ref: existing.ref, status: JOB_STATUS[existing.status] } : null });
  });

  app.post("/api/admin/opgaver", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const booking = await bookings.get(cleanLine(body.bookingRef, 20).toUpperCase());
    if (!booking) return res.status(404).json({ error: "ikke_fundet", message: "Sagen findes ikke." });
    const payoutDkk = Number(body.payoutDkk);
    if (!Number.isInteger(payoutDkk) || payoutDkk < 50 || payoutDkk > 20000) {
      return res.status(400).json({ error: "oplysninger", message: "Skriv partnerens betaling i hele kroner (mindst 50)." });
    }
    const created = await jobs.withList((list) => {
      const existing = list.find((job) => job.bookingRef === booking.ref && job.status !== "annulleret");
      if (existing) return { save: false, value: { existing } };
      const now = new Date().toISOString();
      const job = { ref: makeRef("OP", list), createdAt: now, updatedAt: now, status: "aaben", partnerRef: null, ...jobFromBooking(booking, payoutDkk, cleanText(body.note, 400)), events: [] };
      event(job, `Sendt til partnere · ${kr(payoutDkk)}`);
      list.push(job);
      return { save: true, value: { job } };
    });
    if (created.existing) return res.status(409).json({ error: "findes", message: `Sagen er allerede sendt som ${created.existing.ref}.` });
    await bookings.change(booking.ref, (item) => {
      item.events.push({ at: new Date().toISOString(), public: false, text: `Sendt til partnere som ${created.job.ref} · ${kr(payoutDkk)}` });
    });
    const mailed = customer.mailEnabled() ? await mailNewJob(created.job) : 0;
    return res.status(201).json({ ...created.job, mailed });
  });

  app.patch("/api/admin/opgaver/:ref", requireAdmin, async (req, res) => {
    const ref = normRef("OP", req.params.ref);
    const body = req.body || {};
    const status = cleanLine(body.status, 20);
    if (status && !["aaben", "udbetalt", "annulleret"].includes(status)) return res.status(400).json({ error: "oplysninger", message: "Ukendt status." });
    const updated = await jobs.withList((list) => {
      const job = list.find((entry) => entry.ref === ref);
      if (!job) return { save: false, value: null };
      if (Object.prototype.hasOwnProperty.call(body, "payoutDkk")) {
        const payout = Number(body.payoutDkk);
        if (!Number.isInteger(payout) || payout < 50 || payout > 20000) return { save: false, value: { bad: "Skriv betalingen i hele kroner." } };
        if (payout !== job.payoutDkk) event(job, `Betaling ændret til ${kr(payout)}`);
        job.payoutDkk = payout;
      }
      if (status && status !== job.status) {
        if (status === "udbetalt" && !job.partnerRef) return { save: false, value: { bad: "Ingen partner har taget opgaven." } };
        if (status === "aaben" && job.status === "annulleret") return { save: false, value: { bad: "Send sagen til partnere igen i stedet." } };
        if (status === "aaben") {
          job.partnerRef = null;
          job.partnerName = null;
          job.takenAt = null;
        }
        if (status === "udbetalt") job.paidAt = new Date().toISOString();
        job.status = status;
        event(job, JOB_STATUS[status]);
      }
      return { save: true, value: job };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    if (updated.bad) return res.status(400).json({ error: "oplysninger", message: updated.bad });
    if (status === "aaben" && customer.mailEnabled()) void mailNewJob(updated);
    return res.json(updated);
  });

  app.get("/partner/opgaver", (req, res) => send(req, res, "partner-opgaver.html", "partner"));
}

module.exports = { register, NOINDEX: ["partner-opgaver.html"] };
