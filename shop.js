// Webshop for refurbished devices: /koeb lists what is in stock, /koeb/<ref> shows one device, and "Køb nu" pays through Stripe.
// Every device is unique, so it is reserved while the customer pays and marked sold when Stripe confirms.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const buyback = require("./buyback");
const stripe = require("./stripe");
const notify = require("./notify");
const customer = require("./customer");
const i18n = require("./i18n");
const stockimg = require("./stockimg");
const { createStore, makeRef, normRef } = require("./store");

const DATA = path.join(__dirname, "data");
const PHOTOS = path.join(DATA, "shop-photos");
const listings = createStore(path.join(DATA, "shop.json"));
const orders = createStore(path.join(DATA, "shop-orders.json"));
fs.mkdirSync(PHOTOS, { recursive: true });

/** Stripe lets a checkout expire after 30 minutes at the earliest; the reservation lasts a little longer. */
const CHECKOUT_S = 31 * 60;
const RESERVE_MS = 33 * 60 * 1000;
const MAX_PHOTOS = 8;
/** A device bought from a seller is listed while it is on its way to us and ships within this many working days. */
const INCOMING_DAYS = 5;
/** Card reservations expire after 7 days, so a reserved order that hasn't shipped is flagged, then released. */
const RESERVE_WARN_MS = 5 * 86400000;
const RESERVE_RELEASE_MS = 6.5 * 86400000;
const AUTO_MAX_PER_LINE = 5;
const PHOTO_RE = /^[a-z0-9-]+\.(jpg|png|webp)$/;
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const GRADES = {
  "som-ny": { label: "Som ny", text: "Ingen synlige brugsspor. Den ligner en ny.", factor: 1 },
  "meget-god": { label: "Meget god", text: "Små brugsspor, som du kun ser, hvis du leder efter dem. Skærmen er uden ridser.", factor: 0.93 },
  god: { label: "God", text: "Synlige brugsspor på kanter eller bagside. Skærmen er pæn og uden revner.", factor: 0.86 }
};
const STATUS = { aktiv: "Til salg", reserveret: "Reserveret", solgt: "Solgt", skjult: "Skjult" };
const ORDER_STATUS = {
  betalt: "Betalt, skal sendes",
  afsendt: "Sendt",
  leveret: "Leveret",
  returneret: "Returneret",
  refunderet: "Refunderet",
  annulleret: "Annulleret",
  tjek: "Tjek betalingen i Stripe",
  dobbelt: "Solgt to gange, refundér"
};
const BRANDS = [
  ["", "Alle mærker"],
  ["Apple", "Apple"],
  ["Samsung", "Samsung"],
  ["Google", "Google"]
];
const CATEGORIES = [
  ["", "Alle"],
  ["telefon", "Telefoner"],
  ["tablet", "Tablets"],
  ["computer", "Computere"]
];
const SORTS = [
  ["", "Nyeste"],
  ["billigst", "Billigst"],
  ["dyrest", "Dyrest"]
];
const GOOGLE_CATEGORY = { telefon: "267", tablet: "4745", computer: "278" };
/** How a model and its generation read together in a product title: [name, separator]. */
const TITLE_PARTS = {
  "ipad-9": ["", ""],
  "ipad-mini": ["iPad", " "],
  "ipad-air-m": ["iPad Air", ", "],
  "ipad-pro-13": ["iPad Pro", " "],
  "macbook-air": ["MacBook Air", " "],
  "macbook-pro": ["MacBook Pro", " "],
  imac: ["iMac", " "]
};

const TEXT = {
  available: "{n} enheder til salg",
  availableOne: "1 enhed til salg",
  empty: "Der er ingen enheder i denne kategori lige nu. Kig forbi igen snart, eller sælg os din gamle.",
  emptyLink: "Sælg din enhed",
  battery: "Batteri {n} %",
  buy: "Køb nu",
  sold: "Solgt",
  reserved: "Reserveret",
  reservedText: "En anden kunde er ved at betale for den. Kig igen om en halv time.",
  soldText: "Den er solgt. Se de andre enheder, vi har til salg.",
  seeAll: "Se alle enheder",
  noCard: "Ring eller skriv til os for at købe den. Vi lægger den til side til dig.",
  cancelled: "Betalingen blev afbrudt. Enheden er ikke købt.",
  busy: "En anden kunde er ved at betale for den lige nu. Prøv igen om en halv time.",
  failed: "Betalingen kunne ikke startes. Prøv igen om lidt, eller ring til os.",
  specGrade: "Stand",
  specStorage: "Lager",
  specBattery: "Batteri",
  specColor: "Farve",
  specConn: "Forbindelse",
  specTested: "Testet",
  tested: "Alle funktioner er testet, og den er nulstillet",
  shipping: "Gratis fragt i Danmark. Sendes inden for 1 hverdag med sporing.",
  shippingIncoming: "Gratis fragt i Danmark. Sendes inden for 5 hverdage med sporing.",
  inStock: "På lager",
  incomingBadge: "Sendes inden for 5 hverdage",
  incomingText: "Den er på vej til os fra sælgeren. Vi tester den, nulstiller den og sender den inden for 5 hverdage.",
  exampleImage: "Eksempelbillede",
  exampleNote: "Billedet er et eksempel. Du får præcis den model, lagerplads og stand, der står her.",
  charged: "Beløbet bliver reserveret nu og først trukket, når vi sender den.",
  cancelSubject: "Din ordre er annulleret · {ref}",
  cancelBody: "Vi har desværre måttet annullere dit køb af {title}, fordi den ikke levede op til vores krav, da vi testede den. Beløbet er ikke trukket, og reservationen på din konto forsvinder af sig selv. Undskyld ulejligheden.",
  cancelSms: "TeknikFix: Din ordre {ref} er annulleret. Beløbet er ikke trukket. Se din mail.",
  vat: "Sælges efter brugtmomsordningen.",
  titleItem: "{title}: brugt i {grade} stand til {price} | TeknikFix",
  descItem: "Køb {title} i {grade} stand for {price}. Testet og nulstillet, 24 måneders reklamationsret, 14 dages fortrydelsesret og gratis fragt i Danmark.",
  thanksTitle: "Tak for dit køb",
  thanksPaid: "Ordrenummer <strong>{ref}</strong>. Kvitteringen er sendt til {email}. Vi sender {title} inden for {days}, og du får et sporingsnummer på mail. Beløbet bliver først trukket, når vi sender den.",
  oneDay: "1 hverdag",
  incomingDays: "5 hverdage",
  thanksPending: "Vi har ikke fået besked om betalingen endnu. Du får en mail, så snart den er registreret.",
  thanksMissing: "Vi kunne ikke finde ordren. Har du betalt, får du en mail, så snart betalingen er registreret.",
  receipt: "KVITTERING",
  mailSubject: "Tak for dit køb · {ref}",
  mailBody: "Tak for dit køb. Vi sender den inden for {days}, og du får en mail med sporingsnummer, så snart pakken er sendt. Beløbet er reserveret og bliver først trukket, når vi sender den.",
  mailRights: "Du har 14 dages fortrydelsesret fra du modtager pakken og 24 måneders reklamationsret. Er der noget i vejen, så svar på denne mail.",
  shippedSubject: "Din pakke er på vej · {ref}",
  shippedBody: "{title} er sendt.",
  shippingLine: "Fragt",
  total: "I alt",
  date: "Dato",
  order: "Ordre"
};

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const kr = new Intl.NumberFormat("da-DK");
function money(amount) {
  return `${kr.format(amount)} kr`;
}

