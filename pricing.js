const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "prices.json");
const kr = new Intl.NumberFormat("da-DK");

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

function formatKr(amount) {
  return `${kr.format(amount)} kr`;
}

function computed(data, market) {
  const cut = market * (1 - data.strategy.undercutPercent / 100);
  const rounded = Math.floor((cut + 1) / 50) * 50 - 1;
  return Math.max(data.strategy.minPrice, rounded);
}

function groupOf(data, model) {
  return data.groups.find((group) => group.id === model.group);
}

function repairDef(data, model, repairId) {
  const group = groupOf(data, model);
  return group ? data.repairs[group.device][repairId] || null : null;
}

/** Services like free troubleshooting have one price for every model of the device. */
function isFixed(def) {
  return Boolean(def) && Number.isInteger(def.price);
}

function priceFor(data, model, repairId) {
  const def = repairDef(data, model, repairId);
  if (isFixed(def)) {
    const override = data.overrides[`${groupOf(data, model).device}:${repairId}`];
    return Number.isInteger(override) ? override : def.price;
  }
  const market = model.market[repairId];
  if (!Number.isFinite(market)) return null;
  const override = data.overrides[`${model.id}:${repairId}`];
  return Number.isInteger(override) ? override : computed(data, market);
}

/** «fra»: the exact price comes after the free check, because parts for the brand vary. */
function isFrom(data, model, repairId) {
  const def = repairDef(data, model, repairId);
  if (isFixed(def)) return Boolean(def.from);
  return Boolean((def && def.from) || groupOf(data, model).from || model.from);
}

/** A 3 kr product for checking payments end to end. Only the logged-in owner sees or can book it. */
const TEST_MODEL = { id: "test-betaling", name: "Testbetaling (kun for dig)" };
const TEST_REPAIR = { id: "test", label: "Testbetaling", time: "1 min", from: false, price: 3 };
const TEST_GROUP = {
  id: "test",
  name: "Test (kun for dig)",
  device: "telefon",
  models: [{ ...TEST_MODEL, repairs: [TEST_REPAIR] }]
};

function catalog({ withTest = false } = {}) {
  const data = load();
  return {
    stockNote: data.stockNote,
    marketUpdated: data.marketUpdated,
    groups: (withTest ? [TEST_GROUP] : []).concat(data.groups.map((group) => {
      const repairs = data.repairs[group.device];
      return {
        id: group.id,
        name: group.name,
        device: group.device,
        models: data.models
          .filter((model) => model.group === group.id)
          .map((model) => ({
            id: model.id,
            name: model.name,
            repairs: Object.keys(repairs)
              .map((repairId) => {
                const price = priceFor(data, model, repairId);
                if (price === null) return null;
                return {
                  id: repairId,
                  label: repairs[repairId].label,
                  time: repairs[repairId].time,
                  from: isFrom(data, model, repairId),
                  fixed: isFixed(repairs[repairId]),
                  price
                };
              })
              .filter(Boolean)
          }))
      };
    }))
  };
}

function estimate(modelId, repairId, { withTest = false } = {}) {
  if (modelId === TEST_MODEL.id) {
    if (!withTest || repairId !== TEST_REPAIR.id) return null;
    return {
      modelId: TEST_MODEL.id,
      modelName: TEST_MODEL.name,
      device: TEST_GROUP.device,
      repairId,
      label: TEST_REPAIR.label,
      time: TEST_REPAIR.time,
      from: false,
      priceDkk: TEST_REPAIR.price
    };
  }
  const data = load();
  const model = data.models.find((item) => item.id === modelId);
  if (!model) return null;
  const group = groupOf(data, model);
  const repair = group && data.repairs[group.device][repairId];
  if (!repair) return null;
  const price = priceFor(data, model, repairId);
  if (price === null) return null;
  return {
    modelId: model.id,
    modelName: model.name,
    device: group.device,
    repairId,
    label: repair.label,
    time: repair.time,
    from: isFrom(data, model, repairId),
    priceDkk: price
  };
}

