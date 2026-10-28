(function () {
  const login = document.querySelector("#login");
  const desk = document.querySelector("#desk");
  const loginError = document.querySelector("#login-error");
  const list = document.querySelector("#sag-list");
  const detail = document.querySelector("#sag-detail");
  const count = document.querySelector("#sag-count");
  const search = document.querySelector("#search");
  if (!login || !desk) return;

  const labels = window.FixLabels;
  let items = [];
  let currentRef = "";

  function phoneLink(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.indexOf("45") === 0) return "+" + digits;
    if (digits.length === 8) return "+45" + digits;
    return digits;
  }

  function parseKr(raw) {
    const trimmed = String(raw || "").trim();
    if (/^\d{1,3}(\.\d{3})+$/.test(trimmed)) return Number(trimmed.replace(/\./g, ""));
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    return NaN;
  }

  function kroner(amount) {
    if (amount === null || amount === undefined) return "Ikke sat";
    return new Intl.NumberFormat("da-DK").format(amount) + " kr";
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function showLogin() {
    login.hidden = false;
    desk.hidden = true;
  }

  function showDesk() {
    login.hidden = true;
    const first = desk.hidden;
    desk.hidden = false;
    if (first) document.dispatchEvent(new Event("admin:ready"));
  }

  async function load() {
    const response = await fetch("/api/admin/sager");
    if (response.status === 401) {
      showLogin();
      return;
    }
    items = await response.json();
    showDesk();
    paintList();
    const linked = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    if (linked && items.some(function (entry) { return entry.ref === linked; })) currentRef = linked;
    if (currentRef) paintDetail(currentRef);
    if (!prices) loadPrices();
  }

  window.addEventListener("hashchange", function () {
    const linked = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    if (items.some(function (entry) { return entry.ref === linked; })) paintDetail(linked);
  });

  const priceBox = document.querySelector("#price-admin");
  let prices = null;
  let priceMode = "mine";

  async function loadPrices() {
    const response = await fetch("/api/admin/priser");
    if (!response.ok) return;
    prices = await response.json();
    paintPrices();
  }

  function paintPrices(message) {
    if (!priceBox || !prices) return;
    const groups = prices.groups
      .map(function (group) {
        const models = prices.models.filter(function (model) { return model.group === group.id; });
        const repairIds = Object.keys(prices.repairs[group.device]).filter(function (id) {
          return models.some(function (model) { return model.cells[id]; });
        });
        const head = repairIds.map(function (id) { return "<th>" + esc(prices.repairs[group.device][id].label) + "</th>"; }).join("");
        const rows = models
          .map(function (model) {
            const cells = repairIds
              .map(function (id) {
                const cell = model.cells[id];
                if (!cell) return "<td>–</td>";
                const key = model.id + ":" + id;
                if (priceMode === "marked") {
                  return "<td><input class=\"price-input\" data-market=\"" + esc(key) + "\" inputmode=\"numeric\" value=\"" + cell.market + "\"><small>Din pris " + kroner(cell.price) + "</small></td>";
                }
                return (
                  "<td><input class=\"price-input" + (cell.override ? " is-own" : "") + "\" data-own=\"" + esc(key) + "\" inputmode=\"numeric\" placeholder=\"" + cell.auto + "\" value=\"" + (cell.override ? cell.price : "") + "\">" +
                  "<small>Marked " + kroner(cell.market) + "</small></td>"
                );
              })
              .join("");
            return "<tr><th>" + esc(model.name) + "</th>" + cells + "</tr>";
          })
          .join("");
        return "<h3>" + esc(group.name) + "</h3><div class=\"table-wrap\"><table class=\"price-table price-admin\"><thead><tr><th>Model</th>" + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>";
      })
      .join("");
    priceBox.innerHTML =
      "<summary>Priser og konkurrence</summary>" +
      "<p>Dine priser bliver regnet automatisk ud fra markedsprisen i Aalborg og på nettet. Markedspriser sidst opdateret " + esc(prices.marketUpdated) + ". Kilder: " + esc(prices.marketSources.join(", ")) + ".</p>" +
      "<form id=\"strategy\" class=\"actions\" style=\"align-items: end\">" +
      "<label class=\"field\" style=\"margin: 0\"><span>Procent under markedet</span><input name=\"undercutPercent\" inputmode=\"decimal\" value=\"" + prices.strategy.undercutPercent + "\"></label>" +
      "<label class=\"field\" style=\"margin: 0\"><span>Mindstepris</span><input name=\"minPrice\" inputmode=\"numeric\" value=\"" + prices.strategy.minPrice + "\"></label>" +
      "<button class=\"btn\" type=\"submit\">Gem og regn priser om</button></form>" +
      "<p>Kortbetaling (kort, MobilePay, Klarna): <strong>" + (prices.cardEnabled ? "slået til" : "ikke slået til endnu") + "</strong></p>" +
      "<div class=\"actions\"><button class=\"btn " + (priceMode === "mine" ? "" : "btn-ghost") + "\" type=\"button\" data-mode=\"mine\">Mine priser</button>" +
      "<button class=\"btn " + (priceMode === "marked" ? "" : "btn-ghost") + "\" type=\"button\" data-mode=\"marked\">Markedspriser</button></div>" +
      "<p class=\"muted\">" +
      (priceMode === "mine"
        ? "Tomt felt betyder automatisk pris (det grå tal). Skriv et tal for at sætte din egen pris. Slet tallet for at gå tilbage til automatisk."
        : "Skriv hvad konkurrenterne tager. Din pris bliver regnet ud, når du gemmer.") +
      "</p>" +
      (message ? "<p class=\"form-ok\">" + esc(message) + "</p>" : "") +
      "<p id=\"price-error\" class=\"form-error\" hidden></p>" +
      groups +
      "<p><button class=\"btn\" type=\"button\" id=\"save-prices\">Gem priser</button></p>";
    priceBox.open = true;
  }

  async function savePrices(payload) {
    const response = await fetch("/api/admin/priser", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const box = document.querySelector("#price-error");
      box.hidden = false;
      box.textContent = body.message || "Priserne blev ikke gemt.";
      return;
    }
    prices = body;
    paintPrices("Gemt. Priserne på hjemmesiden er opdateret.");
  }

  if (priceBox) {
    priceBox.addEventListener("click", function (event) {
      const mode = event.target.closest("[data-mode]");
      if (mode) {
        priceMode = mode.getAttribute("data-mode");
        paintPrices();
        return;
      }
      if (event.target.id === "save-prices") {
        const payload = { overrides: {}, market: {} };
        priceBox.querySelectorAll("[data-own]").forEach(function (input) {
          const key = input.getAttribute("data-own");
          const cell = findCell(key);
          const raw = input.value.trim();
          if (raw === "" && cell.override) payload.overrides[key] = null;
          if (raw !== "" && (!cell.override || Number(raw) !== cell.price)) payload.overrides[key] = parseKr(raw);
        });
        priceBox.querySelectorAll("[data-market]").forEach(function (input) {
          const key = input.getAttribute("data-market");
          const value = parseKr(input.value);
          if (value !== findCell(key).market) payload.market[key] = value;
        });
        savePrices(payload);
      }
    });
    priceBox.addEventListener("submit", function (event) {
      if (event.target.id !== "strategy") return;
      event.preventDefault();
      savePrices({
        strategy: {
          undercutPercent: Number(String(event.target.elements.undercutPercent.value).replace(",", ".")),
          minPrice: parseKr(event.target.elements.minPrice.value)
        }
      });
    });
  }

  function findCell(key) {
    const parts = key.split(":");
    const model = prices.models.find(function (item) { return item.id === parts[0]; });
    return model.cells[parts[1]];
  }

  function filtered() {
    const query = (search.value || "").trim().toLowerCase();
    if (!query) return items;
    return items.filter(function (item) {
      return [item.ref, item.name, item.phone, item.email, item.model, item.problem, item.address]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }

  function paintList() {
    const rows = filtered();
    count.textContent = rows.length + (rows.length === 1 ? " sag" : " sager");
    list.innerHTML = rows.length
      ? rows
          .map(function (item) {
            return (
              "<button class=\"sag-button" +
              (item.ref === currentRef ? " is-current" : "") +
              "\" type=\"button\" data-ref=\"" +
              esc(item.ref) +
              "\"><strong>" +
              esc(item.ref) +
              " · " +
              esc(labels.status[item.status] || item.status) +
              "</strong><span>" +
              esc(item.name) +
              " · " +
              esc(labels.device[item.device] || item.device) +
              (item.model ? " · " + esc(item.model) : "") +
              "</span></button>"
            );
          })
          .join("")
      : "<p>Ingen sager endnu. Når en kunde booker, lander den her.</p>";
  }

  function channelText() {
    if (!prices) return "mail og sms";
    const channels = [prices.mailEnabled ? "mail" : "", prices.smsEnabled ? "sms" : ""].filter(Boolean);
    return channels.length ? channels.join(" og ") : "mail og sms (ikke sat op endnu – kunden ser det kun på sin sag)";
  }

  function paintDetail(ref) {
    const item = items.find(function (entry) { return entry.ref === ref; });
    currentRef = ref;
    paintList();
    if (!item) {
      detail.innerHTML = "<p>Vælg en sag.</p>";
      return;
    }
    const options = Object.keys(labels.status)
      .map(function (key) {
        return "<option value=\"" + key + "\"" + (key === item.status ? " selected" : "") + ">" + esc(labels.status[key]) + "</option>";
      })
      .join("");
    const notes = (item.notes || [])
      .map(function (note) { return "<li>" + esc(note.text) + "</li>"; })
      .join("");
    const payments = (item.payments || [])
      .map(function (payment) {
        return "<li>" + kroner(payment.amountDkk) + " · " + (payment.kind === "forud" ? "forudbetalt" : "betalt") + " med kort/MobilePay/Klarna · " + esc(new Date(payment.at).toLocaleString("da-DK")) + "</li>";
      })
      .join("");
    const estimate = item.estimate
      ? "<p>Prisoverslag ved booking: <strong>" + (item.estimate.from ? "fra " : "") + kroner(item.estimate.priceDkk) + "</strong> · " + esc(item.estimate.label) + " · " + esc(item.estimate.time) +
        (item.payWhen === "nu" ? " · <strong>valgte at betale nu</strong>" : "") + "</p>" +
        (item.estimate.items && item.estimate.items.length > 1
          ? "<ul class=\"note-list\">" +
            item.estimate.items
              .map(function (line) { return "<li>" + esc(line.label) + " · " + (line.from ? "fra " : "") + kroner(line.priceDkk) + " · " + esc(line.time) + "</li>"; })
              .join("") +
            "</ul>"
          : "")
      : "";
    const priceValue = item.priceDkk ?? (item.estimate && !item.estimate.from ? item.estimate.priceDkk : "");
    detail.innerHTML =
      "<p class=\"chip\">" + esc(item.ref) + "</p><h2>" + esc(item.name) + "</h2>" +
      "<p><a href=\"tel:" + esc(phoneLink(item.phone)) + "\">" + esc(item.phone) + "</a><br><a href=\"mailto:" + esc(item.email) + "\">" + esc(item.email) + "</a></p>" +
      "<p><strong>" + esc(labels.device[item.device] || "") + "</strong>" + (item.model ? " · " + esc(item.model) : "") + "<br>" + esc(item.problem) + "</p>" +
      "<p>" + esc(labels.visit[item.visit] || item.visit) + (item.address ? "<br>" + esc(item.address) : "") + "<br>" + esc(labels.when[item.when] || "") + (item.timeNote ? " · " + esc(item.timeNote) : "") + "</p>" +
      estimate +
      "<p>Pris nu: <strong>" + kroner(item.priceDkk) + "</strong></p>" +
      (payments ? "<h3>Betalinger</h3><ul class=\"note-list\">" + payments + "</ul>" : "") +
      "<form id=\"editor\"><label class=\"field\"><span>Pris i kroner</span><input name=\"priceDkk\" inputmode=\"numeric\" value=\"" + esc(priceValue) + "\"></label>" +
      "<label class=\"field\"><span>Status</span><select name=\"status\">" + options + "</select></label>" +
      "<label class=\"field\"><span>Besked til kunden</span><textarea name=\"customerMessage\" placeholder=\"Fx: Vi ses torsdag kl. 14 på værkstedet.\"></textarea></label>" +
      "<label class=\"check-line\"><input type=\"checkbox\" name=\"notifyCustomer\" checked> Send til kunden på " + channelText() + "</label>" +
      "<label class=\"field\"><span>Intern note</span><textarea name=\"note\" placeholder=\"Kun til dig. Kunden ser den ikke.\"></textarea></label>" +
      "<div class=\"quick-actions\"><button class=\"btn\" type=\"submit\">Gem</button>" +
      "<button class=\"btn btn-copper\" type=\"button\" data-set=\"bekraeftet\">Bekræft tid</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"tilbud\">Send tilbud</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"i_gang\">I gang</button>" +
      "<button class=\"btn btn-copper\" type=\"button\" data-set=\"afventer_betaling\">Klar til betaling</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"betalt\">Betalt</button>" +
      "<button class=\"btn btn-ghost\" type=\"button\" data-set=\"kunne_ikke\">Kunne ikke</button></div>" +
      "<p id=\"editor-error\" class=\"form-error\" hidden></p></form>" +
      "<details class=\"guide\" data-job-box=\"" + esc(item.ref) + "\"><summary>Send til en partner-reparatør</summary>" +
      "<p>Godkendte partnere får en mail og kan tage opgaven på /partner/opgaver. Kun den, der tager den, ser kundens oplysninger.</p>" +
      "<label class=\"field\"><span>Partnerens betaling i kroner</span><input data-job-payout inputmode=\"numeric\" value=\"" + esc(priceValue ? Math.round((Number(priceValue) * 0.5) / 50) * 50 : "") + "\"></label>" +
      "<label class=\"field\"><span>Besked til partneren <small class=\"muted\">(valgfrit, uden kundens navn)</small></span><textarea data-job-note maxlength=\"400\" placeholder=\"Fx: Delen ligger klar på værkstedet.\"></textarea></label>" +
      "<button class=\"btn btn-copper\" type=\"button\" data-job-new>Send til partnere</button>" +
      "<p class=\"form-error\" data-job-error hidden></p></details>" +
      (notes ? "<h3>Noter</h3><ul class=\"note-list\">" + notes + "</ul>" : "");
    document.querySelector("#editor").addEventListener("submit", function (event) {
      event.preventDefault();
      save({});
    });
    detail.querySelectorAll("[data-set]").forEach(function (button) {
      button.addEventListener("click", function () {
        save({ status: button.getAttribute("data-set") });
      });
    });
  }

  async function save(extra) {
    const editor = document.querySelector("#editor");
    const message = document.querySelector("#editor-error");
    const status = extra.status || editor.elements.status.value;
    const raw = editor.elements.priceDkk.value.trim();
    if ((status === "tilbud" || status === "afventer_betaling") && raw === "") {
      message.hidden = false;
      message.textContent = "Skriv prisen først.";
      return;
    }
    let price = null;
    if (raw !== "") {
      price = parseKr(raw);
      if (!Number.isInteger(price)) {
        message.hidden = false;
        message.textContent = "Skriv prisen i hele kroner, for eksempel 1150.";
        return;
      }
    }
    const payload = {
      status: status,
      priceDkk: price,
      note: editor.elements.note.value,
      customerMessage: editor.elements.customerMessage.value,
      notifyCustomer: editor.elements.notifyCustomer.checked
    };
    const response = await fetch("/api/admin/sager/" + encodeURIComponent(currentRef), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      message.hidden = false;
      message.textContent = "Kunne ikke gemme. Prisen skal være et helt tal i kroner.";
      return;
    }
    await load();
  }

  login.addEventListener("submit", async function (event) {
    event.preventDefault();
    loginError.hidden = true;
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: login.elements.password.value })
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      loginError.hidden = false;
      loginError.textContent = body.message || "Kunne ikke logge ind.";
      return;
    }
    login.elements.password.value = "";
    await load();
  });

  document.querySelector("#logout").addEventListener("click", async function () {
    await fetch("/api/admin/logout", { method: "POST" });
    items = [];
    currentRef = "";
    showLogin();
  });

  document.querySelector("#export").addEventListener("click", function () {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "axiom-sager.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  search.addEventListener("input", paintList);
  list.addEventListener("click", function (event) {
    const button = event.target.closest("[data-ref]");
    if (!button) return;
    paintDetail(button.getAttribute("data-ref"));
  });

  load();
})();