function fill(text, values) {
  return Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(String(value)), text);
}

/** Model, generation, storage and connectivity labels from the buyback catalogue. */
function catalog() {
  const data = buyback.publicData();
  const models = new Map();
  for (const group of data.groups) for (const model of group.models) models.set(model.id, { ...model, device: group.device, groupName: group.name });
  return { models, storage: data.storage, connectivity: data.connectivity || [] };
}

function describe(input, cat = catalog()) {
  const model = cat.models.get(input.modelId);
  if (!model) return null;
  const variant = model.variants.find((item) => item.id === input.variant) || null;
  const storage = (cat.storage[model.device] || []).find((item) => item.id === input.storage) || null;
  const conn = model.device === "tablet" ? cat.connectivity.find((item) => item.id === input.conn) || null : null;
  return { model, variant, storage, conn };
}

function autoTitle(info) {
  const [name, sep] = TITLE_PARTS[info.model.id] || [info.model.name, ", "];
  const head = info.variant ? (name ? `${name}${sep}${info.variant.label}` : info.variant.label) : info.model.name;
  return head;
}

function titleOf(listing, lang = "da") {
  const tr = (text) => i18n.t(lang, text);
  if (listing.title) return tr(listing.title);
  const parts = [listing.headline ? tr(listing.headline) : listing.modelName];
  if (listing.storageLabel) parts.push(listing.storageLabel.replace(" eller mindre", ""));
  if (listing.conn === "cellular") parts.push("Wi-Fi + Cellular");
  if (listing.color) parts.push(tr(listing.color));
  return parts.join(", ");
}

function available(listing, now = Date.now()) {
  return listing.status === "aktiv" || (listing.status === "reserveret" && Date.parse(listing.reservedUntil || 0) < now);
}

function photoUrl(file) {
  return `/foto/${file}`;
}

function exampleUrl(listing) {
  return `/eksempel/${encodeURIComponent(listing.modelId || "telefon")}-${listing.device || "telefon"}.svg`;
}

function publicListing(listing, lang) {
  const grade = GRADES[listing.grade] || GRADES.god;
  return {
    ref: listing.ref,
    title: titleOf(listing, lang),
    device: listing.device,
    brand: brandOf(listing),
    grade: listing.grade,
    gradeLabel: i18n.t(lang, grade.label),
    batteryPct: listing.batteryPct || null,
    priceDkk: listing.priceDkk,
    photos: listing.photos || [],
    example: exampleUrl(listing),
    incoming: Boolean(listing.incoming),
    available: available(listing),
    sold: listing.status === "solgt",
    createdAt: listing.createdAt
  };
}

// ---------- Pages ----------
const PLACEHOLDER =
  '<svg class="shop-ph" viewBox="0 0 64 64" aria-hidden="true"><rect x="18" y="6" width="28" height="52" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="32" cy="50" r="2.5" fill="currentColor"/></svg>';

function cardHtml(item, lang) {
  const tr = (text) => i18n.t(lang, text);
  const photo = item.photos[0]
    ? `<img src="${photoUrl(item.photos[0])}" alt="${esc(item.title)}" loading="lazy" width="400" height="400">`
    : `<img src="${esc(item.example)}" alt="${esc(item.title)}" loading="lazy" width="400" height="400"><span class="shop-example">${esc(tr(TEXT.exampleImage))}</span>`;
  const battery = item.batteryPct ? ` · ${esc(fill(tr(TEXT.battery), { n: item.batteryPct }))}` : "";
  const stock = item.incoming ? `<span class="shop-stock is-incoming">${esc(tr(TEXT.incomingBadge))}</span>` : `<span class="shop-stock">${esc(tr(TEXT.inStock))}</span>`;
  return (
    `<li><a class="shop-card" href="/koeb/${esc(item.ref)}">` +
    `<span class="shop-photo">${photo}${item.available ? "" : `<span class="shop-badge">${esc(tr(TEXT.reserved))}</span>`}</span>` +
    `<span class="shop-card-body"><strong class="shop-card-title">${esc(item.title)}</strong>` +
    `<span class="shop-card-meta"><span class="shop-grade grade-${esc(item.grade)}">${esc(item.gradeLabel)}</span>${battery}</span>` +
    `${stock}<span class="shop-price">${money(item.priceDkk)}</span></span></a></li>`
  );
}

function listLink(category, sort, brand) {
  const query = new URLSearchParams();
  if (category) query.set("kategori", category);
  if (brand) query.set("maerke", brand);
  if (sort) query.set("sort", sort);
  const text = query.toString();
  return `/koeb${text ? `?${text}` : ""}`;
}

