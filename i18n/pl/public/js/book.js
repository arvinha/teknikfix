(function () {
  const form = document.querySelector("#book-form");
  if (!form) return;

  const steps = Array.prototype.slice.call(form.querySelectorAll("[data-step]"));
  const bars = Array.prototype.slice.call(document.querySelectorAll(".steps-bar span"));
  const next = document.querySelector("#next");
  const back = document.querySelector("#back");
  const send = document.querySelector("#send");
  const error = document.querySelector("#form-error");
  const live = document.querySelector("#step-live");
  const stepCount = document.querySelector("#step-count");
  const addressWrap = document.querySelector("#address-wrap");
  const postNote = document.querySelector("#post-note");
  const timeWrap = document.querySelector("#time-wrap");
  const timePick = document.querySelector("#time-pick");
  const dayChips = document.querySelector("#day-chips");
  const slotChips = document.querySelector("#slot-chips");
  const timeDate = document.querySelector("#time-date");
  const timeSlot = document.querySelector("#time-slot");
  const pickWrap = document.querySelector("#pick-wrap");
  const modelSelect = document.querySelector("#model-select");
  const repairWrap = document.querySelector("#repair-wrap");
  const repairGrid = document.querySelector("#repair-grid");
  const estimateBox = document.querySelector("#estimate");
  const reviewBox = document.querySelector("#review");
  const payChoice = document.querySelector("#pay-choice");
  const modelText = document.querySelector("#model-text");
  const modelNote = document.querySelector("#pick-wrap .field-note");
  const problemWrap = document.querySelector("#problem-wrap");
  const problemOpen = document.querySelector("#problem-open");
  const problemLabel = document.querySelector("#problem-label");
  const config = document.querySelector("#book-config");
  const cardEnabled = Boolean(config && config.dataset.card);
  let catalog = { groups: [], stockNote: "" };
  try {
    catalog = JSON.parse(document.querySelector("#price-data").textContent);
  } catch (err) {
    catalog = { groups: [], stockNote: "" };
  }
  let index = 0;
  let problemOpened = false;

  const kr = new Intl.NumberFormat("da-DK");
  const SLOTS = [
    { value: "formiddag", label: "Przedpołudnie", time: "9–12", ends: 12 },
    { value: "eftermiddag", label: "Popołudnie", time: "12–17", ends: 17 },
    { value: "aften", label: "Wieczór", time: "17–22", ends: 22 }
  ];
  const DEVICE_NAMES = { telefon: "Telefon", computer: "Komputer", tablet: "Tablet", andet: "Inne" };

  function isoDay(offset) {
    const day = new Date();
    day.setDate(day.getDate() + offset);
    return day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
  }
  timeDate.min = isoDay(0);
  timeDate.max = isoDay(60);
  timeDate.value = isoDay(1);

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function device() {
    return form.elements.device.value;
  }

  function visit() {
    return form.elements.visit.value;
  }

  function when() {
    return form.elements.when.value;
  }

  function groupsFor(dev) {
    return catalog.groups.filter(function (group) { return group.device === dev; });
  }

  function findModel(id) {
    for (const group of catalog.groups) {
      for (const model of group.models) {
        if (model.id === id) return { group: group, model: model };
      }
    }
    return null;
  }

  function checkedIds() {
    return Array.prototype.map.call(form.querySelectorAll('input[name="repairIds"]:checked'), function (input) { return input.value; });
  }

  function otherChecked() {
    const input = form.querySelector('input[name="other"]');
    return Boolean(input && input.checked);
  }

  function chosenRepairs() {
    const found = findModel(modelSelect.value);
    if (!found) return null;
    const ids = checkedIds();
    const repairs = found.model.repairs.filter(function (item) { return ids.indexOf(item.id) !== -1; });
    if (repairs.length === 0) return null;
    return {
      model: found.model,
      repairs: repairs,
      price: repairs.reduce(function (sum, item) { return sum + item.price; }, 0),
      from: repairs.some(function (item) { return item.from; })
    };
  }

  function priceText(item) {
    if (item.price === 0 && !item.from) return "Bezpłatnie";
    return (item.from ? "fra " : "") + kr.format(item.price) + " kr";
  }

  function joinDa(words) {
    if (words.length < 2) return words.join("");
    return words.slice(0, -1).join(", ") + " og " + words[words.length - 1];
  }

  function repairList(pick) {
    return joinDa(pick.repairs.map(function (repair, i) { return i === 0 ? repair.label : repair.label.toLowerCase(); }));
  }

  function fillModels() {
    const groups = groupsFor(device());
    pickWrap.hidden = groups.length === 0;
    const current = modelSelect.value;
    modelSelect.innerHTML =
      "<option value=\"\">Wybierz model</option>" +
      groups
        .map(function (group) {
          return (
            "<optgroup label=\"" + esc(group.name) + "\">" +
            group.models.map(function (model) { return "<option value=\"" + esc(model.id) + "\">" + esc(model.name) + "</option>"; }).join("") +
            "</optgroup>"
          );
        })
        .join("") +
      (groups.length ? "<option value=\"anden\">Mojego modelu nie ma na liście / nie wiem</option>" : "");
    if (current && modelSelect.querySelector("option[value=\"" + current + "\"]")) modelSelect.value = current;
  }

  function fillRepairs() {
    const found = findModel(modelSelect.value);
    repairWrap.hidden = !found;
    if (!found) {
      repairGrid.innerHTML = "";
      return;
    }
    const keep = checkedIds();
    const keepOther = otherChecked();
    repairGrid.innerHTML =
      found.model.repairs
        .map(function (repair) {
          return (
            "<label class=\"choice\"><input type=\"checkbox\" name=\"repairIds\" value=\"" + esc(repair.id) + "\"" + (keep.indexOf(repair.id) !== -1 ? " checked" : "") + ">" +
            "<strong>" + esc(repair.label) + "</strong><small><b>" + esc(priceText(repair)) + "</b> · " + esc(repair.time) + "</small></label>"
          );
        })
        .join("") +
      "<label class=\"choice\"><input type=\"checkbox\" name=\"other\" value=\"ja\"" + (keepOther ? " checked" : "") + "><strong>Inne</strong><small>Opisz usterkę</small></label>";
  }

  function estimateHtml(pick, other) {
    const many = pick.repairs.length > 1;
    const lines = many
      ? "<ul class=\"estimate-lines\">" +
        pick.repairs
          .map(function (repair) {
            return "<li><span>" + esc(repair.label) + " <small>" + esc(repair.time) + "</small></span><span>" + esc(priceText(repair)) + "</span></li>";
          })
          .join("") +
        "</ul>"
      : "";
    const meta = many
      ? esc(pick.model.name) + " · " + pick.repairs.length + " naprawy, zrobimy je za jednym razem"
      : "<strong>Tid: " + esc(pick.repairs[0].time) + "</strong> · " + esc(pick.model.name) + ", " + esc(pick.repairs[0].label.toLowerCase());
    return (
      lines +
      "<p class=\"estimate-price\">" + (many ? "<span class=\"estimate-total\">Razem</span> " : "") + esc(priceText(pick)) + "</p>" +
      "<p class=\"estimate-meta\">" + meta + "</p>" +
      "<small>" + priceNote(pick, other) + "</small>"
    );
  }

  function priceNote(pick, other) {
    const checkOnly = pick.price === 0 && !pick.from;
    return (
      (checkOnly
        ? "Znajdziemy usterkę za darmo i podamy Ci stałą cenę. To Ty decydujesz, czy zaczynamy."
        : pick.from
          ? "Ostateczna cena po bezpłatnej diagnozie, przed rozpoczęciem naprawy."
          : "Stała cena. 0 DKK, jeśli nie da się naprawić.") +
      (other ? " Cenę za „Inne” podamy, gdy zobaczymy urządzenie." : "")
    );
  }

  function dayLabel(iso) {
    if (iso === isoDay(0)) return "Dziś";
    if (iso === isoDay(1)) return "Jutro";
    const parts = iso.split("-").map(Number);
    const day = new Date(parts[0], parts[1] - 1, parts[2]);
    return day.toLocaleDateString("da-DK", { weekday: "short" }).replace(".", "") + " " + parts[2] + "/" + parts[1];
  }

  function whenText() {
    if (when() !== "tidspunkt") return "Jak najszybciej";
    const slot = SLOTS.find(function (item) { return item.value === timeSlot.value; });
    const day = dayLabel(timeDate.value);
    return (/^I /.test(day) ? day : day.charAt(0).toUpperCase() + day.slice(1)) + ", " + (slot ? slot.label.toLowerCase() + " " + slot.time : "");
  }

  function slotPassed(slot) {
    return timeDate.value === isoDay(0) && new Date().getHours() >= slot.ends - 1;
  }

  function buildDays() {
    const first = new Date().getHours() >= 21 ? 1 : 0;
    let html = "";
    for (let offset = first; offset < first + 14; offset += 1) {
      const iso = isoDay(offset);
      const parts = dayLabel(iso).split(" ");
      const big = offset < 2 ? dayLabel(iso) : parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      const small = offset < 2 ? iso.slice(8).replace(/^0/, "") + "/" + iso.slice(5, 7).replace(/^0/, "") : parts[1];
      html += "<button type=\"button\" class=\"chip-btn\" role=\"radio\" data-day=\"" + iso + "\"><strong>" + esc(big) + "</strong><small>" + esc(small) + "</small></button>";
    }
    dayChips.innerHTML = html;
  }

  function syncTimePick() {
    Array.prototype.forEach.call(dayChips.children, function (chip) {
      chip.setAttribute("aria-checked", String(chip.dataset.day === timeDate.value));
    });
    if (SLOTS.some(function (slot) { return slot.value === timeSlot.value && slotPassed(slot); })) {
      const open = SLOTS.find(function (slot) { return !slotPassed(slot); });
      if (open) timeSlot.value = open.value;
    }
    slotChips.innerHTML = SLOTS.map(function (slot) {
      const passed = slotPassed(slot);
      return (
        "<button type=\"button\" class=\"chip-btn\" role=\"radio\" data-slot=\"" + slot.value + "\" aria-checked=\"" + String(slot.value === timeSlot.value) + "\"" + (passed ? " disabled" : "") + ">" +
        "<strong>" + slot.label + "</strong><small>" + slot.time + "</small></button>"
      );
    }).join("");
  }

  function reviewRow(label, value, step) {
    return (
      "<li><span class=\"review-label\">" + label + "</span><span class=\"review-value\">" + value + "</span>" +
      "<button type=\"button\" class=\"link-button\" data-goto=\"" + step + "\">Zmień</button></li>"
    );
  }

  function syncReview(pick, other) {
    const found = findModel(modelSelect.value);
    const modelName = found ? found.model.name : form.elements.model.value.trim();
    const what = pick ? repairList(pick) + (other ? " + inne" : "") : form.elements.problem.value.trim();
    const where = visit() === "hjemme"
      ? "Przyjedziemy pod adres " + esc(form.elements.address.value.trim())
      : visit() === "post" ? "Wysyłasz je pocztą"
      : visit() === "vaerksted" ? "Przynosisz je do nas w Aalborg Øst" : "";
    reviewBox.hidden = !device();
    reviewBox.innerHTML =
      "<p class=\"review-title\">Twoja rezerwacja</p><ul>" +
      reviewRow("Urządzenie", esc(DEVICE_NAMES[device()] || "") + (modelName ? " · " + esc(modelName) : ""), 0) +
      (what ? reviewRow("Usterka", esc(what.length > 80 ? what.slice(0, 80) + "…" : what), 1) : "") +
      (where ? reviewRow("Gdzie", where, 2) : "") +
      reviewRow("Kiedy", esc(whenText()), 2) +
      "</ul>" +
      (pick
        ? "<div class=\"review-price\"><span>" + (pick.repairs.length > 1 ? "Razem" : "Cena") + "</span><strong>" + esc(priceText(pick)) + "</strong></div>" +
          "<small class=\"review-note\">" + priceNote(pick, other) + "</small>"
        : "<small class=\"review-note\">Cenę poznasz, zanim zaczniemy. Diagnoza jest bezpłatna.</small>");
  }

  function syncEstimate() {
    const pick = chosenRepairs();
    const other = otherChecked();
    const unknownModel = modelSelect.value === "anden" || pickWrap.hidden;
    estimateBox.hidden = !pick;
    if (pick) estimateBox.innerHTML = estimateHtml(pick, other);
    modelText.hidden = !unknownModel;
    modelNote.hidden = Boolean(findModel(modelSelect.value));
    const needProblem = !pick || other;
    const waitingForChoice = !pickWrap.hidden && (!modelSelect.value || (!unknownModel && !pick && !other));
    const hasText = form.elements.problem.value.trim() !== "";
    problemWrap.hidden = waitingForChoice || (!needProblem && !problemOpened && !hasText);
    problemOpen.hidden = !problemWrap.hidden || waitingForChoice;
    form.elements.problem.required = needProblem && !problemWrap.hidden;
    form.elements.problem.minLength = needProblem ? 8 : 0;
    problemLabel.textContent = other ? "Opisz usterkę" : needProblem ? "Co jest nie tak?" : "Wiadomość do nas (opcjonalnie)";
    const canPayNow = Boolean(pick && !pick.from && pick.price > 0 && !other && cardEnabled);
    payChoice.hidden = !canPayNow;
    if (!canPayNow) form.querySelector('input[name="payWhen"][value="efter"]').checked = true;
    send.textContent = canPayNow && form.elements.payWhen.value === "nu" ? "Zarezerwuj i zapłać " + priceText(pick) : "Wyślij rezerwację";
    syncReview(pick, other);
  }

  function syncFields() {
    const home = visit() === "hjemme" || visit() === "post";
    addressWrap.hidden = !home;
    form.elements.address.required = home;
    postNote.hidden = visit() !== "post";
    const timed = when() === "tidspunkt";
    timeWrap.hidden = true;
    timePick.hidden = !timed;
    if (timed) syncTimePick();
    syncEstimate();
  }

  function showError(message) {
    error.hidden = !message;
    error.textContent = message || "";
  }

  function scrollToForm() {
    const header = document.querySelector(".site-header");
    const offset = (header ? header.offsetHeight : 0) + 12;
    const top = form.getBoundingClientRect().top;
    if (top < offset || top > window.innerHeight * 0.5) {
      window.scrollTo({ top: window.scrollY + top - offset, behavior: "smooth" });
    }
  }

  function show(step, options) {
    const opts = options || {};
    index = step;
    steps.forEach(function (item, itemIndex) {
      item.classList.toggle("is-active", itemIndex === step);
    });
    bars.forEach(function (bar, barIndex) {
      bar.classList.toggle("is-on", barIndex <= step);
      bar.classList.toggle("is-done", barIndex < step);
    });
    back.hidden = step === 0;
    next.hidden = step === steps.length - 1 || (step === 0 && !device());
    send.hidden = step !== steps.length - 1;
    form.classList.toggle("is-first", step === 0);
    const label = "Krok " + (step + 1) + " af " + steps.length;
    live.textContent = label;
    stepCount.textContent = label;
    stepCount.hidden = false;
    syncFields();
    if (opts.scroll !== false) scrollToForm();
    const heading = steps[step].querySelector("h2");
    if (heading) heading.setAttribute("tabindex", "-1");
    if (heading && step > 0 && opts.focus !== false) heading.focus({ preventScroll: true });
  }

  function goTo(step) {
    if (step === index) return;
    if (step < index && history.state && history.state.bookStep === index) {
      history.go(step - index);
      return;
    }
    if (step > index) history.pushState({ bookStep: step }, "", location.href);
    else history.replaceState({ bookStep: step }, "", location.href);
    showError("");
    show(step);
  }

  function validate(step) {
    if (step === 0 && !device()) return "Wybierz telefon, komputer, tablet lub inne.";
    if (step === 1 && !pickWrap.hidden && !modelSelect.value) return "Wybierz swój model albo opcję „Mojego modelu nie ma na liście”.";
    if (step === 1 && (!chosenRepairs() || otherChecked()) && form.elements.problem.value.trim().length < 8) {
      if (!pickWrap.hidden && modelSelect.value && modelSelect.value !== "anden" && !chosenRepairs() && !otherChecked()) {
        return "Wybierz, co trzeba zrobić. Możesz wybrać kilka rzeczy.";
      }
      return "Napisz krótko, co jest nie tak. Wystarczy kilka słów.";
    }
    if (step === 2 && !visit()) return "Wybierz, czy przynosisz urządzenie, wysyłasz je, czy mamy przyjechać do Ciebie.";
    if (step === 2 && visit() === "hjemme" && form.elements.address.value.trim().length < 5) {
      return "Wpisz adres, pod który mamy przyjechać.";
    }
    if (step === 2 && visit() === "post" && form.elements.address.value.trim().length < 5) {
      return "Wpisz swój adres, żebyśmy mogli odesłać urządzenie.";
    }
    if (step === 2 && when() === "tidspunkt" && (!timeDate.value || timeDate.value < timeDate.min)) {
      return "Wybierz dzień od dziś wzwyż.";
    }
    if (step === 3 && form.elements.name.value.trim().length < 2) return "Wpisz swoje imię i nazwisko.";
    if (step === 3 && form.elements.phone.value.replace(/\D/g, "").length < 8) return "Wpisz numer telefonu.";
    if (step === 3 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.elements.email.value.trim())) {
      return "Wpisz adres e-mail, na który możemy odpisać.";
    }
    return "";
  }

  function advance() {
    const message = validate(index);
    showError(message);
    if (message) {
      error.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    goTo(Math.min(index + 1, steps.length - 1));
  }

  form.classList.add("is-stepped");
  form.noValidate = true;
  next.hidden = false;
  back.hidden = false;
  send.hidden = true;
  buildDays();

  const params = new URLSearchParams(location.search);
  const maade = params.get("maade");
  if (["vaerksted", "hjemme", "post"].indexOf(maade) !== -1) {
    const input = form.querySelector('input[name="visit"][value="' + maade + '"]');
    if (input) input.checked = true;
  }
  let startStep = 0;
  const preset = findModel(params.get("model") || "");
  if (preset) {
    const deviceInput = form.querySelector('input[name="device"][value="' + preset.group.device + '"]');
    if (deviceInput) {
      deviceInput.checked = true;
      fillModels();
      modelSelect.value = preset.model.id;
      fillRepairs();
      (params.get("reparation") || "").split(",").forEach(function (id) {
        const repairInput = id && repairGrid.querySelector('input[name="repairIds"][value="' + id + '"]');
        if (repairInput) repairInput.checked = true;
      });
      startStep = 1;
    }
  }

  form.addEventListener("change", function (event) {
    if (event.target.name === "device") {
      modelSelect.value = "";
      fillModels();
      fillRepairs();
    }
    if (event.target === modelSelect) {
      fillRepairs();
      if (!repairWrap.hidden) repairWrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (event.target.name === "when" && when() === "tidspunkt") {
      setTimeout(function () { timePick.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 50);
    }
    syncFields();
  });

  form.addEventListener("input", function (event) {
    if (event.target === form.elements.problem || event.target === form.elements.address) syncReview(chosenRepairs(), otherChecked());
  });

  form.addEventListener("click", function (event) {
    const target = event.target;
    if (target.name === "device" && index === 0) {
      setTimeout(function () {
        showError("");
        goTo(1);
      }, 160);
      return;
    }
    const day = target.closest && target.closest("[data-day]");
    if (day) {
      timeDate.value = day.dataset.day;
      syncFields();
      return;
    }
    const slot = target.closest && target.closest("[data-slot]");
    if (slot && !slot.disabled) {
      timeSlot.value = slot.dataset.slot;
      syncFields();
      return;
    }
    const jump = target.closest && target.closest("[data-goto]");
    if (jump) goTo(Number(jump.dataset.goto));
  });

  problemOpen.addEventListener("click", function () {
    problemOpened = true;
    syncEstimate();
    form.elements.problem.focus();
  });

  bars.forEach(function (bar, barIndex) {
    bar.addEventListener("click", function () {
      if (barIndex < index) goTo(barIndex);
    });
  });

  next.addEventListener("click", advance);

  back.addEventListener("click", function () {
    goTo(Math.max(index - 1, 0));
  });

  window.addEventListener("popstate", function (event) {
    const step = event.state && typeof event.state.bookStep === "number" ? event.state.bookStep : 0;
    showError("");
    show(Math.min(Math.max(step, 0), steps.length - 1));
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    syncFields();
    for (let step = 0; step < steps.length; step += 1) {
      const message = validate(step);
      if (message) {
        if (step !== index) goTo(step);
        showError(message);
        return;
      }
    }
    send.disabled = true;
    showError("");
    const pick = chosenRepairs();
    const data = {
      device: device(),
      modelId: pick ? pick.model.id : "",
      repairIds: pick ? pick.repairs.map(function (repair) { return repair.id; }) : [],
      other: otherChecked() ? "ja" : "",
      model: form.elements.model.value,
      problem: form.elements.problem.value,
      visit: visit(),
      address: form.elements.address.value,
      when: when(),
      timeDate: when() === "tidspunkt" ? timeDate.value : "",
      timeSlot: when() === "tidspunkt" ? timeSlot.value : "",
      name: form.elements.name.value,
      phone: form.elements.phone.value,
      email: form.elements.email.value,
      payWhen: payChoice.hidden ? "efter" : form.elements.payWhen.value,
      consent: "ja"
    };
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data)
      });
      const body = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        showError(body.message || "Zgłoszenie nie zostało wysłane. Zadzwoń do nas, a my się tym zajmiemy.");
        send.disabled = false;
        return;
      }
      if (body.payUrl) {
        location.href = body.payUrl;
        return;
      }
      const done = document.createElement("div");
      done.className = "panel form-done";
      done.innerHTML =
        "<div class=\"done-mark\" aria-hidden=\"true\">✓</div>" +
        "<h2>Dziękujemy, mamy Twoją rezerwację</h2><p>Numer zgłoszenia <strong>" +
        esc(body.ref) +
        "</strong>. Vi bekræfter tiden på sms eller e-mail. Kom først, når du har fået bekræftelsen.</p>" +
        (pick
          ? "<p>" + esc(repairList(pick)) +
            ": <strong>" + esc(priceText(pick)) + "</strong>" + (pick.repairs.length === 1 ? " · Czas: " + esc(pick.repairs[0].time) : "") + "</p>"
          : "") +
        (data.payWhen === "nu" ? "<p>Nie udało się teraz uruchomić płatności. Możesz zapłacić, gdy naprawa będzie gotowa.</p>" : "") +
        "<p><a class=\"btn\" href=\"/sag?ref=" + encodeURIComponent(body.ref) + "\">Śledź zgłoszenie</a></p>";
      form.replaceWith(done);
      done.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (err) {
      showError("Połączenie nie powiodło się. Spróbuj jeszcze raz albo zadzwoń do nas.");
      send.disabled = false;
    }
  });

  fillModels();
  fillRepairs();
  if (startStep > 0) {
    history.replaceState({ bookStep: 0 }, "", location.href);
    history.pushState({ bookStep: startStep }, "", location.href);
  } else {
    history.replaceState({ bookStep: 0 }, "", location.href);
  }
  show(startStep, { scroll: startStep > 0, focus: false });
})();
