// Instant buyback offers for used and broken devices.
// Sale = our own shop price × storage × Wi-Fi/Cellular × cosmetic condition. Repairs cost a share of our own repair price.
// Offer = offerPct of (sale − repairs), or a little above the competitor's offer when we know it (refs),
// but never so high that the profit after used-goods VAT (brugtmoms), sales and ad costs, warranty, handling
// and repairs drops below the minimum profit (a share of the sale, between a floor and minProfitDkk). Rounded down to 50 kr.
const fs = require("fs");
const path = require("path");
const pricing = require("./pricing");

const FILE = path.join(__dirname, "buyback.json");
/** Storage, chip/generation or Wi-Fi the seller doesn't know: priced as the cheapest choice. */
const UNKNOWN = "ukendt";

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

/** `needs`: only asked when the model has that repair. `devices`: only asked for those device types. */
const QUESTIONS = [
  {
    id: "power",
    label: "Kan den tænde og bruges?",
    options: [
      { id: "ja", label: "Ja" },
      { id: "nej", label: "Nej, den er død" }
    ]
  },
  {
    id: "screen",
    label: "Skærmen",
    needs: "skaerm",
    options: [
      { id: "hel", label: "Hel og pæn" },
      { id: "ridser", label: "Ridser eller små mærker" },
      { id: "knust", label: "Revnet, knust eller fejl i billedet" }
    ]
  },
  {
    id: "back",
    label: "Bagsiden",
    needs: "bagglas",
    options: [
      { id: "hel", label: "Hel" },
      { id: "ridser", label: "Ridser" },
      { id: "knust", label: "Revnet glas" }
    ]
  },
  {
    id: "body",
    label: "Kabinet og kanter",
    options: [
      { id: "paen", label: "Pæn" },
      { id: "brugsspor", label: "Brugsspor" },
      { id: "skader", label: "Buler eller skader" }
    ]
  },
  {
    id: "battery",
    label: "Batteriet",
    needs: "batteri",
    options: [
      { id: "ok", label: "Holder fint" },
      { id: "svagt", label: "Dårligt eller under 80 %" }
    ]
  },
  {
    id: "faults",
    label: "Andre fejl",
    multi: true,
    options: [
      { id: "kamera", label: "Kameraet virker ikke", needs: "kamera" },
      { id: "ladeport", label: "Opladning virker ikke", needs: ["ladeport", "ladestik"] },
      { id: "faceid", label: "Face ID eller Touch ID virker ikke", devices: ["telefon", "tablet"] },
      { id: "tastatur", label: "Tastatur eller touchpad virker ikke", needs: "tastatur" },
      { id: "lyd", label: "Højttaler, mikrofon eller knapper driller" }
    ]
  },
  {
    id: "water",
    label: "Har den været våd?",
    options: [
      { id: "nej", label: "Nej" },
      { id: "ja", label: "Ja" }
    ]
  },
  {
    id: "lock",
    label: "Er Find min iPhone, Google-konto eller anden lås slået fra?",
    options: [
      { id: "fra", label: "Ja, eller jeg slår det fra før jeg sender den" },
      { id: "til", label: "Nej eller ved ikke" }
    ]
  }
];

const DEFAULTS = { power: "ja", screen: "hel", back: "hel", body: "paen", battery: "ok", faults: [], water: "nej", lock: "fra" };

const COSMETIC = {
  screen: { ridser: 0.07 },
  back: { ridser: 0.05 },
  body: { brugsspor: 0.05, skader: 0.14 }
};

function modelInfo(modelId) {
  for (const group of pricing.catalog().groups) {
    const model = group.models.find((item) => item.id === modelId);
    if (model) {
      return { group, model, device: group.device, repairs: new Set(model.repairs.map((repair) => repair.id)) };
    }
  }
  return null;
}

function hasNeed(info, needs) {
  if (!needs) return true;
  return (Array.isArray(needs) ? needs : [needs]).some((id) => info.repairs.has(id));
}

