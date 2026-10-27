// Messages to the customer: e-mail through Resend (resend.com) and SMS through GatewayAPI (gatewayapi.com).
// Each channel is off until its key is in .env, and a failed message never stops a booking.
// Texts are written in Danish and translated on the way out when the customer used another language.
const i18n = require("./i18n");

const VISIT_LABEL = {
  vaerksted: "På værkstedet",
  hjemme: "Hjemme hos dig",
  post: "Du sender den med posten",
  "paa-stedet": "På stedet",
  konsultation: "Konsultation"
};
const WHEN_LABEL = { hurtigst: "Hurtigst muligt", "i-dag": "I dag" };

/** What the customer hears when the case moves to one of these statuses. Others stay quiet. */
const STATUS_TEXT = {
  bekraeftet: "Din tid er bekræftet.",
  tilbud: "Vi har sendt dig et tilbud. Se prisen og godkend den på din sag.",
  i_gang: "Vi er gået i gang med reparationen.",
  afventer_betaling: "Din reparation er klar. Du kan betale på din sag.",
  betalt: "Tak, vi har modtaget din betaling.",
  afsluttet: "Din sag er afsluttet. Tak fordi du valgte TeknikFix.",
  kunne_ikke: "Vi kunne desværre ikke reparere enheden. Vi kontakter dig om det videre forløb.",
  aflyst: "Din booking er aflyst. Kontakt os, hvis det er en fejl."
};

function env(name) {
  return (process.env[name] || "").trim();
}

function mailEnabled() {
  return env("RESEND_API_KEY").startsWith("re_") && env("MAIL_FROM").includes("@");
}

function smsEnabled() {
  return env("GATEWAYAPI_TOKEN").length > 10;
}

function siteUrl() {
  return env("SITE_URL").replace(/\/$/, "");
}

function caseLink(booking, withEmail) {
  const query = new URLSearchParams({ ref: booking.ref });
  if (withEmail) query.set("email", booking.email);
  return `${siteUrl()}${i18n.prefix(booking.lang)}/sag?${query}`;
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function msisdn(phone) {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^00/, "");
  if (digits.length === 8) return Number(`45${digits}`);
  if (digits.length >= 10 && digits.length <= 15) return Number(digits);
  return null;
}

/** Danish amounts read as Swedish or Norwegian kroner abroad, so other languages get DKK. */
function inLanguage(lang, list) {
  if (!lang || lang === "da") return Promise.resolve(list);
  return i18n.translateNow(lang, list.map((text) => String(text).replace(/(\d) kr\b/g, "$1 DKK")));
}

