/* TTK front-end behaviour: sidebar toggle, HTMX modal, segmented controls, BS date-picker hook.
   No framework, no CDN. CSRF: the X-CSRF-Token header is set once on <body hx-headers>. */
(function () {
  "use strict";

  // --- Sidebar (stacked layout under ~800px) ---------------------------------------------------
  document.addEventListener("click", function (event) {
    var toggle = event.target.closest("[data-sidebar-toggle]");
    if (!toggle) return;
    var sidebar = toggle.closest("[data-sidebar]");
    var open = sidebar.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // --- Modal (content is loaded by HTMX into #modal-root) -------------------------------------
  var modalRoot = document.getElementById("modal-root");

  function closeModal() {
    if (!modalRoot || !modalRoot.firstElementChild) return;
    var opener = modalRoot.__opener;
    modalRoot.innerHTML = "";
    if (opener && typeof opener.focus === "function") opener.focus();
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-modal-close]")) {
      event.preventDefault();
      closeModal();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeModal();
  });

  document.body.addEventListener("htmx:beforeRequest", function (event) {
    var el = event.detail && event.detail.elt;
    if (el && modalRoot && el.getAttribute("hx-target") === "#modal-root") modalRoot.__opener = el;
  });

  document.body.addEventListener("htmx:afterSwap", function (event) {
    if (!modalRoot || event.detail.target !== modalRoot) return;
    var dialog = modalRoot.querySelector("[data-modal]");
    if (!dialog) return;
    var focusable = dialog.querySelector("input, select, textarea, button:not([data-modal-close]), a[href]");
    (focusable || dialog).focus();
  });

  // Server-side "close the modal" hint: respond with the HX-Trigger header "closeModal".
  document.body.addEventListener("closeModal", closeModal);

  // --- Segmented controls (client-side toggles emit "segmented:change") -----------------------
  document.addEventListener("click", function (event) {
    var button = event.target.closest(".segmented__btn[type='button']");
    if (!button) return;
    var group = button.closest("[data-segmented]");
    group.querySelectorAll(".segmented__btn").forEach(function (b) {
      b.setAttribute("aria-pressed", b === button ? "true" : "false");
    });
    group.dispatchEvent(new CustomEvent("segmented:change", { bubbles: true, detail: { value: button.dataset.value } }));
  });

  // --- Surface HTMX errors as a flash ---------------------------------------------------------
  document.body.addEventListener("htmx:responseError", function (event) {
    var main = document.getElementById("main");
    if (!main) return;
    var alert = document.createElement("div");
    alert.className = "alert alert--danger";
    alert.setAttribute("role", "alert");
    alert.textContent = "Request failed (" + event.detail.xhr.status + "). Please try again.";
    main.insertBefore(alert, main.firstChild);
    setTimeout(function () { alert.remove(); }, 6000);
  });

  // --- Nepali date-picker enhancement ---------------------------------------------------------
  // TODO: confirm the initialisation API of static/vendor/nepali.datepicker.v4.min.js once it is
  // vendored (the hook below covers the common v4 global names and is a no-op otherwise).
  function initDatePickers(scope) {
    var inputs = (scope || document).querySelectorAll("[data-bs-date]:not([data-bs-date-ready])");
    if (!inputs.length) return;
    inputs.forEach(function (input) {
      input.setAttribute("data-bs-date-ready", "1");
      if (typeof window.nepaliDatePicker === "function") {
        window.nepaliDatePicker(input, { dateFormat: "YYYY-MM-DD", ndpYear: true, ndpMonth: true });
      } else if (typeof input.nepaliDatePicker === "function") {
        input.nepaliDatePicker({ dateFormat: "YYYY-MM-DD", ndpYear: true, ndpMonth: true });
      } else if (window.NepaliDatePicker && typeof window.NepaliDatePicker === "function") {
        new window.NepaliDatePicker(input, { dateFormat: "YYYY-MM-DD" });
      }
    });
  }
  initDatePickers(document);
  document.body.addEventListener("htmx:afterSwap", function (event) { initDatePickers(event.detail.target); });
})();
