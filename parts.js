// Spare parts shop. Each part ships straight from the supplier to the customer (dropshipping).
// A part with a CJ variant id (cjVid) is ordered at CJ automatically after payment; others go to the owner with a ready link.
//
// Price model (all sale prices include 25% Danish VAT, shipping is paid on top):
//   market = typical Danish shop price: own marketDkk, else repair price × the type's share for that brand
//   target = market × undercut, so we sit just under the market
//   cost   = own costDkk (ex VAT, as paid), else the CJ price synced every night, else market × assumedCostShare
//   floor  = lowest price where the profit after VAT and card fee is still minProfitDkk
//   price  = own priceDkk if set, else max(target, floor)
const fs = require("fs");
const path = require("path");
const pricing = require("./pricing");
const fx = require("./fx");

const FILE = path.join(__dirname, "parts.json");

let cached = null;
let cachedAt = 0;

function load() {
  const stat = fs.statSync(FILE);
  if (!cached || stat.mtimeMs !== cachedAt) {
    cached = JSON.parse(fs.readFileSync(FILE, "utf8"));
    cachedAt = stat.mtimeMs;
  }
  return cached;
}

function save(data) {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.rmSync(FILE, { force: true });
  fs.renameSync(tmp, FILE);
  cached = null;
}

function charmUp(amount) {
  const whole = Math.ceil(amount);
  if (whole >= 1000) return Math.ceil((whole + 1) / 50) * 50 - 1;
  return Math.ceil((whole + 1) / 10) * 10 - 1;
}

function charmDown(amount) {
  const whole = Math.floor(amount);
  if (whole >= 1000) return Math.floor((whole + 1) / 50) * 50 - 1;
  return Math.floor((whole + 1) / 10) * 10 - 1;
}

function searchUrl(modelName, type) {
  const words = `${modelName} ${type.search}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `https://www.aliexpress.com/w/wholesale-${words}.html`;
}

function marketShare(type, groupId) {
  const share = type.market || {};
  return Number(share[groupId] ?? share.default) || 0.3;
}

/** What one part costs us in DKK ex VAT. Until we know, a careful guess from the market price. */
function costOf(s, own, market) {
  if (Number.isInteger(own.costDkk)) return { dkk: own.costDkk, source: "manual" };
  if (own.cj && Number(own.cj.priceUsd) > 0) {
    const rate = fx.usdDkk(s.usdDkkFallback) * (1 + s.fxBuffer);
    const shippingNet = s.shippingDkk / (1 + s.vat);
    const item = Number(own.cj.priceUsd) * rate;
    const freight = Math.max(0, (Number(own.cj.shipUsd) || 0) * rate - shippingNet);
    return { dkk: Math.round(item + freight), source: "cj" };
  }
  return { dkk: Math.round(market * s.assumedCostShare), source: "guess" };
}

function profitAt(s, price, cost) {
  const net = price / (1 + s.vat);
  return net - cost - price * s.paymentPct - s.paymentFixedDkk;
}

function floorFor(s, cost) {
  return charmUp((cost + s.paymentFixedDkk + s.minProfitDkk) / (1 / (1 + s.vat) - s.paymentPct));
}

function priceOf(s, market, cost, own) {
  const target = Math.max(s.minPrice, charmDown(market * s.undercut));
  const floor = floorFor(s, cost.dkk);
  const auto = Math.max(target, floor);
  const price = Number.isInteger(own.priceDkk) ? own.priceDkk : auto;
  let flag = "";
  if (price < floor) flag = "under bundpris";
  else if (cost.source === "guess") flag = "indkøb anslået";
  else if (price > market) flag = "dyrere end markedet";
  return {
    priceDkk: price,
    autoPriceDkk: auto,
    floorDkk: floor,
    profitDkk: Math.round(profitAt(s, price, cost.dkk)),
    flag
  };
}

