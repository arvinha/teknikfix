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
        "<div class=\"pay-card\"><h3>Priset är " +
        kroner(booking.priceDkk) +
        "</h3><p>Du betalar först när reparationen är klar. Säg ja om vi ska sätta igång.</p><button class=\"btn\" id=\"accept\" type=\"button\">Godkänn priset</button></div>";
    }
    if (booking.status === "afventer_betaling" && due > 0) {
      payBox =
        "<div class=\"pay-card\"><h3>Redo för betalning: " +
        kroner(due) +
        "</h3><p>Betala först när du har sett att den fungerar.</p>" +
        (pay.dataset.card
          ? "<button class=\"btn\" id=\"pay-card\" type=\"button\">Betala " + kroner(due) + " med kort, MobilePay eller Klarna</button>" +
            "<ul class=\"pay-methods\" aria-label=\"Betalningssätt\"><li>Visa</li><li>Mastercard</li><li>Dankort</li><li>MobilePay</li><li>Klarna</li><li>Apple Pay</li><li>Google Pay</li></ul>"
          : "") +
        "<p style=\"margin-top: 14px\">Eller betala med PayPal eller bank, och skriv <strong>" +
        esc(booking.ref) +
        "</strong> på betalningen.</p>" +
        paypalForm(booking, due) +
        bankBlock(booking, due) +
        "<div class=\"quick-actions\"><button class=\"btn btn-ghost\" id=\"paid-paypal\" type=\"button\">Jag har betalat med PayPal</button><button class=\"btn btn-ghost\" id=\"paid-bank\" type=\"button\">Jag har betalat via bank</button></div></div>";
    }
    if (booking.status === "afventer_betaling" && booking.priceDkk > 0 && due === 0) {
      payBox = "<div class=\"form-ok\"><p>Reparationen är betald. Du behöver inte betala mer.</p></div>";
    }
    if (booking.status === "betaling_meldt") {
      payBox = "<div class=\"form-ok\"><p>Tack. Vi registrerar betalningen när den har kommit in.</p></div>";
    }
    if (booking.status === "kunne_ikke") {
      payBox = "<div class=\"form-ok\"><p>Vi kunde inte reparera den. Du är inte skyldig något.</p></div>";
    }
    view.hidden = false;
    view.innerHTML =
      "<p class=\"" +
      chip(booking.status) +
      "\">" +
      esc(labels.status[booking.status] || booking.status) +
      "</p><h2>" +
      esc(labels.device[booking.device] || "Ärende") +
      (booking.model ? " · " + esc(booking.model) : "") +
      "</h2><p>" +
      esc(booking.problem) +
      "</p><p>" +
      esc(labels.visit[booking.visit] || "") +
      (booking.address ? " · " + esc(booking.address) : "") +
      "</p>" +
      (booking.estimate && booking.priceDkk === null
        ? "<p>Prisoverslag: <strong>" + (booking.estimate.from ? "fra " : "") + kroner(booking.estimate.priceDkk) + "</strong> · Tid: " + esc(booking.estimate.time) + "</p>"
        : "") +
      (booking.priceDkk === null ? "" : "<p>Överenskommet pris: <strong>" + kroner(booking.priceDkk) + "</strong>" + (booking.estimate ? " · Tid: " + esc(booking.estimate.time) : "") + "</p>") +
      (paid > 0 ? "<p>Betalt: <strong>" + kroner(paid) + "</strong></p>" : "") +
      payBox +
      "<h3>Förlopp</h3><ol class=\"timeline\">" +
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
        error.textContent = body.message || "Betalningen kunde inte startas. Försök igen eller använd PayPal.";
        button.disabled = false;
        return;
      }
      location.href = body.url;
    } catch (err) {
      error.hidden = false;
      error.textContent = "Anslutningen misslyckades. Försök igen.";
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
      "<button class=\"btn " + (pay.dataset.card ? "btn-ghost" : "btn-copper") + "\" type=\"submit\">Betala " + kroner(due) + " med PayPal</button></form>"
    );
  }

  function bankBlock(booking, due) {
    return (
      "<div><h3>Eller banköverföring</h3><dl class=\"bank-dl\">" +
      "<dt>Mottagare</dt><dd>" + esc(pay.dataset.holder) + "</dd>" +
      "<dt>IBAN</dt><dd>" + esc(pay.dataset.iban) + "</dd>" +
      "<dt>BIC</dt><dd>" + esc(pay.dataset.bic) + "</dd>" +
      "<dt>Bank</dt><dd>" + esc(pay.dataset.bank) + "</dd>" +
      "<dt>Belopp</dt><dd>" + kroner(due) + "</dd>" +
      "<dt>Text</dt><dd>" + esc(booking.ref) + "</dd></dl>" +
      "<p>Kontot är i svenska kronor. Din bank växlar från danska kronor. PayPal är det mest direkta sättet.</p></div>"
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
      error.textContent = body.message || "Det gick inte. Försök igen.";
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
      error.textContent = body.message || "Vi hittar inte ärendet.";
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
        view.insertAdjacentHTML("afterbegin", "<div class=\"form-ok\" style=\"margin-bottom: 14px\"><p><strong>Tack, betalningen är genomförd.</strong> Kvittot har skickats till " + esc(body.email || "din e-mail") + ".</p></div>");
      } else if (response.status === 202) {
        error.hidden = false;
        error.textContent = "Betalningen behandlas fortfarande. Du får ett kvitto på e-post så snart den har gått igenom.";
      } else {
        error.hidden = false;
        error.textContent = body.message || "Vi kunde inte kontrollera betalningen. Skriv din e-postadress för att se ärendet.";
      }
      history.replaceState(null, "", "/sag?ref=" + encodeURIComponent(startRef));
    })();
  }
  if (params.get("betaling") === "afbrudt") {
    error.hidden = false;
    error.textContent = "Betalningen avbröts och inga pengar har dragits. Skriv din e-postadress för att se ärendet och försöka igen.";
  }
})();