function questionsFor(info) {
  return QUESTIONS.filter((question) => hasNeed(info, question.needs))
    .map((question) => ({
      ...question,
      options: question.options.filter(
        (option) => hasNeed(info, option.needs) && (!option.devices || option.devices.includes(info.device))
      )
    }))
    .filter((question) => question.options.length > 0);
}

function tradable(data, modelId) {
  return Number.isInteger(data.values[modelId]) || Boolean(data.variants[modelId]) || data.manual.includes(modelId);
}

function modelName(data, model) {
  return (data.names && data.names[model.id]) || model.name;
}

/** What the sell page needs: models, storage and variant choices, and the questions per model. */
function publicData() {
  const data = load();
  const groups = pricing
    .catalog()
    .groups.map((group) => ({
      id: group.id,
      name: group.name,
      device: group.device,
      models: group.models
        .filter((model) => tradable(data, model.id))
        .map((model) => {
          const info = modelInfo(model.id);
          return {
            id: model.id,
            name: modelName(data, model),
            manual: data.manual.includes(model.id),
            keywords: (data.keywords && data.keywords[model.id]) || "",
            variantTitle: (data.variantTitles && data.variantTitles[model.id]) || "",
            variants: (data.variants[model.id] || []).map((variant) => ({ id: variant.id, label: variant.label, keywords: variant.keywords || "" })),
            questions: questionsFor(info).map((question) => question.id),
            faults: (questionsFor(info).find((question) => question.id === "faults") || { options: [] }).options.map((option) => option.id)
          };
        })
    }))
    .filter((group) => group.models.length > 0);
  return {
    groups,
    storage: data.storage,
    connectivity: data.connectivity || [],
    questions: QUESTIONS.map((question) => ({
      id: question.id,
      label: question.label,
      multi: Boolean(question.multi),
      options: question.options.map((option) => ({ id: option.id, label: option.label }))
    })),
    defaults: DEFAULTS,
    validDays: data.strategy.validDays,
    euShippingDkk: data.strategy.euShippingDkk || 0
  };
}

function publicJsonForPage() {
  return JSON.stringify(publicData()).replace(/</g, "\\u003c");
}

function floor50(amount) {
  return Math.max(0, Math.floor(amount / 50) * 50);
}

function repairCost(data, info, repairId, base) {
  const ids = Array.isArray(repairId) ? repairId : [repairId];
  for (const id of ids) {
    const estimate = pricing.estimate(info.model.id, id);
    if (estimate && Number.isInteger(estimate.priceDkk)) {
      return { cost: Math.round(estimate.priceDkk * data.strategy.repairCostShare), label: estimate.label };
    }
  }
  return { cost: Math.round(base * 0.15), label: "Reparation" };
}

function pick(question, raw) {
  const ids = question.options.map((option) => option.id);
  if (question.multi) {
    const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
    return [...new Set(list.map((id) => String(id).trim()).filter((id) => ids.includes(id)))];
  }
  const value = String(raw || "").trim();
  return ids.includes(value) ? value : DEFAULTS[question.id];
}

/**
 * One device line. Returns null for unknown models.
 * `offerDkk` is per unit and null when the model needs a manual look (unlisted brands, Windows pcs).
 * `internal` adds our expected sale price, repair cost and profit (admin only, never sent to customers).
 */
