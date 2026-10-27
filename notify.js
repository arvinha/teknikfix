// Push notifications to the owner's phone through ntfy (https://ntfy.sh, free app for iPhone/Android).
// The topic name is the only secret: anyone who knows it can read the messages, so keep it long and random.

const VISIT_LABEL = {
  vaerksted: "På værkstedet",
  hjemme: "Hjemme hos kunden",
  post: "Sender med posten (mail pakkeinfo)",
  "paa-stedet": "På stedet",
  konsultation: "Konsultation"
};
const WHEN_LABEL = { hurtigst: "Hurtigst muligt", "i-dag": "I dag" };

function topic() {
  return (process.env.NTFY_TOPIC || "").trim();
}

function enabled() {
  return topic().length >= 12;
}

function siteUrl() {
  return (process.env.SITE_URL || "").replace(/\/$/, "");
}

function phoneLink(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("45") && digits.length === 10) return `+${digits}`;
  if (digits.length === 8) return `+45${digits}`;
  return digits ? `+${digits}` : "";
}

async function send({ title, message, tags = [], priority = 3, booking }) {
  if (!enabled()) return;
  const actions = [];
  if (booking) {
    const tel = phoneLink(booking.phone);
    if (tel) actions.push({ action: "view", label: "Ring kunden", url: `tel:${tel}` });
    if (siteUrl()) actions.push({ action: "view", label: "Åbn sagen", url: `${siteUrl()}/admin#${booking.ref}` });
  }
  try {
    const res = await fetch((process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, ""), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: topic(),
        title,
        message,
        tags,
        priority,
        click: booking && siteUrl() ? `${siteUrl()}/admin#${booking.ref}` : undefined,
        actions
      }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) console.error(`Notifikation fejlede: ${res.status}`);
  } catch (error) {
    console.error(`Notifikation fejlede: ${error.message}`);
  }
}

function newBooking(booking) {
  const what = booking.estimate ? booking.estimate.label : booking.problem.slice(0, 120);
  const when = booking.when === "tidspunkt" ? booking.timeNote : WHEN_LABEL[booking.when] || booking.when;
  const lines = [
    `${booking.name} · ${booking.model || booking.device}`,
    what,
    `${VISIT_LABEL[booking.visit] || booking.visit} · ${when}`
  ];
  if ((booking.visit === "hjemme" || booking.visit === "post") && booking.address) lines.push(booking.address);
  if (booking.lang && booking.lang !== "da") lines.push(`Sprog: ${booking.lang.toUpperCase()} (kunden får mails på sit sprog)`);
  if (booking.estimate && Number.isInteger(booking.estimate.priceDkk)) {
    lines.push(`${booking.estimate.from ? "Fra " : ""}${booking.estimate.priceDkk} kr${booking.payWhen === "nu" ? " · betaler med kort nu" : ""}`);
  }
  return send({ title: `Ny booking ${booking.ref}`, message: lines.join("\n"), tags: ["wrench"], priority: 4, booking });
}

function paid(booking, amountDkk, prepaid) {
  return send({
    title: `Betalt ${amountDkk} kr · ${booking.ref}`,
    message: `${booking.name} · ${booking.model || booking.device}\n${prepaid ? "Forudbetalt med kort" : "Betalt med kort"}`,
    tags: ["moneybag"],
    booking
  });
}

function accepted(booking) {
  return send({
    title: `Pris godkendt · ${booking.ref}`,
    message: `${booking.name} har godkendt ${booking.priceDkk} kr. Du kan gå i gang.`,
    tags: ["white_check_mark"],
    booking
  });
}

function paymentReported(booking, method) {
  return send({
    title: `Kunden har betalt? · ${booking.ref}`,
    message: `${booking.name} siger, at ${method === "bank" ? "bankoverførslen" : "PayPal-betalingen"} er sendt. Tjek kontoen.`,
    tags: ["mag"],
    booking
  });
}

const kr = (amount) => `${new Intl.NumberFormat("da-DK").format(amount)} kr`;

function newBuyback(buyback) {
  const units = buyback.items.reduce((sum, item) => sum + item.qty, 0);
  const lines = [
    `${buyback.seller.name}${buyback.seller.company ? ` · ${buyback.seller.company}` : ""} · ${units} ${units === 1 ? "enhed" : "enheder"}`,
    ...buyback.items.slice(0, 6).map((item) => `${item.qty > 1 ? `${item.qty} × ` : ""}${item.modelName}: ${item.manual ? "pris mangler" : kr(item.offerDkk)}`),
    buyback.delivery === "post" ? "Sender med post: send en fragtlabel" : "Afleverer selv"
  ];
  return send({
    title: `Opkøb ${buyback.ref}${buyback.offerDkk > 0 ? ` · ${kr(buyback.offerDkk)}` : ""}`,
    message: lines.join("\n"),
    tags: ["recycle"],
    priority: 4,
    booking: { ref: buyback.ref, phone: buyback.seller.phone }
  });
}

function buybackAnswer(buyback, accepted) {
  return send({
    title: `${accepted ? "Tilbud godkendt" : "Tilbud afvist"} · ${buyback.ref}`,
    message: accepted
      ? `${buyback.seller.name} siger ja til ${kr(buyback.finalDkk)}. Udbetal med ${buyback.payout.method === "bank" ? "bankoverførsel" : "MobilePay"}.`
      : `${buyback.seller.name} siger nej. Send enheden retur.`,
    tags: [accepted ? "white_check_mark" : "leftwards_arrow_with_hook"],
    booking: { ref: buyback.ref, phone: buyback.seller.phone }
  });
}

function partsOrder(order, { forwarded, error }) {
  const lines = [
    `${order.customer.name} · ${order.customer.postal} ${order.customer.city}`,
    ...order.items.map((item) => `${item.qty} × ${item.title}`),
    forwarded ? "Bestilt hos CJ automatisk." : error ? `CJ fejlede: ${error}. Bestil selv.` : "Bestil hos leverandøren (link i admin)."
  ];
  return send({
    title: `Reservedele ${order.ref} · ${kr(order.paidDkk)}`,
    message: lines.join("\n"),
    tags: ["package"],
    priority: forwarded ? 3 : 4,
    booking: { ref: order.ref, phone: order.customer.phone }
  });
}

function newPartner(partner) {
  return send({
    title: `Ny reparatør ${partner.ref}`,
    message: `${partner.name}${partner.company ? ` · ${partner.company}` : ""}\n${partner.city} · ${partner.skills.join(", ")}`,
    tags: ["handshake"],
    booking: { ref: partner.ref, phone: partner.phone }
  });
}

module.exports = { enabled, send, newBooking, paid, accepted, paymentReported, newBuyback, buybackAnswer, partsOrder, newPartner };
