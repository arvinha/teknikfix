// CJdropshipping API (developers.cjdropshipping.com). Off until CJ_API_KEY is in .env.
const fs = require("fs");
const path = require("path");

const API = "https://developers.cjdropshipping.com/api2.0/v1";
const TOKEN_FILE = path.join(__dirname, "data", "cj-token.json");

function enabled() {
  return Boolean((process.env.CJ_API_KEY || "").trim());
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// CJ allows one call per second per account.
let lastCall = 0;
let queue = Promise.resolve();

function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  });
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function rawCall(method, route, { query, body, token } = {}) {
  const url = new URL(`${API}${route}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const headers = { "Content-Type": "application/json" };
  if (token) headers["CJ-Access-Token"] = token;
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.result === false || (json.code && json.code !== 200)) {
    throw new Error(`CJ ${route}: ${json.message || response.status}`);
  }
  return json.data;
}

function readToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch (error) {
    return null;
  }
}

async function token() {
  const saved = readToken();
  const soon = Date.now() + 2 * 86400000;
  if (saved && saved.accessToken && Date.parse(saved.accessTokenExpiryDate) > soon) return saved.accessToken;
  let data = null;
  if (saved && saved.refreshToken && Date.parse(saved.refreshTokenExpiryDate) > soon) {
    data = await throttled(() => rawCall("POST", "/authentication/refreshAccessToken", { body: { refreshToken: saved.refreshToken } })).catch(() => null);
  }
  if (!data) {
    data = await throttled(() => rawCall("POST", "/authentication/getAccessToken", { body: { apiKey: process.env.CJ_API_KEY.trim() } }));
  }
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  return data.accessToken;
}

async function call(method, route, options = {}) {
  const access = await token();
  return throttled(() => rawCall(method, route, { ...options, token: access }));
}

function maxDays(aging) {
  const numbers = String(aging || "").split(/[^\d]+/).filter(Boolean).map(Number);
  return numbers.length ? Math.max(...numbers) : 99;
}

async function cheapestRoute(toCountry, items) {
  const data = await call("POST", "/logistic/freightCalculate", {
    body: { startCountryCode: "CN", endCountryCode: toCountry, products: items.map((item) => ({ vid: item.vid, quantity: item.quantity })) }
  });
  const routes = (data || []).map((row) => ({ name: row.logisticName, priceUsd: Number(row.totalPostageFee || row.logisticPrice) || 0, maxDays: maxDays(row.logisticAging) }));
  return routes.filter((route) => route.maxDays <= 20).sort((a, b) => a.priceUsd - b.priceUsd)[0] || routes.sort((a, b) => a.maxDays - b.maxDays)[0] || null;
}

function province(postal) {
  const n = Number(postal);
  if (n >= 9000) return "Nordjylland";
  if (n >= 7400) return "Midtjylland";
  if (n >= 5000) return "Syddanmark";
  if (n >= 4000) return "Sjaelland";
  return "Hovedstaden";
}

/** customer: { name, phone, email, line1, line2, postal, city, country }. items: [{ vid, quantity }] */
async function createOrder(orderNumber, customer, items) {
  const route = await cheapestRoute(customer.country, items);
  if (!route) throw new Error("Ingen fragtvej fundet");
  const data = await call("POST", "/shopping/order/createOrderV2", {
    body: {
      orderNumber,
      shippingCountryCode: customer.country,
      shippingCountry: new Intl.DisplayNames(["en"], { type: "region" }).of(customer.country) || customer.country,
      shippingProvince: customer.country === "DK" ? province(customer.postal) : customer.city,
      shippingCity: customer.city,
      shippingZip: customer.postal,
      shippingCustomerName: customer.name,
      shippingAddress: customer.line1,
      shippingAddress2: customer.line2 || "",
      shippingPhone: customer.phone || "",
      email: customer.email,
      logisticName: route.name,
      fromCountryCode: "CN",
      iossType: 1,
      payType: 2,
      products: items.map((item, index) => ({ vid: item.vid, quantity: item.quantity, storeLineItemId: `${orderNumber}-${index + 1}` }))
    }
  });
  return { cjOrderId: data.orderId || "", status: data.orderStatus || "CREATED", logistic: route.name, costUsd: Number(data.orderAmount) || null };
}

async function orderDetail(orderId) {
  return call("GET", "/shopping/order/getOrderDetail", { query: { orderId } });
}

async function searchProducts(keyword, size = 20) {
  const data = await call("GET", "/product/listV2", { query: { keyWord: keyword, page: 1, size } });
  return ((data && data.content) || []).flatMap((block) => block.productList || []);
}

async function productDetail(pid) {
  return call("GET", "/product/query", { query: { pid } });
}

async function variant(vid) {
  return call("GET", "/product/variant/queryByVid", { query: { vid } });
}

/** Cheapest route from China to the country that arrives within 20 days, in USD. */
async function shippingUsd(toCountry, vid) {
  const route = await cheapestRoute(toCountry, [{ vid, quantity: 1 }]);
  return route ? route.priceUsd : null;
}

module.exports = { enabled, createOrder, orderDetail, searchProducts, productDetail, variant, shippingUsd };
