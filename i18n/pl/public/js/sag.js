(function () {
  const form = document.querySelector("#find-sag");
  const view = document.querySelector("#sag-view");
  const error = document.querySelector("#find-error");
  if (!form || !view) return;

  const labels = window.FixLabels;
  const pay = document.querySelector("#pay-config");
  let current = null;

  function kroner(amount) {
    return new Intl.NumberFormat("da-DK").format(amount) + " kr";
  }

  function stamp(iso) {
    return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  }

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function chip(status) {
    if (status === "betalt" || status === "afsluttet" || status === "kunne_ikke") return "chip chip-ok";
    if (status === "afventer_betaling" || status === "betaling_meldt" || status === "tilbud") return "chip chip-pay";
    return "chip chip-wait";
  }

  function render(booking) {
    current = booking;
    const rows = (booking.events || [])
      .map(function (event) {
        return "<li><time datetime=\"" + esc(event.at) + "\">" + esc(stamp(event.at)) + "</time>" + esc(event.text) + "</li>";
      })
      .join("");
    let payBox = "";
    const paid = booking.paidDkk || 0;
    const due = booking.priceDkk > 0 ? Math.max(0, booking.priceDkk - paid) : 0;
    if (booking.status === "tilbud" && booking.priceDkk !== null && booking.priceDkk !== undefined) {
      payBox =
        "<div class=\"pay-card\"><h3>Cena to " +
        kroner(booking.priceDkk) +
        "</h3><p>Płacisz dopiero wtedy, gdy naprawa jest gotowa. Daj znać, że się zgadzasz, a zabieramy się do pracy.</p><button class=\"btn\" id=\"accept\" type=\"button\">Zatwierdź cenę</button></div>";
    }
    if (booking.status === "afventer_betaling" && due > 0) {
      payBox =
        "<div class=\"pay-card\"><h3>Gotowe do zapłaty: " +
        kroner(due) +
        "</h3><p>Zapłać dopiero wtedy, gdy sprawdzisz, że urządzenie działa.</p>" +
        (pay.dataset.card
          ? "<button class=\"btn\" id=\"pay-card\" type=\"button\">Zapłać " + kroner(due) + " kartą, przez MobilePay lub Klarna</button>" +
            "<ul class=\"pay-methods\" aria-label=\"Metody płatności\"><li>Visa</li><li>Mastercard</li><li>Dankort</li><li>MobilePay</li><li>Klarna</li><li>Apple Pay</li><li>Google Pay</li></ul>"
          : "") +
        "<p style=\"margin-top: 14px\">Możesz też zapłacić przez PayPal lub przelewem bankowym. Wpisz w tytule płatności <strong>" +
        esc(booking.ref) +
        "</strong>.</p>" +
        paypalForm(booking, due) +
        bankBlock(booking, due) +
        "<div class=\"quick-actions\"><button class=\"btn btn-ghost\" id=\"paid-paypal\" type=\"button\">Zapłaciłem(-am) przez PayPal</button><button class=\"btn btn-ghost\" id=\"paid-bank\" type=\"button\">Zapłaciłem(-am) przelewem bankowym</button></div></div>";
    }
    if (booking.status === "afventer_betaling" && booking.priceDkk > 0 && due === 0) {
      payBox = "<div class=\"form-ok\"><p>Naprawa jest opłacona. Nie musisz już nic płacić.</p></div>";
    }
    if (booking.status === "betaling_meldt") {
      payBox = "<div class=\"form-ok\"><p>Dziękujemy. Zarejestrujemy płatność, gdy tylko do nas dotrze.</p></div>";
    }
    if (booking.status === "kunne_ikke") {
      payBox = "<div class=\"form-ok\"><p>Nie udało nam się go naprawić. Nic nam nie jesteś winien(-na).</p></div>";
    }
    view.hidden = false;
    view.innerHTML =
      "<p class=\"" +
      chip(booking.status) +
      "\">" +
      esc(labels.status[booking.status] || booking.status) +
      "</p><h2>" +
      esc(labels.device[booking.device] || "Zgłoszenie") +
      (booking.model ? " · " + esc(booking.model) : "") +
      "</h2><p>" +
      esc(booking.problem) +
      "</p><p>" +
      esc(labels.visit[booking.visit] || "") +
      (booking.address ? " · " + esc(booking.address) : "") +
      "</p>" +
      (booking.estimate && booking.priceDkk === null
        ? "<p>Prisoverslag: <strong>" + (booking.estimate.from ? "fra " : "") + kroner(booking.estimate.priceDkk) + "</strong> · Czas: " + esc(booking.estimate.time) + "</p>"
        : "") +
      (booking.priceDkk === null ? "" : "<p>Uzgodniona cena: <strong>" + kroner(booking.priceDkk) + "</strong>" + (booking.estimate ? " · Czas: " + esc(booking.estimate.time) : "") + "</p>") +
      (paid > 0 ? "<p>Betalt: <strong>" + kroner(paid) + "</strong></p>" : "") +
      payBox +
      "<h3>Przebieg</h3><ol class=\"timeline\">" +
      rows +
      "</ol>";
    const accept = document.querySelector("#accept");
    if (accept) accept.addEventListener("click", function () { act("/api/sag/accept", {}); });
    const paidPaypal = document.querySelector("#paid-paypal");
    const paidBank = document.querySelector("#paid-bank");
    if (paidPaypal) paidPaypal.addEventListener("click", function () { act("/api/sag/betalt", { method: "paypal" }); });
    if (paidBank) paidBank.addEventListener("click", function () { act("/api/sag/betalt", { method: "bank" }); });
    const payCard = document.querySelector("#pay-card");
    if (payCard) payCard.addEventListener("click", function () { startCard(payCard); });
  }

  async function startCard(button) {
    error.hidden = true;
    button.disabled = true;
    try {
      const response = await fetch("/api/sag/kort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: current.ref, email: form.elements.email.value })
      });
      const body = await response.json().catch(function () { return {}; });
      if (!response.ok || !body.url) {
        error.hidden = false;
        error.textContent = body.message || "Nie udało się rozpocząć płatności. Spróbuj ponownie lub skorzystaj z PayPal.";
        button.disabled = false;
        return;
      }
      location.href = body.url;
    } catch (err) {
      error.hidden = false;
      error.textContent = "Połączenie nie powiodło się. Spróbuj ponownie.";
      button.disabled = false;
    }
  }

  function paypalForm(booking, due) {
    const amount = Number(due).toFixed(2);
    return (
      "<form class=\"copy-row\" action=\"https://www.paypal.com/cgi-bin/webscr\" method=\"post\" target=\"_blank\">" +
      "<input type=\"hidden\" name=\"cmd\" value=\"_xclick\">" +
      "<input type=\"hidden\" name=\"business\" value=\"" + esc(pay.dataset.paypal) + "\">" +
      "<input type=\"hidden\" name=\"item_name\" value=\"TeknikFix reparation " + esc(booking.ref) + "\">" +
      "<input type=\"hidden\" name=\"item_number\" value=\"" + esc(booking.ref) + "\">" +
      "<input type=\"hidden\" name=\"amount\" value=\"" + amount + "\">" +
      "<input type=\"hidden\" name=\"currency_code\" value=\"DKK\">" +
      "<input type=\"hidden\" name=\"no_shipping\" value=\"1\">" +
      "<input type=\"hidden\" name=\"charset\" value=\"utf-8\">" +
      "<button class=\"btn " + (pay.dataset.card ? "btn-ghost" : "btn-copper") + "\" type=\"submit\">Zapłać " + kroner(due) + " przez PayPal</button></form>"
    );
  }

  function bankBlock(booking, due) {
    return (
      "<div><h3>Albo przelew bankowy</h3><dl class=\"bank-dl\">" +
      "<dt>Odbiorca</dt><dd>" + esc(pay.dataset.holder) + "</dd>" +
      "<dt>IBAN</dt><dd>" + esc(pay.dataset.iban) + "</dd>" +
      "<dt>BIC</dt><dd>" + esc(pay.dataset.bic) + "</dd>" +
      "<dt>Bank</dt><dd>" + esc(pay.dataset.bank) + "</dd>" +
      "<dt>Kwota</dt><dd>" + kroner(due) + "</dd>" +
      "<dt>Tytuł</dt><dd>" + esc(booking.ref) + "</dd></dl>" +
      "<p>Konto jest prowadzone w koronach szwedzkich. Twój bank przewalutuje je z koron duńskich. Najprościej jest zapłacić przez PayPal.</p></div>"
    );
  }

  async function act(url, extra) {
    error.hidden = true;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: current.ref, email: form.elements.email.value, ...extra })
    });
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      error.hidden = false;
      error.textContent = body.message || "Nie udało się. Spróbuj ponownie.";
      return;
    }
    render(body);
  }

  form.elements.ref.addEventListener("input", function () {
    form.elements.ref.value = form.elements.ref.value.toUpperCase();
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    error.hidden = true;
    const query = new URLSearchParams({
      ref: form.elements.ref.value,
      email: form.elements.email.value
    });
    const response = await fetch("/api/sag?" + query.toString());
    const body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      view.hidden = true;
      error.hidden = false;
      error.textContent = body.message || "Nie możemy znaleźć zgłoszenia.";
      return;
    }
    render(body);
  });

  const params = new URLSearchParams(location.search);
  const startRef = params.get("ref");
  if (startRef) form.elements.ref.value = startRef.toUpperCase();
  const startEmail = params.get("email");
  if (startRef && startEmail && !params.get("betaling")) {
    form.elements.email.value = startEmail;
    form.requestSubmit();
    history.replaceState(null, "", "/sag?ref=" + encodeURIComponent(startRef.toUpperCase()));
  }
  const sessionId = params.get("session_id");
  if (params.get("betaling") === "ok" && startRef && sessionId) {
    (async function () {
      const query = new URLSearchParams({ ref: startRef, session_id: sessionId });
      const response = await fetch("/api/sag/kort/bekraeft?" + query.toString());
      const body = await response.json().catch(function () { return {}; });
      if (response.status === 200) {
        if (body.email) {
          form.elements.email.value = body.email;
          form.hidden = true;
        }
        render(body);
        view.insertAdjacentHTML("afterbegin", "<div class=\"form-ok\" style=\"margin-bottom: 14px\"><p><strong>Dziękujemy, płatność została zrealizowana.</strong> Potwierdzenie wysłaliśmy na adres " + esc(body.email || "din e-mail") + ".</p></div>");
      } else if (response.status === 202) {
        error.hidden = false;
        error.textContent = "Płatność jest jeszcze przetwarzana. Potwierdzenie dostaniesz e-mailem, gdy tylko zostanie zaksięgowana.";
      } else {
        error.hidden = false;
        error.textContent = body.message || "Nie udało się sprawdzić płatności. Wpisz swój adres e-mail, aby zobaczyć zgłoszenie.";
      }
      history.replaceState(null, "", "/sag?ref=" + encodeURIComponent(startRef));
    })();
  }
  if (params.get("betaling") === "afbrudt") {
    error.hidden = false;
    error.textContent = "Płatność została przerwana i nic nie zostało pobrane. Wpisz swój adres e-mail, aby zobaczyć zgłoszenie i spróbować ponownie.";
  }
})();
