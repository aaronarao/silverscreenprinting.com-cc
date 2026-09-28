// Menu drawer (tablet/phone) and Services submenus (all menus).

// Submenus: tap/click toggles. On desktop the header dropdown also opens on hover (CSS).
document.querySelectorAll("[data-submenu-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!open));
  });
});

// Close an open header dropdown when clicking elsewhere or pressing Escape.
document.addEventListener("click", (event) => {
  document.querySelectorAll('.main-nav [data-submenu-toggle][aria-expanded="true"]').forEach((button) => {
    if (!button.parentElement.contains(event.target)) button.setAttribute("aria-expanded", "false");
  });
});

const drawer = document.getElementById("menu-drawer");
const overlay = document.querySelector(".menu-overlay");
const openButton = document.querySelector("[data-menu-open]");

function openMenu() {
  drawer.hidden = false;
  overlay.hidden = false;
  // Next frame, so the slide-in transition runs after `hidden` is removed.
  requestAnimationFrame(() => document.body.classList.add("menu-open"));
  openButton.setAttribute("aria-expanded", "true");
  drawer.querySelector(".menu-drawer__close").focus();
}

function closeMenu() {
  document.body.classList.remove("menu-open");
  openButton.setAttribute("aria-expanded", "false");
  // Hide after the 0.3s slide-out (a timer, since reduced-motion users get no transition).
  setTimeout(() => {
    if (!document.body.classList.contains("menu-open")) {
      drawer.hidden = true;
      overlay.hidden = true;
    }
  }, 300);
  openButton.focus();
}

openButton.addEventListener("click", openMenu);
document.querySelectorAll("[data-menu-close]").forEach((el) => el.addEventListener("click", closeMenu));

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.body.classList.contains("menu-open")) {
    closeMenu();
    return;
  }
  const open = document.querySelector('.main-nav [data-submenu-toggle][aria-expanded="true"]');
  if (open) {
    open.setAttribute("aria-expanded", "false");
    open.focus();
  }
});

// If the window grows to desktop width with the drawer open, close it.
window.matchMedia("(min-width: 1025px)").addEventListener("change", (mq) => {
  if (mq.matches && document.body.classList.contains("menu-open")) closeMenu();
});