/** Every part we sell, built from the repair catalogue so a new model in prices.json shows up here too. */
function list({ includeOff = false } = {}) {
  const data = load();
  const s = data.strategy;
  const out = [];
  for (const group of pricing.catalog().groups) {
    if (!data.groups.includes(group.id)) continue;
    for (const model of group.models) {
      if (data.exclude.includes(model.id)) continue;
      for (const repair of model.repairs) {
        const type = data.types[repair.id];
        if (!type) continue;
        const id = `${model.id}:${repair.id}`;
        const own = data.items[id] || {};
        if (own.off && !includeOff) continue;
        const autoMarket = Math.round(repair.price * marketShare(type, group.id));
        const market = Number.isInteger(own.marketDkk) ? own.marketDkk : autoMarket;
        const cost = costOf(s, own, market);
        out.push({
          id,
          modelId: model.id,
          modelName: model.name,
          groupId: group.id,
          groupName: group.name,
          type: repair.id,
          label: type.label,
          note: type.note,
          search: type.search,
          ...priceOf(s, market, cost, own),
          marketDkk: market,
          autoMarketDkk: autoMarket,
          ownMarket: Number.isInteger(own.marketDkk),
          ownPrice: Number.isInteger(own.priceDkk),
          costDkk: cost.source === "guess" ? null : cost.dkk,
          guessCostDkk: cost.source === "guess" ? cost.dkk : null,
          costSource: cost.source,
          ownCostDkk: Number.isInteger(own.costDkk) ? own.costDkk : null,
          cj: own.cj || null,
          cjSuggest: own.cjSuggest || null,
          cjVid: own.cjVid || "",
          cjVids: own.cjVids || {},
          colors: type.colors ? data.colors[model.id] || [] : [],
          supplierUrl: own.supplierUrl || searchUrl(model.name, type),
          repairPriceDkk: repair.price,
          off: Boolean(own.off)
        });
      }
    }
  }
  return out;
}

function publicData() {
  const data = load();
  const groups = [];
  for (const part of list()) {
    let group = groups.find((item) => item.id === part.groupId);
    if (!group) groups.push((group = { id: part.groupId, name: part.groupName, models: [] }));
    let model = group.models.find((item) => item.id === part.modelId);
    if (!model) group.models.push((model = { id: part.modelId, name: part.modelName, parts: [] }));
    const entry = { id: part.id, type: part.type, label: part.label, note: part.note, priceDkk: part.priceDkk, repairPriceDkk: part.repairPriceDkk };
    if (part.colors.length) entry.colors = part.colors.map((color) => ({ id: color, name: color }));
    model.parts.push(entry);
  }
  return { groups, shippingDkk: data.strategy.shippingDkk, shippingEuDkk: shippingTo(data, "SE"), deliveryText: data.strategy.deliveryText };
}

function shippingTo(data, country) {
  if (country === "DK") return data.strategy.shippingDkk;
  return Number.isInteger(data.strategy.shippingEuDkk) ? data.strategy.shippingEuDkk : data.strategy.shippingDkk;
}

function publicJsonForPage() {
  return JSON.stringify(publicData()).replace(/</g, "\\u003c");
}

/** Validates a cart against our own prices. Returns null if nothing in it is for sale, or { error } if a colour is missing. */
function priceCart(rawItems, country = "DK") {
  const data = load();
  const byId = new Map(list().map((part) => [part.id, part]));
  const lines = [];
  for (const raw of (Array.isArray(rawItems) ? rawItems : []).slice(0, 20)) {
    const part = byId.get(String((raw && raw.id) || ""));
    const qty = Math.min(10, Math.max(1, Math.floor(Number(raw && raw.qty) || 1)));
    if (!part) continue;
    const color = part.colors.length ? String((raw && raw.color) || "") : "";
    if (part.colors.length && !part.colors.includes(color)) return { error: `Vælg farve på ${part.label.toLowerCase()} til ${part.modelName}.` };
    const existing = lines.find((line) => line.id === part.id && line.color === color);
    if (existing) {
      existing.qty = Math.min(10, existing.qty + qty);
      continue;
    }
    const baseTitle = `${part.label} til ${part.modelName}`;
    lines.push({
      id: part.id,
      color,
      baseTitle,
      title: color ? `${baseTitle} (${color})` : baseTitle,
      qty,
      priceDkk: part.priceDkk,
      costDkk: part.costDkk,
      cjVid: (color && part.cjVids[color]) || part.cjVid,
      supplierUrl: part.supplierUrl
    });
  }
  if (!lines.length) return null;
  const subtotal = lines.reduce((sum, line) => sum + line.priceDkk * line.qty, 0);
  const shipping = shippingTo(data, country);
  return { lines, subtotalDkk: subtotal, shippingDkk: shipping, totalDkk: subtotal + shipping };
}

function adminView() {
  const data = load();
  const all = list({ includeOff: true });
  const summary = {
    total: all.length,
    withCost: all.filter((part) => part.costDkk !== null).length,
    withCj: all.filter((part) => part.cjVid || Object.keys(part.cjVids).length).length,
    suggestions: all.filter((part) => !part.cjVid && !Object.keys(part.cjVids).length && part.cjSuggest && part.cjSuggest.variants && part.cjSuggest.variants.length).length,
    overMarket: all.filter((part) => part.flag === "dyrere end markedet").length,
    underFloor: all.filter((part) => part.flag === "under bundpris").length
  };
  return { strategy: data.strategy, sync: data.sync || null, usdDkk: fx.usdDkk(data.strategy.usdDkkFallback), summary, parts: all };
}

