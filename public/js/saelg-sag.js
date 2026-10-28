(function () {
  const form = document.querySelector("#find-sale");
  const view = document.querySelector("#sale-view");
  const error = document.querySelector("#find-error");
  if (!form || !view) return;

  const kr = new Intl.NumberFormat("da-DK");
  let current = { ref: "", email: "" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(amount) {
    return kr.format(amount) + " kr";
  }

  function date(iso) {
    return new Date(iso).toLocaleString("da-DK", { dateStyle: "medium", timeStyle: "short" });
  }

  function paint(sale) {
    const lines = sale.items
      .map(function (item) {
        const spec = [item.variantLabel, item.storageLabel].filter(Boolean).join(", ");
        const price = item.manual ? "Pris følger" : item.recycle ? "Genbrug" : money(item.offerDkk * item.qty);
        return "<li><span class=\"review-label\">" + item.qty + " ×</span><span class=\"review-value\">" + esc(item.modelName) + (spec ? "<span class=\"review-note\">" + esc(spec) + "</span>" : "") + "</span><strong>" + price + "</strong></li>";
      })
      .join("");
    const final = Number.isInteger(sale.finalDkk) ? sale.finalDkk : null;
    const answer = sale.canAnswer
      ? "<div class=\"estimate\"><p class=\"offer-kicker\">Nyt tilbud efter tjek</p><p class=\"estimate-price\">" + money(final) + "</p>" +
        "<p>Siger du nej, sender vi den gratis retur.</p><div class=\"quick-actions\"><button class=\"btn btn-copper\" type=\"button\" data-answer=\"1\">Ja tak, udbetal</button><button class=\"btn btn-ghost\" type=\"button\" data-answer=\"0\">Nej, send den retur</button></div>" +
        "<p id=\"answer-error\" class=\"form-error\" hidden></p></div>"
      : "";
    const shipped = sale.canReportShipped
      ? "<form class=\"estimate\" id=\"shipped-form\"><p class=\"offer-kicker\">Har du sendt den?</p>" +
        "<label class=\"field\"><span>Sporingsnummer</span><input name=\"tracking\" autocomplete=\"off\" required minlength=\"6\" maxlength=\"40\" placeholder=\"Står på kvitteringen fra pakkeshoppen\"></label>" +
        "<button class=\"btn btn-copper\" type=\"submit\">Jeg har sendt den</button>" +
        "<p id=\"shipped-error\" class=\"form-error\" hidden></p></form>"
      : "";
    const events = sale.events
      .slice()
      .reverse()
      .map(function (entry) { return "<li><time>" + esc(date(entry.at)) + "</time>" + esc(entry.text) + "</li>"; })
      .join("");
    view.innerHTML =
      "<p class=\"chip\">" + esc(sale.ref) + "</p><h2>" + esc(sale.statusLabel) + "</h2>" +
      answer +
      shipped +
      "<div class=\"review\"><ul>" + lines + "</ul>" +
      "<div class=\"review-price\"><span>" + (final !== null ? "Endelig pris" : "Tilbud") + "</span><strong>" + money(final !== null ? final : sale.offerDkk) + "</strong></div></div>" +
      "<p class=\"muted\">Udbetaling med " + (sale.payoutMethod === "bank" ? "bankoverførsel" : "MobilePay") + ". " + (sale.delivery === "post" ? "Du sender med posten." : "Du afleverer i Aalborg.") +
      " Tilbuddet gælder til " + esc(new Date(sale.validUntil).toLocaleDateString("da-DK", { dateStyle: "long" })) + ".</p>" +
      "<h3>Forløb</h3><ol class=\"timeline\">" + events + "</ol>";
    view.hidden = false;
  }

  async function load(ref, email) {
    error.hidden = true;
    const query = new URLSearchParams({ ref: ref, email: email });
    const response = await fetch("/api/saelg/sag?" + query);
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      error.hidden = false;
      error.textContent = body.message || "Vi kan ikke finde det salg.";
      view.hidden = true;
      return;
    }
    current = { ref: ref, email: email };
    paint(body);
  }

  view.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-answer]");
    if (!button) return;
    const accept = button.getAttribute("data-answer") === "1";
    const response = await fetch("/api/saelg/svar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: current.ref, email: current.email, accept: accept })
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const box = document.querySelector("#answer-error");
      box.hidden = false;
      box.textContent = body.message || "Svaret blev ikke gemt. Prøv igen.";
      return;
    }
    paint(body);
  });

  view.addEventListener("submit", async function (event) {
    if (event.target.id !== "shipped-form") return;
    event.preventDefault();
    const box = document.querySelector("#shipped-error");
    const response = await fetch("/api/saelg/sendt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: current.ref, email: current.email, tracking: event.target.elements.tracking.value.trim() })
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      box.hidden = false;
      box.textContent = body.message || "Det blev ikke gemt. Prøv igen.";
      return;
    }
    paint(body);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    load(form.elements.ref.value.trim(), form.elements.email.value.trim());
  });

  const params = new URLSearchParams(location.search);
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem("teknikfix.sell") || "null");
  } catch (err) {
    saved = null;
  }
  const ref = params.get("ref") || (saved && saved.ref) || "";
  const email = params.get("email") || (saved && saved.ref === ref ? saved.email : "") || "";
  if (ref) form.elements.ref.value = ref;
  if (email) form.elements.email.value = email;
  if (ref && email) load(ref, email);
})();
