// The platform beyond repairs: buying devices (/saelg), spare parts (/reservedele) and the repairer network (/partner).
const path = require("path");
const express = require("express");
const buyback = require("./buyback");
const parts = require("./parts");
const partsSync = require("./parts-sync");
const vision = require("./vision");
const tac = require("./tac");
const cj = require("./cj");
const stripe = require("./stripe");
const notify = require("./notify");
const customer = require("./customer");
const i18n = require("./i18n");
const { createStore, makeRef, normRef } = require("./store");

const DATA = path.join(__dirname, "data");
const buybacks = createStore(path.join(DATA, "buybacks.json"));
const partOrders = createStore(path.join(DATA, "part-orders.json"));
const partners = createStore(path.join(DATA, "partners.json"));

const DELIVERY_NOTE = "Sendes med sporing. Normal leveringstid {{DAYS}}.";

const PARTS_TEXT = {
  title: "Reservedele til iPhone, Samsung, Pixel og iPad: skærm, batteri og bagglas | TeknikFix",
  desc: "Køb skærm, batteri, bagglas, ladeport og kamera til iPhone, Samsung, Pixel og iPad til lave priser. Find delen til din model, og få den sendt hjem med sporing.",
  h1: "Reservedele",
  lead: "Skærm, batteri, bagglas, ladeport og kamera til din model. Lave priser, og vi sender til hele EU.",
  crumb: "Reservedele",
  modelTitle: "{{MODEL}} reservedele: skærm, batteri og bagglas til lav pris | TeknikFix",
  modelDesc: "Reservedele til {{MODEL}} til lave priser: {{PRICES}}. Passer præcis til din model, og vi sender til hele EU med sporing.",
  modelH1: "Reservedele til {{MODEL}}",
  modelLead: "Skærm, batteri, bagglas, ladeport og kamera, der passer præcis til din {{MODEL}}. Lave priser, og vi sender til hele EU.",
  pricesTitle: "Priser på reservedele til {{MODEL}}",
  allModels: "Find reservedele til din model"
};

function escHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

