(function () {
  const box = document.querySelector("#job-admin");
  const tabs = document.querySelector("#admin-tabs");
  if (!box || !tabs) return;

  const kr = new Intl.NumberFormat("da-DK");
  let data = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(amount) {
    return Number.isInteger(amount) ? kr.format(amount) + " kr" : "–";
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
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.message || "Kunne ikke gemme.");
    return result;
  }

  async function load() {
    try {
      data = await api("GET", "/api/admin/opgaver");
    } catch (error) {
      box.innerHTML = "<p class=\"form-error\">" + esc(error.message) + "</p>";
      return;
    }
    paint();
  }

  function actions(job) {
    const buttons = [];
    if (job.status === "faerdig") buttons.push("<button class=\"btn btn-copper\" type=\"button\" data-job-set=\"udbetalt\" data-ref=\"" + esc(job.ref) + "\">Udbetalt</button>");
    if (["taget", "i_gang", "kunne_ikke"].indexOf(job.status) !== -1) buttons.push("<button class=\"btn btn-ghost\" type=\"button\" data-job-set=\"aaben\" data-ref=\"" + esc(job.ref) + "\">Gør ledig igen</button>");
    if (["aaben", "taget", "i_gang", "kunne_ikke"].indexOf(job.status) !== -1) buttons.push("<button class=\"btn btn-ghost\" type=\"button\" data-job-set=\"annulleret\" data-ref=\"" + esc(job.ref) + "\">Træk tilbage</button>");
    return buttons.join(" ");
  }

  function paint() {
    const open = data.items.filter(function (job) { return job.status === "faerdig"; });
    const owed = open.reduce(function (sum, job) { return sum + job.payoutDkk; }, 0);
    const rows = data.items
      .map(function (job) {
        return (
          "<tr><td><strong>" + esc(job.ref) + "</strong><br><a href=\"#" + esc(job.bookingRef) + "\" data-open-case=\"" + esc(job.bookingRef) + "\">" + esc(job.bookingRef) + "</a></td>" +
          "<td>" + esc(job.model) + "<br><small class=\"muted\">" + esc(job.task) + "</small></td>" +
          "<td>" + money(job.payoutDkk) + "</td>" +
          "<td>" + esc(data.statuses[job.status] || job.status) + (job.partnerName ? "<br><small>" + esc(job.partnerName) + " · " + esc(job.partnerRef) + "</small>" : "") + "</td>" +
          "<td>" + actions(job) + "</td></tr>"
        );
      })
      .join("");
    box.innerHTML =
      "<h2>Opgaver til partnere</h2>" +
      "<p>" + data.approvedPartners + " godkendte reparatører." + (owed ? " Du skylder partnere <strong>" + money(owed) + "</strong> for " + open.length + " færdige opgaver." : "") + "</p>" +
      (rows
        ? "<div style=\"overflow-x:auto\"><table class=\"price-table\"><thead><tr><th>Opgave</th><th>Hvad</th><th>Partneren får</th><th>Status</th><th></th></tr></thead><tbody>" + rows + "</tbody></table></div>"
        : "<p class=\"muted\">Ingen opgaver endnu. Åbn en sag under Reparationer, og tryk Send til partnere.</p>") +
      "<p class=\"form-error\" data-job-admin-error hidden></p>";
  }

  box.addEventListener("click", async function (event) {
    const set = event.target.closest("[data-job-set]");
    const caseLink = event.target.closest("[data-open-case]");
    if (caseLink) {
      event.preventDefault();
      const tab = tabs.querySelector("[data-tab=\"reparation\"]");
      if (tab) tab.click();
      window.location.hash = caseLink.getAttribute("data-open-case");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    if (!set) return;
    const status = set.getAttribute("data-job-set");
    if (status === "annulleret" && !window.confirm("Trække opgaven tilbage fra partnerne?")) return;
    set.disabled = true;
    try {
      await api("PATCH", "/api/admin/opgaver/" + encodeURIComponent(set.getAttribute("data-ref")), { status: status });
      await load();
    } catch (error) {
      const message = box.querySelector("[data-job-admin-error]");
      message.hidden = false;
      message.textContent = error.message;
      set.disabled = false;
    }
  });

  document.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-job-new]");
    if (!button) return;
    const panel = button.closest("[data-job-box]");
    const error = panel.querySelector("[data-job-error]");
    error.hidden = true;
    const payout = parseKr(panel.querySelector("[data-job-payout]").value);
    if (!Number.isInteger(payout) || payout < 50) {
      error.hidden = false;
      error.textContent = "Skriv partnerens betaling i hele kroner, mindst 50.";
      return;
    }
    button.disabled = true;
    try {
      const job = await api("POST", "/api/admin/opgaver", { bookingRef: panel.getAttribute("data-job-box"), payoutDkk: payout, note: panel.querySelector("[data-job-note]").value });
      error.hidden = false;
      error.classList.remove("form-error");
      error.textContent = "Sendt som " + job.ref + "." + (job.mailed ? " " + job.mailed + " partnere har fået en mail." : " Ingen partnere har fået mail endnu (ingen godkendte eller mail er ikke sat op).");
      data = null;
    } catch (err) {
      error.hidden = false;
      error.textContent = err.message;
      button.disabled = false;
    }
  });

  tabs.addEventListener("click", function (event) {
    const button = event.target.closest("[data-tab=\"partnere\"]");
    if (button) load();
  });
})();
