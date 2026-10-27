// Finds the phone model from an IMEI: the first 8 digits (TAC) identify the model.
// tac.json is built by build-tac.js. Models customers pick for unknown TACs are remembered in data/tac-learned.json.

const fs = require("fs");
const path = require("path");

const LEARNED_FILE = path.join(__dirname, "data", "tac-learned.json");
let table = { names: [], ids: [], tac: {} };
try {
  table = JSON.parse(fs.readFileSync(path.join(__dirname, "tac.json"), "utf8"));
} catch (error) {
  console.error(`TAC-tabel mangler: ${error.message}`);
}
let learned = {};
try {
  learned = JSON.parse(fs.readFileSync(LEARNED_FILE, "utf8"));
} catch (error) {
  learned = {};
}

/** Returns { modelId, name } (modelId may be null for models we don't buy), or null if the TAC is unknown. */
function lookup(imei) {
  const code = String(imei || "").replace(/\D/g, "").slice(0, 8);
  if (code.length !== 8) return null;
  const index = table.tac[code];
  if (index !== undefined) return { modelId: table.ids[index] || null, name: table.names[index] };
  if (learned[code]) return { modelId: learned[code], name: "" };
  return null;
}

function learn(imei, modelId) {
  const code = String(imei || "").replace(/\D/g, "").slice(0, 8);
  if (code.length !== 8 || !/^\d{15}$/.test(String(imei)) || !modelId || lookup(imei)) return;
  learned[code] = modelId;
  fs.writeFile(LEARNED_FILE, JSON.stringify(learned, null, 2), () => {});
}

module.exports = { lookup, learn };
