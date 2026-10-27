(function () {
  const header = document.querySelector(".site-header");
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("#nav");

  function setOpen(open) {
    if (!nav || !toggle) return;
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Luk" : "Menu";
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      setOpen(!nav.classList.contains("is-open"));
    });
  }

  const langMenu = document.querySelector(".lang-menu");

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      setOpen(false);
      if (langMenu) langMenu.open = false;
    }
  });

  document.addEventListener("click", function (event) {
    if (langMenu && langMenu.open && !langMenu.contains(event.target)) langMenu.open = false;
  });

  if (nav) {
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });
  }

  function onScroll() {
    if (header) header.classList.toggle("is-scrolled", window.scrollY > 4);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  async function copyText(button, value) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = "Kopieret";
    } catch (error) {
      window.prompt("Kopiér teksten:", value);
    }
    setTimeout(function () {
      button.textContent = original;
    }, 1400);
  }

  document.querySelectorAll("[data-copy]").forEach(function (button) {
    button.addEventListener("click", function () {
      copyText(button, button.getAttribute("data-copy") || "");
    });
  });

  document.querySelectorAll("[data-copy-target]").forEach(function (button) {
    button.addEventListener("click", function () {
      const target = document.querySelector(button.getAttribute("data-copy-target"));
      if (target) copyText(button, target.value || target.textContent || "");
    });
  });
})();