/** target: { ref, name, email, lang }. button: { link, label } or null. */
async function sendMailTo(target, subject, paragraphs, config, button) {
  if (!mailEnabled() || !target.email) return;
  const first = String(target.name || "").split(" ")[0];
  const words = await inLanguage(target.lang, [subject, "Hej", "Venlig hilsen", button ? button.label : "", ...paragraphs]);
  [subject] = words;
  const [, hello, regards, buttonLabel] = words;
  paragraphs = words.slice(4);
  if (button) button = { ...button, label: buttonLabel };
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c1917;max-width:560px">` +
    `<p>${esc(hello)} ${esc(first)},</p>` +
    paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("") +
    (button
      ? `<p><a href="${esc(button.link)}" style="display:inline-block;background:#b45309;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${esc(button.label)}</a></p>`
      : "") +
    `<p>${esc(regards)}<br>TeknikFix<br>${esc(config.phoneDisplay)} · ${esc(config.domain)}</p></div>`;
  const text = `${hello} ${first},\n\n${paragraphs.join("\n\n")}${button ? `\n\n${button.label}: ${button.link}` : ""}\n\n${regards}\nTeknikFix\n${config.phoneDisplay}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env("RESEND_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env("MAIL_FROM"), to: [target.email], reply_to: config.email, subject, html, text }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) console.error(`Mail ${target.ref} fejlede: ${res.status} ${await res.text().catch(() => "")}`);
  } catch (error) {
    console.error(`Mail ${target.ref} fejlede: ${error.message}`);
  }
}

function sendMail(booking, subject, paragraphs, config) {
  return sendMailTo(booking, subject, paragraphs, config, { link: caseLink(booking, true), label: `Se din sag ${booking.ref}` });
}

async function sendSms(target, message) {
  if (!smsEnabled()) return;
  const to = msisdn(target.phone);
  if (!to) return;
  [message] = await inLanguage(target.lang, [message]);
  try {
    const res = await fetch(env("GATEWAYAPI_URL") || "https://gatewayapi.com/rest/mtsms", {
      method: "POST",
      headers: { authorization: `Token ${env("GATEWAYAPI_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify({ sender: env("SMS_SENDER") || "TeknikFix", message, recipients: [{ msisdn: to }] }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) console.error(`SMS ${target.ref} fejlede: ${res.status} ${await res.text().catch(() => "")}`);
  } catch (error) {
    console.error(`SMS ${target.ref} fejlede: ${error.message}`);
  }
}

function bookingReceived(booking, config) {
  const what = booking.estimate ? booking.estimate.label : booking.problem.slice(0, 200);
  const when = booking.when === "tidspunkt" ? booking.timeNote : WHEN_LABEL[booking.when] || "";
  const details = [
    `Sagsnummer: ${booking.ref}`,
    `Enhed: ${booking.model || booking.device}`,
    `Opgave: ${what}`,
    `Hvor: ${VISIT_LABEL[booking.visit] || booking.visit}${booking.visit === "hjemme" && booking.address ? `, ${booking.address}` : ""}`,
    `Ønsket tid: ${when}`
  ];
  if (booking.estimate && Number.isInteger(booking.estimate.priceDkk)) {
    details.push(`Pris: ${booking.estimate.from ? "fra " : ""}${booking.estimate.priceDkk} kr`);
  }
  return Promise.all([
    sendMail(
      booking,
      `Tak for din booking · ${booking.ref}`,
      ["Tak for din booking hos TeknikFix. Vi kontakter dig snarest for at bekræfte tiden.", details.join("\n")],
      config
    ),
    sendSms(
      booking,
      `TeknikFix: Tak for din booking (${booking.ref}). Vi kontakter dig snarest for at bekræfte tiden. Se sagen: ${caseLink(booking, false)}`
    )
  ]);
}

/** After the owner changes the case. `status` is set only when it changed to a status in STATUS_TEXT. */
function caseUpdated(booking, { status, message }, config) {
  const parts = [];
  if (status && STATUS_TEXT[status]) parts.push(STATUS_TEXT[status]);
  if (status === "tilbud" || status === "afventer_betaling") {
    if (Number.isInteger(booking.priceDkk)) parts.push(`Pris: ${booking.priceDkk} kr.`);
  }
  if (message) parts.push(message);
  if (parts.length === 0) return Promise.resolve();
  return Promise.all([
    sendMail(booking, `${status && STATUS_TEXT[status] ? STATUS_TEXT[status].replace(/\.$/, "") : "Nyt om din sag"} · ${booking.ref}`, parts, config),
    sendSms(booking, `TeknikFix (${booking.ref}): ${parts.join(" ")} ${caseLink(booking, false)}`)
  ]);
}

/** Receipt after a card/MobilePay payment through Stripe. */
function paymentReceived(booking, { amountDkk, prepaid, paymentId }, config) {
  const what = booking.estimate ? `${booking.model || booking.device}, ${booking.estimate.label.toLowerCase()}` : "Reparation";
  const date = new Intl.DateTimeFormat("da-DK", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(new Date());
  const receipt = [
    "KVITTERING",
    `Dato: ${date}`,
    `Sagsnummer: ${booking.ref}`,
    `Ydelse: ${what}`,
    `Beløb: ${amountDkk} kr`,
    "Betalt med: kort / MobilePay (Stripe)"
  ];
  if (paymentId) receipt.push(`Betalings-id: ${paymentId}`);
  receipt.push("", `Sælger: ${config.brand} (${config.legalName}), CVR ${config.cvr}`, `${config.street}, ${config.postal} ${config.city}`);
  const intro = prepaid
    ? "Tak, vi har modtaget din betaling. Kan vi ikke reparere enheden, får du pengene tilbage."
    : "Tak, vi har modtaget din betaling.";
  return Promise.all([
    sendMail(booking, `Kvittering for betaling · ${booking.ref}`, [intro, receipt.join("\n")], config),
    sendSms(booking, `TeknikFix (${booking.ref}): Tak, vi har modtaget ${amountDkk} kr. Kvitteringen er sendt på e-mail.`)
  ]);
}

const kr = (amount) => `${new Intl.NumberFormat("da-DK").format(amount)} kr`;

function sellerTarget(buyback) {
  return { ref: buyback.ref, name: buyback.seller.name, email: buyback.seller.email, phone: buyback.seller.phone, lang: buyback.lang };
}

function buybackLink(buyback, withEmail) {
  const query = new URLSearchParams({ ref: buyback.ref });
  if (withEmail) query.set("email", buyback.seller.email);
  return `${siteUrl()}${i18n.prefix(buyback.lang)}/saelg/sag?${query}`;
}

function buybackItemsText(buyback) {
  return buyback.items
    .map((item) => {
      const price = item.manual ? "pris følger" : item.blocked ? "kan ikke købes" : kr(item.offerDkk);
      return `${item.qty > 1 ? `${item.qty} × ` : ""}${item.modelName}${item.storageLabel ? `, ${item.storageLabel}` : ""}${item.variantLabel ? `, ${item.variantLabel}` : ""}: ${price}${item.qty > 1 && !item.manual ? " pr. stk." : ""}`;
    })
    .join("\n");
}

function buybackReceived(buyback, config) {
  const abroad = buyback.seller.country && buyback.seller.country !== "DK";
  const how =
    buyback.delivery !== "post"
      ? `Næste skridt: Aflever enheden hos os på ${config.street}, ${config.postal} ${config.city}. Ring eller skriv først, så vi er der.`
      : abroad
        ? "Næste skridt: Vi mailer dig en fragtlabel inden for 1 hverdag. Pak enheden godt ind, og aflever den hos fragtfirmaet."
        : "Næste skridt: Vi mailer dig en gratis fragtlabel inden for 1 hverdag. Pak enheden godt ind, og aflever den i en pakkeshop.";
  const lines = [
    `Tak. Her er dit tilbud ${buyback.ref}. Det gælder i ${buyback.validDays} dage.`,
    buybackItemsText(buyback),
    buyback.shippingDeductDkk > 0 ? `Fragt fra udlandet: −${kr(buyback.shippingDeductDkk)}` : "",
    buyback.offerDkk > 0 ? `I alt: ${kr(buyback.offerDkk)}` : "",
    how,
    "Slå Find min iPhone, Google-konto og andre låse fra, og tag SIM- og hukommelseskort ud. Vi sletter alle data, når vi har tjekket enheden.",
    "Passer enheden med det, du skrev, udbetaler vi med det samme. Ellers får du et nyt tilbud, som du kan sige ja eller nej til. Siger du nej, får du den gratis retur."
  ].filter(Boolean);
  return Promise.all([
    sendMailTo(sellerTarget(buyback), `Dit tilbud fra TeknikFix · ${buyback.ref}`, lines, config, { link: buybackLink(buyback, true), label: `Se dit tilbud ${buyback.ref}` }),
    sendSms(sellerTarget(buyback), `TeknikFix: Tak, dit tilbud ${buyback.ref}${buyback.offerDkk > 0 ? ` på ${kr(buyback.offerDkk)}` : ""} er gemt. Se det her: ${buybackLink(buyback, false)}`)
  ]);
}

function buybackText(buyback, status) {
  const amount = kr(Number.isInteger(buyback.finalDkk) ? buyback.finalDkk : buyback.offerDkk);
  const payout = buyback.payout && buyback.payout.method === "bank" ? "bankoverførsel" : "MobilePay";
  const abroad = buyback.seller.country && buyback.seller.country !== "DK";
  return {
    label_sendt: abroad
      ? "Vi har sendt dig en fragtlabel. Pak enheden godt ind, og aflever pakken hos fragtfirmaet."
      : "Vi har sendt dig en gratis fragtlabel. Pak enheden godt ind, og aflever pakken i en pakkeshop.",
    modtaget: "Vi har modtaget din enhed og tjekker den nu. Det tager normalt 1–2 hverdage.",
    nyt_tilbud: `Efter tjekket kan vi tilbyde dig ${amount}. Sig ja eller nej på din side. Siger du nej, sender vi den gratis retur.`,
    godkendt: `Tak. Vi udbetaler ${amount} til dig med ${payout} inden for 1 hverdag.`,
    udbetalt: `Vi har udbetalt ${amount} med ${payout}. Tak for handlen.`,
    retur: "Vi sender enheden retur til dig uden beregning.",
    afvist: "Vi kan desværre ikke købe enheden. Vi kontakter dig om, hvordan du får den tilbage."
  }[status];
}

function buybackUpdated(buyback, { status, message }, config) {
  const parts = [];
  const statusText = status ? buybackText(buyback, status) : "";
  if (statusText) parts.push(statusText);
  if (message) parts.push(message);
  if (!parts.length) return Promise.resolve();
  return Promise.all([
    sendMailTo(sellerTarget(buyback), `Nyt om dit salg · ${buyback.ref}`, parts, config, { link: buybackLink(buyback, true), label: `Se dit salg ${buyback.ref}` }),
    sendSms(sellerTarget(buyback), `TeknikFix (${buyback.ref}): ${parts.join(" ")} ${buybackLink(buyback, false)}`)
  ]);
}

function partsTarget(order) {
  return { ref: order.ref, name: order.customer.name, email: order.customer.email, phone: order.customer.phone, lang: order.lang };
}

function partsPaid(order, config) {
  const date = new Intl.DateTimeFormat("da-DK", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Copenhagen" }).format(new Date());
  const receipt = [
    "KVITTERING",
    `Dato: ${date}`,
    `Ordre: ${order.ref}`,
    ...order.items.map((item) => `${item.qty} × ${item.title}: ${kr(item.priceDkk * item.qty)}`),
    `Fragt: ${kr(order.shippingDkk)}`,
    `I alt: ${kr(order.paidDkk)}`,
    "",
    `Sælger: ${config.brand} (${config.legalName}), CVR ${config.cvr}`,
    `${config.street}, ${config.postal} ${config.city}`
  ];
  return sendMailTo(
    partsTarget(order),
    `Tak for din ordre · ${order.ref}`,
    [
      `Tak for din ordre. Du får en mail med sporingsnummer, så snart pakken er sendt. Normal leveringstid er ${order.deliveryText}.`,
      receipt.join("\n"),
      "Du har 14 dages fortrydelsesret fra du modtager pakken. Vil du hellere have os til at montere delen, så book en tid på teknikfix.dk/book."
    ],
    config,
    null
  );
}

function partsShipped(order, config) {
  const trackUrl = `https://t.17track.net/${order.lang || "da"}#nums=${encodeURIComponent(order.tracking || "")}`;
  const track = order.tracking ? `Sporingsnummer: ${order.tracking}\nFølg pakken: ${trackUrl}` : "";
  return Promise.all([
    sendMailTo(partsTarget(order), `Din pakke er på vej · ${order.ref}`, ["Din pakke med reservedele er sendt.", track].filter(Boolean), config, null),
    sendSms(partsTarget(order), `TeknikFix: Din ordre ${order.ref} er sendt.${order.tracking ? ` Spor: ${trackUrl}` : ""}`)
  ]);
}

function partnerReceived(partner, config) {
  return sendMailTo(
    { ref: partner.ref, name: partner.name, email: partner.email, lang: partner.lang },
    `Tak for din tilmelding · ${partner.ref}`,
    [
      "Tak fordi du vil være reparatør hos TeknikFix. Vi kigger på din tilmelding og ringer dig op inden for et par dage.",
      "Når du er godkendt, sender vi dig opgaver i dit område. Du ser opgaven og prisen, før du siger ja."
    ],
    config,
    null
  );
}

module.exports = {
  STATUS_TEXT,
  mailEnabled,
  smsEnabled,
  sendMailTo,
  sendSms,
  bookingReceived,
  caseUpdated,
  paymentReceived,
  buybackReceived,
  buybackUpdated,
  partsPaid,
  partsShipped,
  partnerReceived
};