async function listTokens(lang, origin, query) {
  const tr = (text) => i18n.t(lang, text);
  const category = CATEGORIES.some(([id]) => id && id === query.kategori) ? query.kategori : "";
  const brand = BRANDS.some(([id]) => id && id === query.maerke) ? query.maerke : "";
  const sort = SORTS.some(([id]) => id && id === query.sort) ? query.sort : "";
  const all = (await listings.all()).filter((item) => item.status !== "skjult" && item.status !== "solgt").map((item) => publicListing(item, lang));
  const counts = { "": all.length };
  for (const item of all) counts[item.device] = (counts[item.device] || 0) + 1;
  const inCategory = all.filter((item) => !category || item.device === category);
  const brandCounts = { "": inCategory.length };
  for (const item of inCategory) brandCounts[item.brand] = (brandCounts[item.brand] || 0) + 1;
  let shown = inCategory.filter((item) => !brand || item.brand === brand);
  shown.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (sort === "billigst") return a.priceDkk - b.priceDkk;
    if (sort === "dyrest") return b.priceDkk - a.priceDkk;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  const brandsShown = BRANDS.filter(([id]) => !id || brandCounts[id]);
  const filters =
    `<nav class="shop-filters" aria-label="${esc(tr("Kategorier"))}">` +
    CATEGORIES.filter(([id]) => !id || counts[id])
      .map(([id, label]) => `<a href="${listLink(id, sort, "")}"${id === category ? ' aria-current="true"' : ""}>${esc(tr(label))} <small>${counts[id] || 0}</small></a>`)
      .join("") +
    "</nav>" +
    (brandsShown.length > 2
      ? `<nav class="shop-filters shop-brands" aria-label="${esc(tr("Mærker"))}">` +
        brandsShown.map(([id, label]) => `<a href="${listLink(category, sort, id)}"${id === brand ? ' aria-current="true"' : ""}>${esc(tr(label))}</a>`).join("") +
        "</nav>"
      : "") +
    `<nav class="shop-sort" aria-label="${esc(tr("Sortér"))}">` +
    SORTS.map(([id, label]) => `<a href="${listLink(category, id, brand)}"${id === sort ? ' aria-current="true"' : ""}>${esc(tr(label))}</a>`).join("") +
    "</nav>";
  const count = shown.length === 1 ? tr(TEXT.availableOne) : fill(tr(TEXT.available), { n: shown.length });
  const grid = shown.length
    ? `<p class="shop-count">${esc(count)}</p><ul class="shop-grid">${shown.map((item) => cardHtml(item, lang)).join("")}</ul>`
    : `<div class="panel shop-empty"><p>${esc(tr(TEXT.empty))}</p><p><a class="btn" href="/saelg">${esc(tr(TEXT.emptyLink))}</a></p></div>`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: shown.slice(0, 50).map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${origin}${i18n.prefix(lang)}/koeb/${item.ref}`
    }))
  };
  return {
    SHOP_FILTERS: filters,
    SHOP_GRID: grid,
    SHOP_LD: shown.length ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""
  };
}

function productLd(listing, item, origin, lang) {
  const images = item.photos.map((file) => `${origin}${photoUrl(file)}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.title,
    sku: listing.ref,
    image: images.length ? images : undefined,
    description: listing.description ? i18n.t(lang, listing.description) : undefined,
    brand: { "@type": "Brand", name: brandOf(listing) },
    itemCondition: "https://schema.org/RefurbishedCondition",
    offers: {
      "@type": "Offer",
      url: `${origin}${i18n.prefix(lang)}/koeb/${listing.ref}`,
      price: String(listing.priceDkk),
      priceCurrency: "DKK",
      availability: item.available ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      itemCondition: "https://schema.org/RefurbishedCondition",
      seller: { "@type": "Organization", name: "TeknikFix" },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: "0", currency: "DKK" },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "DK" }
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "DK",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 14,
        returnMethod: "https://schema.org/ReturnByMail"
      }
    }
  };
}

function brandOf(listing) {
  const id = listing.modelId || "";
  if (/^(iphone|ipad|macbook|imac)/.test(id)) return "Apple";
  if (/^galaxy/.test(id)) return "Samsung";
  if (/^pixel/.test(id)) return "Google";
  if (/^oneplus/.test(id)) return "OnePlus";
  if (/^(xiaomi|redmi)/.test(id)) return "Xiaomi";
  if (/^moto/.test(id)) return "Motorola";
  if (/^huawei/.test(id)) return "Huawei";
  if (/^honor/.test(id)) return "Honor";
  if (/^surface/.test(id)) return "Microsoft";
  if (/^lenovo/.test(id)) return "Lenovo";
  return "TeknikFix";
}

function itemTokens(listing, lang, origin, config, error) {
  const tr = (text) => i18n.t(lang, text);
  const item = publicListing(listing, lang);
  const grade = GRADES[listing.grade] || GRADES.god;
  const gallery = item.photos.length
    ? `<div class="shop-gallery">${item.photos
        .map((file, index) => `<a href="${photoUrl(file)}" target="_blank" rel="noopener"><img src="${photoUrl(file)}" alt="${esc(item.title)}" ${index ? 'loading="lazy"' : ""} width="800" height="800"></a>`)
        .join("")}</div>`
    : `<figure class="shop-gallery shop-gallery-example"><img src="${esc(item.example)}" alt="${esc(item.title)}" width="800" height="800">` +
      `<span class="shop-example">${esc(tr(TEXT.exampleImage))}</span><figcaption class="field-note">${esc(tr(TEXT.exampleNote))}</figcaption></figure>`;
  const specs = [
    [TEXT.specGrade, item.gradeLabel],
    [TEXT.specStorage, listing.storageLabel ? listing.storageLabel.replace(" eller mindre", "") : ""],
    [TEXT.specConn, listing.connLabel ? tr(listing.connLabel) : ""],
    [TEXT.specBattery, listing.batteryPct ? `${listing.batteryPct} %` : ""],
    [TEXT.specColor, listing.color ? tr(listing.color) : ""],
    [TEXT.specTested, tr(TEXT.tested)]
  ]
    .filter((row) => row[1])
    .map(([label, value]) => `<div><dt>${esc(tr(label))}</dt><dd>${esc(value)}</dd></div>`)
    .join("");
  let buy;
  if (item.available && stripe.enabled()) {
    buy =
      (item.incoming ? `<p class="shop-incoming">${esc(tr(TEXT.incomingText))}</p>` : "") +
      `<form method="post" action="/koeb/${esc(listing.ref)}/betal"><button class="btn btn-copper shop-buy" type="submit">${esc(tr(TEXT.buy))}</button></form>` +
      `<p class="field-note">${esc(tr(TEXT.charged))}</p>`;
  } else if (item.available) {
    const digits = String(config.phone || "").replace(/\D/g, "");
    const tel = digits.startsWith("45") ? `+${digits}` : `+45${digits}`;
    buy = `<p>${esc(tr(TEXT.noCard))}</p><p><a class="btn" href="tel:${esc(tel)}">${esc(config.phoneDisplay || config.phone || "")}</a> <a class="btn btn-ghost" href="mailto:${esc(config.email)}?subject=${encodeURIComponent(`${item.title} (${listing.ref})`)}">${esc(config.email)}</a></p>`;
  } else {
    buy = `<p class="shop-sold">${esc(tr(listing.status === "solgt" ? TEXT.sold : TEXT.reserved))}</p><p>${esc(tr(listing.status === "solgt" ? TEXT.soldText : TEXT.reservedText))}</p><p><a class="btn btn-ghost" href="/koeb">${esc(tr(TEXT.seeAll))}</a></p>`;
  }
  const price = money(listing.priceDkk);
  const title = fill(tr(TEXT.titleItem), { title: item.title, grade: item.gradeLabel.toLowerCase(), price });
  const desc = fill(tr(TEXT.descItem), { title: item.title, grade: item.gradeLabel.toLowerCase(), price });
  return {
    ITEM_TITLE: esc(title),
    ITEM_DESC: esc(desc),
    ITEM_PATH: `/koeb/${listing.ref}`,
    ITEM_ROBOTS: listing.status === "solgt" ? "noindex, follow" : "index, follow",
    ITEM_IMAGE: item.photos[0] ? `${origin}${photoUrl(item.photos[0])}` : `${origin}/og.png`,
    ITEM_SHIP: esc(tr(listing.incoming ? TEXT.shippingIncoming : TEXT.shipping)),
    ITEM_H1: esc(item.title),
    ITEM_GALLERY: gallery,
    ITEM_PRICE: price,
    ITEM_SPECS: specs,
    ITEM_GRADE: `<strong>${esc(item.gradeLabel)}:</strong> ${esc(tr(grade.text))}`,
    ITEM_TEXT: listing.description ? `<p>${esc(tr(listing.description)).replace(/\n/g, "<br>")}</p>` : "",
    ITEM_BUY: buy,
    ITEM_ERROR: error ? `<p class="form-error" role="alert">${esc(tr(error))}</p>` : "",
    ITEM_LD: `<script type="application/ld+json">${JSON.stringify(productLd(listing, item, origin, lang)).replace(/</g, "\\u003c")}</script>`
  };
}

