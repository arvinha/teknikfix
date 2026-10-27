// USD to DKK from the European Central Bank, refreshed by the nightly parts job.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "data", "fx.json");
const ECB = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

let saved = null;

function read() {
  if (saved) return saved;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (error) {
    saved = {};
  }
  return saved;
}

function usdDkk(fallback) {
  const rate = Number(read().usdDkk);
  return rate > 0 ? rate : fallback;
}

async function refresh() {
  const response = await fetch(ECB, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`ECB svarede ${response.status}`);
  const xml = await response.text();
  const rate = (code) => {
    const match = xml.match(new RegExp(`currency=['"]${code}['"]\\s+rate=['"]([\\d.]+)['"]`));
    return match ? Number(match[1]) : 0;
  };
  const usd = rate("USD");
  const dkk = rate("DKK");
  if (!usd || !dkk) throw new Error("ECB-kurser mangler");
  saved = { usdDkk: Math.round((dkk / usd) * 10000) / 10000, at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(saved, null, 2));
  return saved.usdDkk;
}

module.exports = { usdDkk, refresh };
