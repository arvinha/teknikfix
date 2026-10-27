(function () {
  const dataNode = document.querySelector("#parts-data");
  const select = document.querySelector("#part-model");
  const grid = document.querySelector("#part-grid");
  const linesBox = document.querySelector("#cart-lines");
  const payButton = document.querySelector("#pay");
  const cartError = document.querySelector("#cart-error");
  if (!dataNode || !select) return;
  const data = JSON.parse(dataNode.textContent);
  const cardOn = document.querySelector("#parts-config").getAttribute("data-card") === "1";
  const KEY = "teknikfix.cart.v1";
  const COUNTRY_KEY = "teknikfix.country";
  const kr = new Intl.NumberFormat("da-DK");
  const countrySelect = document.querySelector("#ship-country");
  let saved = "";
  try {
    saved = localStorage.getItem(COUNTRY_KEY) || "";
  } catch (error) {
    saved = "";
  }
  const preferred = saved || document.documentElement.getAttribute("data-country") || "";
  if (preferred && countrySelect.querySelector("option[value=\"" + preferred + "\"]")) countrySelect.value = preferred;

  function shipping() {
    if (!countrySelect.value) return null;
    return countrySelect.value === "DK" ? data.shippingDkk : data.shippingEuDkk;
  }

  const ICONS = {
    skaerm: "<rect x=\"6.5\" y=\"2.5\" width=\"11\" height=\"19\" rx=\"2.5\"/><path d=\"M8.5 5.5h7v12h-7z\"/>",
    batteri: "<rect x=\"7\" y=\"4\" width=\"10\" height=\"17\" rx=\"2\"/><path d=\"M10 2.5h4M12.5 9l-2 3.5h3l-2 3.5\"/>",
    bagglas: "<rect x=\"6.5\" y=\"2.5\" width=\"11\" height=\"19\" rx=\"2.5\"/><circle cx=\"10\" cy=\"6.5\" r=\"1.6\"/>",
    ladeport: "<path d=\"M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4\"/>",
    kamera: "<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"4\"/><circle cx=\"10\" cy=\"10\" r=\"2.2\"/><circle cx=\"14.5\" cy=\"14.5\" r=\"2.2\"/>"
  };

  const parts = new Map();
  const modelOf = new Map();
  data.groups.forEach(function (group) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.name;
    group.models.forEach(function (model) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.name;
      optgroup.appendChild(option);
      model.parts.forEach(function (part) {
        parts.set(part.id, Object.assign({ modelName: model.name, modelId: model.id }, part));
      });
      modelOf.set(model.id, model);
    });
    select.appendChild(optgroup);
  });

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function money(amount) {
    return kr.format(amount) + " kr";
  }

  function colorOf(part, id) {
    return (part.colors || []).find(function (color) { return color.id === id; });
  }

  function readCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return raw.filter(function (line) {
        const part = parts.get(line.id);
        return part && (!part.colors || colorOf(part, line.color));
      });
    } catch (error) {
      return [];
    }
  }

  let cart = readCart();

  function saveCart() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart));
    } catch (error) {
      // Private mode: the cart lives until the page closes.
    }
  }

  function paintParts() {
    const model = modelOf.get(select.value);
    if (!model) {
      grid.innerHTML = "";
      return;
    }
    const picked = {};
    grid.querySelectorAll("[data-color-for]").forEach(function (picker) { picked[picker.getAttribute("data-color-for")] = picker.value; });
    grid.innerHTML = model.parts
      .map(function (part) {
        const inCart = cart.some(function (line) { return line.id === part.id; });
        const book = "/book?model=" + encodeURIComponent(model.id) + "&reparation=" + encodeURIComponent(part.type);
        const colors = part.colors
          ? "<label class=\"field part-color\"><span>Kolor</span><select data-color-for=\"" + esc(part.id) + "\"><option value=\"\">Wybierz kolor</option>" +
            part.colors.map(function (color) { return "<option value=\"" + esc(color.id) + "\">" + esc(color.name) + "</option>"; }).join("") +
            "</select></label><p class=\"form-error\" data-color-error=\"" + esc(part.id) + "\" hidden>Najpierw wybierz kolor swojego telefonu.</p>"
          : "";
        return (
          "<article class=\"part-card\">" +
          "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\">" + (ICONS[part.type] || ICONS.skaerm) + "</svg>" +
          "<div><h3>" + esc(part.label) + "</h3><p class=\"muted\">" + esc(part.note) + "</p>" +
          "<p class=\"part-price\">" + money(part.priceDkk) + "</p>" + colors +
          "<div class=\"part-actions\"><button class=\"btn btn-small" + (inCart ? " btn-ghost" : "") + "\" type=\"button\" data-add=\"" + esc(part.id) + "\">" + (inCart ? "Dodaj jeszcze jedną do koszyka" : "Dodaj do koszyka") + "</button>" +
          "<a class=\"part-fit\" href=\"" + book + "\">Albo my ją wymienimy: " + money(part.repairPriceDkk) + "</a></div></div>" +
          "</article>"
        );
      })
      .join("");
    grid.querySelectorAll("[data-color-for]").forEach(function (picker) { picker.value = picked[picker.getAttribute("data-color-for")] || ""; });
  }

  function paintCart() {
    if (!cart.length) {
      linesBox.innerHTML = "<p class=\"muted\">Koszyk jest pusty.</p>";
      payButton.disabled = true;
      return;
    }
    const subtotal = cart.reduce(function (sum, line) { return sum + parts.get(line.id).priceDkk * line.qty; }, 0);
    linesBox.innerHTML =
      "<ul class=\"cart-list\">" +
      cart
        .map(function (line, index) {
          const part = parts.get(line.id);
          const color = line.color ? colorOf(part, line.color) : null;
          return (
            "<li><div><strong>" + esc(part.label) + "</strong><span>" + esc(part.modelName) + (color ? " · " + esc(color.name) : "") + "</span>" +
            "<span class=\"cart-qty\"><button type=\"button\" data-dec=\"" + index + "\" aria-label=\"Én mindre\">−</button>" + line.qty +
            "<button type=\"button\" data-inc=\"" + index + "\" aria-label=\"Én mere\">+</button></span></div>" +
            "<strong>" + money(part.priceDkk * line.qty) + "</strong></li>"
          );
        })
        .join("") +
      "</ul>" +
      "<p class=\"cart-sum\"><span>Dostawa</span><span>" + (shipping() === null ? "Wybierz kraj" : money(shipping())) + "</span></p>" +
      "<p class=\"cart-sum cart-total\"><span>Razem</span><strong>" + money(subtotal + (shipping() || 0)) + "</strong></p>";
    payButton.disabled = !cardOn || shipping() === null;
    if (!cardOn) {
      cartError.hidden = false;
      cartError.textContent = "Płatność kartą nie jest jeszcze włączona. Zadzwoń do nas, a złożymy zamówienie za Ciebie.";
    }
  }

  function add(id, color) {
    const line = cart.find(function (entry) { return entry.id === id && (entry.color || "") === color; });
    if (line) line.qty = Math.min(10, line.qty + 1);
    else cart.push(color ? { id: id, qty: 1, color: color } : { id: id, qty: 1 });
    saveCart();
    paintCart();
    paintParts();
  }

  grid.addEventListener("click", function (event) {
    const button = event.target.closest("[data-add]");
    if (!button) return;
    const id = button.getAttribute("data-add");
    const picker = grid.querySelector("[data-color-for=\"" + id + "\"]");
    if (picker && !picker.value) {
      grid.querySelector("[data-color-error=\"" + id + "\"]").hidden = false;
      picker.focus();
      return;
    }
    add(id, picker ? picker.value : "");
  });

  grid.addEventListener("change", function (event) {
    const id = event.target.getAttribute("data-color-for");
    if (id) grid.querySelector("[data-color-error=\"" + id + "\"]").hidden = true;
  });

  linesBox.addEventListener("click", function (event) {
    const inc = event.target.closest("[data-inc]");
    const dec = event.target.closest("[data-dec]");
    if (inc) cart[Number(inc.getAttribute("data-inc"))].qty = Math.min(10, cart[Number(inc.getAttribute("data-inc"))].qty + 1);
    if (dec) {
      const index = Number(dec.getAttribute("data-dec"));
      cart[index].qty -= 1;
      if (cart[index].qty <= 0) cart.splice(index, 1);
    }
    if (inc || dec) {
      saveCart();
      paintCart();
      paintParts();
    }
  });

  countrySelect.addEventListener("change", function () {
    try {
      localStorage.setItem(COUNTRY_KEY, countrySelect.value);
    } catch (error) {
      // Private mode: the choice lasts until the page closes.
    }
    paintCart();
  });

  select.addEventListener("change", function () {
    if (select.value) {
      location.href = location.pathname.replace(/(\/reservedele)(\/.*)?$/, "$1/") + encodeURIComponent(select.value);
      return;
    }
    paintParts();
  });

  payButton.addEventListener("click", async function () {
    cartError.hidden = true;
    payButton.disabled = true;
    try {
      const response = await fetch("/api/dele/kurv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: cart, country: countrySelect.value }) });
      const body = await response.json().catch(function () { return {}; });
      if (!response.ok || !body.url) throw new Error(body.message || "Nie udało się uruchomić płatności.");
      location.href = body.url;
    } catch (error) {
      cartError.hidden = false;
      cartError.textContent = error.message;
      payButton.disabled = false;
    }
  });

  const params = new URLSearchParams(location.search);
  if (params.get("betaling") === "afbrudt") document.querySelector("#cancelled").hidden = false;
  const start = params.get("model") || document.querySelector("#parts-config").getAttribute("data-model");
  if (start && modelOf.has(start)) select.value = start;
  paintParts();
  paintCart();
})();