// ---------- Orders ----------
function event(order, text, isPublic = true) {
  order.events = order.events || [];
  order.events.push({ at: new Date().toISOString(), text, public: isPublic });
  order.updatedAt = new Date().toISOString();
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

function target(order) {
  return { ref: order.ref, name: order.customer.name, email: order.customer.email, phone: order.customer.phone, lang: order.lang };
}

function receiptMail(order, config) {
  const date = new Intl.DateTimeFormat("da-DK", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(new Date());
  const receipt = [
    TEXT.receipt,
    `${TEXT.date}: ${date}`,
    `${TEXT.order}: ${order.ref}`,
    `${order.title}: ${money(order.priceDkk)}`,
    `${TEXT.shippingLine}: ${money(0)}`,
    `${TEXT.total}: ${money(order.paidDkk)}`,
    TEXT.vat,
    "",
    `Sælger: ${config.brand || "TeknikFix"} (${config.legalName || ""}), CVR ${config.cvr}`,
    `${config.street}, ${config.postal} ${config.city}`
  ];
  const days = order.incoming ? TEXT.incomingDays : TEXT.oneDay;
  return customer.sendMailTo(target(order), fill(TEXT.mailSubject, { ref: order.ref }), [fill(TEXT.mailBody, { days }), receipt.join("\n"), TEXT.mailRights], config, null);
}

function cancelledMail(order, config) {
  return Promise.all([
    customer.sendMailTo(target(order), fill(TEXT.cancelSubject, { ref: order.ref }), [fill(TEXT.cancelBody, { title: order.title })], config, null),
    customer.sendSms(target(order), fill(TEXT.cancelSms, { ref: order.ref }))
  ]);
}

/** Releases the reserved amount. Returns "" or an error text. */
async function releasePayment(order) {
  if (!order.paymentIntent || order.captured) return "";
  try {
    await stripe.cancelPayment(order.paymentIntent);
    return "";
  } catch (error) {
    return error.message;
  }
}

function shippedMail(order, config) {
  const trackUrl = `https://t.17track.net/${order.lang || "da"}#nums=${encodeURIComponent(order.tracking || "")}`;
  const track = order.tracking ? `Sporingsnummer: ${order.tracking}\nFølg pakken: ${trackUrl}` : "";
  return Promise.all([
    customer.sendMailTo(target(order), fill(TEXT.shippedSubject, { ref: order.ref }), [fill(TEXT.shippedBody, { title: order.title }), track].filter(Boolean), config, null),
    customer.sendSms(target(order), `TeknikFix: Din ordre ${order.ref} er sendt.${order.tracking ? ` Spor: ${trackUrl}` : ""}`)
  ]);
}

/** Stripe webhook and thank-you page both land here. Safe to call twice. */
async function markPaid(session, config) {
  const ref = normRef("KB", session && session.metadata && session.metadata.ref, 5);
  if (!ref) return null;
  const auth = await stripe.authorized(session);
  if (!auth) return null;
  let fresh = false;
  const order = await orders.withList((list) => {
    const found = list.find((item) => item.ref === ref);
    if (!found) return { save: false, value: null };
    if (found.status !== "afventer") return { save: false, value: found };
    fresh = true;
    found.status = "betalt";
    found.paidAt = new Date().toISOString();
    found.sessionId = session.id;
    found.paymentIntent = auth.intent;
    found.captured = auth.captured;
    found.paidDkk = Math.round(Number(session.amount_total) / 100);
    found.customer = shippingFrom(session);
    event(found, auth.captured ? `Betalt ${found.paidDkk} kr.` : `${found.paidDkk} kr er reserveret. Beløbet trækkes, når vi sender den.`);
    return { save: true, value: found };
  });
  if (!order || !fresh) return order;
  let source = "";
  const clash = await listings.withList((list) => {
    const listing = list.find((item) => item.ref === order.listingRef);
    if (!listing) return { save: false, value: false };
    if (listing.status === "solgt" && listing.orderRef !== order.ref) return { save: false, value: true };
    listing.status = "solgt";
    listing.orderRef = order.ref;
    listing.soldAt = new Date().toISOString();
    listing.updatedAt = listing.soldAt;
    source = listing.incoming && listing.buybackRef ? listing.buybackRef : "";
    return { save: true, value: false };
  });
  if (clash) {
    await orders.withList((list) => {
      const found = list.find((item) => item.ref === order.ref);
      if (!found) return { save: false };
      found.status = "dobbelt";
      event(found, "Enheden var allerede solgt. Refundér betalingen i Stripe.", false);
      return { save: true };
    });
  }
  console.log(`Butik ${order.ref} · ${order.title} · ${order.paidDkk} kr`);
  if (!clash) void receiptMail(order, config);
  void notify.send({
    title: `${clash ? "OBS: solgt to gange · " : ""}Butik ${order.ref} · ${money(order.paidDkk)}`,
    message:
      `${order.title}\n${order.customer.name} · ${order.customer.postal} ${order.customer.city}\n` +
      (clash
        ? "Enheden var allerede solgt. Refundér i Stripe."
        : source
          ? `Den er på vej fra sælger (${source}). Test den, og send den inden for ${INCOMING_DAYS} hverdage. Pengene trækkes, når du skriver sporingsnummeret.`
          : "Send den inden for 1 hverdag. Pengene trækkes, når du skriver sporingsnummeret."),
    tags: [clash ? "warning" : "shopping_cart"],
    priority: clash ? 5 : 4,
    booking: { ref: order.ref, phone: order.customer.phone }
  });
  return order;
}

async function handleStripeSession(session, config) {
  if (!session || !session.metadata || session.metadata.kind !== "butik") return false;
  await markPaid(session, config);
  return true;
}

// ---------- Automatic listings from buybacks ----------
/** The shop grade we expect from the seller's answers, or "" when someone has to look at it first. */
function expectedGrade(answers) {
  const a = answers || {};
  const faults = a.faults || [];
  if (a.power === "nej" || a.water === "ja" || a.lock === "til") return "";
  if (faults.includes("faceid") || faults.includes("lyd") || a.body === "skader") return "";
  const worn = [a.screen === "ridser", a.back === "ridser", a.body === "brugsspor"].filter(Boolean).length;
  return worn ? "god" : "meget-god";
}

/**
 * Lists the devices of a buyback as soon as they are on their way to us. Prices come from our own sale value
 * (a little under Refurbed when its price is known). Safe to call more than once.
 */
async function listFromBuyback(sale) {
  if (!sale || !Array.isArray(sale.items)) return [];
  const created = await listings.withList((list) => {
    const made = [];
    if (list.some((item) => item.buybackRef === sale.ref)) return { save: false, value: made };
    const cat = catalog();
    const now = new Date().toISOString();
    sale.items.forEach((line, index) => {
      if (line.manual || line.recycle || !line.offerDkk) return;
      const grade = expectedGrade(line.answers);
      if (!grade) return;
      const input = { modelId: line.modelId, variant: line.variant || "", storage: line.storage || "", conn: line.conn || "", grade, batteryPct: 100 };
      const price = suggestPrice(input);
      if (!price || price <= line.offerDkk) return;
      const count = Math.min(AUTO_MAX_PER_LINE, Math.max(1, Number(line.qty) || 1));
      for (let unit = 0; unit < count; unit += 1) {
        const listing = { ref: makeRef("VA", list, 5), createdAt: now, status: "aktiv", photos: [], color: "", title: "", description: "", imei: "", buybackRef: "" };
        const problem = applyFields(listing, { ...input, status: "aktiv", priceDkk: price, costDkk: line.offerDkk, batteryPct: null }, { cleanLine: (v) => String(v || ""), cleanText: (v) => String(v || "") }, cat);
        if (problem) return;
        Object.assign(listing, { buybackRef: sale.ref, buybackLine: index, imei: unit === 0 ? line.imei || "" : "", incoming: true, auto: true });
        list.push(listing);
        made.push(listing);
      }
    });
    return { save: made.length > 0, value: made };
  });
  if (created.length) console.log(`Butik: ${created.length} enheder lagt op fra ${sale.ref}`);
  return created;
}

/** Keeps the shop in step with the buyback: in stock when approved, hidden while regraded, gone when it can't be bought. */
async function buybackChanged(sale, status, config) {
  if (!sale) return;
  if (["sendt", "modtaget"].includes(status)) {
    await listFromBuyback(sale);
    return;
  }
  const affected = (await listings.all()).filter((item) => item.buybackRef === sale.ref && item.auto);
  if (!affected.length) return;
  if (["godkendt", "udbetalt"].includes(status)) {
    await listings.withList((list) => {
      for (const listing of list) {
        if (listing.buybackRef !== sale.ref || !listing.auto) continue;
        listing.incoming = false;
        if (listing.status === "skjult" && listing.hiddenForRegrade) {
          const line = sale.items[listing.buybackLine] || {};
          const lower = listing.grade === "som-ny" ? "meget-god" : "god";
          const price = suggestPrice({ modelId: line.modelId, variant: line.variant, storage: line.storage, conn: line.conn, grade: lower, batteryPct: 100 });
          listing.grade = lower;
          if (price) listing.priceDkk = price;
          listing.status = "aktiv";
          listing.hiddenForRegrade = false;
        }
        listing.updatedAt = new Date().toISOString();
      }
      return { save: true };
    });
    return;
  }
  const sold = affected.filter((item) => item.status === "solgt" || item.status === "reserveret");
  if (status === "nyt_tilbud") {
    await listings.withList((list) => {
      for (const listing of list) {
        if (listing.buybackRef !== sale.ref || !listing.auto || listing.status !== "aktiv") continue;
        listing.status = "skjult";
        listing.hiddenForRegrade = true;
        listing.updatedAt = new Date().toISOString();
      }
      return { save: true };
    });
    if (sold.length) {
      void notify.send({
        title: `Tjek ordre · ${sale.ref} er omvurderet`,
        message: `En enhed fra ${sale.ref} er allerede solgt (${sold.map((item) => item.orderRef || item.ref).join(", ")}), men standen passede ikke helt. Passer den stadig til ordren? Ellers annullér ordren under Butik.`,
        tags: ["warning"],
        priority: 4
      });
    }
    return;
  }
  if (!["retur", "afvist", "annulleret"].includes(status)) return;
  await listings.withList((list) => {
    for (const listing of list) {
      if (listing.buybackRef !== sale.ref || !listing.auto || listing.status === "solgt") continue;
      listing.status = "skjult";
      listing.updatedAt = new Date().toISOString();
    }
    return { save: true };
  });
  for (const listing of sold.filter((item) => item.orderRef)) {
    const order = (await orders.all()).find((entry) => entry.ref === listing.orderRef);
    if (!order || !["betalt"].includes(order.status)) continue;
    const problem = await releasePayment(order);
    await orders.withList((list) => {
      const found = list.find((entry) => entry.ref === order.ref);
      if (!found) return { save: false };
      found.status = problem ? "tjek" : "annulleret";
      event(found, problem ? `Kunne ikke frigive betalingen: ${problem}` : "Annulleret, fordi enheden ikke kunne købes ind. Beløbet er ikke trukket.", !problem);
      return { save: true };
    });
    await listings.withList((list) => {
      const found = list.find((item) => item.ref === listing.ref);
      if (!found) return { save: false };
      found.status = "skjult";
      return { save: true };
    });
    if (!problem && order.customer) void cancelledMail(order, config);
    void notify.send({
      title: problem ? `OBS: ordre ${order.ref} skal refunderes` : `Ordre ${order.ref} annulleret automatisk`,
      message: problem
        ? `Enheden fra ${sale.ref} kunne ikke købes, men betalingen kunne ikke frigives: ${problem}. Refundér i Stripe.`
        : `Enheden fra ${sale.ref} kunne ikke købes. Kunden har fået besked, og beløbet er ikke trukket.`,
      tags: [problem ? "warning" : "x"],
      priority: problem ? 5 : 3
    });
  }
}

/** Reserved card payments run out after 7 days: warn after 5, release after 6½ and put the device back in the shop. */
async function sweepReservations(config) {
  const now = Date.now();
  const open = (await orders.all()).filter((order) => order.status === "betalt" && order.paymentIntent && !order.captured && order.paidAt);
  for (const order of open) {
    const age = now - Date.parse(order.paidAt);
    if (age >= RESERVE_RELEASE_MS) {
      const problem = await releasePayment(order);
      await orders.withList((list) => {
        const found = list.find((entry) => entry.ref === order.ref);
        if (!found || found.status !== "betalt") return { save: false };
        found.status = problem ? "tjek" : "annulleret";
        event(found, problem ? `Reservationen kunne ikke frigives: ${problem}` : "Annulleret, fordi den ikke blev sendt inden for 6 dage. Beløbet er ikke trukket.", !problem);
        return { save: true };
      });
      if (!problem) {
        await listings.withList((list) => {
          const listing = list.find((item) => item.ref === order.listingRef);
          if (!listing || listing.orderRef !== order.ref) return { save: false };
          listing.status = "aktiv";
          listing.orderRef = "";
          listing.updatedAt = new Date().toISOString();
          return { save: true };
        });
        if (order.customer) void cancelledMail(order, config);
      }
      void notify.send({
        title: `Ordre ${order.ref} er annulleret`,
        message: problem
          ? `${order.title} blev ikke sendt i tide, og reservationen kunne ikke frigives: ${problem}. Tjek Stripe.`
          : `${order.title} blev ikke sendt inden for 6 dage, så reservationen er frigivet, og kunden har fået besked. Enheden er sat til salg igen.`,
        tags: ["warning"],
        priority: 4
      });
    } else if (age >= RESERVE_WARN_MS && !order.warned) {
      await orders.withList((list) => {
        const found = list.find((entry) => entry.ref === order.ref);
        if (!found) return { save: false };
        found.warned = true;
        return { save: true };
      });
      void notify.send({
        title: `Send ordre ${order.ref} i dag`,
        message: `${order.title} til ${order.customer ? order.customer.name : "kunden"}. Betalingen udløber om 2 dage. Bliver den ikke sendt inden for 1½ døgn, annullerer siden ordren af sig selv.`,
        tags: ["hourglass"],
        priority: 4
      });
    }
  }
}

async function listedBuybacks() {
  return new Set((await listings.all()).map((item) => item.buybackRef).filter(Boolean));
}

function startJobs(config) {
  const run = () => void sweepReservations(config).catch((error) => console.error(`Butik reservationer: ${error.message}`));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

// ---------- Admin ----------
function suggestPrice(input) {
  const value = buyback.shopValue(input);
  if (!value) return null;
  const grade = GRADES[input.grade] || GRADES.god;
  const battery = Number(input.batteryPct) || 100;
  const raw = value * grade.factor * (battery < 85 ? 0.95 : 1);
  return Math.max(99, Math.round(raw / 100) * 100 - 1);
}

function intOr(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  const n = Number(String(value).replace(/\./g, ""));
  if (!Number.isInteger(n) || n < min || n > max) return NaN;
  return n;
}

/** Applies admin fields to a listing. Returns an error text or "". */
function applyFields(listing, body, clean, cat = catalog()) {
  const { cleanLine, cleanText } = clean;
  const modelId = body.modelId !== undefined ? String(body.modelId) : listing.modelId;
  const next = {
    modelId,
    variant: body.variant !== undefined ? String(body.variant || "") : listing.variant || "",
    storage: body.storage !== undefined ? String(body.storage || "") : listing.storage || "",
    conn: body.conn !== undefined ? String(body.conn || "") : listing.conn || ""
  };
  const info = describe(next, cat);
  if (!info) return "Vælg en model.";
  if (info.model.variants.length && !info.variant) return "Vælg generation eller chip.";
  const grade = body.grade !== undefined ? String(body.grade) : listing.grade;
  if (!GRADES[grade]) return "Vælg stand.";
  const price = intOr(body.priceDkk, listing.priceDkk, 1, 200000);
  if (!Number.isInteger(price)) return "Skriv salgsprisen i hele kroner.";
  const cost = intOr(body.costDkk, listing.costDkk ?? null, 0, 200000);
  if (Number.isNaN(cost)) return "Skriv indkøbsprisen i hele kroner.";
  const battery = intOr(body.batteryPct, listing.batteryPct ?? null, 1, 100);
  if (Number.isNaN(battery)) return "Batteri skal være mellem 1 og 100 %.";
  const status = body.status !== undefined ? String(body.status) : listing.status || "aktiv";
  if (!STATUS[status]) return "Ukendt status.";
  Object.assign(listing, next, {
    modelName: info.model.name,
    headline: autoTitle(info),
    device: info.model.device,
    variantLabel: info.variant ? info.variant.label : "",
    storageLabel: info.storage ? info.storage.label : "",
    connLabel: info.conn ? info.conn.label : "",
    grade,
    priceDkk: price,
    costDkk: cost,
    batteryPct: battery,
    status
  });
  if (body.color !== undefined) listing.color = cleanLine(body.color, 40);
  if (body.title !== undefined) listing.title = cleanLine(body.title, 120);
  if (body.description !== undefined) listing.description = cleanText(body.description, 3000);
  if (body.imei !== undefined) listing.imei = cleanLine(body.imei, 30).replace(/\s/g, "").toUpperCase();
  if (body.buybackRef !== undefined) listing.buybackRef = cleanLine(body.buybackRef, 20).toUpperCase();
  if (status !== "reserveret") listing.reservedUntil = null;
  listing.updatedAt = new Date().toISOString();
  return "";
}

function adminModels() {
  const data = buyback.publicData();
  return {
    groups: data.groups.map((group) => ({
      name: group.name,
      device: group.device,
      models: group.models.filter((model) => !model.manual).map((model) => ({ id: model.id, name: model.name, variants: model.variants.map((v) => ({ id: v.id, label: v.label })) }))
    })),
    storage: data.storage,
    connectivity: data.connectivity || []
  };
}

function strings() {
  const out = [...Object.values(TEXT), ...Object.values(STATUS), ...CATEGORIES.map((c) => c[1]), ...SORTS.map((s) => s[1]), "Alle mærker", "Kategorier", "Mærker", "Sortér"];
  for (const grade of Object.values(GRADES)) out.push(grade.label, grade.text);
  return out;
}

// ---------- Routes ----------
function register(app, ctx) {
  const { config, limited, clientIp, cleanLine, cleanText, requireAdmin, originOf, send } = ctx;
  const clean = { cleanLine, cleanText };

  app.get("/koeb", async (req, res) => {
    send(req, res, "koeb.html", "koeb", await listTokens(req.lang || "da", originOf(req), req.query));
  });

  app.get("/koeb/tak", async (req, res) => {
    const lang = req.lang || "da";
    const tr = (text) => i18n.t(lang, text);
    const ref = normRef("KB", req.query.ordre, 5);
    const sessionId = cleanLine(req.query.session_id, 200);
    let html = tr(TEXT.thanksMissing);
    if (ref && /^cs_[A-Za-z0-9_]+$/.test(sessionId) && stripe.enabled()) {
      try {
        const session = await stripe.getCheckout(sessionId);
        if (normRef("KB", session.metadata && session.metadata.ref, 5) === ref) {
          const order = await markPaid(session, config);
          html = order
            ? fill(tr(TEXT.thanksPaid), {
                ref: esc(order.ref),
                email: esc(order.customer.email),
                title: esc(order.title),
                days: esc(tr(order.incoming ? TEXT.incomingDays : TEXT.oneDay))
              })
            : tr(TEXT.thanksPending);
        }
      } catch (error) {
        console.error(`Butik bekræft ${ref}: ${error.message}`);
        html = tr(TEXT.thanksPending);
      }
    }
    send(req, res, "koeb-tak.html", "koeb", { ORDER_HTML: html });
  });

  app.get("/koeb/feed.xml", async (req, res) => {
    const origin = originOf(req);
    const items = (await listings.all()).filter((item) => available(item) && item.photos && item.photos.length);
    const xml = items
      .map((listing) => {
        const title = titleOf(listing);
        const grade = GRADES[listing.grade] || GRADES.god;
        const description = [listing.description, `${grade.label}: ${grade.text}`, TEXT.tested + ".", TEXT.shipping].filter(Boolean).join(" ");
        return (
          "<item>" +
          `<g:id>${esc(listing.ref)}</g:id>` +
          `<g:title>${esc(`${title} (${grade.label}, refurbished)`)}</g:title>` +
          `<g:description>${esc(description)}</g:description>` +
          `<g:link>${esc(`${origin}/koeb/${listing.ref}`)}</g:link>` +
          `<g:image_link>${esc(`${origin}${photoUrl(listing.photos[0])}`)}</g:image_link>` +
          listing.photos
            .slice(1, 10)
            .map((file) => `<g:additional_image_link>${esc(`${origin}${photoUrl(file)}`)}</g:additional_image_link>`)
            .join("") +
          `<g:price>${listing.priceDkk}.00 DKK</g:price>` +
          "<g:availability>in_stock</g:availability>" +
          "<g:condition>refurbished</g:condition>" +
          `<g:brand>${esc(brandOf(listing))}</g:brand>` +
          "<g:identifier_exists>no</g:identifier_exists>" +
          `<g:google_product_category>${GOOGLE_CATEGORY[listing.device] || "222"}</g:google_product_category>` +
          (listing.color ? `<g:color>${esc(listing.color)}</g:color>` : "") +
          "<g:shipping><g:country>DK</g:country><g:price>0.00 DKK</g:price></g:shipping>" +
          "</item>"
        );
      })
      .join("\n");
    res.setHeader("Cache-Control", "public, max-age=900");
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>TeknikFix</title><link>${esc(origin)}/koeb</link><description>Brugte og istandsatte telefoner, tablets og computere</description>\n${xml}\n</channel></rss>\n`
      );
  });

  app.get("/eksempel/:file", (req, res, next) => {
    const match = /^([a-z0-9-]{1,60})-(telefon|tablet|computer)\.svg$/.exec(String(req.params.file || ""));
    if (!match) return next();
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.type("image/svg+xml").send(stockimg.svg(match[1], match[2]));
  });

  app.get("/foto/:file", (req, res, next) => {
    const file = String(req.params.file || "");
    if (!PHOTO_RE.test(file)) return next();
    const full = path.join(PHOTOS, file);
    if (!fs.existsSync(full)) return next();
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    return res.sendFile(full);
  });

  app.get("/koeb/:ref", async (req, res, next) => {
    const ref = normRef("VA", req.params.ref, 5);
    if (!ref) return next();
    const listing = (await listings.all()).find((item) => item.ref === ref);
    if (!listing || listing.status === "skjult") return next();
    const error = req.query.betaling === "afbrudt" ? TEXT.cancelled : req.query.fejl === "optaget" ? TEXT.busy : req.query.fejl === "kort" ? TEXT.failed : "";
    return send(req, res, "koeb-vare.html", "koeb", itemTokens(listing, req.lang || "da", originOf(req), config, error));
  });

  app.post("/koeb/:ref/betal", async (req, res, next) => {
    const ref = normRef("VA", req.params.ref, 5);
    if (!ref) return next();
    const lang = req.lang || "da";
    const back = `${i18n.prefix(lang)}/koeb/${ref}`;
    if (!stripe.enabled()) return res.redirect(303, `${back}?fejl=kort`);
    if (limited(`butik:${clientIp(req)}`, 20, 60 * 60 * 1000)) return res.redirect(303, `${back}?fejl=optaget`);
    const now = Date.now();
    const listing = await listings.withList((list) => {
      const found = list.find((item) => item.ref === ref);
      if (!found || !available(found, now)) return { save: false, value: found ? { busy: true } : null };
      found.status = "reserveret";
      found.reservedUntil = new Date(now + RESERVE_MS).toISOString();
      return { save: true, value: { ...found } };
    });
    if (!listing) return next();
    if (listing.busy) return res.redirect(303, `${back}?fejl=optaget`);
    const title = titleOf(listing, lang);
    const order = await orders.withList((list) => {
      const cutoff = now - 3 * 86400000;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].status === "afventer" && Date.parse(list[i].createdAt) < cutoff) list.splice(i, 1);
      }
      const at = new Date(now).toISOString();
      const record = {
        ref: makeRef("KB", list, 5),
        createdAt: at,
        updatedAt: at,
        status: "afventer",
        lang,
        listingRef: listing.ref,
        incoming: Boolean(listing.incoming),
        title: titleOf(listing),
        priceDkk: listing.priceDkk,
        costDkk: listing.costDkk ?? null,
        imei: listing.imei || "",
        customer: null,
        tracking: "",
        notes: [],
        events: []
      };
      list.push(record);
      return { save: true, value: record };
    });
    try {
      const origin = originOf(req);
      const session = await stripe.createShopCheckout({
        ref: order.ref,
        title: `${title} (${i18n.t(lang, (GRADES[listing.grade] || GRADES.god).label)})`,
        priceDkk: listing.priceDkk,
        image: listing.photos && listing.photos[0] && origin.startsWith("https://") ? `${origin}${photoUrl(listing.photos[0])}` : "",
        origin: origin + i18n.prefix(lang),
        cancelPath: `/koeb/${listing.ref}`,
        expiresAt: Math.floor(now / 1000) + CHECKOUT_S,
        note: `${i18n.t(lang, listing.incoming ? TEXT.shippingIncoming : TEXT.shipping)} ${i18n.t(lang, TEXT.charged)}`,
        lang
      });
      return res.redirect(303, session.url);
    } catch (error) {
      console.error(`Stripe butik ${order.ref}: ${error.message}`);
      await listings.withList((list) => {
        const found = list.find((item) => item.ref === listing.ref);
        if (!found || found.status !== "reserveret") return { save: false };
        found.status = "aktiv";
        found.reservedUntil = null;
        return { save: true };
      });
      return res.redirect(303, `${back}?fejl=kort`);
    }
  });

  // ---------- Admin API ----------
  app.get("/api/admin/butik", requireAdmin, async (req, res) => {
    const list = await listings.all();
    res.json({
      listings: [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((item) => ({ ...item, available: available(item), title: titleOf(item) })),
      grades: Object.fromEntries(Object.entries(GRADES).map(([id, grade]) => [id, grade.label])),
      statuses: STATUS,
      cardEnabled: stripe.enabled(),
      ...adminModels()
    });
  });

  app.get("/api/admin/butik/forslag", requireAdmin, (req, res) => {
    const input = { modelId: String(req.query.modelId || ""), variant: String(req.query.variant || ""), storage: String(req.query.storage || ""), conn: String(req.query.conn || ""), grade: String(req.query.grade || ""), batteryPct: req.query.batteryPct };
    res.json({ priceDkk: suggestPrice(input), valueDkk: buyback.shopValue(input) });
  });

  app.post("/api/admin/butik/vare", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const created = await listings.withList((list) => {
      const now = new Date().toISOString();
      const listing = { ref: makeRef("VA", list, 5), createdAt: now, status: "aktiv", photos: [], color: "", title: "", description: "", imei: "", buybackRef: "" };
      const problem = applyFields(listing, { status: "aktiv", ...body }, clean);
      if (problem) return { save: false, value: { bad: problem } };
      list.push(listing);
      return { save: true, value: listing };
    });
    if (created.bad) return res.status(400).json({ error: "oplysninger", message: created.bad });
    return res.status(201).json(created);
  });

  app.put("/api/admin/butik/vare/:ref", requireAdmin, async (req, res) => {
    const ref = normRef("VA", req.params.ref, 5);
    const updated = await listings.withList((list) => {
      const listing = list.find((item) => item.ref === ref);
      if (!listing) return { save: false, value: null };
      const copy = JSON.parse(JSON.stringify(listing));
      const problem = applyFields(copy, req.body || {}, clean);
      if (problem) return { save: false, value: { bad: problem } };
      Object.assign(listing, copy);
      return { save: true, value: listing };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    if (updated.bad) return res.status(400).json({ error: "oplysninger", message: updated.bad });
    return res.json(updated);
  });

  app.post("/api/admin/butik/vare/:ref/foto", requireAdmin, express.raw({ type: Object.keys(PHOTO_TYPES), limit: "8mb" }), async (req, res) => {
    const ref = normRef("VA", req.params.ref, 5);
    const ext = PHOTO_TYPES[String(req.get("content-type") || "").split(";")[0].trim()];
    if (!ref || !ext || !Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: "foto", message: "Vælg et billede (JPG, PNG eller WebP)." });
    const file = `${ref.toLowerCase()}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
    const updated = await listings.withList((list) => {
      const listing = list.find((item) => item.ref === ref);
      if (!listing) return { save: false, value: null };
      listing.photos = listing.photos || [];
      if (listing.photos.length >= MAX_PHOTOS) return { save: false, value: { bad: `Højst ${MAX_PHOTOS} billeder.` } };
      fs.writeFileSync(path.join(PHOTOS, file), req.body);
      listing.photos.push(file);
      listing.updatedAt = new Date().toISOString();
      return { save: true, value: listing };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    if (updated.bad) return res.status(400).json({ error: "foto", message: updated.bad });
    return res.json(updated);
  });

  app.delete("/api/admin/butik/vare/:ref/foto/:file", requireAdmin, async (req, res) => {
    const ref = normRef("VA", req.params.ref, 5);
    const file = String(req.params.file || "");
    if (!PHOTO_RE.test(file)) return res.status(400).json({ error: "foto" });
    const updated = await listings.withList((list) => {
      const listing = list.find((item) => item.ref === ref);
      if (!listing || !(listing.photos || []).includes(file)) return { save: false, value: null };
      listing.photos = listing.photos.filter((name) => name !== file);
      fs.rmSync(path.join(PHOTOS, file), { force: true });
      return { save: true, value: listing };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    return res.json(updated);
  });

  app.get("/api/admin/butik/ordrer", requireAdmin, async (req, res) => {
    const list = await orders.all();
    res.json({ items: list.filter((order) => order.status !== "afventer").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), statuses: ORDER_STATUS });
  });

  app.patch("/api/admin/butik/ordrer/:ref", requireAdmin, async (req, res) => {
    const ref = normRef("KB", req.params.ref, 5);
    const body = req.body || {};
    const before = (await orders.all()).find((entry) => entry.ref === ref);
    if (!before) return res.status(404).json({ error: "ikke_fundet" });
    const shipping = (typeof body.tracking === "string" && body.tracking.trim()) || body.status === "afsendt" || body.status === "leveret";
    if (shipping && before.paymentIntent && !before.captured) {
      try {
        await stripe.capturePayment(before.paymentIntent);
        await orders.withList((list) => {
          const order = list.find((entry) => entry.ref === ref);
          if (!order) return { save: false };
          order.captured = true;
          event(order, `${order.paidDkk} kr er trukket.`, false);
          return { save: true };
        });
      } catch (error) {
        console.error(`Butik træk ${ref}: ${error.message}`);
        return res.status(409).json({ error: "betaling", message: `Pengene kunne ikke trækkes (${error.message}). Send ikke pakken. Tjek betalingen i Stripe.` });
      }
    }
    const stopping = ["refunderet", "annulleret"].includes(body.status) && before.paymentIntent && !before.captured;
    if (stopping) {
      const problem = await releasePayment(before);
      if (problem) return res.status(409).json({ error: "betaling", message: `Reservationen kunne ikke frigives (${problem}). Tjek betalingen i Stripe.` });
    }
    let shipped = false;
    const updated = await orders.withList((list) => {
      const order = list.find((entry) => entry.ref === ref);
      if (!order) return { save: false, value: null };
      if (typeof body.tracking === "string") {
        const tracking = cleanLine(body.tracking, 60).replace(/\s/g, "");
        if (tracking && tracking !== order.tracking) {
          order.tracking = tracking;
          if (order.status === "betalt") {
            order.status = "afsendt";
            shipped = true;
          }
          event(order, `Pakken er sendt. Sporingsnummer ${tracking}.`);
        }
      }
      if (typeof body.status === "string" && body.status && body.status !== order.status) {
        if (!ORDER_STATUS[body.status]) return { save: false, value: { bad: "Ukendt status." } };
        if (body.status === "afsendt" && order.status === "betalt") shipped = true;
        order.status = body.status;
        event(order, `Status: ${ORDER_STATUS[body.status]}`, false);
      }
      if (typeof body.note === "string" && body.note.trim()) order.notes.push({ at: new Date().toISOString(), text: cleanText(body.note, 2000) });
      order.updatedAt = new Date().toISOString();
      return { save: true, value: order };
    });
    if (!updated) return res.status(404).json({ error: "ikke_fundet" });
    if (updated.bad) return res.status(400).json({ error: "oplysninger", message: updated.bad });
    if (shipped && updated.customer) void shippedMail(updated, config);
    if (stopping && updated.status === "annulleret" && updated.customer) void cancelledMail(updated, config);
    if (["returneret", "refunderet", "annulleret"].includes(updated.status)) {
      await listings.withList((list) => {
        const listing = list.find((item) => item.ref === updated.listingRef);
        if (!listing || listing.orderRef !== updated.ref || listing.status !== "solgt") return { save: false };
        listing.status = "skjult";
        listing.updatedAt = new Date().toISOString();
        return { save: true };
      });
    }
    return res.json(updated);
  });
}

async function sitemapPaths() {
  return (await listings.all()).filter((item) => item.status === "aktiv" || item.status === "reserveret").map((item) => `/koeb/${item.ref}`);
}

module.exports = {
  register,
  handleStripeSession,
  strings,
  sitemapPaths,
  suggestPrice,
  listFromBuyback,
  listedBuybacks,
  buybackChanged,
  startJobs,
  NOINDEX: ["koeb-tak.html"]
};