function joinDa(words) {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} og ${words[words.length - 1]}`;
}

function estimateMany(modelId, repairIds, options = {}) {
  const items = [...new Set(repairIds)].map((repairId) => estimate(modelId, repairId, options)).filter(Boolean);
  if (items.length === 0) return null;
  const first = items[0];
  const label = joinDa(items.map((item, index) => (index === 0 ? item.label : item.label.toLowerCase())));
  return {
    modelId: first.modelId,
    modelName: first.modelName,
    device: first.device,
    repairIds: items.map((item) => item.repairId),
    label,
    time: items.length === 1 ? first.time : items.map((item) => `${item.label.toLowerCase()} ${item.time}`).join(", "),
    from: items.some((item) => item.from),
    priceDkk: items.reduce((sum, item) => sum + item.priceDkk, 0),
    items: items.map((item) => ({
      repairId: item.repairId,
      label: item.label,
      time: item.time,
      from: item.from,
      priceDkk: item.priceDkk
    }))
  };
}

function rangeTokens() {
  const data = load();
  const spans = {};
  for (const model of data.models) {
    const group = groupOf(data, model);
    if (!group) continue;
    for (const repairId of Object.keys(data.repairs[group.device])) {
      const price = priceFor(data, model, repairId);
      if (price === null) continue;
      for (const scope of [group.device, group.id, ...(model.tags || [])]) {
        const key = `${scope}_${repairId}`.toUpperCase();
        const span = spans[key] || (spans[key] = { min: price, max: price });
        span.min = Math.min(span.min, price);
        span.max = Math.max(span.max, price);
      }
    }
  }
  const tokens = {};
  for (const [key, span] of Object.entries(spans)) {
    tokens[`MIN_${key}`] = String(span.min);
    tokens[`MAX_${key}`] = String(span.max);
    tokens[`FRA_${key}`] = formatKr(span.min);
    tokens[`RANGE_${key}`] =
      span.min === span.max ? formatKr(span.min) : `${kr.format(span.min)}–${kr.format(span.max)} kr`;
  }
  return tokens;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

const DEVICE_NAMES = { telefon: "Alle telefoner", tablet: "Alle tablets", computer: "Alle computere" };

function fixedPriceText(repair, tr) {
  if (repair.price === 0) return tr("Gratis");
  return `${repair.from ? `${tr("fra")} ` : ""}${formatKr(repair.price)}`;
}

function fixedServicesHtml(data, tr) {
  const rows = [];
  for (const [device, repairs] of Object.entries(data.repairs)) {
    for (const [repairId, repair] of Object.entries(repairs)) {
      if (!isFixed(repair)) continue;
      const price = Number.isInteger(data.overrides[`${device}:${repairId}`]) ? data.overrides[`${device}:${repairId}`] : repair.price;
      rows.push(
        `<tr><th scope="row">${esc(tr(repair.label))}</th><td>${esc(tr(DEVICE_NAMES[device] || device))}</td>` +
          `<td>${fixedPriceText({ ...repair, price }, tr)}</td><td>${esc(tr(repair.time))}</td></tr>`
      );
    }
  }
  if (!rows.length) return "";
  return (
    `<section class="price-group" id="alle-modeller">\n<h2>${esc(tr("Gælder alle mærker og modeller"))}</h2>\n` +
    `<div class="table-wrap"><table class="price-table">\n` +
    `<caption class="visually-hidden">${esc(tr("Faste priser uanset model"))}</caption>\n` +
    `<thead><tr><th scope="col">${esc(tr("Ydelse"))}</th><th scope="col">${esc(tr("Til"))}</th><th scope="col">${esc(tr("Pris"))}</th><th scope="col">${esc(tr("Tid"))}</th></tr></thead>\n` +
    `<tbody>\n${rows.join("\n")}\n</tbody></table></div>\n</section>`
  );
}

/** `tr` translates a Danish label for the page's language; Danish pages pass nothing. */
function priceTablesHtml(tr = (text) => text) {
  const data = load();
  const list = catalog();
  const tables = list.groups
    .map((group) => {
      const repairs = data.repairs[group.device];
      const ids = Object.keys(repairs).filter(
        (repairId) =>
          !isFixed(repairs[repairId]) &&
          group.models.some((model) => model.repairs.some((repair) => repair.id === repairId))
      );
      const head = ids
        .map((repairId) => `<th scope="col">${esc(tr(repairs[repairId].label))}<small>${esc(tr(repairs[repairId].time))}</small></th>`)
        .join("");
      const rows = group.models
        .map((model) => {
          const cells = ids
            .map((repairId) => {
              const repair = model.repairs.find((item) => item.id === repairId);
              if (!repair) return "<td>–</td>";
              const label = `${repair.from ? `${tr("fra")} ` : ""}${formatKr(repair.price)}`;
              const link = `/book?model=${encodeURIComponent(model.id)}&amp;reparation=${encodeURIComponent(repairId)}`;
              return `<td><a href="${link}">${label}</a></td>`;
            })
            .join("");
          return `<tr><th scope="row">${esc(tr(model.name))}</th>${cells}</tr>`;
        })
        .join("\n");
      return (
        `<section class="price-group" id="${esc(group.id)}">\n<h2>${esc(tr(group.name))}</h2>\n` +
        `<div class="table-wrap"><table class="price-table price-matrix">\n` +
        `<caption class="visually-hidden">${esc(tr(`Priser på ${group.name}-reparation i Aalborg`))}</caption>\n` +
        `<thead><tr><th scope="col">${esc(tr("Model"))}</th>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody></table></div>\n</section>`
      );
    })
    .join("\n");
  return `${tables}\n${fixedServicesHtml(data, tr)}`;
}

function offerCatalogJson(origin) {
  const list = catalog();
  const offers = [];
  const fixedDone = new Set();
  for (const group of list.groups) {
    for (const model of group.models) {
      for (const repair of model.repairs) {
        if (repair.fixed) {
          const key = `${group.device}:${repair.id}`;
          if (fixedDone.has(key)) continue;
          fixedDone.add(key);
          const offer = { "@type": "Offer", name: `${repair.label} (${DEVICE_NAMES[group.device].toLowerCase()})`, priceCurrency: "DKK", url: `${origin}/book` };
          if (repair.from) offer.priceSpecification = { "@type": "PriceSpecification", minPrice: repair.price, priceCurrency: "DKK" };
          else offer.price = repair.price;
          offers.push(offer);
          continue;
        }
        const offer = {
          "@type": "Offer",
          name: `${model.name}, ${repair.label.toLowerCase()}`,
          priceCurrency: "DKK",
          url: `${origin}/book?model=${model.id}&reparation=${repair.id}`
        };
        if (repair.from) {
          offer.priceSpecification = { "@type": "PriceSpecification", minPrice: repair.price, priceCurrency: "DKK" };
        } else {
          offer.price = repair.price;
        }
        offers.push(offer);
      }
    }
  }
  const json = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "OfferCatalog",
        name: "Priser på reparation hos TeknikFix i Aalborg",
        url: `${origin}/priser`,
        provider: { "@id": `${origin}/#business` },
        itemListElement: offers
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Forside", item: `${origin}/` },
          { "@type": "ListItem", position: 2, name: "Priser", item: `${origin}/priser` }
        ]
      }
    ]
  };
  return JSON.stringify(json).replace(/</g, "\\u003c");
}