function quote(input, internal = false) {
  const data = load();
  const modelId = String((input && input.modelId) || "").slice(0, 60);
  if (!tradable(data, modelId)) return null;
  const info = modelInfo(modelId);
  if (!info) return null;

  const qty = Math.min(500, Math.max(1, Math.floor(Number(input.qty) || 1)));
  const guessed = [];
  const storageList = data.storage[info.device] || [];
  const storageUnknown = String(input.storage || "") === UNKNOWN && storageList.length > 0;
  const storage = storageUnknown
    ? storageList.reduce((low, option) => (option.factor < low.factor ? option : low))
    : storageList.find((option) => option.id === String(input.storage || "")) || storageList.find((option) => option.factor === 1) || null;
  if (storageUnknown) guessed.push("lager");
  const variants = data.variants[modelId] || [];
  const variantUnknown = String(input.variant || "") === UNKNOWN && variants.length > 0;
  const variant = variantUnknown
    ? variants.reduce((low, option) => (option.value < low.value ? option : low))
    : variants.find((option) => option.id === String(input.variant || "")) || null;
  if (variantUnknown) guessed.push("model");
  const connList = info.device === "tablet" ? data.connectivity || [] : [];
  const connUnknown = String(input.conn || "") === UNKNOWN && connList.length > 0;
  const conn = connList.length ? connList.find((option) => !connUnknown && option.id === String(input.conn || "")) || connList[0] : null;
  if (connUnknown) guessed.push("wifi");
  const questions = questionsFor(info);
  const raw = (input && input.answers) || {};
  const answers = {};
  for (const question of questions) answers[question.id] = pick(question, raw[question.id]);

  const guessLabel = (label) => `Ved ikke (regnet som ${label})`;
  const storageLabel = storage ? (storageUnknown ? guessLabel(storage.label) : storage.label) : "";
  const connLabel = conn ? (connUnknown ? guessLabel(conn.label) : conn.label) : "";
  const result = {
    modelId,
    modelName: modelName(data, info.model),
    device: info.device,
    qty,
    storage: storage ? storage.id : "",
    storageLabel: [storageLabel, connLabel].filter(Boolean).join(", "),
    variant: variant ? variant.id : "",
    variantLabel: variant ? (variantUnknown ? guessLabel(variant.label) : variant.label) : "",
    conn: conn ? conn.id : "",
    answers,
    manual: false,
    blocked: false,
    recycle: false,
    offerDkk: null,
    totalDkk: null,
    lines: []
  };

  if (answers.lock === "til") {
    result.blocked = true;
    result.lines.push("Vi kan kun købe enheder, hvor Find min iPhone, Google-konto og andre låse er slået fra.");
    return result;
  }
  if (data.manual.includes(modelId) || (variants.length && !variant)) {
    result.manual = true;
    result.lines.push(variants.length && !variant ? "Vælg chip for at se prisen." : "Vi kigger på oplysningerne og sender dig et fast tilbud inden for 1 hverdag.");
    return result;
  }

  if (guessed.length) result.lines.push("Vi regner med den billigste udgave. Er din bedre, hæver vi prisen, når vi tjekker den.");

  const value = variant ? variant.value : data.values[modelId];
  const extra = (storage ? storage.factor : 1) * (conn ? conn.factor : 1);
  const base = value * extra;
  const { offerPct, deadFactor, minOfferDkk } = data.strategy;
  let sale;
  let repairTotal = 0;
  let minProfit = minProfitFor(data.strategy, base);

  if (answers.power === "nej" || answers.water === "ja") {
    sale = base * deadFactor;
    minProfit = Math.round(minProfitFor(data.strategy, base) * 0.4);
    result.lines.push(answers.water === "ja" ? "Vandskade: vi køber den til reservedele." : "Tænder ikke: vi køber den til reservedele.");
  } else {
    let cosmetic = 0;
    for (const [questionId, table] of Object.entries(COSMETIC)) {
      if (answers[questionId] && table[answers[questionId]]) cosmetic += table[answers[questionId]];
    }
    const faults = answers.faults || [];
    if (faults.includes("lyd")) cosmetic += 0.08;
    if (faults.includes("faceid")) cosmetic += 0.25;
    sale = base * (1 - cosmetic);
    if (cosmetic > 0) result.lines.push("Brugsspor og mindre fejl er trukket fra.");

    const repairs = [];
    if (answers.screen === "knust") repairs.push("skaerm");
    if (answers.back === "knust") repairs.push("bagglas");
    if (answers.battery === "svagt") repairs.push("batteri");
    if (faults.includes("kamera")) repairs.push("kamera");
    if (faults.includes("ladeport")) repairs.push(["ladeport", "ladestik"]);
    if (faults.includes("tastatur")) repairs.push("tastatur");
    for (const repairId of repairs) {
      const { cost, label } = repairCost(data, info, repairId, base);
      repairTotal += cost;
      result.lines.push(`${label}: vi skal reparere den.`);
    }
  }

  const net = Math.max(0, sale - repairTotal);
  let target = (offerPct / 100) * net;
  const ref = refFor(data, modelId, variant);
  if (ref) {
    const theirs = ref * extra * (net / base);
    target = Math.max(theirs * (1 + (data.strategy.beatPct || 0) / 100), theirs + 50);
  }
  const cap = maxOfferFor(data.strategy, sale, repairTotal, minProfit);
  const offer = floor50(Math.min(target, cap));
  if (internal) Object.assign(result, { saleDkk: Math.round(sale), repairDkk: repairTotal, refDkk: ref ? Math.round(ref * extra * (net / base)) : null, capped: target > cap });
  if (offer < minOfferDkk) {
    result.recycle = true;
    result.offerDkk = 0;
    result.totalDkk = 0;
    result.lines.push("Den er desværre ikke noget værd for os, men vi genbruger den gratis og sletter dine data.");
    return result;
  }
  result.offerDkk = offer;
  result.totalDkk = offer * qty;
  if (internal) result.profitDkk = profitAt(data.strategy, sale, repairTotal, offer);
  return result;
}

