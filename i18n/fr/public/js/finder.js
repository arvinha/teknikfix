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
    if (repair.price === 0 && !repair.from) return "Gratuit";
    return (repair.from ? "fra " : "") + kr.format(repair.price) + " kr";
  }

  modelSelect.innerHTML =
    "<option value=\"\">Choisissez un modèle</option>" +
    catalog.groups
      .map(function (group) {
        return (
          "<optgroup label=\"" + esc(group.name) + "\">" +
          group.models.map(function (model) { return "<option value=\"" + esc(model.id) + "\">" + esc(model.name) + "</option>"; }).join("") +
          "</optgroup>"
        );
      })
      .join("") +
    "<option value=\"anden\">Mon modèle n'est pas dans la liste</option>";

  function unknown() {
    return modelSelect.value === "anden";
  }

  function sync() {
    const model = findModel(modelSelect.value);
    const repair = model && model.repairs.find(function (item) { return item.id === repairSelect.value; });
    result.hidden = !repair && !unknown();
    button.disabled = !repair && !unknown();
    button.textContent = unknown() ? "Obtenir une estimation gratuite" : buttonText;
    if (unknown()) {
      result.innerHTML =
        "<p class=\"finder-price\">Estimation gratuite</p>" +
        "<p class=\"finder-meta\">Nous réparons presque toutes les marques. Indiquez-nous le modèle et la panne, et vous recevrez un prix fixe avant que nous commencions.</p>";
    } else if (repair) {
      result.innerHTML =
        "<p class=\"finder-price\">" + priceText(repair) + "</p>" +
        "<p class=\"finder-meta\">" + esc(repair.time) + " · " +
        (repair.price === 0 ? "vous recevrez un prix fixe ensuite" : repair.from ? "prix définitif après un examen gratuit" : "prix fixe") + "</p>";
    }
  }

  modelSelect.addEventListener("change", function () {
    const model = findModel(modelSelect.value);
    repairSelect.disabled = !model;
    repairSelect.innerHTML = model
      ? "<option value=\"\">Choisissez une réparation</option>" +
        model.repairs.map(function (repair) { return "<option value=\"" + esc(repair.id) + "\">" + esc(repair.label) + "</option>"; }).join("")
      : "<option value=\"\">" + (unknown() ? "Nous verrons cela ensemble" : "Choisissez d'abord un modèle") + "</option>";
    sync();
  });

  repairSelect.addEventListener("change", sync);

  form.addEventListener("submit", function (event) {
    if (!unknown()) return;
    event.preventDefault();
    location.href = "/book";
  });
})();
