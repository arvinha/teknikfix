(function () {
  var codeForm = document.querySelector("#code-form");
  var loginForm = document.querySelector("#login-form");
  var board = document.querySelector("#board");
  if (!codeForm || !loginForm || !board) return;

  var kr = new Intl.NumberFormat("da-DK");
  var email = "";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(amount) {
    return kr.format(amount || 0) + " kr";
  }

  function telLink(phone) {
    var digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 8) return "+45" + digits;
    return digits ? "+" + digits : "";
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) {
          var error = new Error(data.message || "Noget gik galt. Prøv igen.");
          error.status = response.status;
          throw error;
        }
        return data;
      });
    });
  }

  function showError(form, message) {
    var box = form.querySelector("[data-error]");
    box.hidden = !message;
    box.textContent = message || "";
  }

  function showLogin() {
    board.hidden = true;
    loginForm.hidden = true;
    codeForm.hidden = false;
    document.querySelector("#job-lead").textContent = "Log ind med den e-mail, du tilmeldte dig med. Vi sender dig en kode.";
  }

  codeForm.addEventListener("submit", function (event) {
    event.preventDefault();
    showError(codeForm, "");
    email = codeForm.elements.email.value.trim();
    var button = codeForm.querySelector("button[type=submit]");
    button.disabled = true;
    api("POST", "/api/partner/kode", { email: email })
      .then(function (data) {
        codeForm.hidden = true;
        loginForm.hidden = false;
        loginForm.querySelector("[data-info]").textContent = data.message;
        loginForm.elements.code.focus();
      })
      .catch(function (err) { showError(codeForm, err.message); })
      .then(function () { button.disabled = false; });
  });

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    showError(loginForm, "");
    api("POST", "/api/partner/login", { email: email, code: loginForm.elements.code.value })
      .then(function () {
        loginForm.elements.code.value = "";
        return load();
      })
      .catch(function (err) { showError(loginForm, err.message); });
  });

  loginForm.querySelector("[data-back]").addEventListener("click", showLogin);

  document.querySelector("#job-logout").addEventListener("click", function () {
    api("POST", "/api/partner/logud").then(showLogin, showLogin);
  });

  function openCard(job) {
    return (
      "<article class=\"panel job-card\">" +
      "<p class=\"job-pay\">" + money(job.payoutDkk) + "</p>" +
      "<h3>" + esc(job.model) + "</h3>" +
      "<p>" + esc(job.task) + "</p>" +
      "<p class=\"muted\">" + esc(job.area) + " · " + esc(job.when) + "</p>" +
      (job.note ? "<p class=\"job-note\">" + esc(job.note) + "</p>" : "") +
      "<button class=\"btn btn-copper\" type=\"button\" data-take=\"" + esc(job.ref) + "\">Tag opgaven</button>" +
      "<p class=\"form-error\" data-error hidden role=\"alert\"></p>" +
      "</article>"
    );
  }

  function mineCard(job) {
    var c = job.customer;
    var active = job.status === "taget" || job.status === "i_gang";
    return (
      "<article class=\"panel job-card" + (active ? " is-active" : "") + "\" data-job=\"" + esc(job.ref) + "\">" +
      "<p class=\"job-pay\">" + money(job.payoutDkk) + "</p>" +
      "<p class=\"chip\">" + esc(job.ref) + " · " + esc(job.statusLabel) + "</p>" +
      "<h3>" + esc(job.model) + "</h3>" +
      "<p>" + esc(job.task) + "</p>" +
      (c
        ? "<dl class=\"admin-kv\">" +
          "<dt>Kunde</dt><dd>" + esc(c.name) + "</dd>" +
          "<dt>Telefon</dt><dd><a href=\"tel:" + esc(telLink(c.phone)) + "\">" + esc(c.phone) + "</a></dd>" +
          "<dt>E-mail</dt><dd><a href=\"mailto:" + esc(c.email) + "\">" + esc(c.email) + "</a></dd>" +
          (c.address ? "<dt>Adresse</dt><dd>" + esc(c.address) + "</dd>" : "<dt>Hvor</dt><dd>" + esc(job.area) + "</dd>") +
          (c.timeNote ? "<dt>Ønsket tid</dt><dd>" + esc(c.timeNote) + "</dd>" : "") +
          "<dt>Kundens beskrivelse</dt><dd>" + esc(c.problem) + "</dd>" +
          (job.priceDkk ? "<dt>Kunden betaler</dt><dd>" + money(job.priceDkk) + " til TeknikFix</dd>" : "") +
          "</dl>"
        : "") +
      (active
        ? "<label class=\"field\"><span>Besked til TeknikFix <small class=\"muted\">(valgfrit)</small></span><textarea data-note maxlength=\"600\"></textarea></label>" +
          "<div class=\"quick-actions\">" +
          (job.status === "taget" ? "<button class=\"btn\" type=\"button\" data-move=\"i_gang\">Jeg er i gang</button>" : "") +
          "<button class=\"btn btn-copper\" type=\"button\" data-move=\"faerdig\">Færdig, den virker</button>" +
          (job.status === "taget" ? "<button class=\"btn btn-ghost\" type=\"button\" data-move=\"aaben\">Giv opgaven tilbage</button>" : "") +
          "<button class=\"btn btn-ghost\" type=\"button\" data-move=\"kunne_ikke\">Kan ikke laves</button>" +
          "</div>"
        : "") +
      "<p class=\"form-error\" data-error hidden role=\"alert\"></p>" +
      "</article>"
    );
  }

  function paint(data) {
    codeForm.hidden = true;
    loginForm.hidden = true;
    board.hidden = false;
    document.querySelector("#job-lead").textContent = "Her er de opgaver, der passer til det, du reparerer.";
    document.querySelector("#job-hello").textContent = "Hej " + data.partner.name.split(" ")[0] + ". Du er logget ind som " + data.partner.ref + ".";
    document.querySelector("#job-earned").innerHTML =
      "<div><span>Venter på udbetaling</span><strong>" + money(data.earned.waiting) + "</strong></div>" +
      "<div><span>Udbetalt i alt</span><strong>" + money(data.earned.paid) + "</strong></div>";
    document.querySelector("#job-open").innerHTML = data.open.length
      ? data.open.map(openCard).join("")
      : "<p class=\"muted\">Ingen ledige opgaver lige nu. Du får en mail, når der kommer en ny.</p>";
    document.querySelector("#job-mine").innerHTML = data.mine.length
      ? data.mine.map(mineCard).join("")
      : "<p class=\"muted\">Du har ikke taget nogen opgaver endnu.</p>";
  }

  function load() {
    return api("GET", "/api/partner/opgaver").then(paint, function (err) {
      if (err.status === 401) showLogin();
      else throw err;
    });
  }

  board.addEventListener("click", function (event) {
    var take = event.target.closest("[data-take]");
    var move = event.target.closest("[data-move]");
    var card = event.target.closest(".job-card");
    if (!card || (!take && !move)) return;
    var errorBox = card.querySelector("[data-error]");
    errorBox.hidden = true;
    var request;
    if (take) {
      request = api("POST", "/api/partner/opgaver/" + encodeURIComponent(take.getAttribute("data-take")) + "/tag");
    } else {
      var status = move.getAttribute("data-move");
      var noteBox = card.querySelector("[data-note]");
      var note = noteBox ? noteBox.value : "";
      if (status === "kunne_ikke" && note.trim().length < 5) {
        errorBox.hidden = false;
        errorBox.textContent = "Skriv kort i beskeden, hvorfor den ikke kan laves.";
        return;
      }
      if (status === "aaben" && !window.confirm("Vil du give opgaven tilbage, så en anden kan tage den?")) return;
      request = api("POST", "/api/partner/opgaver/" + encodeURIComponent(card.getAttribute("data-job")) + "/status", { status: status, note: note });
    }
    (take || move).disabled = true;
    request.then(load).catch(function (err) {
      if (err.status === 409) {
        load().then(function () { window.alert(err.message); });
        return;
      }
      errorBox.hidden = false;
      errorBox.textContent = err.message;
      (take || move).disabled = false;
    });
  });

  load().catch(showLogin);
})();
