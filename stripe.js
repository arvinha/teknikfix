const crypto = require("crypto");

const API = "https://api.stripe.com/v1";

function key() {
  return (process.env.STRIPE_SECRET_KEY || "").trim();
}

function enabled() {
  return /^(sk|rk)_(live|test)_/.test(key());
}

async function call(method, path, params) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body.error && body.error.message) || `Stripe svarede ${response.status}`;
    throw new Error(message);
  }
  return body;
}

const LOCALES = ["da", "en", "de", "sv", "fi", "fr", "es", "it", "nl", "pl"];

function locale(lang) {
  return LOCALES.includes(lang) ? lang : "da";
}

/** `origin` already carries the language prefix (https://teknikfix.dk/en), so the customer comes back to their own language. */
async function createCheckout({ ref, email, amountDkk, title, kind, origin, lang }) {
  const back = `${origin}/sag?ref=${encodeURIComponent(ref)}`;
  return call("POST", "/checkout/sessions", {
    mode: "payment",
    locale: locale(lang),
    customer_email: email,
    client_reference_id: ref,
    "metadata[ref]": ref,
    "metadata[kind]": kind,
    "payment_intent_data[metadata][ref]": ref,
    "payment_intent_data[description]": `TeknikFix sag ${ref}`,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "dkk",
    "line_items[0][price_data][unit_amount]": String(Math.round(amountDkk * 100)),
    "line_items[0][price_data][product_data][name]": title,
    success_url: `${back}&betaling=ok&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}&betaling=afbrudt`
  });
}

/** Spare parts: one line per part plus shipping. Stripe collects the delivery address and phone. */
async function createPartsCheckout({ ref, lines, shippingDkk, shippingTitle = "Fragt", country = "DK", origin, lang, note = "" }) {
  const params = {
    mode: "payment",
    locale: locale(lang),
    client_reference_id: ref,
    "metadata[ref]": ref,
    "metadata[kind]": "dele",
    "metadata[country]": country,
    "payment_intent_data[metadata][ref]": ref,
    "payment_intent_data[description]": `TeknikFix reservedele ${ref}`,
    "shipping_address_collection[allowed_countries][0]": country,
    "phone_number_collection[enabled]": "true",
    success_url: `${origin}/reservedele/tak?ordre=${encodeURIComponent(ref)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/reservedele?betaling=afbrudt`
  };
  if (note) params["custom_text[submit][message]"] = note.slice(0, 1200);
  const all = shippingDkk > 0 ? [...lines, { title: shippingTitle, priceDkk: shippingDkk, qty: 1 }] : lines;
  all.forEach((line, index) => {
    params[`line_items[${index}][quantity]`] = String(line.qty);
    params[`line_items[${index}][price_data][currency]`] = "dkk";
    params[`line_items[${index}][price_data][unit_amount]`] = String(Math.round(line.priceDkk * 100));
    params[`line_items[${index}][price_data][product_data][name]`] = line.title;
  });
  return call("POST", "/checkout/sessions", params);
}

/** One refurbished device from the shop. Danish delivery only; the session expires with the reservation. */
async function createShopCheckout({ ref, title, priceDkk, image, origin, cancelPath, expiresAt, note = "", lang }) {
  const params = {
    mode: "payment",
    locale: locale(lang),
    client_reference_id: ref,
    expires_at: String(expiresAt),
    "metadata[ref]": ref,
    "metadata[kind]": "butik",
    "payment_intent_data[metadata][ref]": ref,
    "payment_intent_data[description]": `TeknikFix butik ${ref}`,
    "shipping_address_collection[allowed_countries][0]": "DK",
    "phone_number_collection[enabled]": "true",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "dkk",
    "line_items[0][price_data][unit_amount]": String(Math.round(priceDkk * 100)),
    "line_items[0][price_data][product_data][name]": title.slice(0, 250),
    success_url: `${origin}/koeb/tak?ordre=${encodeURIComponent(ref)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${cancelPath}?betaling=afbrudt`
  };
  if (image) params["line_items[0][price_data][product_data][images][0]"] = image;
  if (note) params["custom_text[submit][message]"] = note.slice(0, 1200);
  return call("POST", "/checkout/sessions", params);
}

async function getCheckout(sessionId) {
  return call("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

function verifyWebhook(rawBody, header, secret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    String(header)
      .split(",")
      .map((part) => part.split("="))
      .filter((pair) => pair.length === 2)
  );
  const stamp = Number(parts.t);
  if (!Number.isFinite(stamp) || Math.abs(Date.now() / 1000 - stamp) > 600) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const signatures = String(header)
    .split(",")
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  return signatures.some((signature) => {
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  });
}

module.exports = { enabled, createCheckout, createPartsCheckout, createShopCheckout, getCheckout, verifyWebhook };