function catalogJsonForPage(options = {}) {
  return JSON.stringify(catalog(options)).replace(/</g, "\\u003c");
}

function adminView() {
  const data = load();
  return {
    strategy: data.strategy,
    marketUpdated: data.marketUpdated,
    marketSources: data.marketSources,
    repairs: data.repairs,
    groups: data.groups,
    models: data.models.map((model) => {
      const group = groupOf(data, model);
      const cells = {};
      for (const repairId of Object.keys(model.market)) {
        cells[repairId] = {
          market: model.market[repairId],
          auto: computed(data, model.market[repairId]),
          price: priceFor(data, model, repairId),
          override: Number.isInteger(data.overrides[`${model.id}:${repairId}`])
        };
      }
      return { id: model.id, group: model.group, device: group ? group.device : "", name: model.name, cells };
    })
  };
}

function updateFromAdmin(input) {
  const data = JSON.parse(JSON.stringify(load()));
  if (input.strategy) {
    const undercut = Number(input.strategy.undercutPercent);
    const minPrice = Number(input.strategy.minPrice);
    if (!Number.isFinite(undercut) || undercut < -50 || undercut > 50) return { error: "Procent skal være mellem -50 og 50." };
    if (!Number.isInteger(minPrice) || minPrice < 0 || minPrice > 5000) return { error: "Mindstepris skal være et helt tal." };
    data.strategy.undercutPercent = undercut;
    data.strategy.minPrice = minPrice;
  }
  for (const [key, value] of Object.entries(input.overrides || {})) {
    const [modelId, repairId] = key.split(":");
    const model = data.models.find((item) => item.id === modelId);
    if (!model || !Number.isFinite(model.market[repairId])) return { error: `Ukendt pris: ${key}` };
    if (value === null || value === "") {
      delete data.overrides[key];
      continue;
    }
    const price = Number(value);
    if (!Number.isInteger(price) || price < 0 || price > 100000) return { error: `Prisen for ${model.name} skal være et helt tal.` };
    data.overrides[key] = price;
  }
  for (const [key, value] of Object.entries(input.market || {})) {
    const [modelId, repairId] = key.split(":");
    const model = data.models.find((item) => item.id === modelId);
    const price = Number(value);
    if (!model || !Number.isFinite(model.market[repairId])) return { error: `Ukendt pris: ${key}` };
    if (!Number.isInteger(price) || price < 0 || price > 100000) return { error: `Markedsprisen for ${model.name} skal være et helt tal.` };
    model.market[repairId] = price;
  }
  if (input.market && Object.keys(input.market).length) data.marketUpdated = new Date().toISOString().slice(0, 10);
  save(data);
  return { ok: true };
}

module.exports = {
  catalog,
  estimate,
  estimateMany,
  rangeTokens,
  priceTablesHtml,
  offerCatalogJson,
  catalogJsonForPage,
  adminView,
  updateFromAdmin,
  formatKr,
  file: FILE
};
