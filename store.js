// Small JSON-file stores for buybacks, part orders and partners. Writes are queued per file and atomic.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "[]\n");
  let chain = Promise.resolve();

  function read() {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(data)) throw new Error(`${path.basename(file)} is not a list`);
    return data;
  }

  function write(list) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + "\n");
    fs.rmSync(file, { force: true });
    fs.renameSync(tmp, file);
  }

  /** mutator(list) returns { save, value }. Runs one at a time, so read-modify-write never races. */
  function withList(mutator) {
    const run = chain.then(() => {
      const list = read();
      const result = mutator(list);
      if (result && result.save) write(list);
      return result ? result.value : undefined;
    });
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function all() {
    return withList((list) => ({ save: false, value: list }));
  }

  return { withList, all };
}

function makeRef(prefix, list, length = 4) {
  for (let i = 0; i < 40; i += 1) {
    let body = "";
    for (const byte of crypto.randomBytes(length)) body += ALPHABET[byte % ALPHABET.length];
    const ref = `${prefix}-${body}`;
    if (!list.some((item) => item.ref === ref)) return ref;
  }
  throw new Error("Could not make a reference");
}

function normRef(prefix, input, length = 4) {
  let ref = String(input || "").toUpperCase().replace(/\s/g, "").slice(0, 20);
  const body = `[${ALPHABET}]{${length}}`;
  if (new RegExp(`^${body}$`).test(ref)) ref = `${prefix}-${ref}`;
  return new RegExp(`^${prefix}-${body}$`).test(ref) ? ref : "";
}

module.exports = { createStore, makeRef, normRef };