/** Title, texts, a plain price table and product data for /reservedele and /reservedele/<model>, so search engines see real content. */
function partsPageTokens(lang, origin, modelId) {
  const tr = (text) => i18n.t(lang, text);
  const data = parts.publicData();
  const models = data.groups.flatMap((group) => group.models);
  const model = modelId ? models.find((item) => item.id === modelId) : null;
  if (modelId && !model) return null;
  const links =
    `<h2 class="section-title">${escHtml(tr(PARTS_TEXT.allModels))}</h2>` +
    data.groups
      .map(
        (group) =>
          `<h3>${escHtml(tr(group.name))}</h3><ul class="model-links">` +
          group.models.map((item) => `<li><a href="/reservedele/${escHtml(item.id)}"${item.id === modelId ? ' aria-current="page"' : ""}>${escHtml(item.name)}</a></li>`).join("") +
          "</ul>"
      )
      .join("");
  if (!model) {
    return {
      PARTS_TITLE: escHtml(tr(PARTS_TEXT.title)),
      PARTS_DESC: escHtml(tr(PARTS_TEXT.desc)),
      PARTS_PATH: "/reservedele",
      PARTS_CRUMB: `<span>${escHtml(tr(PARTS_TEXT.crumb))}</span>`,
      PARTS_H1: escHtml(tr(PARTS_TEXT.h1)),
      PARTS_LEAD: escHtml(tr(PARTS_TEXT.lead)),
      PARTS_MODEL: "",
      PARTS_SEO: `<section class="section" style="padding-top:0"><div class="wrap">${links}</div></section>`,
      PARTS_LD: ""
    };
  }
  const fill = (text, extra = {}) => Object.entries({ MODEL: model.name, ...extra }).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, value), tr(text));
  const prices = model.parts.map((part) => `${tr(part.label).toLowerCase()} ${part.priceDkk} kr`).join(", ");
  const pathName = `/reservedele/${model.id}`;
  const rows = model.parts
    .map((part) => `<tr><th>${escHtml(tr(part.label))}<small>${escHtml(tr(part.note))}</small></th><td><strong>${part.priceDkk} kr</strong></td></tr>`)
    .join("");
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: fill(PARTS_TEXT.modelH1),
    itemListElement: model.parts.map((part, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: `${tr(`${part.label} til ${model.name}`)}`,
        description: tr(part.note),
        offers: {
          "@type": "Offer",
          price: String(part.priceDkk),
          priceCurrency: "DKK",
          availability: "https://schema.org/InStock",
          itemCondition: "https://schema.org/NewCondition",
          url: `${origin}${i18n.prefix(lang)}${pathName}`,
          seller: { "@type": "Organization", name: "TeknikFix" }
        }
      }
    }))
  };
  return {
    PARTS_TITLE: escHtml(fill(PARTS_TEXT.modelTitle)),
    PARTS_DESC: escHtml(fill(PARTS_TEXT.modelDesc, { PRICES: prices })),
    PARTS_PATH: pathName,
    PARTS_CRUMB: `<a href="/reservedele">${escHtml(tr(PARTS_TEXT.crumb))}</a><span aria-hidden="true">/</span><span>${escHtml(model.name)}</span>`,
    PARTS_H1: escHtml(fill(PARTS_TEXT.modelH1)),
    PARTS_LEAD: escHtml(fill(PARTS_TEXT.modelLead)),
    PARTS_MODEL: escHtml(model.id),
    PARTS_SEO:
      `<section class="section" style="padding-top:0"><div class="wrap"><h2 class="section-title">${escHtml(fill(PARTS_TEXT.pricesTitle))}</h2>` +
      `<div class="table-wrap"><table class="price-table parts-prices"><tbody>${rows}</tbody></table></div>${links}</div></section>`,
    PARTS_LD: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`
  };
}

const BUY_STATUS = {
  ny: "Tilbud modtaget",
  label_sendt: "Fragtlabel sendt",
  modtaget: "Enheden er modtaget",
  nyt_tilbud: "Nyt tilbud efter tjek",
  godkendt: "Tilbud godkendt",
  udbetalt: "Udbetalt",
  retur: "Sendes retur",
  afvist: "Kan ikke købes",
  annulleret: "Annulleret"
};

const PART_STATUS = {
  afventer: "Afventer betaling",
  betalt: "Betalt, skal bestilles",
  bestilt: "Bestilt hos leverandør",
  afsendt: "Afsendt",
  leveret: "Leveret",
  fejl: "Kræver handling",
  refunderet: "Refunderet",
  annulleret: "Annulleret"
};

const PARTNER_STATUS = { ny: "Ny", godkendt: "Godkendt", pause: "På pause", afvist: "Afvist" };
const SKILLS = { telefon: "Telefoner", tablet: "Tablets", computer: "Computere", mikrolodning: "Mikrolodning", data: "Datagendannelse", konsol: "Konsoller" };

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function digits(value, max = 40) {
  return String(value || "").replace(/\D/g, "").slice(0, max);
}

function country(raw) {
  const code = String(raw || "").trim().toUpperCase();
  return i18n.EU.includes(code) ? code : "";
}

function ibanOk(raw) {
  const text = String(raw || "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(text)) return "";
  let rest = 0;
  for (const char of text.slice(4) + text.slice(0, 4)) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1 ? text : "";
}

function idOk(raw) {
  const text = String(raw || "").replace(/\s/g, "").toUpperCase();
  if (!text) return "";
  if (/^\d{15}$/.test(text)) return vision.luhnOk(text) ? text : null;
  return /^[A-Z0-9]{8,20}$/.test(text) ? text : null;
}

function event(item, text, isPublic = true) {
  const now = new Date().toISOString();
  item.events = item.events || [];
  item.events.push({ at: now, public: isPublic, text });
  item.updatedAt = now;
}

function buyPublic(item) {
  return {
    ref: item.ref,
    createdAt: item.createdAt,
    status: item.status,
    statusLabel: BUY_STATUS[item.status] || item.status,
    validUntil: item.validUntil,
    delivery: item.delivery,
    payoutMethod: item.payout.method,
    offerDkk: item.offerDkk,
    finalDkk: item.finalDkk,
    shippingDeductDkk: item.shippingDeductDkk || 0,
    canAnswer: item.status === "nyt_tilbud",
    items: item.items.map((line) => ({
      modelName: line.modelName,
      storageLabel: line.storageLabel,
      variantLabel: line.variantLabel,
      qty: line.qty,
      offerDkk: line.offerDkk,
      manual: line.manual,
      recycle: line.recycle
    })),
    events: (item.events || []).filter((entry) => entry.public).map((entry) => ({ at: entry.at, text: entry.text }))
  };
}

function partPublic(order) {
  return {
    ref: order.ref,
    status: order.status,
    statusLabel: PART_STATUS[order.status] || order.status,
    items: order.items.map((line) => ({ title: line.title, qty: line.qty, priceDkk: line.priceDkk })),
    shippingDkk: order.shippingDkk,
    totalDkk: order.totalDkk,
    paidDkk: order.paidDkk || 0,
    deliveryText: order.deliveryText,
    tracking: order.tracking || "",
    email: order.customer ? order.customer.email : ""
  };
}

function shippingFrom(session) {
  const ship = (session.collected_information && session.collected_information.shipping_details) || session.shipping_details || {};
  const details = session.customer_details || {};
  const address = ship.address || details.address || {};
  return {
    name: String(ship.name || details.name || "").slice(0, 120),
    email: String(details.email || "").slice(0, 160),
    phone: String(details.phone || "").slice(0, 40),
    line1: String(address.line1 || "").slice(0, 200),
    line2: String(address.line2 || "").slice(0, 200),
    postal: String(address.postal_code || "").slice(0, 20),
    city: String(address.city || "").slice(0, 80),
    country: String(address.country || "DK").slice(0, 2)
  };
}

async function forwardToCj(ref) {
  const list = await partOrders.all();
  const order = list.find((item) => item.ref === ref);
  if (!order || !cj.enabled()) return { skipped: true };
  if (!order.items.every((line) => line.cjVid)) return { skipped: true };
  try {
    const result = await cj.createOrder(order.ref, order.customer, order.items.map((line) => ({ vid: line.cjVid, quantity: line.qty })));
    await partOrders.withList((items) => {
      const target = items.find((item) => item.ref === ref);
      if (!target) return { save: false };
      target.supplier = { ...result, at: new Date().toISOString() };
      target.status = "bestilt";
      event(target, "Bestilt hos leverandøren. Du får sporingsnummer, når pakken er sendt.");
      return { save: true };
    });
    return { forwarded: true };
  } catch (error) {
    console.error(`CJ ${ref}: ${error.message}`);
    await partOrders.withList((items) => {
      const target = items.find((item) => item.ref === ref);
      if (!target) return { save: false };
      target.supplier = { error: error.message, at: new Date().toISOString() };
      target.status = "fejl";
      event(target, `CJ fejlede: ${error.message}`, false);
      return { save: true };
    });
    return { error: error.message };
  }
}

/** Stripe webhook and thank-you page both land here. Safe to call twice. */
async function markPartsPaid(session, config) {
  if (!session || session.payment_status !== "paid") return null;
  const ref = normRef("RD", session.metadata && session.metadata.ref, 6);
  if (!ref) return null;
  let fresh = false;
  const order = await partOrders.withList((list) => {
    const found = list.find((item) => item.ref === ref);
    if (!found) return { save: false, value: null };
    if (found.status !== "afventer") return { save: false, value: found };
    fresh = true;
    found.status = "betalt";
    found.paidAt = new Date().toISOString();
    found.sessionId = session.id;
    found.paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : "";
    found.paidDkk = Math.round(Number(session.amount_total) / 100);
    found.customer = shippingFrom(session);
    event(found, `Betalt ${found.paidDkk} kr. Tak for din ordre.`);
    return { save: true, value: found };
  });
  if (order && fresh) {
    console.log(`Reservedele ${ref} · ${order.paidDkk} kr`);
    void customer.partsPaid(order, config);
    const result = await forwardToCj(ref);
    void notify.partsOrder(order, result);
  }
  return order;
}

async function syncTracking(config) {
  if (!cj.enabled()) return;
  const open = (await partOrders.all()).filter((order) => order.status === "bestilt" && order.supplier && order.supplier.cjOrderId && !order.tracking);
  for (const order of open) {
    try {
      const detail = await cj.orderDetail(order.supplier.cjOrderId);
      if (!detail || !detail.trackNumber) continue;
      const updated = await partOrders.withList((list) => {
        const target = list.find((item) => item.ref === order.ref);
        if (!target || target.tracking) return { save: false, value: null };
        target.tracking = detail.trackNumber;
        target.status = "afsendt";
        event(target, `Pakken er sendt. Sporingsnummer ${detail.trackNumber}.`);
        return { save: true, value: target };
      });
      if (updated) void customer.partsShipped(updated, config);
    } catch (error) {
      console.error(`Sporing ${order.ref}: ${error.message}`);
    }
  }
}

function buybackModels() {
  return buyback.publicData().groups.flatMap((group) => group.models.map((model) => ({ id: model.id, name: model.name, group: group.name })));
}

/** Model from the IMEI numbers, as { modelId, imei, note }, or null when no IMEI is known. */
function modelFromImei(imeis, models) {
  if (!imeis.length) return null;
  for (const imei of imeis) {
    const hit = tac.lookup(imei);
    if (!hit) continue;
    const model = hit.modelId && models.find((entry) => entry.id === hit.modelId);
    if (model) return { modelId: model.id, imei, note: `IMEI-nummeret viser, at det er en ${hit.name || model.name}.` };
    return { modelId: null, imei, note: `IMEI-nummeret viser, at det er en ${hit.name}. Den står ikke på vores liste, så ring eller skriv til os for en pris.` };
  }
  return { modelId: null, imei: imeis[0], note: "" };
}

function registerEarly(app, ctx) {
  app.get("/api/saelg/imei/:imei", (req, res) => {
    if (ctx.limited(`imei:${ctx.clientIp(req)}`, 120, 60 * 60 * 1000)) return res.status(429).json({ error: "mange" });
    const imei = String(req.params.imei || "").replace(/\D/g, "");
    if (!vision.luhnOk(imei)) return res.status(400).json({ error: "imei" });
    const found = modelFromImei([imei], buybackModels());
    return res.json({ modelId: found.modelId, note: found.note });
  });


  // Before the global 80 kb JSON limit: photos are shrunk in the browser, but still need room.
  app.post("/api/saelg/genkend", express.json({ limit: "6mb" }), async (req, res) => {
    if (!vision.enabled()) return res.status(503).json({ error: "slukket", message: "Billedgenkendelse er ikke slået til. Vælg modellen på listen." });
    if (ctx.limited(`genkend:${ctx.clientIp(req)}`, 20, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "mange", message: "Du har sendt mange billeder. Vælg modellen på listen." });
    }
    try {
      const models = buybackModels();
      const result = await vision.identify(req.body && req.body.image, models);
      if (result.error) return res.status(400).json({ error: "billede", message: "Billedet kunne ikke læses. Prøv et andet." });
      const fromImei = modelFromImei(result.imeis || [], models);
      if (fromImei && fromImei.modelId) {
        Object.assign(result, { modelId: fromImei.modelId, imei: fromImei.imei, confidence: "high", note: fromImei.note });
      } else if (fromImei && !result.modelId) {
        result.note =
          fromImei.note ||
          "Vi har udfyldt IMEI-nummeret, men kan ikke se modellen ud fra det. Vælg modellen på listen, eller send et skærmbillede af Indstillinger → Generelt → Om.";
        result.imeiOnly = true;
      }
      delete result.imeis;
      return res.json(result);
    } catch (error) {
      console.error(`Genkend: ${error.message}`);
      return res.status(502).json({ error: "server", message: "Vi kunne ikke læse billedet lige nu. Vælg modellen på listen." });
    }
  });
}

function register(app, ctx) {
  const { config, limited, clientIp, cleanLine, cleanText, sameEmail, requireAdmin, originOf, send } = ctx;

  setInterval(() => void syncTracking(config), 6 * 60 * 60 * 1000).unref();
  partsSync.schedule();

  // ---------- Sell ----------
  app.post("/api/saelg/tilbud", (req, res) => {
    if (limited(`tilbud:${clientIp(req)}`, 600, 60 * 60 * 1000)) return res.status(429).json({ error: "mange" });
    return res.json(buyback.quoteMany(req.body && req.body.items));
  });

  app.post("/api/saelg", async (req, res) => {
    if (limited(`saelg:${clientIp(req)}`, 8, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "mange", message: "Der er sendt mange tilbud. Vent lidt, eller ring til os." });
    }
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    const items = [];
    for (const raw of rawItems) {
      const line = buyback.quote(raw);
      if (!line || line.blocked) continue;
      const id = idOk(raw.imei);
      if (id === null) return res.status(400).json({ error: "imei", message: `IMEI eller serienummer for ${line.modelName} ser forkert ud. Tast *#06# for at se det.` });
      items.push({ ...line, imei: id || "" });
      if (id) tac.learn(id, line.modelId);
    }
    const type = body.sellerType === "firma" ? "firma" : "privat";
    const land = country(body.country);
    const home = land === "DK";
    const companyId = home ? digits(body.cvr, 8) : String(body.cvr || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    const seller = {
      type,
      name: cleanLine(body.name, 80),
      email: cleanLine(body.email, 120).toLowerCase(),
      phone: cleanLine(body.phone, 30),
      address: cleanText(body.address, 200),
      country: land,
      company: type === "firma" ? cleanLine(body.company, 120) : "",
      cvr: type === "firma" ? companyId : ""
    };
    const delivery = body.delivery === "aflever" && home ? "aflever" : "post";
    const mobilepayOk = home || land === "FI";
    const method = body.payoutMethod === "mobilepay" && mobilepayOk ? "mobilepay" : "bank";
    const payout = {
      method,
      mobilepay: method === "mobilepay" ? digits(body.mobilepay || body.phone, 15) : "",
      reg: method === "bank" && home ? digits(body.reg, 4) : "",
      konto: method === "bank" && home ? digits(body.konto, 14) : "",
      iban: method === "bank" && !home ? ibanOk(body.iban) : ""
    };
    const problems = [];
    if (!items.length) problems.push("Tilføj mindst én enhed, vi kan købe.");
    if (seller.name.length < 2) problems.push("Skriv dit navn.");
    if (!emailOk(seller.email)) problems.push("Skriv en gyldig e-mail.");
    if (digits(seller.phone).length < 8) problems.push("Skriv dit telefonnummer.");
    if (!land) problems.push("Vælg dit land.");
    if (seller.address.replace(/\s/g, "").length < 6) problems.push("Skriv din adresse.");
    if (type === "firma" && home && (seller.company.length < 2 || seller.cvr.length !== 8)) problems.push("Skriv firmanavn og CVR-nummer (8 cifre).");
    if (type === "firma" && !home && (seller.company.length < 2 || seller.cvr.length < 4)) problems.push("Skriv firmanavn og momsnummer.");
    if (method === "mobilepay" && payout.mobilepay.length < 8) problems.push("Skriv dit MobilePay-nummer.");
    if (method === "bank" && home && (payout.reg.length !== 4 || payout.konto.length < 6)) problems.push("Skriv reg.nr. (4 cifre) og kontonummer.");
    if (method === "bank" && land && !home && !payout.iban) problems.push("Skriv et gyldigt IBAN-nummer.");
    if (cleanLine(body.consent, 10) !== "ja") problems.push("Bekræft, at du ejer enheden.");
    if (problems.length) return res.status(400).json({ error: "oplysninger", message: problems.join(" ") });

    const quote = buyback.quoteMany(items);
    const shippingDeductDkk = !home && quote.totalDkk > 0 ? Math.min(quote.totalDkk, buyback.publicData().euShippingDkk) : 0;
    const now = new Date();
    const created = await buybacks.withList((list) => {
      const record = {
        ref: makeRef("SL", list),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        status: "ny",
        validDays: quote.validDays,
        validUntil: new Date(now.getTime() + quote.validDays * 86400000).toISOString(),
        lang: req.lang || "da",
        seller,
        delivery,
        payout,
        items,
        offerDkk: quote.totalDkk - shippingDeductDkk,
        shippingDeductDkk,
        finalDkk: null,
        hasManual: quote.hasManual,
        note: cleanText(body.note, 2000),
        notes: [],
        events: [
          {
            at: now.toISOString(),
            public: true,
            text:
              delivery === "aflever"
                ? "Tilbud modtaget. Aflever enheden efter aftale."
                : home
                  ? "Tilbud modtaget. Vi mailer dig en gratis fragtlabel inden for 1 hverdag."
                  : "Tilbud modtaget. Vi mailer dig en fragtlabel inden for 1 hverdag."
          }
        ]
      };
      list.push(record);
      return { save: true, value: record };
    });
    console.log(`Nyt opkøb ${created.ref} · ${created.items.length} linjer · ${created.offerDkk} kr`);
    void notify.newBuyback(created);
    void customer.buybackReceived(created, config);
    return res.status(201).json({ ok: true, ref: created.ref });
  });

  async function findBuyback(ref, email) {
    const list = await buybacks.all();
    const item = list.find((entry) => entry.ref === ref);
    return item && sameEmail(item.seller.email, email) ? item : null;
  }

  app.get("/api/saelg/sag", async (req, res) => {
    const ref = normRef("SL", req.query.ref);
    const item = ref ? await findBuyback(ref, cleanLine(req.query.email, 120)) : null;
    if (!item) return res.status(404).json({ error: "ikke_fundet", message: "Vi kan ikke finde det salg. Tjek nummeret og e-mailen." });
    return res.json(buyPublic(item));
  });

  app.post("/api/saelg/svar", async (req, res) => {
    const ref = normRef("SL", req.body && req.body.ref);
    const email = cleanLine(req.body && req.body.email, 120);
    const accept = Boolean(req.body && req.body.accept);
    let changed = null;
    const result = await buybacks.withList((list) => {
      const item = list.find((entry) => entry.ref === ref);
      if (!item || !sameEmail(item.seller.email, email)) return { save: false, value: { missing: true } };
      if (item.status !== "nyt_tilbud") return { save: false, value: { bad: "Der er ikke et nyt tilbud at svare på." } };
      item.status = accept ? "godkendt" : "retur";
      event(item, accept ? `Du har sagt ja til ${item.finalDkk} kr. Vi udbetaler inden for 1 hverdag.` : "Du har sagt nej. Vi sender enheden gratis retur.");
      changed = item;
      return { save: true, value: buyPublic(item) };
    });
    if (result.missing) return res.status(404).json({ error: "ikke_fundet", message: "Vi kan ikke finde det salg." });
    if (result.bad) return res.status(409).json({ error: "status", message: result.bad });
    if (changed) void notify.buybackAnswer(changed, accept);
    return res.json(result);
  });

  app.get("/api/admin/opkoeb", requireAdmin, async (req, res) => {
    const list = await buybacks.all();
    res.json({ items: [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), statuses: BUY_STATUS, questions: buyback.publicData().questions });
  });

  app.patch("/api/admin/opkoeb/:ref", requireAdmin, async (req, res) => {
    const ref = normRef("SL", req.params.ref);
    const body = req.body || {};
    const message = typeof body.customerMessage === "string" ? cleanText(body.customerMessage, 600) : "";
    let newStatus = "";
    const updated = await buybacks.withList((list) => {
      const item = list.find((entry) => entry.ref === ref);
      if (!item) return { save: false, value: null };
      if (Object.prototype.hasOwnProperty.call(body, "finalDkk")) {
        if (body.finalDkk === null || body.finalDkk === "") item.finalDkk = null;
        else {
          const value = Number(body.finalDkk);
          if (!Number.isInteger(value) || value < 0 || value > 1000000) return { save: false, value: { bad: "Prisen skal være et helt tal." } };
          item.finalDkk = value;
        }
      }
      if (typeof body.status === "string" && body.status && body.status !== item.status) {
        if (!BUY_STATUS[body.status]) return { save: false, value: { bad: "Ukendt status." } };
        if (body.status === "nyt_tilbud" && !Number.isInteger(item.finalDkk)) return { save: false, value: { bad: "Skriv den nye pris først." } };
        if (["godkendt", "udbetalt"].includes(body.status) && !Number.isInteger(item.finalDkk)) item.finalDkk = item.offerDkk;
        item.status = body.status;
        newStatus = body.status;
        event(item, `Status: ${BUY_STATUS[body.status]}${["nyt_tilbud", "godkendt", "udbetalt"].includes(body.status) ? ` · ${item.finalDkk} kr` : ""}`);
      }
      if (typeof body.note === "string" && body.note.trim()) item.notes.push({ at: new Date().toISOString(), text: cleanText(body.note, 2000) });
      if (message) event(item, message);
      item.updatedAt = new Date().toISOString();
      return { save: true, value: item };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    if (updated.bad) return res.status(400).json({ error: "oplysninger", message: updated.bad });
    if (body.notifyCustomer !== false) void customer.buybackUpdated(updated, { status: newStatus, message }, config);
    return res.json(updated);
  });

  app.get("/api/admin/opkoeb-priser", requireAdmin, (req, res) => res.json(buyback.adminView()));
  app.put("/api/admin/opkoeb-priser", requireAdmin, (req, res) => {
    const result = buyback.updateFromAdmin(req.body || {});
    if (result.error) return res.status(400).json({ error: "oplysninger", message: result.error });
    return res.json(buyback.adminView());
  });

  // ---------- Spare parts ----------
  app.get("/api/dele", (req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(parts.publicData());
  });

  app.post("/api/dele/kurv", async (req, res) => {
    if (!stripe.enabled()) return res.status(503).json({ error: "kort", message: "Betaling er ikke slået til endnu. Ring til os, så bestiller vi for dig." });
    if (limited(`dele:${clientIp(req)}`, 20, 60 * 60 * 1000)) return res.status(429).json({ error: "mange", message: "Vent lidt, og prøv igen." });
    const land = country(req.body && req.body.country);
    if (!land) return res.status(400).json({ error: "land", message: "Vælg det land, delene skal sendes til." });
    const cart = parts.priceCart(req.body && req.body.items, land);
    if (!cart) return res.status(400).json({ error: "kurv", message: "Kurven er tom." });
    if (cart.error) return res.status(400).json({ error: "farve", message: cart.error });
    const lang = req.lang || "da";
    const order = await partOrders.withList((list) => {
      const cutoff = Date.now() - 3 * 86400000;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].status === "afventer" && Date.parse(list[i].createdAt) < cutoff) list.splice(i, 1);
      }
      const now = new Date().toISOString();
      const record = {
        ref: makeRef("RD", list, 6),
        createdAt: now,
        updatedAt: now,
        status: "afventer",
        lang,
        country: land,
        items: cart.lines,
        subtotalDkk: cart.subtotalDkk,
        shippingDkk: cart.shippingDkk,
        totalDkk: cart.totalDkk,
        deliveryText: parts.publicData().deliveryText,
        customer: null,
        supplier: null,
        tracking: "",
        notes: [],
        events: []
      };
      list.push(record);
      return { save: true, value: record };
    });
    try {
      const lines = cart.lines.map((line) => ({
        ...line,
        title: i18n.t(lang, line.baseTitle) + (line.color ? ` (${i18n.t(lang, line.color)})` : "")
      }));
      const session = await stripe.createPartsCheckout({
        ref: order.ref,
        lines,
        shippingDkk: cart.shippingDkk,
        shippingTitle: i18n.t(lang, "Fragt"),
        note: i18n.t(lang, DELIVERY_NOTE).replace("{{DAYS}}", i18n.t(lang, parts.publicData().deliveryText)),
        country: land,
        lang,
        origin: originOf(req) + i18n.prefix(lang)
      });
      return res.json({ url: session.url, ref: order.ref });
    } catch (error) {
      console.error(`Stripe dele ${order.ref}: ${error.message}`);
      return res.status(502).json({ error: "kort", message: "Betalingen kunne ikke startes. Prøv igen om lidt." });
    }
  });

  app.get("/api/dele/bekraeft", async (req, res) => {
    const ref = normRef("RD", req.query.ordre, 6);
    const sessionId = cleanLine(req.query.session_id, 200);
    if (!ref || !/^cs_[A-Za-z0-9_]+$/.test(sessionId) || !stripe.enabled()) return res.status(400).json({ error: "oplysninger", message: "Ordren kunne ikke findes." });
    try {
      const session = await stripe.getCheckout(sessionId);
      if (normRef("RD", session.metadata && session.metadata.ref, 6) !== ref) return res.status(404).json({ error: "ikke_fundet", message: "Ordren kunne ikke findes." });
      if (session.payment_status !== "paid") return res.status(202).json({ pending: true, message: "Betalingen er ikke gennemført endnu." });
      const order = await markPartsPaid(session, config);
      if (!order) return res.status(404).json({ error: "ikke_fundet", message: "Ordren kunne ikke findes." });
      return res.json(partPublic(order));
    } catch (error) {
      console.error(`Dele bekræft ${ref}: ${error.message}`);
      return res.status(502).json({ error: "server", message: "Vi kunne ikke tjekke betalingen lige nu. Du får en mail, når den er registreret." });
    }
  });

  app.get("/api/admin/dele", requireAdmin, async (req, res) => {
    const list = await partOrders.all();
    res.json({
      items: list.filter((order) => order.status !== "afventer").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
      statuses: PART_STATUS,
      cjEnabled: cj.enabled()
    });
  });

  app.patch("/api/admin/dele/:ref", requireAdmin, async (req, res) => {
    const ref = normRef("RD", req.params.ref, 6);
    const body = req.body || {};
    let shipped = false;
    const updated = await partOrders.withList((list) => {
      const order = list.find((entry) => entry.ref === ref);
      if (!order) return { save: false, value: null };
      if (typeof body.tracking === "string") {
        const tracking = cleanLine(body.tracking, 60).replace(/\s/g, "");
        if (tracking && tracking !== order.tracking) {
          order.tracking = tracking;
          if (["betalt", "bestilt", "fejl"].includes(order.status)) {
            order.status = "afsendt";
            shipped = true;
          }
          event(order, `Pakken er sendt. Sporingsnummer ${tracking}.`);
        }
      }
      if (typeof body.supplierOrder === "string" && body.supplierOrder.trim()) {
        order.supplier = { ...(order.supplier || {}), manualOrder: cleanLine(body.supplierOrder, 120), at: new Date().toISOString() };
      }
      if (typeof body.status === "string" && body.status && body.status !== order.status) {
        if (!PART_STATUS[body.status]) return { save: false, value: { bad: "Ukendt status." } };
        order.status = body.status;
        event(order, `Status: ${PART_STATUS[body.status]}`, body.status !== "fejl");
      }
      if (typeof body.note === "string" && body.note.trim()) order.notes.push({ at: new Date().toISOString(), text: cleanText(body.note, 2000) });
      order.updatedAt = new Date().toISOString();
      return { save: true, value: order };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    if (updated.bad) return res.status(400).json({ error: "oplysninger", message: updated.bad });
    if (shipped && updated.customer) void customer.partsShipped(updated, config);
    return res.json(updated);
  });

  app.post("/api/admin/dele/:ref/cj", requireAdmin, async (req, res) => {
    const ref = normRef("RD", req.params.ref, 6);
    if (!cj.enabled()) return res.status(400).json({ error: "cj", message: "CJ er ikke sat op. Læg CJ_API_KEY i .env." });
    const result = await forwardToCj(ref);
    if (result.skipped) return res.status(400).json({ error: "cj", message: "Alle dele skal have et CJ-variant-id (vid) først." });
    if (result.error) return res.status(502).json({ error: "cj", message: result.error });
    return res.json({ ok: true });
  });

  app.get("/api/admin/dele-priser", requireAdmin, (req, res) => res.json({ ...parts.adminView(), cjEnabled: cj.enabled(), syncRunning: partsSync.isRunning() }));
  app.post("/api/admin/dele-sync", requireAdmin, (req, res) => {
    if (partsSync.isRunning()) return res.json({ ok: true, running: true });
    void partsSync.run();
    return res.json({ ok: true, running: true });
  });
  app.put("/api/admin/dele-priser", requireAdmin, (req, res) => {
    const result = parts.updateFromAdmin(req.body || {});
    if (result.error) return res.status(400).json({ error: "oplysninger", message: result.error });
    return res.json({ ...parts.adminView(), cjEnabled: cj.enabled(), syncRunning: partsSync.isRunning() });
  });

  // ---------- Repairer network ----------
  app.post("/api/partner", async (req, res) => {
    if (limited(`partner:${clientIp(req)}`, 5, 60 * 60 * 1000)) return res.status(429).json({ error: "mange", message: "Vent lidt, og prøv igen." });
    const body = req.body || {};
    const rawSkills = Array.isArray(body.skills) ? body.skills : String(body.skills || "").split(",");
    const partner = {
      name: cleanLine(body.name, 80),
      company: cleanLine(body.company, 120),
      cvr: String(body.cvr || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16),
      email: cleanLine(body.email, 120).toLowerCase(),
      phone: cleanLine(body.phone, 30),
      city: cleanLine(body.city, 80),
      country: country(body.country) || "DK",
      lang: req.lang || "da",
      radiusKm: Math.min(500, Math.max(0, Math.floor(Number(body.radiusKm) || 0))),
      skills: [...new Set(rawSkills.map((skill) => String(skill).trim()).filter((skill) => SKILLS[skill]))],
      experience: cleanLine(body.experience, 40),
      workshop: body.workshop === "ja",
      message: cleanText(body.message, 2000)
    };
    const problems = [];
    if (partner.name.length < 2) problems.push("Skriv dit navn.");
    if (!emailOk(partner.email)) problems.push("Skriv en gyldig e-mail.");
    if (digits(partner.phone).length < 8) problems.push("Skriv dit telefonnummer.");
    if (partner.city.length < 2) problems.push("Skriv hvor du holder til.");
    if (!partner.skills.length) problems.push("Vælg mindst én ting, du reparerer.");
    if (cleanLine(body.consent, 10) !== "ja") problems.push("Sæt flueben i samtykket.");
    if (problems.length) return res.status(400).json({ error: "oplysninger", message: problems.join(" ") });
    const created = await partners.withList((list) => {
      const now = new Date().toISOString();
      const record = { ref: makeRef("RP", list), createdAt: now, updatedAt: now, status: "ny", ...partner, notes: [], events: [] };
      list.push(record);
      return { save: true, value: record };
    });
    console.log(`Ny reparatør ${created.ref} · ${created.city}`);
    void notify.newPartner({ ...created, skills: created.skills.map((skill) => SKILLS[skill]) });
    void customer.partnerReceived(created, config);
    return res.status(201).json({ ok: true, ref: created.ref });
  });

  app.get("/api/admin/partnere", requireAdmin, async (req, res) => {
    const list = await partners.all();
    res.json({ items: [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), statuses: PARTNER_STATUS, skills: SKILLS });
  });

  app.patch("/api/admin/partnere/:ref", requireAdmin, async (req, res) => {
    const ref = normRef("RP", req.params.ref);
    const body = req.body || {};
    const updated = await partners.withList((list) => {
      const partner = list.find((entry) => entry.ref === ref);
      if (!partner) return { save: false, value: null };
      if (typeof body.status === "string" && body.status && body.status !== partner.status) {
        if (!PARTNER_STATUS[body.status]) return { save: false, value: { bad: "Ukendt status." } };
        partner.status = body.status;
        event(partner, `Status: ${PARTNER_STATUS[body.status]}`, false);
      }
      if (typeof body.note === "string" && body.note.trim()) partner.notes.push({ at: new Date().toISOString(), text: cleanText(body.note, 2000) });
      partner.updatedAt = new Date().toISOString();
      return { save: true, value: partner };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    if (updated.bad) return res.status(400).json({ error: "oplysninger", message: updated.bad });
    return res.json(updated);
  });

  // ---------- Pages ----------
  app.get("/saelg", (req, res) => send(req, res, "saelg.html", "saelg"));
  app.get("/saelg/tak", (req, res) => {
    const ref = normRef("SL", req.query.ref);
    send(req, res, "saelg-tak.html", "saelg", { REF: ref || "" });
  });
  app.get("/saelg/sag", (req, res) => send(req, res, "saelg-sag.html", "saelg"));
  app.get("/reservedele", (req, res) => send(req, res, "reservedele.html", "reservedele", partsPageTokens(req.lang || "da", originOf(req), "")));
  app.get("/reservedele/tak", (req, res) => send(req, res, "reservedele-tak.html", "reservedele"));
  app.get("/reservedele/:model", (req, res, next) => {
    const tokens = partsPageTokens(req.lang || "da", originOf(req), String(req.params.model));
    if (!tokens) return next();
    return send(req, res, "reservedele.html", "reservedele", tokens);
  });
  app.get("/partner", (req, res) => send(req, res, "partner.html", "partner"));
}

/** Called from the Stripe webhook. Returns true when the session belonged to a spare parts order. */
async function handleStripeSession(session, config) {
  if (!session || !session.metadata || session.metadata.kind !== "dele") return false;
  await markPartsPaid(session, config);
  return true;
}

module.exports = { registerEarly, register, handleStripeSession, DELIVERY_NOTE, PARTS_TEXT, NOINDEX: ["saelg-tak.html", "saelg-sag.html", "reservedele-tak.html"] };
