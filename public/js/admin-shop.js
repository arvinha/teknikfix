(function () {
  const box = document.querySelector("#shop-stock");
  const tabs = document.querySelector("#admin-tabs");
  if (!box || !tabs) return;

  const kr = new Intl.NumberFormat("da-DK");
  let data = null;
  let editing = null;
  let pending = null;
  let message = "";

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(amount) {
    return Number.isInteger(amount) ? kr.format(amount) + " kr" : "–";
  }

  async function api(method, url, body, type) {
    const response = await fetch(url, {
      method: method,
      headers: body ? { "Content-Type": type || "application/json" } : {},
      body: body ? (type ? body : JSON.stringify(body)) : undefined
    });
    const result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.message || "Kunne ikke gemme.");
    return result;
  }

  async function load() {
    try {
      data = await api("GET", "/api/admin/butik");
    } catch (error) {
      box.innerHTML = "<p class=\"form-error\">" + esc(error.message) + "</p>";
      return;
    }
    if (pending) {
      editing = Object.assign({ ref: "", grade: "meget-god", status: "aktiv", photos: [] }, pending);
      pending = null;
    }
    paint();
  }

  function modelById(id) {
    let found = null;
    data.groups.forEach(function (group) {
      group.models.forEach(function (model) {
        if (model.id === id) found = Object.assign({ device: group.device }, model);
      });
    });
    return found;
  }

  function options(list, selected, empty) {
    return (empty !== undefined ? "<option value=\"\">" + esc(empty) + "</option>" : "") +
      list.map(function (item) { return "<option value=\"" + esc(item.id) + "\"" + (item.id === selected ? " selected" : "") + ">" + esc(item.label) + "</option>"; }).join("");
  }

  function field(label, html, note) {
    return "<label class=\"field\" style=\"margin:0\"><span>" + esc(label) + "</span>" + html + (note ? "<small class=\"muted\">" + esc(note) + "</small>" : "") + "</label>";
  }

  function editorHtml(item) {
    const model = modelById(item.modelId);
    const modelSelect =
      "<select name=\"modelId\"><option value=\"\">Vælg model</option>" +
      data.groups
        .map(function (group) {
          return "<optgroup label=\"" + esc(group.name) + "\">" +
            group.models.map(function (m) { return "<option value=\"" + esc(m.id) + "\"" + (m.id === item.modelId ? " selected" : "") + ">" + esc(m.name) + "</option>"; }).join("") +
            "</optgroup>";
        })
        .join("") +
      "</select>";
    const variants = model ? model.variants : [];
    const storage = model ? data.storage[model.device] || [] : [];
    const conns = model && model.device === "tablet" ? data.connectivity : [];
    const grades = Object.keys(data.grades).map(function (id) { return { id: id, label: data.grades[id] }; });
    const statuses = Object.keys(data.statuses).map(function (id) { return { id: id, label: data.statuses[id] }; });
    const photos = (item.photos || [])
      .map(function (file) {
        return "<span class=\"shop-admin-photo\"><img src=\"/foto/" + esc(file) + "\" alt=\"\"><button type=\"button\" class=\"link-button\" data-photo-delete=\"" + esc(file) + "\">Fjern</button></span>";
      })
      .join("");
    return (
      "<form id=\"shop-form\" class=\"shop-admin-form\">" +
      "<h3>" + (item.ref ? "Ret " + esc(item.ref) : "Ny enhed") + "</h3>" +
      "<div class=\"shop-admin-grid\">" +
      field("Model", modelSelect) +
      (variants.length ? field("Generation / chip", "<select name=\"variant\">" + options(variants, item.variant, "Vælg") + "</select>") : "") +
      (storage.length ? field("Lager", "<select name=\"storage\">" + options(storage, item.storage) + "</select>") : "") +
      (conns.length ? field("Forbindelse", "<select name=\"conn\">" + options(conns, item.conn || "wifi") + "</select>") : "") +
      field("Stand", "<select name=\"grade\">" + options(grades, item.grade) + "</select>") +
      field("Batteri %", "<input name=\"batteryPct\" inputmode=\"numeric\" value=\"" + esc(item.batteryPct || "") + "\" placeholder=\"fx 91\">") +
      field("Farve", "<input name=\"color\" value=\"" + esc(item.color || "") + "\" placeholder=\"fx Sort\">") +
      field("Salgspris (kr)", "<input name=\"priceDkk\" inputmode=\"numeric\" value=\"" + esc(item.priceDkk || "") + "\">", "") +
      field("Indkøbspris (kr, kun til dig)", "<input name=\"costDkk\" inputmode=\"numeric\" value=\"" + esc(item.costDkk == null ? "" : item.costDkk) + "\">") +
      field("IMEI / serienummer (kun til dig)", "<input name=\"imei\" value=\"" + esc(item.imei || "") + "\">") +
      field("Opkøb (SL-nummer)", "<input name=\"buybackRef\" value=\"" + esc(item.buybackRef || "") + "\">") +
      field("Status", "<select name=\"status\">" + options(statuses, item.status || "aktiv") + "</select>") +
      "</div>" +
      "<p class=\"actions\" style=\"margin:10px 0\"><button class=\"btn btn-ghost btn-small\" type=\"button\" id=\"shop-suggest\">Foreslå pris</button> <span class=\"muted\" id=\"shop-suggest-text\"></span></p>" +
      field("Egen overskrift (valgfri)", "<input name=\"title\" value=\"" + esc(item.title || "") + "\" placeholder=\"Laves automatisk ud fra model, lager og farve\">") +
      field("Beskrivelse (valgfri)", "<textarea name=\"description\" rows=\"3\" placeholder=\"Fx: Lille ridse på bagsiden. Original æske medfølger.\">" + esc(item.description || "") + "</textarea>") +
      (item.ref
        ? "<div class=\"shop-admin-photos\">" + photos + "</div>" +
          "<label class=\"btn btn-ghost btn-small\" style=\"cursor:pointer\">Tilføj billeder<input type=\"file\" id=\"shop-photo\" accept=\"image/*\" multiple hidden></label> <span class=\"muted\" id=\"shop-photo-status\"></span>"
        : "<p class=\"muted\">Gem først, så kan du tilføje billeder.</p>") +
      "<p class=\"form-error\" id=\"shop-error\" hidden></p>" +
      "<div class=\"quick-actions\"><button class=\"btn\" type=\"submit\">Gem</button> <button class=\"btn btn-ghost\" type=\"button\" id=\"shop-close\">Luk</button>" +
      (item.ref ? " <a class=\"btn btn-ghost\" href=\"/koeb/" + esc(item.ref) + "\" target=\"_blank\" rel=\"noopener\">Se i butikken ↗</a>" : "") + "</div>" +
      "</form>"
    );
  }

  function paint() {
    const rows = data.listings
      .map(function (item) {
        const thumb = item.photos && item.photos[0] ? "<img src=\"/foto/" + esc(item.photos[0]) + "\" alt=\"\" class=\"shop-admin-thumb\">" : "<span class=\"shop-admin-thumb\"></span>";
        const profit = Number.isInteger(item.costDkk) ? money(item.priceDkk - item.costDkk) : "–";
        return "<tr><td>" + thumb + "</td><th>" + esc(item.title) + "<small>" + esc(item.ref) + " · " + esc(data.grades[item.grade] || item.grade) + (item.photos && item.photos.length ? "" : " · <span style=\"color:var(--bad)\">ingen billeder</span>") + "</small></th>" +
          "<td>" + money(item.priceDkk) + "<small>indkøb " + money(item.costDkk) + " · forskel " + profit + "</small></td>" +
          "<td>" + esc(data.statuses[item.status] || item.status) + "</td>" +
          "<td><button class=\"link-button\" type=\"button\" data-shop-edit=\"" + esc(item.ref) + "\">Ret</button></td></tr>";
      })
      .join("");
    box.innerHTML =
      "<div class=\"actions\" style=\"justify-content:space-between\"><h2 style=\"margin:0\">Lager i butikken</h2>" +
      "<span><a class=\"btn btn-ghost btn-small\" href=\"/koeb\" target=\"_blank\" rel=\"noopener\">Åbn butikken ↗</a> <button class=\"btn btn-small\" type=\"button\" id=\"shop-new\">Ny enhed</button></span></div>" +
      (data.cardEnabled ? "" : "<p class=\"muted\">Kortbetaling (Stripe) er ikke slået til, så kunderne bliver bedt om at ringe eller skrive for at købe.</p>") +
      (message ? "<p class=\"form-ok\">" + esc(message) + "</p>" : "") +
      (editing ? editorHtml(editing) : "") +
      (rows ? "<div class=\"table-wrap\"><table class=\"price-table price-admin\"><tbody>" + rows + "</tbody></table></div>" : "<p>Ingen enheder i butikken endnu.</p>");
    message = "";
  }

  function formValues(form) {
    const f = form.elements;
    const value = function (name) { return f[name] ? f[name].value : undefined; };
    return {
      modelId: value("modelId"),
      variant: value("variant") || "",
      storage: value("storage") || "",
      conn: value("conn") || "",
      grade: value("grade"),
      batteryPct: value("batteryPct"),
      color: value("color"),
      priceDkk: value("priceDkk"),
      costDkk: value("costDkk"),
      imei: value("imei"),
      buybackRef: value("buybackRef"),
      status: value("status"),
      title: value("title"),
      description: value("description")
    };
  }

  function showError(text) {
    const node = box.querySelector("#shop-error");
    if (!node) return;
    node.hidden = !text;
    node.textContent = text || "";
  }

  box.addEventListener("change", function (event) {
    const form = event.target.closest("#shop-form");
    if (!form || ["modelId"].indexOf(event.target.name) === -1) return;
    Object.assign(editing, formValues(form), { variant: "", storage: "", conn: "" });
    paint();
  });

  box.addEventListener("submit", async function (event) {
    if (event.target.id !== "shop-form") return;
    event.preventDefault();
    const values = formValues(event.target);
    try {
      const saved = editing.ref
        ? await api("PUT", "/api/admin/butik/vare/" + encodeURIComponent(editing.ref), values)
        : await api("POST", "/api/admin/butik/vare", values);
      message = editing.ref ? "Gemt." : "Lagt i butikken. Tilføj billeder nedenfor.";
      editing = saved;
      await load();
    } catch (error) {
      showError(error.message);
    }
  });

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
        canvas.toBlob(function (blob) { return blob ? resolve(blob) : reject(new Error("Billedet kunne ikke læses.")); }, "image/jpeg", 0.85);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Billedet kunne ikke læses."));
      };
      img.src = url;
    });
  }

  box.addEventListener("change", async function (event) {
    if (event.target.id !== "shop-photo") return;
    const files = Array.prototype.slice.call(event.target.files || []);
    const status = box.querySelector("#shop-photo-status");
    try {
      for (let i = 0; i < files.length; i += 1) {
        status.textContent = "Sender billede " + (i + 1) + " af " + files.length + "…";
        const blob = await shrink(files[i]);
        editing = await api("POST", "/api/admin/butik/vare/" + encodeURIComponent(editing.ref) + "/foto", blob, "image/jpeg");
      }
      message = "Billeder gemt.";
      await load();
    } catch (error) {
      status.textContent = "";
      showError(error.message);
    }
  });

  box.addEventListener("click", async function (event) {
    if (event.target.id === "shop-new") {
      editing = { ref: "", grade: "meget-god", status: "aktiv", photos: [] };
      paint();
      return;
    }
    if (event.target.id === "shop-close") {
      editing = null;
      paint();
      return;
    }
    const edit = event.target.closest("[data-shop-edit]");
    if (edit) {
      const ref = edit.getAttribute("data-shop-edit");
      editing = JSON.parse(JSON.stringify(data.listings.find(function (item) { return item.ref === ref; })));
      paint();
      box.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const remove = event.target.closest("[data-photo-delete]");
    if (remove) {
      try {
        editing = await api("DELETE", "/api/admin/butik/vare/" + encodeURIComponent(editing.ref) + "/foto/" + encodeURIComponent(remove.getAttribute("data-photo-delete")));
        await load();
      } catch (error) {
        showError(error.message);
      }
      return;
    }
    if (event.target.id === "shop-suggest") {
      const form = box.querySelector("#shop-form");
      const values = formValues(form);
      const text = box.querySelector("#shop-suggest-text");
      try {
        const result = await api("GET", "/api/admin/butik/forslag?" + new URLSearchParams({
          modelId: values.modelId || "", variant: values.variant, storage: values.storage, conn: values.conn, grade: values.grade || "", batteryPct: values.batteryPct || ""
        }));
        if (!result.priceDkk) {
          text.textContent = "Vælg model (og generation) først.";
          return;
        }
        form.elements.priceDkk.value = result.priceDkk;
        const cost = Number(String(values.costDkk || "").replace(/\./g, ""));
        text.textContent = "Salgsværdi i perfekt stand " + money(result.valueDkk) + "." + (cost ? " Forskel til indkøb " + money(result.priceDkk - cost) + "." : "");
      } catch (error) {
        text.textContent = error.message;
      }
    }
  });

  tabs.addEventListener("click", function (event) {
    const button = event.target.closest("[data-tab=\"butik\"]");
    if (button && !data) load();
  });

  document.addEventListener("shop:new", function (event) {
    pending = event.detail;
    message = "Tjek stand, batteri og pris, og tryk Gem.";
    load();
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();
