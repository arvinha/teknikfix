(function () {
  const tabs = document.querySelector("#admin-tabs");
  if (!tabs) return;

  const kr = new Intl.NumberFormat("da-DK");
  const state = { opkoeb: null, butik: null, dele: null, partnere: null };
  const current = { opkoeb: "", butik: "", dele: "", partnere: "" };
  let buyPrices = null;
  let partPrices = null;
  let partFilter = "";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(amount) {
    return amount === null || amount === undefined ? "Ikke sat" : kr.format(amount) + " kr";
  }

  function when(iso) {
    return new Date(iso).toLocaleString("da-DK", { dateStyle: "short", timeStyle: "short" });
  }

  function telLink(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 8) return "+45" + digits;
    return digits ? "+" + digits : "";
  }

  function parseKr(raw) {
    const text = String(raw || "").trim().replace(/\./g, "");
    return /^\d+$/.test(text) ? Number(text) : NaN;
  }

  async function api(method, url, body) {
    const response = await fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.message || "Kunne ikke gemme.");
    return data;
  }

  // ---------- Tabs ----------
  function showTab(name) {
    tabs.querySelectorAll("[data-tab]").forEach(function (button) {
      button.setAttribute("aria-selected", String(button.getAttribute("data-tab") === name));
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
    if (name !== "reparation" && !state[name]) load(name);
  }

  tabs.addEventListener("click", function (event) {
    const button = event.target.closest("[data-tab]");
    if (button) showTab(button.getAttribute("data-tab"));
  });

  function setCount(name, count) {
    const button = tabs.querySelector("[data-tab=\"" + name + "\"]");
    const old = button.querySelector(".tab-count");
    if (old) old.remove();
    if (count > 0) button.insertAdjacentHTML("beforeend", "<span class=\"tab-count\">" + count + "</span>");
  }

  const URLS = { opkoeb: "/api/admin/opkoeb", butik: "/api/admin/butik/ordrer", dele: "/api/admin/dele", partnere: "/api/admin/partnere" };
  const OPEN = {
    opkoeb: ["ny", "label_sendt", "modtaget", "godkendt"],
    butik: ["betalt", "dobbelt"],
    dele: ["betalt", "fejl"],
    partnere: ["ny"]
  };

  async function load(name) {
    try {
      state[name] = await api("GET", URLS[name]);
    } catch (error) {
      return;
    }
    setCount(name, state[name].items.filter(function (item) { return OPEN[name].indexOf(item.status) !== -1; }).length);
    paintList(name);
    if (current[name]) paintDetail(name, current[name]);
  }

  // ---------- Lists ----------
  function summary(name, item) {
    if (name === "opkoeb") {
      const units = item.items.reduce(function (sum, line) { return sum + line.qty; }, 0);
      return esc(item.seller.name) + (item.seller.company ? " · " + esc(item.seller.company) : "") + " · " + units + " stk · " + money(Number.isInteger(item.finalDkk) ? item.finalDkk : item.offerDkk);
    }
    if (name === "dele") return esc(item.customer ? item.customer.name : "") + " · " + item.items.length + " del" + (item.items.length === 1 ? "" : "e") + " · " + money(item.paidDkk);
    if (name === "butik") return esc(item.customer ? item.customer.name : "") + " · " + esc(item.title) + " · " + money(item.paidDkk);
    return esc(item.name) + " · " + esc(item.city);
  }

  function haystack(name, item) {
    if (name === "opkoeb") return [item.ref, item.seller.name, item.seller.phone, item.seller.email, item.seller.company].concat(item.items.map(function (line) { return line.modelName + " " + line.imei; })).join(" ");
    if (name === "dele") return [item.ref, item.customer && item.customer.name, item.customer && item.customer.email, item.tracking].concat(item.items.map(function (line) { return line.title; })).join(" ");
    if (name === "butik") return [item.ref, item.listingRef, item.title, item.imei, item.tracking, item.customer && item.customer.name, item.customer && item.customer.email].join(" ");
    return [item.ref, item.name, item.company, item.city, item.phone, item.email].join(" ");
  }

  function paintList(name) {
    const box = document.querySelector("[data-list=\"" + name + "\"]");
    const query = (document.querySelector("[data-search=\"" + name + "\"]").value || "").trim().toLowerCase();
    const data = state[name];
    if (!box || !data) return;
    const rows = data.items.filter(function (item) { return !query || haystack(name, item).toLowerCase().indexOf(query) !== -1; });
    box.innerHTML = rows.length
      ? rows
          .map(function (item) {
            return (
              "<button class=\"sag-button" + (item.ref === current[name] ? " is-current" : "") + "\" type=\"button\" data-open=\"" + esc(item.ref) + "\">" +
              "<strong>" + esc(item.ref) + " · " + esc(data.statuses[item.status] || item.status) + "</strong><span>" + summary(name, item) + "</span>" +
              "<span class=\"muted\" style=\"display:block;font-size:.85rem\">" + esc(when(item.createdAt)) + "</span></button>"
            );
          })
          .join("")
      : "<p>Ingen endnu.</p>";
  }

  document.querySelectorAll("[data-search]").forEach(function (input) {
    input.addEventListener("input", function () { paintList(input.getAttribute("data-search")); });
  });

  document.querySelectorAll("[data-list]").forEach(function (box) {
    box.addEventListener("click", function (event) {
      const button = event.target.closest("[data-open]");
      if (button) paintDetail(box.getAttribute("data-list"), button.getAttribute("data-open"));
    });
  });

  function statusOptions(statuses, selected) {
    return Object.keys(statuses)
      .map(function (key) { return "<option value=\"" + key + "\"" + (key === selected ? " selected" : "") + ">" + esc(statuses[key]) + "</option>"; })
      .join("");
  }

  function notesHtml(item) {
    const notes = (item.notes || []).map(function (note) { return "<li>" + esc(note.text) + " <small class=\"muted\">" + esc(when(note.at)) + "</small></li>"; }).join("");
    const events = (item.events || []).slice().reverse().map(function (entry) { return "<li><time>" + esc(when(entry.at)) + "</time>" + esc(entry.text) + (entry.public ? "" : " <small class=\"muted\">(intern)</small>") + "</li>"; }).join("");
    return (notes ? "<h3>Noter</h3><ul class=\"note-list\">" + notes + "</ul>" : "") + (events ? "<h3>Forløb</h3><ol class=\"timeline\">" + events + "</ol>" : "");
  }

  // ---------- Details ----------
  function answerText(line) {
    const questions = (state.opkoeb && state.opkoeb.questions) || [];
    return Object.keys(line.answers || {})
      .map(function (id) {
        const question = questions.find(function (q) { return q.id === id; });
        if (!question) return "";
        const value = line.answers[id];
        if (Array.isArray(value)) {
          if (!value.length) return "";
          return "Fejl: " + value.map(function (v) { const o = question.options.find(function (x) { return x.id === v; }); return o ? o.label.toLowerCase() : v; }).join(", ");
        }
        const option = question.options.find(function (x) { return x.id === value; });
        return question.label.replace(/\?$/, "") + ": " + (option ? option.label.toLowerCase() : value);
      })
      .filter(Boolean)
      .join(" · ");
  }

  function buyDetail(item) {
    const payout = item.payout.method !== "bank"
      ? "MobilePay: " + esc(item.payout.mobilepay)
      : item.payout.iban ? "IBAN: " + esc(item.payout.iban.replace(/(.{4})/g, "$1 ").trim()) : "Bank: reg. " + esc(item.payout.reg) + " konto " + esc(item.payout.konto);
    const land = item.seller.country || "DK";
    const canShop = ["modtaget", "godkendt", "udbetalt"].indexOf(item.status) !== -1 && !item.inShop;
    const lines = item.items
      .map(function (line, index) {
        const spec = [line.variantLabel, line.storageLabel].filter(Boolean).join(", ");
        const price = line.manual ? "<strong>Pris mangler</strong>" : line.recycle ? "Genbrug (0 kr)" : (line.qty > 1 ? line.qty + " × " : "") + money(line.offerDkk);
        return "<li><strong>" + esc(line.modelName) + "</strong>" + (spec ? " · " + esc(spec) : "") + " · " + price +
          "<small>" + (line.imei ? "IMEI/serie: " + esc(line.imei) : "IMEI ikke oplyst") + "</small><small>" + esc(answerText(line)) + "</small>" +
          (canShop && !line.recycle && !line.manual ? "<small><button class=\"link-button\" type=\"button\" data-to-shop=\"" + index + "\">Læg i butik</button></small>" : "") + "</li>";
      })
      .join("");
    const finalValue = Number.isInteger(item.finalDkk) ? item.finalDkk : "";
    return (
      "<p class=\"chip\">" + esc(item.ref) + "</p><h2>" + esc(item.seller.name) + "</h2>" +
      "<dl class=\"admin-kv\">" +
      (item.seller.company ? "<dt>Firma</dt><dd>" + esc(item.seller.company) + (land === "DK" ? " · CVR " : " · Moms ") + esc(item.seller.cvr) + "</dd>" : "") +
      "<dt>Land</dt><dd>" + esc(land) + (item.lang && item.lang !== "da" ? " · skriver på " + esc(item.lang.toUpperCase()) + " (mails oversættes)" : "") + "</dd>" +
      "<dt>Telefon</dt><dd><a href=\"tel:" + esc(telLink(item.seller.phone)) + "\">" + esc(item.seller.phone) + "</a></dd>" +
      "<dt>E-mail</dt><dd><a href=\"mailto:" + esc(item.seller.email) + "\">" + esc(item.seller.email) + "</a></dd>" +
      "<dt>Adresse</dt><dd>" + esc(item.seller.address) + "</dd>" +
      "<dt>Levering</dt><dd>" + (item.delivery === "post" ? "Sender med post (send fragtlabel" + (land === "DK" ? ")" : " fra " + esc(land) + ", " + money(item.shippingDeductDkk || 0) + " trukket fra)") : "Afleverer selv") + "</dd>" +
      "<dt>Udbetaling</dt><dd>" + payout + "</dd>" +
      "<dt>Gyldigt til</dt><dd>" + esc(new Date(item.validUntil).toLocaleDateString("da-DK")) + "</dd>" +
      "</dl>" +
      "<ul class=\"admin-lines\">" + lines + "</ul>" +
      "<p>Tilbud: <strong>" + money(item.offerDkk) + "</strong>" + (Number.isInteger(item.finalDkk) ? " · Endelig pris: <strong>" + money(item.finalDkk) + "</strong>" : "") + "</p>" +
      (item.note ? "<p><em>Kundens besked:</em> " + esc(item.note) + "</p>" : "") +
      "<form data-editor=\"opkoeb\">" +
      "<label class=\"field\"><span>Endelig pris i kroner (kun hvis den ændres)</span><input name=\"finalDkk\" inputmode=\"numeric\" value=\"" + esc(finalValue) + "\" placeholder=\"" + esc(item.offerDkk) + "\"></label>" +
      "<label class=\"field\"><span>Status</span><select name=\"status\">" + statusOptions(state.opkoeb.statuses, item.status) + "</select></label>" +
      "<label class=\"field\"><span>Besked til kunden</span><textarea name=\"customerMessage\" placeholder=\"Fx: Fragtlabel er vedhæftet i en separat mail.\"></textarea></label>" +
      "<label class=\"check-line\"><input type=\"checkbox\" name=\"notifyCustomer\" checked> Send til kunden på mail og sms</label>" +
      "<label class=\"field\"><span>Intern note</span><textarea name=\"note\" placeholder=\"Fx IMEI tjekket, ikke meldt stjålet.\"></textarea></label>" +
      "<div class=\"quick-actions\"><button class=\"btn\" type=\"submit\">Gem</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"label_sendt\">Label sendt</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"modtaget\">Modtaget</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"nyt_tilbud\">Send nyt tilbud</button>" +
      "<button class=\"btn btn-copper\" type=\"button\" data-set=\"udbetalt\">Udbetalt</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"retur\">Retur</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"afvist\">Afvis</button></div>" +
      "<p class=\"form-error\" data-error hidden></p></form>" +
      notesHtml(item)
    );
  }

  function partDetail(item) {
    const c = item.customer || {};
    const costKnown = item.items.every(function (line) { return Number.isInteger(line.costDkk); });
    const cost = item.items.reduce(function (sum, line) { return sum + (line.costDkk || 0) * line.qty; }, 0);
    const lines = item.items
      .map(function (line) {
        return "<li><strong>" + line.qty + " × " + esc(line.title) + "</strong> · " + money(line.priceDkk * line.qty) +
          "<small>" + (line.cjVid ? "CJ-variant " + esc(line.cjVid) : "Ingen CJ-variant") + (Number.isInteger(line.costDkk) ? " · indkøb " + money(line.costDkk) : "") + "</small>" +
          "<small><a href=\"" + esc(line.supplierUrl) + "\" target=\"_blank\" rel=\"noopener\">Bestil hos leverandør ↗</a></small></li>";
      })
      .join("");
    const address = [c.name, c.line1, c.line2, (c.postal || "") + " " + (c.city || ""), c.country].filter(function (part) { return String(part || "").trim(); }).join("\n");
    const supplier = item.supplier
      ? item.supplier.cjOrderId
        ? "CJ-ordre " + esc(item.supplier.cjOrderId) + " · " + esc(item.supplier.status || "")
        : item.supplier.manualOrder
          ? "Leverandørordre " + esc(item.supplier.manualOrder)
          : item.supplier.error
            ? "<span style=\"color:var(--bad)\">CJ-fejl: " + esc(item.supplier.error) + "</span>"
            : ""
      : "Ikke bestilt endnu";
    return (
      "<p class=\"chip\">" + esc(item.ref) + "</p><h2>" + esc(c.name || "Ukendt kunde") + "</h2>" +
      "<dl class=\"admin-kv\">" +
      "<dt>Telefon</dt><dd><a href=\"tel:" + esc(telLink(c.phone)) + "\">" + esc(c.phone || "") + "</a></dd>" +
      "<dt>E-mail</dt><dd><a href=\"mailto:" + esc(c.email) + "\">" + esc(c.email || "") + "</a></dd>" +
      "<dt>Leveres til</dt><dd style=\"white-space:pre-line\">" + esc(address) + "</dd>" +
      "<dt>Leverandør</dt><dd>" + supplier + "</dd>" +
      (item.tracking ? "<dt>Sporing</dt><dd><a href=\"https://t.17track.net/da#nums=" + encodeURIComponent(item.tracking) + "\" target=\"_blank\" rel=\"noopener\">" + esc(item.tracking) + "</a></dd>" : "") +
      "</dl>" +
      "<p><button class=\"btn btn-ghost btn-small\" type=\"button\" data-copy-text=\"" + esc(address) + "\">Kopiér adresse</button></p>" +
      "<ul class=\"admin-lines\">" + lines + "</ul>" +
      "<p>Betalt: <strong>" + money(item.paidDkk) + "</strong> (heraf fragt " + money(item.shippingDkk) + ")" +
      (costKnown ? " · Indkøb " + money(cost) + " · <strong>Fortjeneste ca. " + money(item.paidDkk - cost) + "</strong>" : "") + "</p>" +
      "<form data-editor=\"dele\">" +
      "<label class=\"field\"><span>Leverandørens ordrenummer</span><input name=\"supplierOrder\" placeholder=\"Fx AliExpress-ordre\"></label>" +
      "<label class=\"field\"><span>Sporingsnummer (kunden får mail og sms)</span><input name=\"tracking\" value=\"" + esc(item.tracking || "") + "\"></label>" +
      "<label class=\"field\"><span>Status</span><select name=\"status\">" + statusOptions(state.dele.statuses, item.status) + "</select></label>" +
      "<label class=\"field\"><span>Intern note</span><textarea name=\"note\"></textarea></label>" +
      "<div class=\"quick-actions\"><button class=\"btn\" type=\"submit\">Gem</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"bestilt\">Bestilt</button>" +
      (state.dele.cjEnabled ? "<button class=\"btn btn-copper\" type=\"button\" data-cj>Send til CJ</button>" : "") +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"leveret\">Leveret</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"refunderet\">Refunderet</button></div>" +
      "<p class=\"form-error\" data-error hidden></p></form>" +
      notesHtml(item)
    );
  }

  function shopDetail(item) {
    const c = item.customer || {};
    const address = [c.name, c.line1, c.line2, (c.postal || "") + " " + (c.city || ""), c.country].filter(function (part) { return String(part || "").trim(); }).join("\n");
    return (
      "<p class=\"chip\">" + esc(item.ref) + "</p><h2>" + esc(c.name || "Ukendt kunde") + "</h2>" +
      "<dl class=\"admin-kv\">" +
      "<dt>Enhed</dt><dd>" + esc(item.title) + " · <a href=\"/koeb/" + esc(item.listingRef) + "\" target=\"_blank\" rel=\"noopener\">" + esc(item.listingRef) + "</a></dd>" +
      (item.imei ? "<dt>IMEI/serie</dt><dd>" + esc(item.imei) + "</dd>" : "") +
      "<dt>Telefon</dt><dd><a href=\"tel:" + esc(telLink(c.phone)) + "\">" + esc(c.phone || "") + "</a></dd>" +
      "<dt>E-mail</dt><dd><a href=\"mailto:" + esc(c.email) + "\">" + esc(c.email || "") + "</a></dd>" +
      "<dt>Leveres til</dt><dd style=\"white-space:pre-line\">" + esc(address) + "</dd>" +
      (item.tracking ? "<dt>Sporing</dt><dd><a href=\"https://t.17track.net/da#nums=" + encodeURIComponent(item.tracking) + "\" target=\"_blank\" rel=\"noopener\">" + esc(item.tracking) + "</a></dd>" : "") +
      "</dl>" +
      "<p><button class=\"btn btn-ghost btn-small\" type=\"button\" data-copy-text=\"" + esc(address) + "\">Kopiér adresse</button></p>" +
      "<p>Betalt: <strong>" + money(item.paidDkk) + "</strong>" +
      (Number.isInteger(item.costDkk) ? " · Indkøb " + money(item.costDkk) + " · <strong>Fortjeneste før moms og annoncer ca. " + money(item.paidDkk - item.costDkk) + "</strong>" : "") + "</p>" +
      (item.status === "dobbelt" ? "<p class=\"form-error\">Enheden var allerede solgt til en anden. Refundér betalingen i Stripe, og skriv til kunden.</p>" : "") +
      "<form data-editor=\"butik\">" +
      "<label class=\"field\"><span>Sporingsnummer (kunden får mail og sms)</span><input name=\"tracking\" value=\"" + esc(item.tracking || "") + "\"></label>" +
      "<label class=\"field\"><span>Status</span><select name=\"status\">" + statusOptions(state.butik.statuses, item.status) + "</select></label>" +
      "<label class=\"field\"><span>Intern note</span><textarea name=\"note\"></textarea></label>" +
      "<div class=\"quick-actions\"><button class=\"btn\" type=\"submit\">Gem</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"leveret\">Leveret</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"returneret\">Returneret</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"refunderet\">Refunderet</button></div>" +
      "<p class=\"form-error\" data-error hidden></p></form>" +
      notesHtml(item)
    );
  }

  function partnerDetail(item) {
    const skills = (item.skills || []).map(function (skill) { return state.partnere.skills[skill] || skill; }).join(", ");
    return (
      "<p class=\"chip\">" + esc(item.ref) + "</p><h2>" + esc(item.name) + "</h2>" +
      "<dl class=\"admin-kv\">" +
      (item.company ? "<dt>Firma</dt><dd>" + esc(item.company) + (item.cvr ? " · CVR " + esc(item.cvr) : "") + "</dd>" : "") +
      "<dt>Telefon</dt><dd><a href=\"tel:" + esc(telLink(item.phone)) + "\">" + esc(item.phone) + "</a></dd>" +
      "<dt>E-mail</dt><dd><a href=\"mailto:" + esc(item.email) + "\">" + esc(item.email) + "</a></dd>" +
      "<dt>Område</dt><dd>" + esc(item.city) + " · " + esc(item.radiusKm) + " km</dd>" +
      "<dt>Reparerer</dt><dd>" + esc(skills) + "</dd>" +
      "<dt>Erfaring</dt><dd>" + esc(item.experience) + (item.workshop ? " · eget værksted" : "") + "</dd>" +
      "</dl>" +
      (item.message ? "<p>" + esc(item.message) + "</p>" : "") +
      "<form data-editor=\"partnere\">" +
      "<label class=\"field\"><span>Status</span><select name=\"status\">" + statusOptions(state.partnere.statuses, item.status) + "</select></label>" +
      "<label class=\"field\"><span>Intern note</span><textarea name=\"note\" placeholder=\"Fx ringet op, god erfaring med iPhone-skærme.\"></textarea></label>" +
      "<div class=\"quick-actions\"><button class=\"btn\" type=\"submit\">Gem</button>" +
      "<button class=\"btn btn-copper\" type=\"button\" data-set=\"godkendt\">Godkend</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"afvist\">Afvis</button></div>" +
      "<p class=\"form-error\" data-error hidden></p></form>" +
      notesHtml(item)
    );
  }

  const DETAIL = { opkoeb: buyDetail, butik: shopDetail, dele: partDetail, partnere: partnerDetail };
  const PATCH = { opkoeb: "/api/admin/opkoeb/", butik: "/api/admin/butik/ordrer/", dele: "/api/admin/dele/", partnere: "/api/admin/partnere/" };

  function paintDetail(name, ref) {
    const box = document.querySelector("[data-detail=\"" + name + "\"]");
    const item = state[name] && state[name].items.find(function (entry) { return entry.ref === ref; });
    current[name] = ref;
    paintList(name);
    if (!item) {
      box.innerHTML = "<p>Vælg i listen.</p>";
      return;
    }
    box.innerHTML = DETAIL[name](item);
  }

  function payloadFor(name, form, status) {
    const f = form.elements;
    if (name === "opkoeb") {
      const raw = f.finalDkk.value.trim();
      const payload = { status: status || f.status.value, note: f.note.value, customerMessage: f.customerMessage.value, notifyCustomer: f.notifyCustomer.checked };
      if (raw === "") payload.finalDkk = null;
      else {
        const value = parseKr(raw);
        if (!Number.isInteger(value)) throw new Error("Skriv prisen i hele kroner.");
        payload.finalDkk = value;
      }
      if (payload.status === "nyt_tilbud" && payload.finalDkk === null) throw new Error("Skriv den nye pris først.");
      return payload;
    }
    if (name === "dele") return { status: status || f.status.value, tracking: f.tracking.value, supplierOrder: f.supplierOrder.value, note: f.note.value };
    if (name === "butik") return { status: status || f.status.value, tracking: f.tracking.value, note: f.note.value };
    return { status: status || f.status.value, note: f.note.value };
  }

  async function saveDetail(name, form, status) {
    const error = form.querySelector("[data-error]");
    error.hidden = true;
    try {
      await api("PATCH", PATCH[name] + encodeURIComponent(current[name]), payloadFor(name, form, status));
      await load(name);
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
    }
  }

  document.querySelectorAll("[data-detail]").forEach(function (box) {
    const name = box.getAttribute("data-detail");
    box.addEventListener("submit", function (event) {
      event.preventDefault();
      saveDetail(name, event.target);
    });
    box.addEventListener("click", async function (event) {
      const set = event.target.closest("[data-set]");
      const form = box.querySelector("form");
      if (set && form) saveDetail(name, form, set.getAttribute("data-set"));
      const toShop = event.target.closest("[data-to-shop]");
      if (toShop && name === "opkoeb") {
        const buy = state.opkoeb.items.find(function (entry) { return entry.ref === current.opkoeb; });
        const line = buy && buy.items[Number(toShop.getAttribute("data-to-shop"))];
        if (line) {
          const paid = Number.isInteger(buy.finalDkk) && buy.items.length === 1 ? Math.round(buy.finalDkk / line.qty) : line.offerDkk;
          showTab("butik");
          document.dispatchEvent(new CustomEvent("shop:new", {
            detail: { modelId: line.modelId, variant: line.variant, storage: line.storage, conn: line.conn || "", imei: line.imei, buybackRef: buy.ref, costDkk: paid }
          }));
        }
      }
      const copy = event.target.closest("[data-copy-text]");
      if (copy) {
        navigator.clipboard.writeText(copy.getAttribute("data-copy-text")).then(function () { copy.textContent = "Kopieret"; });
      }
      if (event.target.closest("[data-cj]") && form) {
        const error = form.querySelector("[data-error]");
        try {
          await api("POST", "/api/admin/dele/" + encodeURIComponent(current.dele) + "/cj");
          await load("dele");
        } catch (err) {
          error.hidden = false;
          error.textContent = err.message;
        }
      }
    });
  });

  // ---------- Buyback prices ----------
  const buyBox = document.querySelector("#buy-prices");

  async function loadBuyPrices() {
    try {
      buyPrices = await api("GET", "/api/admin/opkoeb-priser");
    } catch (error) {
      return;
    }
    paintBuyPrices();
  }

  function paintBuyPrices(message) {
    const s = buyPrices.strategy;
    const groups = {};
    buyPrices.values.forEach(function (row) { (groups[row.group] = groups[row.group] || []).push(row); });
    const head = "<tr><th></th><td class=\"muted\">Refurbed sælger for</td><td class=\"muted\">Vores salgspris</td><td class=\"muted\">Refurbed byder</td><td class=\"muted\">Vi byder</td><td class=\"muted\">Du tjener</td></tr>";
    function priceRow(name, attr, key, row) {
      const auto = row.refSale && row.effectiveValue !== row.value;
      return "<tr><th>" + esc(name) + "</th>" +
        "<td><input class=\"price-input\" data-refsale=\"" + esc(key) + "\" inputmode=\"numeric\" placeholder=\"–\" value=\"" + (row.refSale || "") + "\"></td>" +
        "<td><input class=\"price-input\" " + attr + "=\"" + esc(key) + "\" inputmode=\"numeric\" value=\"" + row.value + "\"" + (row.refSale ? " disabled title=\"Sættes automatisk ud fra Refurbeds pris\"" : "") + ">" +
        (auto ? "<small>Bruger " + money(row.effectiveValue) + "</small>" : "") + "</td>" +
        "<td><input class=\"price-input\" data-ref=\"" + esc(key) + "\" inputmode=\"numeric\" placeholder=\"–\" value=\"" + (row.ref || "") + "\"></td>" +
        "<td>" + (row.offerDkk === null ? "–" : money(row.offerDkk)) + (row.capped && row.ref ? " <span class=\"muted\" title=\"Kan ikke slå Refurbed uden at gå under mindste fortjeneste\">(loft)</span>" : "") + "</td>" +
        "<td>" + (row.profitDkk === null ? "–" : money(row.profitDkk)) + "</td></tr>";
    }
    const tables = Object.keys(groups)
      .map(function (group) {
        return "<h3>" + esc(group) + "</h3><div class=\"table-wrap\"><table class=\"price-table price-admin\"><tbody>" + head +
          groups[group].map(function (row) { return priceRow(row.name, "data-value", row.id, row); }).join("") +
          "</tbody></table></div>";
      })
      .join("");
    const variants = Object.keys(buyPrices.variants)
      .map(function (modelId) {
        return buyPrices.variants[modelId].map(function (variant) {
          return priceRow((variant.modelName || modelId) + " · " + variant.label, "data-variant", modelId + ":" + variant.id, variant);
        }).join("");
      })
      .join("");
    buyBox.innerHTML =
      "<summary>Opkøbspriser og avance</summary>" +
      "<p>" + esc(buyPrices.note) + " Sidst ændret " + esc(buyPrices.updated) + ".</p>" +
      "<p class=\"muted\">Skriv hvad Refurbed sælger den billigste udgave for i perfekt stand. Så bliver vores salgspris automatisk <em>sælg under Refurbed med %</em> lavere, rundet ned til 49 eller 99. Den pris bruges både i butikken og til at regne opkøbsprisen.</p>" +
      "<p class=\"muted\">Tilbud = <em>bud i %</em> af salgsværdien (efter brugsspor og reparationer), men aldrig mere end at du tjener mindst <em>mindste fortjeneste</em>: <em>fortjeneste i %</em> af salgsværdien, dog mindst <em>bundgrænse</em> og højst <em>mindste fortjeneste (kr)</em>. " +
      "Har du skrevet hvad Refurbed byder (perfekt stand, billigste udgave, kun Wi-Fi), byder vi <em>slå Refurbed med %</em> mere, mindst 50 kr., så længe du stadig tjener mindst <em>bundgrænsen</em>. Ellers giver vi det normale tilbud, og der står (loft). " +
      "Det er efter brugtmoms, salgsgebyr, Google-annoncer, garanti, håndtering (fragt, sletning, rengøring) og reparation. Ødelagte dele koster <em>andel af reparationspris</em> × din egen reparationspris.</p>" +
      "<form id=\"buy-strategy\" class=\"actions\" style=\"align-items:end\">" +
      field("offerPct", "Bud i % af salgsværdi", s.offerPct) +
      field("beatPct", "Slå Refurbed med %", s.beatPct || 0) +
      field("shopBeatPct", "Sælg under Refurbed med %", s.shopBeatPct || 0) +
      field("minProfitPct", "Fortjeneste i % af salgsværdi", s.minProfitPct || 0) +
      field("minProfitFloorDkk", "Bundgrænse fortjeneste (kr)", s.minProfitFloorDkk || 0) +
      field("minProfitDkk", "Mindste fortjeneste (kr)", s.minProfitDkk) +
      field("adsPct", "Google-annoncer i % af salg", s.adsPct || 0) +
      field("warrantyPct", "Garanti/reklamation i %", s.warrantyPct || 0) +
      field("handlingDkk", "Håndtering pr. enhed (kr)", s.handlingDkk) +
      field("salesFeePct", "Salgsgebyr i %", s.salesFeePct) +
      field("usedVatShare", "Brugtmoms (andel af avance)", s.usedVatShare) +
      field("repairCostShare", "Andel af reparationspris", s.repairCostShare) +
      field("deadFactor", "Død enhed: andel af værdi", s.deadFactor) +
      field("minOfferDkk", "Laveste bud (kr)", s.minOfferDkk) +
      field("validDays", "Tilbud gælder (dage)", s.validDays) +
      field("euShippingDkk", "Fragt fra EU, trækkes fra (kr)", s.euShippingDkk || 0) +
      "<button class=\"btn\" type=\"submit\">Gem</button></form>" +
      (message ? "<p class=\"form-ok\">" + esc(message) + "</p>" : "") +
      "<p class=\"form-error\" id=\"buy-error\" hidden></p>" +
      "<p class=\"muted\">Vores salgspris = hvad du kan sælge enheden for i din egen butik i perfekt stand (128 GB, computer 256 GB). Står der hvad Refurbed sælger for, sættes den automatisk ud fra deres billigste udgave og kan ikke ændres her.</p>" +
      tables +
      "<h3>iPad, MacBook og iMac efter generation</h3><div class=\"table-wrap\"><table class=\"price-table price-admin\"><tbody>" + head + variants + "</tbody></table></div>" +
      "<p><button class=\"btn\" type=\"button\" id=\"save-buy-values\">Gem værdier</button></p>";
    buyBox.open = Boolean(message) || buyBox.open;
  }

  function field(name, label, value) {
    return "<label class=\"field\" style=\"margin:0\"><span>" + esc(label) + "</span><input name=\"" + name + "\" inputmode=\"decimal\" value=\"" + esc(value) + "\" style=\"width:8rem\"></label>";
  }

  async function saveBuy(payload) {
    try {
      buyPrices = await api("PUT", "/api/admin/opkoeb-priser", payload);
      paintBuyPrices("Gemt. Nye tilbud bruger tallene med det samme.");
    } catch (error) {
      const box = document.querySelector("#buy-error");
      box.hidden = false;
      box.textContent = error.message;
    }
  }

  buyBox.addEventListener("submit", function (event) {
    if (event.target.id !== "buy-strategy") return;
    event.preventDefault();
    const strategy = {};
    Array.prototype.forEach.call(event.target.elements, function (input) {
      if (input.name) strategy[input.name] = input.value;
    });
    saveBuy({ strategy: strategy });
  });

  buyBox.addEventListener("click", function (event) {
    if (event.target.id !== "save-buy-values") return;
    const payload = { values: {}, variants: {}, refs: {}, refSales: {} };
    function rowOf(key) {
      const parts = key.split(":");
      return parts[1]
        ? buyPrices.variants[parts[0]].find(function (entry) { return entry.id === parts[1]; })
        : buyPrices.values.find(function (entry) { return entry.id === key; });
    }
    buyBox.querySelectorAll("[data-ref]").forEach(function (input) {
      const key = input.getAttribute("data-ref");
      const row = rowOf(key);
      const value = input.value.trim() ? parseKr(input.value) : 0;
      if (row && value !== (row.ref || 0)) payload.refs[key] = value;
    });
    buyBox.querySelectorAll("[data-refsale]").forEach(function (input) {
      const key = input.getAttribute("data-refsale");
      const row = rowOf(key);
      const value = input.value.trim() ? parseKr(input.value) : 0;
      if (row && value !== (row.refSale || 0)) payload.refSales[key] = value;
    });
    buyBox.querySelectorAll("[data-value]").forEach(function (input) {
      const id = input.getAttribute("data-value");
      const row = buyPrices.values.find(function (entry) { return entry.id === id; });
      const value = parseKr(input.value);
      if (row && value !== row.value) payload.values[id] = value;
    });
    buyBox.querySelectorAll("[data-variant]").forEach(function (input) {
      const key = input.getAttribute("data-variant").split(":");
      const variant = buyPrices.variants[key[0]].find(function (entry) { return entry.id === key[1]; });
      const value = parseKr(input.value);
      if (variant && value !== variant.value) payload.variants[key.join(":")] = value;
    });
    saveBuy(payload);
  });

  // ---------- Part prices ----------
  const partBox = document.querySelector("#part-prices");

  async function loadPartPrices() {
    try {
      partPrices = await api("GET", "/api/admin/dele-priser");
    } catch (error) {
      return;
    }
    paintPartPrices();
  }

  function paintPartPrices(message) {
    const models = [];
    partPrices.parts.forEach(function (part) {
      if (!models.some(function (m) { return m.id === part.modelId; })) models.push({ id: part.modelId, name: part.modelName });
    });
    if (!partFilter && models[0]) partFilter = models[0].id;
    const s = partPrices.strategy;
    const sum = partPrices.summary;
    const flagged = function (part) { return part.flag === "dyrere end markedet" || part.flag === "under bundpris"; };
    const rows = partPrices.parts
      .filter(function (part) {
        if (partFilter === "__flag") return flagged(part);
        if (partFilter === "__suggest") return !part.cjVid && part.cjSuggest && part.cjSuggest.variants && part.cjSuggest.variants.length;
        return part.modelId === partFilter;
      })
      .map(function (part) {
        const flag = part.flag
          ? "<small style=\"color:" + (flagged(part) ? "var(--bad)" : "var(--muted, #777)") + "\">" + esc(part.flag) + "</small>"
          : "";
        const cjCost = part.costSource === "cj" ? " · CJ " + money(part.costDkk) : "";
        const profit = " · fortjeneste " + (part.costSource === "guess" ? "ca. " : "") + money(part.profitDkk);
        const linked = part.colors.length ? part.colors.every(function (color) { return part.cjVids[color]; }) : Boolean(part.cjVid);
        const suggest = !linked && part.cjSuggest && part.cjSuggest.variants && part.cjSuggest.variants.length
          ? "<small>Forslag: " + esc(part.cjSuggest.name) + "</small>" +
            part.cjSuggest.variants.map(function (v) {
              return "<button class=\"btn btn-ghost\" type=\"button\" style=\"padding:.15rem .5rem;font-size:.8rem;margin:.1rem\" data-use-vid=\"" + esc(v.vid) + "\">" +
                esc(v.name || "Variant") + " · $" + v.priceUsd.toFixed(2) + "</button>";
            }).join("")
          : part.cj
            ? "<small>CJ $" + Number(part.cj.priceUsd).toFixed(2) + (part.cj.shipUsd != null ? " + fragt $" + Number(part.cj.shipUsd).toFixed(2) : "") + " · lager " + part.cj.stock + "</small>"
            : "";
        return "<tr data-part=\"" + esc(part.id) + "\"><th>" + esc(part.label) + (partFilter.indexOf("__") === 0 ? " · " + esc(part.modelName) : "") +
          "<small>Reparation " + money(part.repairPriceDkk) + "</small>" + flag + "</th>" +
          "<td><input class=\"price-input\" data-k=\"marketDkk\" inputmode=\"numeric\" placeholder=\"" + part.autoMarketDkk + "\" value=\"" + (part.ownMarket ? part.marketDkk : "") + "\"><small>Markedspris</small></td>" +
          "<td><input class=\"price-input\" data-k=\"costDkk\" inputmode=\"numeric\"" + (part.guessCostDkk ? " placeholder=\"ca. " + part.guessCostDkk + "\"" : "") + " value=\"" + (part.ownCostDkk == null ? "" : part.ownCostDkk) + "\"><small>Indkøb u. moms" + cjCost + "</small></td>" +
          "<td><input class=\"price-input\" data-k=\"priceDkk\" inputmode=\"numeric\" placeholder=\"" + part.autoPriceDkk + "\" value=\"" + (part.ownPrice ? part.priceDkk : "") + "\"><small>Salgspris " + money(part.priceDkk) + profit + "</small></td>" +
          "<td>" + (part.colors.length
            ? "<input type=\"hidden\" data-k=\"cjVid\" value=\"" + esc(part.cjVid) + "\">" +
              part.colors.map(function (color) {
                return "<input class=\"price-input\" data-color-vid=\"" + esc(color) + "\" style=\"width:10rem;margin-bottom:2px\" placeholder=\"" + esc(color) + "\" title=\"" + esc(color) + "\" value=\"" + esc(part.cjVids[color] || "") + "\">";
              }).join("") +
              "<small>CJ-variant pr. farve (klik i feltet, så på forslaget)</small>"
            : "<input class=\"price-input\" data-k=\"cjVid\" style=\"width:10rem\" value=\"" + esc(part.cjVid) + "\"><small>CJ-variant (vid)</small>") +
            suggest + "</td>" +
          "<td><input class=\"price-input\" data-k=\"supplierUrl\" style=\"width:14rem\" value=\"" + esc(part.supplierUrl) + "\"><small><a href=\"" + esc(part.supplierUrl) + "\" target=\"_blank\" rel=\"noopener\">Åbn ↗</a></small></td>" +
          "<td><label class=\"check-line\" style=\"margin:0\"><input type=\"checkbox\" data-k=\"off\"" + (part.off ? " checked" : "") + "> Skjul</label></td></tr>";
      })
      .join("");
    const sync = partPrices.sync;
    partBox.innerHTML =
      "<summary>Reservedele: priser, indkøb og leverandør</summary>" +
      "<p>CJ-bestilling: <strong>" + (partPrices.cjEnabled ? "slået til. Dele med CJ-variant bestilles automatisk efter betaling." : "ikke slået til. Læg CJ_API_KEY i .env. Indtil da får du en notifikation med link, og bestiller selv.") + "</strong></p>" +
      "<p class=\"muted\">Prisen sættes selv: markedspris × " + Math.round(s.undercut * 100) + " %, men aldrig så lavt at du tjener under " + money(s.minProfitDkk) +
      " efter moms og kortgebyr. Kender systemet ikke indkøbsprisen, regner det forsigtigt med " + Math.round(s.assumedCostShare * 100) + " % af markedsprisen, til du skriver den rigtige. CJ-priser og valutakurs opdateres hver nat.</p>" +
      "<p><strong>" + sum.total + "</strong> dele · " + sum.withCost + " med indkøbspris · " + sum.withCj + " koblet til CJ · " +
      "<span style=\"color:" + (sum.overMarket ? "var(--bad)" : "inherit") + "\">" + sum.overMarket + " dyrere end markedet</span>" +
      (sum.underFloor ? " · <span style=\"color:var(--bad)\">" + sum.underFloor + " under bundpris</span>" : "") +
      " · 1 USD = " + String(partPrices.usdDkk).replace(".", ",") + " kr" +
      (sync && sync.finished ? " · sidst opdateret " + esc(when(sync.finished)) : "") +
      (partPrices.cjEnabled ? " <button class=\"btn btn-ghost\" type=\"button\" id=\"run-part-sync\"" + (partPrices.syncRunning ? " disabled" : "") + ">" + (partPrices.syncRunning ? "Opdaterer…" : "Opdatér fra CJ nu") + "</button>" : "") +
      "</p>" +
      "<form id=\"part-strategy\" class=\"actions\" style=\"align-items:end\">" +
      field("undercutPct", "Pris i % af markedet", Math.round(s.undercut * 100)) +
      field("minProfitDkk", "Mindste fortjeneste (kr)", s.minProfitDkk) +
      field("shippingDkk", "Fragt i DK (kr)", s.shippingDkk) +
      field("shippingEuDkk", "Fragt resten af EU (kr)", s.shippingEuDkk) +
      "<button class=\"btn\" type=\"submit\">Gem</button></form>" +
      (message ? "<p class=\"form-ok\">" + esc(message) + "</p>" : "") +
      "<p class=\"form-error\" id=\"part-error\" hidden></p>" +
      "<label class=\"field\" style=\"max-width:22rem\"><span>Vis</span><select id=\"part-filter\">" +
      "<option value=\"__flag\"" + (partFilter === "__flag" ? " selected" : "") + ">Dele med advarsel (" + (sum.overMarket + sum.underFloor) + ")</option>" +
      "<option value=\"__suggest\"" + (partFilter === "__suggest" ? " selected" : "") + ">Dele med CJ-forslag (" + sum.suggestions + ")</option>" +
      models.map(function (m) { return "<option value=\"" + esc(m.id) + "\"" + (m.id === partFilter ? " selected" : "") + ">" + esc(m.name) + "</option>"; }).join("") +
      "</select></label>" +
      "<p class=\"muted\">Tomme felter = automatisk (det grå tal). Markedspris = hvad danske butikker typisk tager. Indkøb = hvad du betaler uden moms. Salgspris låser prisen, så den ikke følger med automatisk.</p>" +
      "<div class=\"table-wrap\"><table class=\"price-table price-admin\"><tbody>" + (rows || "<tr><td>Ingen dele her.</td></tr>") + "</tbody></table></div>" +
      "<p><button class=\"btn\" type=\"button\" id=\"save-parts\">Gem dele</button></p>";
    partBox.open = Boolean(message) || partBox.open;
  }

  async function saveParts(payload) {
    try {
      const result = await api("PUT", "/api/admin/dele-priser", payload);
      partPrices = result;
      paintPartPrices("Gemt.");
    } catch (error) {
      const box = document.querySelector("#part-error");
      box.hidden = false;
      box.textContent = error.message;
    }
  }

  partBox.addEventListener("change", function (event) {
    if (event.target.id === "part-filter") {
      partFilter = event.target.value;
      paintPartPrices();
    }
  });

  partBox.addEventListener("submit", function (event) {
    if (event.target.id !== "part-strategy") return;
    event.preventDefault();
    saveParts({
      strategy: {
        undercutPct: event.target.elements.undercutPct.value,
        minProfitDkk: parseKr(event.target.elements.minProfitDkk.value),
        shippingDkk: parseKr(event.target.elements.shippingDkk.value),
        shippingEuDkk: parseKr(event.target.elements.shippingEuDkk.value)
      }
    });
  });

  let lastVidInput = null;
  partBox.addEventListener("focusin", function (event) {
    if (event.target.hasAttribute("data-color-vid")) lastVidInput = event.target;
  });

  partBox.addEventListener("click", async function (event) {
    const useVid = event.target.getAttribute("data-use-vid");
    if (useVid) {
      const row = event.target.closest("tr");
      const colorInputs = row.querySelectorAll("[data-color-vid]");
      const target = colorInputs.length
        ? lastVidInput && row.contains(lastVidInput) ? lastVidInput : Array.prototype.find.call(colorInputs, function (input) { return !input.value; }) || colorInputs[0]
        : row.querySelector("[data-k=\"cjVid\"]");
      target.value = useVid;
      return;
    }
    if (event.target.id === "run-part-sync") {
      event.target.disabled = true;
      event.target.textContent = "Opdaterer…";
      try {
        await api("POST", "/api/admin/dele-sync", {});
      } catch (error) {
        return;
      }
      setTimeout(loadPartPrices, 20000);
      return;
    }
    if (event.target.id !== "save-parts") return;
    const items = {};
    partBox.querySelectorAll("[data-part]").forEach(function (row) {
      const id = row.getAttribute("data-part");
      const part = partPrices.parts.find(function (p) { return p.id === id; });
      const get = function (key) { return row.querySelector("[data-k=\"" + key + "\"]"); };
      const read = function (key) {
        const raw = get(key).value.trim();
        return raw === "" ? null : parseKr(raw);
      };
      const cjVids = {};
      row.querySelectorAll("[data-color-vid]").forEach(function (input) {
        if (input.value.trim()) cjVids[input.getAttribute("data-color-vid")] = input.value.trim();
      });
      const next = {
        cjVids: cjVids,
        marketDkk: read("marketDkk"),
        costDkk: read("costDkk"),
        priceDkk: read("priceDkk"),
        cjVid: get("cjVid").value.trim(),
        supplierUrl: get("supplierUrl").value.trim(),
        off: get("off").checked
      };
      const changed =
        JSON.stringify(next.cjVids) !== JSON.stringify(part.cjVids) ||
        next.marketDkk !== (part.ownMarket ? part.marketDkk : null) ||
        next.costDkk !== part.ownCostDkk ||
        next.priceDkk !== (part.ownPrice ? part.priceDkk : null) ||
        next.cjVid !== part.cjVid ||
        next.supplierUrl !== part.supplierUrl ||
        next.off !== part.off;
      if (changed) items[id] = next;
    });
    saveParts({ items: items });
  });

  // ---------- Start ----------
  document.addEventListener("admin:ready", function () {
    load("opkoeb");
    load("dele");
    load("partnere");
    loadBuyPrices();
    loadPartPrices();
    const hash = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    const prefix = { SL: "opkoeb", RD: "dele", RP: "partnere" }[hash.slice(0, 2)];
    if (prefix) {
      current[prefix] = hash;
      showTab(prefix);
    }
  });
})();