function number(value) {
  return Number(String(value ?? "").replace(",", "."));
}

function updateFromAdmin(input) {
  const data = JSON.parse(JSON.stringify(load()));
  if (input.strategy) {
    const s = data.strategy;
    const undercutPct = number(input.strategy.undercutPct ?? s.undercut * 100);
    const minProfit = number(input.strategy.minProfitDkk ?? s.minProfitDkk);
    const shipping = number(input.strategy.shippingDkk ?? s.shippingDkk);
    const shippingEu = number(input.strategy.shippingEuDkk ?? s.shippingEuDkk ?? shipping);
    if (!Number.isFinite(undercutPct) || undercutPct < 50 || undercutPct > 150) return { error: "Pris i forhold til markedet skal være mellem 50 og 150 %." };
    if (!Number.isInteger(minProfit) || minProfit < 0 || minProfit > 2000) return { error: "Mindste fortjeneste skal være et helt tal." };
    if (!Number.isInteger(shipping) || shipping < 0 || shipping > 500) return { error: "Fragt skal være et helt tal." };
    if (!Number.isInteger(shippingEu) || shippingEu < 0 || shippingEu > 1000) return { error: "Fragt til EU skal være et helt tal." };
    s.undercut = Math.round(undercutPct) / 100;
    s.minProfitDkk = minProfit;
    s.shippingDkk = shipping;
    s.shippingEuDkk = shippingEu;
  }
  const known = new Set(list({ includeOff: true }).map((part) => part.id));
  for (const [id, raw] of Object.entries(input.items || {})) {
    if (!known.has(id)) return { error: `Ukendt del: ${id}` };
    const next = { ...(data.items[id] || {}) };
    for (const key of ["priceDkk", "costDkk", "marketDkk"]) {
      if (raw[key] === undefined) continue;
      if (raw[key] === null || raw[key] === "") delete next[key];
      else {
        const value = Number(raw[key]);
        if (!Number.isInteger(value) || value < 0 || value > 50000) return { error: `${id}: pris skal være et helt tal.` };
        next[key] = value;
      }
    }
    if (raw.cjVid !== undefined) {
      const vid = String(raw.cjVid || "").trim().slice(0, 80);
      if (vid !== (next.cjVid || "")) delete next.cj;
      if (vid) next.cjVid = vid;
      else delete next.cjVid;
    }
    if (raw.cjVids !== undefined) {
      const allowed = data.colors[id.split(":")[0]] || [];
      const vids = {};
      for (const [color, value] of Object.entries(raw.cjVids || {})) {
        const vid = String(value || "").trim().slice(0, 80);
        if (vid && allowed.includes(color)) vids[color] = vid;
      }
      const before = JSON.stringify(next.cjVids || {});
      if (Object.keys(vids).length) next.cjVids = vids;
      else delete next.cjVids;
      if (JSON.stringify(next.cjVids || {}) !== before) delete next.cj;
    }
    if (raw.supplierUrl !== undefined) {
      const url = String(raw.supplierUrl || "").trim().slice(0, 500);
      if (url && !/^https:\/\//.test(url)) return { error: `${id}: linket skal starte med https://` };
      if (url) next.supplierUrl = url;
      else delete next.supplierUrl;
    }
    if (raw.off !== undefined) {
      if (raw.off) next.off = true;
      else delete next.off;
    }
    if (Object.keys(next).length) data.items[id] = next;
    else delete data.items[id];
  }
  save(data);
  return { ok: true };
}

/** Used by the nightly CJ job: patch one part's CJ data, or the sync status. */
function updateFromSync(patches, sync) {
  const data = JSON.parse(JSON.stringify(load()));
  for (const [id, patch] of Object.entries(patches)) {
    const next = { ...(data.items[id] || {}), ...patch };
    for (const key of Object.keys(patch)) if (patch[key] === null) delete next[key];
    if (Object.keys(next).length) data.items[id] = next;
    else delete data.items[id];
  }
  if (sync) data.sync = sync;
  save(data);
}

function types() {
  return load().types;
}

module.exports = { list, types, publicData, publicJsonForPage, priceCart, adminView, updateFromAdmin, updateFromSync, file: FILE };
