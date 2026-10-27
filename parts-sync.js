// Nightly job for the spare parts shop: fresh USD rate, current CJ cost for every linked part,
// and CJ suggestions for parts that are not linked yet (the owner picks the variant in admin).
const cj = require("./cj");
const fx = require("./fx");
const parts = require("./parts");

const SUGGEST_PER_RUN = 100;
const SUGGEST_MAX_AGE_MS = 30 * 86400000;
const NEIGHBOURS = "pro|max|plus|ultra|mini|fe|lite|air|\\+";

let running = false;

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Galaxy S24" must match "Samsung S24 LCD" but not "S24 Ultra" or "S24+". */
function modelPattern(modelName) {
  const core = modelName.replace(/^(apple|samsung|google)\s+/i, "").replace(/^galaxy\s+/i, "(galaxy\\s+)?");
  const words = core.split(/\s+/).map((word) => (word.startsWith("(") ? word : escape(word)));
  const own = new Set(modelName.toLowerCase().split(/\s+/));
  const after = NEIGHBOURS.split("|").filter((word) => !own.has(word.replace("\\", ""))).join("|");
  return new RegExp(`(^|[^a-z0-9])${words.join("\\s*")}(?![a-z0-9]|\\s*(${after})([^a-z]|$))`, "i");
}

const NOT_A_PART = /protector|tempered|screen film|hydrogel|case|holster|wallet|skin|sticker|tool kit|lens protector|charger|cable(?! flex)/i;

function pickProduct(rows, part, type) {
  const model = modelPattern(part.modelName);
  const kind = new RegExp(type.match, "i");
  return rows
    .filter((row) => model.test(row.nameEn || "") && kind.test(row.nameEn || "") && !NOT_A_PART.test(row.nameEn || ""))
    .sort((a, b) => (Number(b.listedNum) || 0) - (Number(a.listedNum) || 0))[0] || null;
}

async function suggest(part, type) {
  const rows = await cj.searchProducts(`${part.modelName.replace(/^galaxy\s+/i, "Samsung ")} ${type.search}`);
  const row = pickProduct(rows, part, type);
  if (!row) return { at: new Date().toISOString(), variants: [] };
  const detail = await cj.productDetail(row.id);
  const variants = (detail.variants || [])
    .map((v) => ({ vid: String(v.vid), name: String(v.variantKey || v.variantNameEn || "").slice(0, 80), priceUsd: Number(v.variantSellPrice) || 0 }))
    .filter((v) => v.vid && v.priceUsd > 0)
    .sort((a, b) => a.priceUsd - b.priceUsd)
    .slice(0, 8);
  return {
    at: new Date().toISOString(),
    pid: String(row.id),
    name: String(detail.productNameEn || row.nameEn || "").slice(0, 160),
    image: /^https:\/\//.test(row.bigImage || "") ? row.bigImage : "",
    variants
  };
}

async function run(log = console.log) {
  if (running) return { skipped: "kører allerede" };
  running = true;
  const started = new Date().toISOString();
  const result = { fx: null, synced: 0, suggested: 0, errors: 0 };
  try {
    try {
      result.fx = await fx.refresh();
    } catch (error) {
      log(`Valutakurs: ${error.message}`);
    }
    if (!cj.enabled()) return result;

    const all = parts.list({ includeOff: true });
    const types = parts.types();

    const vidOf = (item) => item.cjVid || Object.values(item.cjVids)[0] || "";
    for (const part of all.filter(vidOf)) {
      try {
        const vid = vidOf(part);
        const v = await cj.variant(vid);
        const stock = (v.inventories || []).reduce((sum, row) => sum + (Number(row.totalInventory) || 0), 0);
        const lastShip = part.cj && part.cj.shipAt ? Date.parse(part.cj.shipAt) : 0;
        let shipUsd = part.cj ? part.cj.shipUsd : null;
        let shipAt = part.cj ? part.cj.shipAt : null;
        if (!lastShip || Date.now() - lastShip > 7 * 86400000) {
          shipUsd = await cj.shippingUsd("DK", vid);
          shipAt = new Date().toISOString();
        }
        parts.updateFromSync({ [part.id]: { cj: { priceUsd: Number(v.variantSellPrice) || 0, shipUsd, shipAt, stock, at: new Date().toISOString() } } });
        result.synced += 1;
      } catch (error) {
        result.errors += 1;
        log(`CJ ${part.id}: ${error.message}`);
      }
    }

    const due = all
      .filter((item) => !vidOf(item) && !item.off)
      .filter((item) => !item.cjSuggest || Date.now() - Date.parse(item.cjSuggest.at) > SUGGEST_MAX_AGE_MS)
      .slice(0, SUGGEST_PER_RUN);
    for (const part of due) {
      try {
        parts.updateFromSync({ [part.id]: { cjSuggest: await suggest(part, types[part.type]) } });
        result.suggested += 1;
      } catch (error) {
        result.errors += 1;
        log(`CJ-forslag ${part.id}: ${error.message}`);
      }
    }
    return result;
  } finally {
    running = false;
    parts.updateFromSync({}, { ...result, started, finished: new Date().toISOString() });
    log(`Reservedele-sync: kurs ${result.fx || "uændret"}, ${result.synced} CJ-priser, ${result.suggested} forslag, ${result.errors} fejl`);
  }
}

/** Runs once a night around 03:00, and right away if it has never run. */
function schedule(onDone) {
  const tick = async () => {
    const sync = parts.adminView().sync;
    const last = sync && sync.finished ? new Date(sync.finished) : null;
    const now = new Date();
    const ranToday = last && last.toDateString() === now.toDateString();
    if (!last || (!ranToday && now.getHours() >= 3)) {
      await run().catch((error) => console.error(`Reservedele-sync: ${error.message}`));
      if (onDone) onDone();
    }
  };
  setTimeout(() => void tick(), 60 * 1000).unref();
  setInterval(() => void tick(), 30 * 60 * 1000).unref();
}

module.exports = { run, schedule, modelPattern, pickProduct, isRunning: () => running };
