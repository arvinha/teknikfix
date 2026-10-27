(function () {
  const form = document.querySelector("#finder");
  if (!form) return;

  const modelSelect = document.querySelector("#finder-model");
  const repairSelect = document.querySelector("#finder-repair");
  const result = document.querySelector("#finder-result");
  const button = document.querySelector("#finder-btn");
  const buttonText = button.textContent;
  const kr = new Intl.NumberFormat("da-DK");
  let catalog = { groups: [] };
  try {
    catalog = JSON.parse(document.querySelector("#price-data").textContent);
  } catch (err) {
    return;
  }

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function findModel(id) {
    for (const group of catalog.groups) {
      for (const model of group.models) {
        if (model.id === id) return model;
      }
    }
    return null;
  }

  function priceText(repair) {
    if (repair.price === 0 && !repair.from) return "Gratis";
    return (repair.from ? "fra " : "") + kr.format(repair.price) + " kr";
  }

  modelSelect.innerHTML =
    "<option value=\"\">Scegli il modello</option>" +
    catalog.groups
      .map(function (group) {
        return (
          "<optgroup label=\"" + esc(group.name) + "\">" +
          group.models.map(function (model) { return "<option value=\"" + esc(model.id) + "\">" + esc(model.name) + "</option>"; }).join("") +
          "</optgroup>"
        );
      })
      .join("") +
    "<option value=\"anden\">Il mio modello non è in elenco</option>";

  function unknown() {
    return modelSelect.value === "anden";
  }

  function sync() {
    const model = findModel(modelSelect.value);
    const repair = model && model.repairs.find(function (item) { return item.id === repairSelect.value; });
    result.hidden = !repair && !unknown();
    button.disabled = !repair && !unknown();
    button.textContent = unknown() ? "Richiedi una valutazione gratuita" : buttonText;
    if (unknown()) {
      result.innerHTML =
        "<p class=\"finder-price\">Valutazione gratuita</p>" +
        "<p class=\"finder-meta\">Ripariamo quasi tutte le marche. Scrivici modello e guasto e prima di iniziare ti diamo un prezzo fisso.</p>";
    } else if (repair) {
      result.innerHTML =
        "<p class=\"finder-price\">" + priceText(repair) + "</p>" +
        "<p class=\"finder-meta\">" + esc(repair.time) + " · " +
        (repair.price === 0 ? "il prezzo fisso te lo diamo dopo" : repair.from ? "prezzo definitivo dopo il controllo gratuito" : "prezzo fisso") + "</p>";
    }
  }

  modelSelect.addEventListener("change", function () {
    const model = findModel(modelSelect.value);
    repairSelect.disabled = !model;
    repairSelect.innerHTML = model
      ? "<option value=\"\">Scegli la riparazione</option>" +
        model.repairs.map(function (repair) { return "<option value=\"" + esc(repair.id) + "\">" + esc(repair.label) + "</option>"; }).join("")
      : "<option value=\"\">" + (unknown() ? "Lo scopriamo insieme" : "Scegli prima il modello") + "</option>";
    sync();
  });

  repairSelect.addEventListener("change", sync);

  form.addEventListener("submit", function (event) {
    if (!unknown()) return;
    event.preventDefault();
    location.href = "/book";
  });
})();
