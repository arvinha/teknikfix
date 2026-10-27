(function () {
  const root = document.querySelector("#sell");
  const dataNode = document.querySelector("#sell-data");
  if (!root || !dataNode) return;
  const data = JSON.parse(dataNode.textContent);
  const $ = function (selector) { return document.querySelector(selector); };

  const deviceStep = $("#device-step");
  const sellerStep = $("#seller-step");
  const topBox = $("#sell-top");
  const countText = $("#step-count");
  const bar = $("#sell-bar");
  const live = $("#step-live");
  const chosenBox = $("#sell-chosen");
  const chosenName = $("#chosen-name");
  const chosenSpec = $("#chosen-spec");
  const uptoBox = $("#upto");
  const stepNodes = {};
  document.querySelectorAll("[data-sell]").forEach(function (node) { stepNodes[node.getAttribute("data-sell")] = node; });

  const searchInput = $("#search");
  const hitsBox = $("#search-hits");
  const quickBox = $("#quick-picks");
  const photoStatus = $("#photo-status");
  const photoWay = $("#photo-way");
  const photoInput = $("#photo");
  const listWrap = $("#list-wrap");
  const modelSelect = $("#model");

  const specTitle = $("#spec-title");
  const variantBlock = $("#variant-block");
  const variantTitle = $("#variant-title");
  const variantTiles = $("#variant-tiles");
  const connBlock = $("#conn-block");
  const connTiles = $("#conn-tiles");
  const storageBlock = $("#storage-block");
  const storageTitle = $("#storage-title");
  const storageTiles = $("#storage-tiles");
  const specHelp = $("#spec-help");
  const lookTiles = $("#look-tiles");
  const crackBlock = $("#crack-block");
  const crackTiles = $("#crack-tiles");
  const worksTiles = $("#works-tiles");
  const faultBlock = $("#fault-block");
  const faultList = $("#fault-list");

  const offerBox = $("#offer");
  const summaryBox = $("#summary");
  const moreBox = $("#more");
  const questionBox = $("#questions");
  const imeiInput = $("#imei");
  const imeiError = $("#imei-error");
  const qtyInput = $("#qty");

  const backButton = $("#back");
  const cancelButton = $("#cancel-edit");
  const nextButton = $("#next");
  const addButton = $("#add");
  const listBox = $("#sell-list");
  const sendError = $("#send-error");
  const sendButton = $("#send");

  const kr = new Intl.NumberFormat("da-DK");
  const models = new Map();
  data.groups.forEach(function (group) {
    group.models.forEach(function (model) {
      models.set(model.id, Object.assign({ device: group.device, groupName: group.name }, model));
    });
  });

  const LOOKS = [
    { id: "perfekt", title: "Wie neu", text: "Keine Kratzer oder Spuren, die man sehen kann." },
    { id: "god", title: "Gut", text: "Leichte Gebrauchsspuren, z. B. an den Kanten. Das Display ist schön." },
    { id: "slidt", title: "Abgenutzt", text: "Deutliche Kratzer auf dem Display oder der Rückseite." },
    { id: "revnet", title: "Gesprungen", text: "Risse im Display oder im Glas auf der Rückseite." }
  ];
  const COMPUTER_LOOKS = {
    slidt: "Deutliche Kratzer, Spuren oder kleine Dellen.",
    revnet: "Gesprungenes Display oder Fehler im Bild."
  };
  const CRACKS = [
    { id: "skaerm", title: "Das Display" },
    { id: "bag", title: "Die Rückseite" },
    { id: "begge", title: "Beides" }
  ];
  const WORKS = [
    { id: "ja", title: "Ja, alles funktioniert", text: "Es lässt sich einschalten, und Akku, Kamera und Tasten funktionieren." },
    { id: "fejl", title: "Etwas funktioniert nicht", text: "Z. B. schwacher Akku, Kamera oder Aufladen." },
    { id: "dod", title: "Es lässt sich nicht einschalten", text: "Wir kaufen es trotzdem für Ersatzteile." }
  ];
  const POPULAR = ["iphone-16-pro", "iphone-15", "iphone-14", "iphone-13", "galaxy-s24", "ipad-air-m", "macbook-air"];
  const UNKNOWN = "ukendt";

  let items = [];
  let editing = -1;
  let cur = blank();
  let step = "find";
  let lastQuote = null;
  let quoteTimer = 0;
  let quoteSeq = 0;
  let uptoSeq = 0;

  function blank() {
    return { modelId: "", variant: "", storage: "", conn: "", look: "", crack: "", works: "", faults: [], custom: null, imei: "", qty: 1, upto: null };
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(amount) {
    return kr.format(amount) + " kr";
  }

  function luhn(digits) {
    let sum = 0;
    for (let i = 0; i < 15; i += 1) {
      let n = Number(digits[14 - i]);
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
    }
    return sum % 10 === 0;
  }

  function imeiProblem(raw) {
    const text = String(raw || "").replace(/\s/g, "").toUpperCase();
    if (!text) return "";
    if (/^\d+$/.test(text)) {
      if (text.length !== 15) return "Eine IMEI-Nummer hat 15 Ziffern. Gib *#06# ein, um sie zu sehen.";
      return luhn(text) ? "" : "Diese IMEI-Nummer stimmt nicht. Prüf die Ziffern.";
    }
    return /^[A-Z0-9]{8,20}$/.test(text) ? "" : "Die Seriennummer muss aus 8–20 Buchstaben und Zahlen bestehen.";
  }

  function model() {
    return models.get(cur.modelId);
  }

  function storageOptions(m) {
    return (m && data.storage[m.device]) || [];
  }

  function has(m, questionId) {
    return Boolean(m) && m.questions.indexOf(questionId) !== -1;
  }

  function questionDef(id) {
    return data.questions.find(function (question) { return question.id === id; });
  }

  function connOptions(m) {
    return m && m.device === "tablet" ? data.connectivity || [] : [];
  }

  function storageLabel(id, m) {
    if (id === UNKNOWN && storageOptions(m).length) return "Speicher: weiß nicht";
    const option = storageOptions(m).find(function (item) { return item.id === id; });
    return option ? option.label : "";
  }

  function variantLabel(id, m) {
    if (id === UNKNOWN && m && m.variants.length) return m.device === "computer" ? "Chip: weiß nicht" : "Generation: weiß nicht";
    const option = ((m && m.variants) || []).find(function (item) { return item.id === id; });
    return option ? option.label : "";
  }

  function connLabel(id, m) {
    if (id === UNKNOWN && connOptions(m).length) return "WLAN oder SIM: weiß nicht";
    const option = connOptions(m).find(function (item) { return item.id === id; });
    return option ? option.label : "";
  }

  function specText(m) {
    return [variantLabel(cur.variant, m), storageLabel(cur.storage, m), connLabel(cur.conn, m)].filter(Boolean).join(", ");
  }

  function needsSpec() {
    const m = model();
    if (!m) return false;
    return (m.variants.length > 0 && !cur.variant) || (storageOptions(m).length > 0 && !cur.storage) || (connOptions(m).length > 0 && !cur.conn);
  }

  function crackChoices(m) {
    const list = [];
    if (has(m, "screen")) list.push("skaerm");
    if (has(m, "back")) list.push("bag");
    if (list.length === 2) list.push("begge");
    return list;
  }

  // ---------- Answers ----------
  function answers() {
    if (cur.custom) return Object.assign({}, cur.custom);
    const out = Object.assign({}, data.defaults, { faults: [] });
    if (cur.look === "god") out.body = "brugsspor";
    if (cur.look === "slidt") {
      out.screen = "ridser";
      out.back = "ridser";
      out.body = "brugsspor";
    }
    if (cur.look === "revnet") {
      out.body = "brugsspor";
      if (cur.crack === "skaerm" || cur.crack === "begge") out.screen = "knust";
      if (cur.crack === "bag" || cur.crack === "begge") out.back = "knust";
    }
    if (cur.works === "dod") out.power = "nej";
    if (cur.works === "fejl") {
      cur.faults.forEach(function (key) {
        if (key === "battery") out.battery = "svagt";
        else if (key === "water") out.water = "ja";
        else out.faults.push(key);
      });
    }
    return out;
  }

  function draft() {
    return {
      modelId: cur.modelId,
      variant: cur.variant,
      storage: cur.storage,
      conn: cur.conn,
      answers: answers(),
      qty: Math.max(1, Math.min(500, Math.floor(Number(cur.qty) || 1))),
      imei: String(cur.imei || "").replace(/\s/g, "").toUpperCase()
    };
  }

  // ---------- Steps ----------
  function flow() {
    const m = model();
    const list = ["find"];
    if (m && (m.variants.length || storageOptions(m).length || connOptions(m).length)) list.push("spec");
    list.push("look", "works", "price");
    return list;
  }

  function show(id) {
    step = id;
    const list = flow();
    const index = list.indexOf(id);
    Object.keys(stepNodes).forEach(function (key) { stepNodes[key].hidden = key !== id; });
    topBox.hidden = id === "find";
    countText.textContent = "Schritt {n} von {total}".replace("{n}", index + 1).replace("{total}", list.length);
    live.textContent = countText.textContent;
    bar.innerHTML = list
      .map(function (key, i) {
        return "<span data-go=\"" + key + "\" class=\"" + (i < index ? "is-on is-done" : i === index ? "is-on" : "") + "\"></span>";
      })
      .join("");
    backButton.hidden = index <= 0;
    cancelButton.hidden = index > 0 || items.length === 0;
    nextButton.hidden = !(id === "works" && cur.works === "fejl");
    addButton.hidden = id !== "price";
    paintChosen();
    if (id === "spec") paintSpec();
    if (id === "look") paintLook();
    if (id === "works") paintWorks();
    if (id === "price") showPrice();
    if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function forward() {
    const list = flow();
    let index = list.indexOf(step) + 1;
    if (list[index] === "spec" && !needsSpec()) index += 1;
    show(list[Math.min(index, list.length - 1)]);
  }

  bar.addEventListener("click", function (event) {
    const target = event.target.closest(".is-done[data-go]");
    if (target) show(target.getAttribute("data-go"));
  });

  backButton.addEventListener("click", function () {
    const list = flow();
    show(list[Math.max(0, list.indexOf(step) - 1)]);
  });

  $("#change-model").addEventListener("click", function () {
    show("find");
    searchInput.focus();
  });

  function paintChosen() {
    const m = model();
    chosenBox.hidden = !m || step === "find";
    if (!m) return;
    chosenName.textContent = m.name;
    const spec = specText(m);
    chosenSpec.textContent = spec ? " · " + spec : "";
    uptoBox.hidden = step === "price" || !cur.upto;
    if (cur.upto) uptoBox.textContent = "Bis zu " + money(cur.upto);
  }

  function requestUpto() {
    const m = model();
    cur.upto = null;
    paintChosen();
    if (!m || m.manual || (m.variants.length && !cur.variant)) return;
    const seq = (uptoSeq += 1);
    const body = { items: [{ modelId: cur.modelId, variant: cur.variant, storage: cur.storage, conn: cur.conn, answers: data.defaults, qty: 1 }] };
    fetch("/api/saelg/tilbud", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (seq !== uptoSeq) return;
        const line = result.items && result.items[0];
        cur.upto = line && !line.manual && line.offerDkk > 0 ? line.offerDkk : null;
        paintChosen();
      })
      .catch(function () {});
  }

  // ---------- Step 1: find the model ----------
  // Words keep letters and digits together ("m2", "s24", "a12z"); a query word that doesn't match is retried split ("iphone13").
  function words(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9æøåäöüéèàáíóúñ]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
  }

  function splitWord(word) {
    return word.replace(/([a-zæøå])(\d)/g, "$1 $2").replace(/(\d)([a-zæøå])/g, "$1 $2").split(" ");
  }

  // A number must match a whole word ("4" is not "14"), except the last word, which may still be half typed.
  function wordMatch(token, list, last) {
    if (/^\d+$/.test(token) && !last) return list.indexOf(token) !== -1;
    return list.some(function (word) { return word.indexOf(token) === 0; });
  }

  // Split parts must match whole words ("m2" is not "m" + "2024"), except the very end of what is being typed.
  function tokenMatch(token, list, last) {
    if (wordMatch(token, list, last)) return true;
    const parts = splitWord(token);
    return parts.length > 1 && parts.every(function (part, i) {
      return last && i === parts.length - 1 ? wordMatch(part, list, true) : list.indexOf(part) !== -1;
    });
  }

  const searchIndex = [];
  models.forEach(function (m) {
    const own = words(m.name);
    const extra = words(m.groupName + " " + (m.keywords || "")).concat([m.device]);
    if (/^(iphone|ipad|mac|imac)/i.test(m.id)) extra.push("apple");
    searchIndex.push({
      id: m.id,
      own: own,
      base: own.concat(extra),
      variants: m.variants.map(function (v) { return { id: v.id, label: words(v.label), words: words(v.label + " " + (v.keywords || "")) }; })
    });
  });

  const STORAGE_NUMBERS = ["64", "128", "256", "512", "1024"];
  const STOP_WORDS = [
    "inch", "inches", "tommer", "tomme", "tum", "zoll", "pouces", "pouce", "pulgadas", "pollici", "cali", "tuuma",
    "gen", "generation", "generationen", "génération", "generación", "generazione", "generatie", "generacja", "sukupolvi", "sukupolven",
    "gb", "tb"
  ];
  const CELLULAR = /\b(cellular|cell|lte|sim|5g|4g|mobildata)\b/;

  function parseQuery(raw) {
    let storage = "";
    let conn = "";
    let text = String(raw || "")
      .toLowerCase()
      .replace(/wi-?fi|wlan/g, " wifi ")
      .replace(/(\d+)\s*(gb|tb)\b/g, function (all, n, unit) {
        storage = String(unit === "tb" ? Number(n) * 1024 : Number(n));
        return " ";
      })
      .replace(/(\d+)(st|nd|rd|th|ème|eme|ère|er|º|ª)(?![a-z0-9])/g, "$1")
      .replace(/(\d+):[ea](?![a-z0-9])/g, "$1");
    if (CELLULAR.test(text)) conn = "cellular";
    else if (/\bwifi\b/.test(text)) conn = "wifi";
    text = text.replace(new RegExp(CELLULAR.source, "g"), " ").replace(/\bwifi\b/g, " ");
    const tokens = words(text).filter(function (token) {
      if (STORAGE_NUMBERS.indexOf(token) !== -1) {
        storage = token;
        return false;
      }
      return STOP_WORDS.indexOf(token) === -1;
    });
    return { tokens: tokens, storage: storage, conn: conn };
  }

  // A model is a hit when every word matches its name or search words. Words that only fit one generation
  // ("ipad pro m2", "ipad 2022") give a hit for that generation instead.
  function findModels(raw) {
    const query = parseQuery(raw);
    const found = { hits: [], storage: query.storage, conn: query.conn };
    if (!query.tokens.length) return found;
    const last = query.tokens.length - 1;
    searchIndex.forEach(function (entry, order) {
      let matched = 0;
      const missing = [];
      query.tokens.forEach(function (token, i) {
        if (tokenMatch(token, entry.own, i === last)) matched += 1;
        else if (!tokenMatch(token, entry.base, i === last)) missing.push(i);
      });
      const rest = entry.own.length - matched;
      if (!missing.length) {
        found.hits.push({ id: entry.id, variant: "", kind: 0, matched: matched, label: 0, rest: rest, size: models.get(entry.id).name.length, order: order * 100 });
        return;
      }
      entry.variants.forEach(function (v, index) {
        const ok = missing.every(function (i) { return tokenMatch(query.tokens[i], v.words, i === last); });
        if (!ok) return;
        const label = missing.filter(function (i) { return tokenMatch(query.tokens[i], v.label, i === last); }).length;
        found.hits.push({ id: entry.id, variant: v.id, kind: 1, matched: matched, label: label, rest: rest, size: 0, order: order * 100 + index });
      });
    });
    found.hits.sort(function (a, b) {
      return a.kind - b.kind || b.matched - a.matched || b.label - a.label || a.rest - b.rest || a.size - b.size || a.order - b.order;
    });
    found.hits = found.hits.slice(0, 8);
    return found;
  }

  function hitButton(hit, found) {
    const m = models.get(hit.id);
    const conn = connLabel(found.conn, m) ? found.conn : "";
    const spec = [variantLabel(hit.variant, m), found.storage ? storageLabel(found.storage, m) : "", connLabel(conn, m)].filter(Boolean).join(" · ");
    return (
      "<li><button class=\"hit\" type=\"button\" role=\"option\" data-pick=\"" + esc(hit.id) + "\" data-variant=\"" + esc(hit.variant) + "\"" +
      " data-storage=\"" + esc(storageLabel(found.storage, m) ? found.storage : "") + "\" data-conn=\"" + esc(conn) + "\">" +
      "<strong>" + esc(m.name) + (spec ? " · " + esc(spec) : "") + "</strong><small>" + esc(m.groupName) + "</small></button></li>"
    );
  }

  function status(text, kind) {
    photoStatus.hidden = !text;
    photoStatus.className = "photo-status" + (kind ? " is-" + kind : "");
    photoStatus.textContent = text || "";
  }

  let imeiSeq = 0;
  function lookupImei(digits) {
    const seq = (imeiSeq += 1);
    if (!luhn(digits)) {
      status("Diese IMEI-Nummer stimmt nicht. Prüf die Ziffern.", "bad");
      return;
    }
    status("Wir suchen die IMEI-Nummer heraus…");
    fetch("/api/saelg/imei/" + digits)
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (seq !== imeiSeq) return;
        if (result.modelId && models.has(result.modelId)) {
          status("");
          chooseModel(result.modelId, { imei: digits });
          return;
        }
        cur.imei = digits;
        status(result.note || "Wir können das Modell anhand der IMEI-Nummer nicht erkennen. Such nach dem Modell oder mach ein Foto von Einstellungen → Allgemein → Info.");
      })
      .catch(function () {
        if (seq !== imeiSeq) return;
        status("Die IMEI-Nummer konnte gerade nicht abgefragt werden. Such stattdessen nach dem Modell.", "bad");
      });
  }

  function paintHits() {
    const raw = searchInput.value;
    const digits = raw.replace(/[\s-]/g, "");
    quickBox.hidden = raw.trim().length > 0;
    if (/^\d{6,}$/.test(digits)) {
      hitsBox.hidden = true;
      if (digits.length < 15) status("Das sieht nach einer IMEI-Nummer aus. Gib alle 15 Ziffern ein.");
      else if (digits.length === 15) lookupImei(digits);
      else status("Eine IMEI-Nummer hat 15 Ziffern. Prüf, ob eine Ziffer zu viel dabei ist.", "bad");
      return;
    }
    if (!photoStatus.classList.contains("is-ok")) status("");
    const found = findModels(raw);
    if (!raw.trim()) {
      hitsBox.hidden = true;
      return;
    }
    hitsBox.hidden = false;
    if (!found.hits.length) {
      const other = models.has("anden-telefon") ? "<li><button class=\"hit\" type=\"button\" data-pick=\"anden-telefon\"><strong>Mein Modell steht nicht in der Liste</strong><small>Du bekommst innerhalb von 1 Werktag einen Festpreis</small></button></li>" : "";
      hitsBox.innerHTML = "<li class=\"hit-empty\">Wir haben kein Modell gefunden. Versuch es kürzer, z. B. „iPhone 13“ oder „Galaxy S23“.</li>" + other;
      return;
    }
    hitsBox.innerHTML = found.hits.map(function (hit) { return hitButton(hit, found); }).join("");
  }

  searchInput.addEventListener("input", paintHits);
  searchInput.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    const first = hitsBox.querySelector("[data-pick]");
    if (first && !hitsBox.hidden) {
      event.preventDefault();
      first.click();
    }
  });

  hitsBox.addEventListener("click", function (event) {
    const button = event.target.closest("[data-pick]");
    if (button) {
      chooseModel(button.getAttribute("data-pick"), {
        storage: button.getAttribute("data-storage"),
        variant: button.getAttribute("data-variant"),
        conn: button.getAttribute("data-conn")
      });
    }
  });

  quickBox.innerHTML = POPULAR.filter(function (id) { return models.has(id); })
    .slice(0, 5)
    .map(function (id) { return "<button class=\"quick-pick\" type=\"button\" data-pick=\"" + esc(id) + "\">" + esc(models.get(id).name) + "</button>"; })
    .join("");
  quickBox.addEventListener("click", function (event) {
    const button = event.target.closest("[data-pick]");
    if (button) chooseModel(button.getAttribute("data-pick"));
  });

  $("#imei-way").addEventListener("click", function () {
    searchInput.value = "";
    searchInput.placeholder = "Die 15 Ziffern von *#06#";
    searchInput.inputMode = "numeric";
    quickBox.hidden = false;
    hitsBox.hidden = true;
    status("Gib *#06# auf dem Handy ein, als würdest du jemanden anrufen. Dann steht die IMEI-Nummer auf dem Display.");
    searchInput.focus();
  });

  data.groups.forEach(function (group) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.name;
    group.models.forEach(function (m) {
      const option = document.createElement("option");
      option.value = m.id;
      option.textContent = m.name;
      optgroup.appendChild(option);
    });
    modelSelect.appendChild(optgroup);
  });
  $("#list-way").addEventListener("click", function () {
    listWrap.hidden = false;
    modelSelect.focus();
  });
  modelSelect.addEventListener("change", function () {
    if (modelSelect.value) chooseModel(modelSelect.value);
  });

  if (!photoWay.getAttribute("data-vision")) photoWay.hidden = true;

  function chooseModel(id, extra) {
    const m = models.get(id);
    if (!m) return;
    const keepImei = (extra && extra.imei) || (cur.modelId ? "" : cur.imei);
    cur = blank();
    cur.modelId = id;
    cur.imei = keepImei || "";
    if (extra && extra.storage && storageLabel(extra.storage, m)) cur.storage = extra.storage;
    if (extra && extra.variant && variantLabel(extra.variant, m)) cur.variant = extra.variant;
    if (extra && extra.conn && connLabel(extra.conn, m)) cur.conn = extra.conn;
    if (!storageOptions(m).length) cur.storage = "";
    modelSelect.value = id;
    imeiInput.value = cur.imei;
    qtyInput.value = 1;
    imeiError.hidden = true;
    moreBox.open = false;
    requestUpto();
    step = "find";
    forward();
  }

  // ---------- Photo ----------
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("billede"));
      };
      img.src = url;
    });
  }

  function storageId(gb, device) {
    const options = data.storage[device] || [];
    const n = Number(gb);
    if (!n) return "";
    let best = "";
    options.forEach(function (option) {
      if (Number(option.id) <= n) best = option.id;
    });
    return best || (options[0] && options[0].id) || "";
  }

  photoInput.addEventListener("change", async function () {
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    status("Wir schauen uns das Foto an…");
    try {
      const image = await shrink(file);
      const response = await fetch("/api/saelg/genkend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: image }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "fejl");
      if (result.modelId && models.has(result.modelId)) {
        const m = models.get(result.modelId);
        status("");
        chooseModel(result.modelId, { storage: storageId(result.storage, m.device), variant: result.chip || "", imei: result.imei || result.serial || "" });
      } else if (result.imeiOnly) {
        cur.imei = result.imei;
        searchInput.value = result.imei;
        status(result.note);
      } else {
        status((result.note ? result.note + " " : "") + "Such stattdessen nach dem Modell.", "bad");
      }
    } catch (error) {
      status(error.message && error.message.length > 8 ? error.message : "Das Foto konnte nicht gelesen werden. Such stattdessen nach dem Modell.", "bad");
    }
    photoInput.value = "";
  });

  // ---------- Step 2: storage and chip ----------
  function tile(attr, id, title, on, text) {
    return (
      "<button class=\"tile-btn\" type=\"button\" " + attr + "=\"" + esc(id) + "\" aria-pressed=\"" + (on ? "true" : "false") + "\">" +
      "<strong>" + esc(title) + "</strong>" + (text ? "<small>" + esc(text) + "</small>" : "") + "</button>"
    );
  }

  function smallest(list) {
    return list.reduce(function (low, option) { return option.factor < low.factor ? option : low; }, list[0]);
  }

  function paintSpec() {
    const m = model();
    const variants = m.variants || [];
    const storage = storageOptions(m);
    const conns = connOptions(m);
    variantBlock.hidden = variants.length === 0;
    storageBlock.hidden = storage.length === 0;
    connBlock.hidden = conns.length === 0;
    storageTitle.hidden = variants.length === 0 && conns.length === 0;
    variantTitle.textContent = m.device === "computer" ? "Chip" : "Generation";
    specTitle.textContent = variants.length ? m.variantTitle || "Welche Ausführung hast du?" : conns.length ? "Welche Ausführung hast du?" : "Wie viel Speicherplatz hat es?";
    specHelp.textContent =
      m.device === "computer"
        ? "Auf einem Mac: Apple-Menü → Über diesen Mac."
        : m.device === "tablet"
          ? "Du findest es unter Einstellungen → Allgemein → Info. Wenn du es nicht siehst, wähl „Weiß nicht“."
          : "Du findest es unter Einstellungen → Allgemein → Info.";
    const dunno = function (attr, on, text) { return tile(attr, UNKNOWN, "Weiß nicht", on, text); };
    variantTiles.innerHTML =
      variants.map(function (v) { return tile("data-variant", v.id, v.label, v.id === cur.variant); }).join("") +
      dunno("data-variant", cur.variant === UNKNOWN, "Wir gehen von der ältesten aus, bis wir es geprüft haben");
    storageTiles.innerHTML = storage.length
      ? storage.map(function (s) { return tile("data-storage", s.id, s.label, s.id === cur.storage); }).join("") +
        dunno("data-storage", cur.storage === UNKNOWN, "Wir gehen von {x} aus".replace("{x}", smallest(storage).label))
      : "";
    connTiles.innerHTML = conns.length
      ? conns.map(function (c) { return tile("data-conn", c.id, c.label, c.id === cur.conn); }).join("") +
        dunno("data-conn", cur.conn === UNKNOWN, "Wir gehen von {x} aus".replace("{x}", conns[0].label))
      : "";
  }

  stepNodes.spec.addEventListener("click", function (event) {
    const variant = event.target.closest("[data-variant]");
    const storage = event.target.closest("[data-storage]");
    const conn = event.target.closest("[data-conn]");
    if (!variant && !storage && !conn) return;
    if (variant) cur.variant = variant.getAttribute("data-variant");
    if (storage) cur.storage = storage.getAttribute("data-storage");
    if (conn) cur.conn = conn.getAttribute("data-conn");
    paintSpec();
    paintChosen();
    requestUpto();
    if (!needsSpec()) forward();
  });

  // ---------- Step 3: how it looks ----------
  function paintLook() {
    const m = model();
    const cracks = crackChoices(m);
    lookTiles.innerHTML = LOOKS.filter(function (look) { return look.id !== "revnet" || cracks.length; })
      .map(function (look) {
        const text = (m.device === "computer" && COMPUTER_LOOKS[look.id]) || look.text;
        return tile("data-look", look.id, look.title, !cur.custom && look.id === cur.look, text);
      })
      .join("");
    crackBlock.hidden = !(cur.look === "revnet" && cracks.length > 1);
    crackTiles.innerHTML = CRACKS.filter(function (crack) { return cracks.indexOf(crack.id) !== -1; })
      .map(function (crack) { return tile("data-crack", crack.id, crack.title, crack.id === cur.crack); })
      .join("");
  }

  stepNodes.look.addEventListener("click", function (event) {
    const look = event.target.closest("[data-look]");
    const crack = event.target.closest("[data-crack]");
    if (!look && !crack) return;
    cur.custom = null;
    if (crack) {
      cur.crack = crack.getAttribute("data-crack");
      forward();
      return;
    }
    cur.look = look.getAttribute("data-look");
    const cracks = crackChoices(model());
    if (cur.look === "revnet" && cracks.length > 1) {
      cur.crack = "";
      paintLook();
      crackBlock.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    cur.crack = cur.look === "revnet" ? cracks[0] : "";
    forward();
  });

  // ---------- Step 4: does it work ----------
  function faultChoices(m) {
    const list = [];
    if (has(m, "battery")) list.push({ id: "battery", label: "Der Akku hält schlecht (unter 80 %)" });
    const faults = questionDef("faults");
    if (faults) {
      faults.options.forEach(function (option) {
        if (m.faults.indexOf(option.id) !== -1) list.push({ id: option.id, label: option.label });
      });
    }
    if (has(m, "water")) list.push({ id: "water", label: "Es war nass" });
    return list;
  }

  function paintWorks() {
    worksTiles.innerHTML = WORKS.map(function (works) { return tile("data-works", works.id, works.title, !cur.custom && works.id === cur.works, works.text); }).join("");
    faultBlock.hidden = cur.works !== "fejl";
    faultList.innerHTML = faultChoices(model())
      .map(function (choice) {
        const on = cur.faults.indexOf(choice.id) !== -1;
        return "<label class=\"check\"><input type=\"checkbox\" data-fault=\"" + esc(choice.id) + "\"" + (on ? " checked" : "") + "> <span>" + esc(choice.label) + "</span></label>";
      })
      .join("");
    nextButton.hidden = step !== "works" || cur.works !== "fejl";
  }

  stepNodes.works.addEventListener("click", function (event) {
    const works = event.target.closest("[data-works]");
    if (!works) return;
    cur.custom = null;
    cur.works = works.getAttribute("data-works");
    if (cur.works === "fejl") {
      paintWorks();
      faultBlock.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    forward();
  });

  faultList.addEventListener("change", function () {
    cur.faults = [];
    faultList.querySelectorAll("input[data-fault]:checked").forEach(function (input) { cur.faults.push(input.getAttribute("data-fault")); });
  });

  nextButton.addEventListener("click", function () { show("price"); });

  // ---------- Step 5: the price ----------
  function paintQuestions() {
    const m = model();
    const current = answers();
    questionBox.innerHTML = m.questions
      .filter(function (id) { return id !== "lock"; })
      .map(function (id) {
        const question = questionDef(id);
        if (!question) return "";
        if (question.multi) {
          const options = question.options.filter(function (option) { return m.faults.indexOf(option.id) !== -1; });
          if (!options.length) return "";
          return (
            "<fieldset class=\"sell-q\"><legend class=\"field-title\">" + esc(question.label) + " <span class=\"repair-hint\">Kreuz an, was passt</span></legend>" +
            "<div class=\"fault-grid\">" +
            options
              .map(function (option) {
                const on = (current.faults || []).indexOf(option.id) !== -1;
                return "<label class=\"check\"><input type=\"checkbox\" data-fault=\"" + esc(option.id) + "\"" + (on ? " checked" : "") + "> <span>" + esc(option.label) + "</span></label>";
              })
              .join("") +
            "</div></fieldset>"
          );
        }
        return (
          "<fieldset class=\"sell-q\"><legend class=\"field-title\">" + esc(question.label) + "</legend>" +
          "<div class=\"segmented seg-" + question.options.length + "\">" +
          question.options
            .map(function (option) {
              return "<label><input type=\"radio\" name=\"q-" + esc(id) + "\" value=\"" + esc(option.id) + "\"" + (option.id === current[id] ? " checked" : "") + "><span>" + esc(option.label) + "</span></label>";
            })
            .join("") +
          "</div></fieldset>"
        );
      })
      .join("");
  }

  questionBox.addEventListener("change", function () {
    const out = Object.assign({}, data.defaults);
    questionBox.querySelectorAll("input[type=radio]:checked").forEach(function (input) { out[input.name.slice(2)] = input.value; });
    out.faults = [];
    questionBox.querySelectorAll("input[data-fault]:checked").forEach(function (input) { out.faults.push(input.getAttribute("data-fault")); });
    cur.custom = out;
    paintSummary();
    requestQuote();
  });

  function lookText() {
    const look = LOOKS.find(function (item) { return item.id === cur.look; });
    if (!look) return "";
    if (cur.look !== "revnet") return look.title;
    const crack = CRACKS.find(function (item) { return item.id === cur.crack; });
    return look.title + (crack ? ": " + crack.title.toLowerCase() : "");
  }

  function worksText() {
    const works = WORKS.find(function (item) { return item.id === cur.works; });
    if (!works) return "";
    if (cur.works !== "fejl") return works.title;
    const labels = faultChoices(model())
      .filter(function (choice) { return cur.faults.indexOf(choice.id) !== -1; })
      .map(function (choice) { return choice.label; });
    return labels.length ? labels.join(", ") : works.title;
  }

  function paintSummary() {
    const m = model();
    const spec = specText(m);
    const rows = [["Modell", m.name, "find"]];
    if (spec) rows.push(["Ausführung", spec, "spec"]);
    if (cur.custom) rows.push(["Zustand", "Deine eigenen Antworten unten", "more"]);
    else {
      rows.push(["Aussehen", lookText(), "look"]);
      rows.push(["Funktioniert", worksText(), "works"]);
    }
    if (cur.imei) rows.push(["IMEI", cur.imei, "more"]);
    summaryBox.innerHTML =
      "<ul>" +
      rows
        .map(function (row) {
          return "<li><span class=\"review-label\">" + esc(row[0]) + "</span><span class=\"review-value\">" + esc(row[1]) + "</span><button class=\"link-button\" type=\"button\" data-edit-step=\"" + row[2] + "\">Ändern</button></li>";
        })
        .join("") +
      "</ul>";
  }

  summaryBox.addEventListener("click", function (event) {
    const button = event.target.closest("[data-edit-step]");
    if (!button) return;
    const target = button.getAttribute("data-edit-step");
    if (target === "more") {
      moreBox.open = true;
      moreBox.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    show(target);
  });

  function showPrice() {
    paintSummary();
    paintQuestions();
    imeiInput.value = cur.imei;
    qtyInput.value = cur.qty;
    offerBox.innerHTML = "<p class=\"offer-kicker\">Wir berechnen den Preis…</p>";
    lastQuote = null;
    refreshButton();
    requestQuote();
  }

  function paintOffer(quote) {
    offerBox.classList.remove("is-bad", "is-manual");
    if (!quote) {
      offerBox.innerHTML = "<p>Der Preis konnte nicht abgerufen werden. Versuch es noch einmal.</p>";
      return;
    }
    const notes = quote.lines.length ? "<ul class=\"offer-lines\">" + quote.lines.map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("") + "</ul>" : "";
    if (quote.blocked) {
      offerBox.classList.add("is-bad");
      offerBox.innerHTML = "<p class=\"estimate-total\">Wir können es nicht kaufen, solange es gesperrt ist</p>" + notes;
      return;
    }
    if (quote.manual) {
      offerBox.classList.add("is-manual");
      offerBox.innerHTML = "<p class=\"estimate-total\">Du bekommst innerhalb von 1 Werktag einen Festpreis</p>" + notes;
      return;
    }
    if (quote.recycle) {
      offerBox.innerHTML = "<p class=\"offer-kicker\">Du bekommst</p><p class=\"estimate-price\">0 DKK</p><p class=\"estimate-meta\">Kostenloses Recycling</p>" + notes;
      return;
    }
    const each = quote.qty > 1 ? "<p class=\"estimate-meta\">" + quote.qty + " × " + money(quote.offerDkk) + " = <strong>" + money(quote.totalDkk) + "</strong></p>" : "";
    offerBox.innerHTML =
      "<p class=\"offer-kicker\">Du bekommst</p><p class=\"estimate-price\">" + money(quote.offerDkk) + (quote.qty > 1 ? " <small class=\"offer-each\">pro Stück</small>" : "") + "</p>" +
      each + notes +
      "<small>Der Preis gilt " + data.validDays + " Tage. Wir prüfen das Gerät, wenn es bei uns ankommt. Stimmt es nicht überein, bekommst du ein neues Angebot oder es geht kostenlos zurück.</small>";
  }

  function refreshButton() {
    const ok = lastQuote && !lastQuote.blocked;
    addButton.disabled = !ok || Boolean(imeiProblem(imeiInput.value));
    addButton.textContent =
      editing >= 0 ? "Änderung speichern" : lastQuote && lastQuote.recycle ? "Zum Recycling schicken" : lastQuote && lastQuote.manual ? "Festes Angebot erhalten" : "Verkaufen";
  }

  function requestQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(async function () {
      const seq = (quoteSeq += 1);
      try {
        const response = await fetch("/api/saelg/tilbud", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [draft()] }) });
        const result = await response.json();
        if (seq !== quoteSeq) return;
        lastQuote = result.items && result.items[0] ? result.items[0] : null;
        paintOffer(lastQuote);
      } catch (error) {
        if (seq !== quoteSeq) return;
        lastQuote = null;
        paintOffer(null);
      }
      refreshButton();
    }, 120);
  }

  qtyInput.addEventListener("input", function () {
    cur.qty = qtyInput.value;
    requestQuote();
  });
  imeiInput.addEventListener("input", function () {
    cur.imei = imeiInput.value;
    const problem = imeiProblem(imeiInput.value);
    const digits = imeiInput.value.replace(/\D/g, "");
    imeiError.hidden = !problem || (digits.length > 0 && digits.length < 15 && /^\d+$/.test(imeiInput.value.trim()));
    imeiError.textContent = problem;
    refreshButton();
  });

  // ---------- List of devices ----------
  function itemPrice(item) {
    const quote = item.quote;
    if (quote.manual) return "Preis folgt";
    if (quote.recycle) return "Recycling";
    return money(quote.totalDkk);
  }

  function abroad() {
    const land = sellerStep.elements.country.value;
    return Boolean(land) && land !== "DK";
  }

  function paintList() {
    const sum = items.reduce(function (total, item) { return total + (item.quote.totalDkk || 0); }, 0);
    const shipping = abroad() && sum > 0 ? Math.min(sum, data.euShippingDkk || 0) : 0;
    const total = sum - shipping;
    const manual = items.some(function (item) { return item.quote.manual; });
    listBox.innerHTML =
      "<ul>" +
      items
        .map(function (item, index) {
          const quote = item.quote;
          const spec = [quote.variantLabel, quote.storageLabel].filter(Boolean).join(", ");
          return (
            "<li><span class=\"review-label\">" + (quote.qty > 1 ? quote.qty + " ×" : "1 ×") + "</span>" +
            "<span class=\"review-value\">" + esc(quote.modelName) + (spec ? "<span class=\"review-note\">" + esc(spec) + "</span>" : "") +
            "<span class=\"review-note\"><button class=\"link-button\" type=\"button\" data-edit=\"" + index + "\">Ändern</button> · <button class=\"link-button\" type=\"button\" data-remove=\"" + index + "\">Entfernen</button></span></span>" +
            "<strong>" + itemPrice(item) + "</strong></li>"
          );
        })
        .join("") +
      "</ul>" +
      (shipping ? "<p class=\"cart-sum\"><span>Versand aus dem Ausland</span><span>−" + money(shipping) + "</span></p>" : "") +
      "<div class=\"review-price\"><span>Du bekommst" + (manual ? " mindst" : "") + "</span><strong>" + money(total) + "</strong></div>" +
      (manual ? "<span class=\"review-note\">Für Geräte ohne Preis bekommst du innerhalb von 1 Werktag ein festes Angebot.</span>" : "");
  }

  function showSeller() {
    deviceStep.hidden = true;
    sellerStep.hidden = false;
    paintList();
    sellerStep.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showDevice(index) {
    editing = typeof index === "number" ? index : -1;
    deviceStep.hidden = false;
    sellerStep.hidden = true;
    $("#device-title").textContent = items.length ? "Was möchtest du noch verkaufen?" : "Was möchtest du verkaufen?";
    if (editing >= 0) {
      cur = JSON.parse(JSON.stringify(items[editing].state));
      show("price");
    } else {
      cur = blank();
      searchInput.value = "";
      hitsBox.hidden = true;
      quickBox.hidden = false;
      listWrap.hidden = true;
      modelSelect.value = "";
      status("");
      show("find");
    }
    refreshButton();
    deviceStep.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  addButton.addEventListener("click", function () {
    if (!lastQuote || addButton.disabled) return;
    const entry = { draft: draft(), quote: lastQuote, state: JSON.parse(JSON.stringify(cur)) };
    if (editing >= 0) items[editing] = entry;
    else items.push(entry);
    editing = -1;
    showSeller();
  });

  cancelButton.addEventListener("click", function () {
    editing = -1;
    showSeller();
  });

  $("#add-more").addEventListener("click", function () { showDevice(); });

  listBox.addEventListener("click", function (event) {
    const edit = event.target.closest("[data-edit]");
    const remove = event.target.closest("[data-remove]");
    if (edit) showDevice(Number(edit.getAttribute("data-edit")));
    if (remove) {
      items.splice(Number(remove.getAttribute("data-remove")), 1);
      if (items.length) paintList();
      else showDevice();
    }
  });

  // ---------- Seller form ----------
  function pick(name, value) {
    const input = sellerStep.querySelector("input[name=\"" + name + "\"][value=\"" + value + "\"]");
    if (input) input.checked = true;
  }

  function syncToggles() {
    const form = sellerStep.elements;
    const land = form.country.value;
    const home = land === "DK";
    const firm = form.sellerType.value === "firma";
    $("#company-row").hidden = !firm;
    $("#cvr-label").textContent = home ? "Firmen- oder Umsatzsteuernummer" : "USt-IdNr. (VAT)";
    form.cvr.inputMode = home ? "numeric" : "text";
    $("#dropoff").hidden = !home;
    if (!home) pick("delivery", "post");
    $("#post-home").hidden = !home;
    $("#post-abroad").hidden = home;
    const mobilepay = home || land === "FI";
    $("#mp-choice").hidden = !mobilepay;
    if (!mobilepay) pick("payoutMethod", "bank");
    const bank = form.payoutMethod.value === "bank";
    $("#mp-row").hidden = bank;
    $("#bank-row").hidden = !bank || !home;
    $("#iban-row").hidden = !bank || home;
    if (!sellerStep.hidden) paintList();
  }
  const homeCountry = document.documentElement.getAttribute("data-country");
  if (homeCountry && sellerStep.querySelector("select[name=\"country\"] option[value=\"" + homeCountry + "\"]")) sellerStep.elements.country.value = homeCountry;
  sellerStep.addEventListener("change", syncToggles);
  syncToggles();

  $("#note-open").addEventListener("click", function (event) {
    event.currentTarget.hidden = true;
    $("#note-wrap").hidden = false;
    sellerStep.elements.note.focus();
  });

  sellerStep.addEventListener("submit", async function (event) {
    event.preventDefault();
    sendError.hidden = true;
    const form = sellerStep.elements;
    const payload = {
      items: items.map(function (item) { return item.draft; }),
      sellerType: form.sellerType.value,
      company: form.company.value,
      cvr: form.cvr.value,
      name: form.name.value,
      phone: form.phone.value,
      email: form.email.value,
      address: form.address.value,
      country: form.country.value,
      delivery: form.delivery.value,
      payoutMethod: form.payoutMethod.value,
      mobilepay: form.mobilepay.value,
      reg: form.reg.value,
      konto: form.konto.value,
      iban: form.iban.value,
      note: form.note.value,
      consent: form.consent.checked ? "ja" : ""
    };
    sendButton.disabled = true;
    try {
      const response = await fetch("/api/saelg", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(result.message || "Das Angebot wurde nicht gesendet. Versuch es noch einmal.");
      try {
        sessionStorage.setItem("teknikfix.sell", JSON.stringify({ ref: result.ref, email: payload.email }));
      } catch (error) {
        // Private mode: the status page just asks for the e-mail.
      }
      location.href = "/saelg/tak?ref=" + encodeURIComponent(result.ref);
    } catch (error) {
      sendError.hidden = false;
      sendError.textContent = error.message;
      sendButton.disabled = false;
    }
  });

  const start = new URLSearchParams(location.search).get("model");
  if (start && models.has(start)) chooseModel(start);
  else show("find");
})();
