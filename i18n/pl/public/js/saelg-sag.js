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
        const price = item.manual ? "Cena wkrótce" : item.recycle ? "Recykling" : money(item.offerDkk * item.qty);
        return "<li><span class=\"review-label\">" + item.qty + " ×</span><span class=\"review-value\">" + esc(item.modelName) + (spec ? "<span class=\"review-note\">" + esc(spec) + "</span>" : "") + "</span><strong>" + price + "</strong></li>";
      })
      .join("");
    const final = Number.isInteger(sale.finalDkk) ? sale.finalDkk : null;
    const answer = sale.canAnswer
      ? "<div class=\"estimate\"><p class=\"offer-kicker\">Nowa oferta po sprawdzeniu</p><p class=\"estimate-price\">" + money(final) + "</p>" +
        "<p>Jeśli powiesz nie, odeślemy urządzenie za darmo.</p><div class=\"quick-actions\"><button class=\"btn btn-copper\" type=\"button\" data-answer=\"1\">Tak, poproszę o wypłatę</button><button class=\"btn btn-ghost\" type=\"button\" data-answer=\"0\">Nie, odeślijcie urządzenie</button></div>" +
        "<p id=\"answer-error\" class=\"form-error\" hidden></p></div>"
      : "";
    const events = sale.events
      .slice()
      .reverse()
      .map(function (entry) { return "<li><time>" + esc(date(entry.at)) + "</time>" + esc(entry.text) + "</li>"; })
      .join("");
    view.innerHTML =
      "<p class=\"chip\">" + esc(sale.ref) + "</p><h2>" + esc(sale.statusLabel) + "</h2>" +
      answer +
      "<div class=\"review\"><ul>" + lines + "</ul>" +
      "<div class=\"review-price\"><span>" + (final !== null ? "Cena ostateczna" : "Oferta") + "</span><strong>" + money(final !== null ? final : sale.offerDkk) + "</strong></div></div>" +
      "<p class=\"muted\">Wypłata: " + (sale.payoutMethod === "bank" ? "przelew bankowy" : "MobilePay") + ". " + (sale.delivery === "post" ? "Wysyłasz paczkę pocztą." : "Przynosisz urządzenie do nas w Aalborg.") +
      " Oferta jest ważna do " + esc(new Date(sale.validUntil).toLocaleDateString("da-DK", { dateStyle: "long" })) + ".</p>" +
      "<h3>Przebieg</h3><ol class=\"timeline\">" + events + "</ol>";
    view.hidden = false;
  }

  async function load(ref, email) {
    error.hidden = true;
    const query = new URLSearchParams({ ref: ref, email: email });
    const response = await fetch("/api/saelg/sag?" + query);
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      error.hidden = false;
      error.textContent = body.message || "Nie możemy znaleźć tej sprzedaży.";
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
      box.textContent = body.message || "Nie udało się zapisać odpowiedzi. Spróbuj ponownie.";
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
