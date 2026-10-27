// Translate the site by hand: `node translate.js` (all languages) or `node translate.js en de -- public/index.html`.
// The server does the same on start-up, so this is only needed to force or test a run.
const fs = require("fs");
const path = require("path");

for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
}

const i18n = require("./i18n");
const args = process.argv.slice(2);
const split = args.indexOf("--");
const langs = (split >= 0 ? args.slice(0, split) : args).filter((code) => i18n.FOREIGN.includes(code));
const files = split >= 0 ? args.slice(split + 1) : null;

const started = Date.now();
i18n
  .build({ langs: langs.length ? langs : i18n.FOREIGN, files })
  .then((result) => {
    console.log(result, `${Math.round((Date.now() - started) / 1000)} s`);
    console.log(JSON.stringify(i18n.status().langs));
  });