/** Costs that grow with the sale price: payment and sales fees, ads (Google) and a warranty reserve. */
function salePct(strategy) {
  return ((strategy.salesFeePct || 0) + (strategy.adsPct || 0) + (strategy.warrantyPct || 0)) / 100;
}

/** Cheap phones need a smaller profit to be worth it: a share of the sale, kept between the floor and minProfitDkk. */
function minProfitFor(strategy, sale) {
  if (!strategy.minProfitPct) return strategy.minProfitDkk;
  return Math.max(strategy.minProfitFloorDkk || 0, Math.min(strategy.minProfitDkk, (sale * strategy.minProfitPct) / 100));
}

function refFor(data, modelId, variant) {
  const refs = data.refs || {};
  const value = variant ? refs[`${modelId}:${variant.id}`] : refs[modelId];
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** What we keep after selling: minus fees, ads, warranty, handling, repairs, the purchase and brugtmoms on (sale − purchase). */
function profitAt(strategy, sale, repairs, offer) {
  const { handlingDkk, usedVatShare } = strategy;
  return Math.round(sale * (1 - salePct(strategy)) - handlingDkk - repairs - offer - usedVatShare * Math.max(0, sale - offer));
}

/** The highest offer that still leaves `minProfit` (solves profitAt(...) = minProfit for the offer). */
function maxOfferFor(strategy, sale, repairs, minProfit) {
  const { handlingDkk, usedVatShare } = strategy;
  return (sale * (1 - salePct(strategy) - usedVatShare) - handlingDkk - repairs - minProfit) / (1 - usedVatShare);
}

function quoteMany(items) {
  const lines = (Array.isArray(items) ? items : []).slice(0, 50).map((item) => quote(item)).filter(Boolean);
  const priced = lines.filter((line) => Number.isInteger(line.totalDkk));
  return {
    items: lines,
    units: lines.reduce((sum, line) => sum + line.qty, 0),
    totalDkk: priced.reduce((sum, line) => sum + line.totalDkk, 0),
    hasManual: lines.some((line) => line.manual),
    hasBlocked: lines.some((line) => line.blocked),
    validDays: load().strategy.validDays
  };
}

function adminView() {
  const data = load();
  const names = new Map();
  for (const group of pricing.catalog().groups) for (const model of group.models) names.set(model.id, { name: model.name, group: group.name });
  const sampleOf = (modelId, variant) => {
    const sample = quote({ modelId, variant, answers: {} }, true);
    return {
      offerDkk: sample && Number.isInteger(sample.offerDkk) ? sample.offerDkk : null,
      profitDkk: sample && Number.isInteger(sample.profitDkk) ? sample.profitDkk : null,
      capped: Boolean(sample && sample.capped)
    };
  };
  const refs = data.refs || {};
  return {
    updated: data.updated,
    note: data.note,
    strategy: data.strategy,
    manual: data.manual,
    variants: Object.fromEntries(
      Object.entries(data.variants).map(([modelId, list]) => [
        modelId,
        list.map((variant) => ({
          ...variant,
          modelName: (data.names && data.names[modelId]) || (names.get(modelId) || { name: modelId }).name,
          ref: refs[`${modelId}:${variant.id}`] || null,
          ...sampleOf(modelId, variant.id)
        }))
      ])
    ),
    values: Object.entries(data.values)
      .filter(([id]) => !data.variants[id])
      .map(([id, value]) => ({ id, value, ref: refs[id] || null, ...sampleOf(id, ""), ...(names.get(id) || { name: id, group: "" }) }))
  };
}

function updateFromAdmin(input) {
  const data = JSON.parse(JSON.stringify(load()));
  if (input.strategy) {
    const limits = {
      offerPct: [10, 90],
      minProfitDkk: [0, 5000],
      minProfitPct: [0, 50],
      minProfitFloorDkk: [0, 5000],
      adsPct: [0, 40],
      warrantyPct: [0, 20],
      beatPct: [0, 50],
      salesFeePct: [0, 30],
      handlingDkk: [0, 2000],
      usedVatShare: [0, 0.25],
      repairCostShare: [0, 1.5],
      deadFactor: [0, 1],
      minOfferDkk: [0, 1000],
      validDays: [1, 60],
      euShippingDkk: [0, 1000]
    };
    for (const [key, [min, max]] of Object.entries(limits)) {
      if (input.strategy[key] === undefined) continue;
      const value = Number(String(input.strategy[key]).replace(",", "."));
      if (!Number.isFinite(value) || value < min || value > max) return { error: `${key} skal være mellem ${min} og ${max}.` };
      data.strategy[key] = value;
    }
  }
  for (const [id, raw] of Object.entries(input.values || {})) {
    if (!Number.isInteger(data.values[id])) return { error: `Ukendt model: ${id}` };
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 100000) return { error: `Værdien for ${id} skal være et helt tal.` };
    data.values[id] = value;
  }
  for (const [key, raw] of Object.entries(input.variants || {})) {
    const [modelId, variantId] = key.split(":");
    const variant = (data.variants[modelId] || []).find((item) => item.id === variantId);
    const value = Number(raw);
    if (!variant) return { error: `Ukendt variant: ${key}` };
    if (!Number.isInteger(value) || value < 0 || value > 100000) return { error: `Værdien for ${key} skal være et helt tal.` };
    variant.value = value;
  }
  for (const [key, raw] of Object.entries(input.refs || {})) {
    const [modelId, variantId] = key.split(":");
    const known = variantId ? (data.variants[modelId] || []).some((item) => item.id === variantId) : Number.isInteger(data.values[modelId]);
    if (!known) return { error: `Ukendt model: ${key}` };
    data.refs = data.refs || {};
    if (raw === null || raw === "" || Number(raw) === 0) {
      delete data.refs[key];
      continue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 100000) return { error: `Konkurrentprisen for ${key} skal være et helt tal.` };
    data.refs[key] = value;
  }
  data.updated = new Date().toISOString().slice(0, 10);
  save(data);
  return { ok: true };
}

/** Our shop price for a device in perfect condition, used to suggest prices when it is listed for sale. */
function shopValue({ modelId, variant, storage, conn }) {
  const data = load();
  const info = modelInfo(modelId);
  if (!info) return null;
  const chosen = (data.variants[modelId] || []).find((item) => item.id === variant);
  const value = chosen ? chosen.value : data.values[modelId];
  if (!Number.isInteger(value)) return null;
  const storageOption = (data.storage[info.device] || []).find((item) => item.id === storage);
  const connOption = info.device === "tablet" ? (data.connectivity || []).find((item) => item.id === conn) : null;
  return Math.round(value * (storageOption ? storageOption.factor : 1) * (connOption ? connOption.factor : 1));
}

module.exports = { QUESTIONS, UNKNOWN, publicData, publicJsonForPage, quote, quoteMany, adminView, updateFromAdmin, shopValue, file: FILE };
