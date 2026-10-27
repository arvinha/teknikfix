// Builds tac.json (first 8 digits of an IMEI -> phone model) from the open TAC database
// https://github.com/MoazEb/tac-database (MIT). Unzip tac_full.xlsx and run:
//   node build-tac.js <unzipped>/xl/worksheets/sheet1.xml

const fs = require("fs");
const path = require("path");

const RULES = [
  [/^APPLE IPHONE (1[1-7]) PRO MAX$/, (m) => `iphone-${m[1]}-pro-max`],
  [/^APPLE IPHONE (1[1-7]) PRO$/, (m) => `iphone-${m[1]}-pro`],
  [/^APPLE IPHONE (1[4-6]) PLUS$/, (m) => `iphone-${m[1]}-plus`],
  [/^APPLE IPHONE (1[23]) MINI$/, (m) => `iphone-${m[1]}-mini`],
  [/^APPLE IPHONE 16E$/, () => "iphone-16e"],
  [/^APPLE IPHONE AIR$/, () => "iphone-air"],
  [/^APPLE IPHONE (1[1-7])$/, (m) => `iphone-${m[1]}`],
  [/^APPLE IPHONE (X|XR|XS|XS MAX)$/, () => "iphone-x-xs-xr"],
  [/^APPLE IPHONE SE \((2ND|3RD) GEN\)$/, () => "iphone-se"],
  [/^APPLE IPHONE SE$/, (m, specs) => (/20(20|22)/.test(specs) ? "iphone-se" : null)],
  [/^SAMSUNG GALAXY S(2[345]) ULTRA( 5G)?$/, (m) => `galaxy-s${m[1]}-ultra`],
  [/^SAMSUNG GALAXY S(2[345])(\+| PLUS)( 5G)?$/, (m) => `galaxy-s${m[1]}-plus`],
  [/^SAMSUNG GALAXY S(2[34]) FE$/, (m) => `galaxy-s${m[1]}-fe`],
  [/^SAMSUNG GALAXY S(2[1-5])( 5G)?$/, (m) => `galaxy-s${m[1]}`],
  [/^SAMSUNG GALAXY A(56|55|54|36|35|25|16|15)( [45]G)?$/, (m) => `galaxy-a${m[1]}`],
  [/^SAMSUNG GALAXY Z FOLD ?[4-7]\b/, () => "galaxy-z-fold"],
  [/^SAMSUNG GALAXY Z FLIP ?[4-7]\b/, () => "galaxy-z-flip"],
  [/^GOOGLE PIXEL 10 PRO( XL)?$/, () => "pixel-10-pro"],
  [/^GOOGLE PIXEL 9 PRO( XL)?$/, () => "pixel-9-pro"],
  [/^GOOGLE PIXEL ([789]|10)$/, (m) => `pixel-${m[1]}`],
  [/^GOOGLE PIXEL ([89])A$/, (m) => `pixel-${m[1]}a`],
  [/^GOOGLE PIXEL ([78]) PRO$/, (m) => `pixel-${m[1]}-pro`],
  [/^GOOGLE PIXEL 7A$/, () => "pixel-7"],
  [/^GOOGLE PIXEL 6( PRO|A)?$/, () => "pixel-6"],
  [/^ONEPLUS 1[1-3]( 5G)?$/, () => "oneplus-flagship"],
  [/^ONEPLUS NORD\b/, () => "oneplus-nord"],
  [/^XIAOMI 1[3-5]\b/, () => "xiaomi-flagship"],
  [/^(XIAOMI )?(REDMI NOTE|POCO)\b/, () => "redmi-note"],
  [/^(XIAOMI )?REDMI ([A-C]\d|\d+[AC])\b/, () => "redmi"],
  [/^MOTOROLA EDGE\b/, () => "moto-edge"],
  [/^MOTOROLA MOTO G\b/, () => "moto-g"],
  [/^HUAWEI (P\d|MATE)\b/, () => "huawei-p-mate"],
  [/^HONOR\b/, () => "honor"],
  [/^(NOTHING|OPPO|SONY XPERIA|NOKIA [GCX]\d|DORO)\b/, () => "anden-telefon"]
];

const NAMED = /^(APPLE IPHONE|SAMSUNG GALAXY|GOOGLE PIXEL)/;
const WORDS = { IPHONE: "iPhone", ONEPLUS: "OnePlus", SE: "SE", FE: "FE", XR: "XR", XS: "XS", "5G": "5G", "4G": "4G", "16E": "16e" };

function pretty(name) {
  return name
    .split(" ")
    .map((word) => WORDS[word] || word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function modelFor(name, specs) {
  for (const [pattern, pick] of RULES) {
    const match = pattern.exec(name);
    if (match) return pick(match, specs);
  }
  return null;
}

const source = process.argv[2];
if (!source) {
  console.error("Brug: node build-tac.js <sheet1.xml>");
  process.exit(1);
}
const xml = fs.readFileSync(source, "utf8");
const rowRe = /<row [^>]*>.*?<v>(\d+)<\/v>.*?<t>([^<]*)<\/t>.*?<\/row>/g;
const names = [];
const ids = [];
const index = new Map();
const tac = {};
let match;
while ((match = rowRe.exec(xml))) {
  const specs = match[2].replace(/&amp;/g, "&");
  const name = specs.split(",")[0].trim().toUpperCase();
  const id = modelFor(name, specs);
  if (!id && !NAMED.test(name)) continue;
  const key = `${name}|${id || ""}`;
  if (!index.has(key)) {
    index.set(key, names.length);
    names.push(pretty(name));
    ids.push(id);
  }
  tac[match[1].padStart(8, "0")] = index.get(key);
}
const out = { source: "MoazEb/tac-database (MIT)", built: new Date().toISOString().slice(0, 10), names, ids, tac };
fs.writeFileSync(path.join(__dirname, "tac.json"), JSON.stringify(out));
console.log(`${Object.keys(tac).length} TAC-koder, ${names.length} modeller, ${ids.filter(Boolean).length} koblet til vores liste`);
