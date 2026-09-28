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

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Hero slideshow: cross-fade to the next photo every 3 seconds, like the Duda site.
// Stays on the first photo for people who prefer reduced motion.
document.querySelectorAll("[data-hero-slideshow]").forEach((hero) => {
  const slides = hero.querySelectorAll(".hero__slide");
  if (slides.length < 2) return;
  let current = 0;
  setInterval(() => {
    if (reducedMotion.matches || document.hidden) return;
    slides[current].classList.remove("is-active");
    current = (current + 1) % slides.length;
    slides[current].classList.add("is-active");
  }, 3000);
});

// Testimonial slider: dots, swipe, and arrow keys. Only the visible slide is reachable by keyboard and screen readers.
document.querySelectorAll("[data-slider]").forEach((slider) => {
  const track = slider.querySelector("[data-slider-track]");
  const slides = [...slider.querySelectorAll("[data-slide]")];
  const dotsWrap = slider.querySelector("[data-slider-dots]");
  let current = 0;

  const dots = slides.map((slide, i) => {
    slide.setAttribute("aria-label", `${i + 1} of ${slides.length}`);
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "slider__dot";
    dot.setAttribute("aria-label", `Show testimonial ${i + 1} of ${slides.length}`);
    dot.addEventListener("click", () => show(i));
    dotsWrap.append(dot);
    return dot;
  });

  function show(index) {
    current = (index + slides.length) % slides.length;
    track.style.transform = `translateX(${-100 * current}%)`;
    slides.forEach((slide, i) => {
      slide.inert = i !== current;
      slide.setAttribute("aria-hidden", String(i !== current));
    });
    dots.forEach((dot, i) => dot.setAttribute("aria-current", String(i === current)));
  }

  slider.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight") show(current + 1);
    if (event.key === "ArrowLeft") show(current - 1);
  });

  let startX = null;
  track.addEventListener("pointerdown", (event) => { startX = event.clientX; });
  track.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const distance = event.clientX - startX;
    if (Math.abs(distance) > 40) show(current + (distance < 0 ? 1 : -1));
    startX = null;
  });

  show(0);
});

// Logo strip: slides one logo right-to-left every 7 seconds (0.5s slide) and loops seamlessly.
// Copies of the first logos sit after the last one; when the strip reaches them it jumps back
// to the real first logo without animating, which looks identical. The copies are hidden from
// screen readers and keyboard focus. Autoplay pauses on hover and while the tab is hidden,
// and never runs for people who prefer reduced motion. The arrows always work and restart the timer.
document.querySelectorAll("[data-logo-strip]").forEach((strip) => {
  const viewport = strip.querySelector("[data-logo-viewport]");
  const list = strip.querySelector("[data-logo-list]");
  const items = [...list.children];
  const count = items.length;
  const DELAY = 7000;
  const MAX_VISIBLE = 5;

  items.slice(0, MAX_VISIBLE).forEach((item) => {
    const copy = item.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    copy.inert = true;
    list.append(copy);
  });

  let index = 0;
  let timer = null;
  let hovering = false;

  function stepSize() {
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    return items[0].getBoundingClientRect().width + gap;
  }

  function place(animate) {
    list.style.transition = animate ? "" : "none";
    list.style.transform = `translateX(${-index * stepSize()}px)`;
    if (!animate) list.getBoundingClientRect(); // apply the jump before any later transition
  }

  function animates() {
    return !reducedMotion.matches && getComputedStyle(list).transitionDuration !== "0s";
  }

  // After sliding onto the copies, swap back to the matching real logo.
  function settle() {
    if (index >= count) {
      index -= count;
      place(false);
    }
  }

  function go(direction) {
    settle();
    if (direction < 0 && index === 0) {
      index = count; // the copies look exactly like the start, so jump there first
      place(false);
    }
    index += direction;
    place(true);
    if (!animates()) settle();
  }

  list.addEventListener("transitionend", (event) => {
    if (event.target === list) settle();
  });

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (reducedMotion.matches || hovering || document.hidden) return;
    timer = setTimeout(() => {
      go(1);
      schedule();
    }, DELAY);
  }

  strip.querySelector("[data-logo-prev]").addEventListener("click", () => { go(-1); schedule(); });
  strip.querySelector("[data-logo-next]").addEventListener("click", () => { go(1); schedule(); });

  strip.addEventListener("mouseenter", () => { hovering = true; schedule(); });
  strip.addEventListener("mouseleave", () => { hovering = false; schedule(); });
  document.addEventListener("visibilitychange", schedule);
  reducedMotion.addEventListener("change", schedule);

  // Swipe on touch screens.
  let startX = null;
  viewport.addEventListener("pointerdown", (event) => { startX = event.clientX; });
  viewport.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const distance = event.clientX - startX;
    if (Math.abs(distance) > 40) {
      go(distance < 0 ? 1 : -1);
      schedule();
    }
    startX = null;
  });

  // Tabbing to a logo that's out of view: bring it into view. (Focus would otherwise scroll the
  // clipped viewport behind the script's back.)
  list.addEventListener("focusin", (event) => {
    const item = event.target.closest(".logo-strip__item");
    const i = items.indexOf(item);
    viewport.scrollLeft = 0;
    if (i === -1) return;
    const visible = Math.round(viewport.clientWidth / stepSize()) || 1;
    if (i < index || i >= index + visible) {
      index = Math.min(i, count - 1);
      place(true);
    }
  });

  window.addEventListener("resize", () => place(false));

  place(false);
  schedule();
});

// The contact form isn't connected to a backend yet (Phase 4), so don't submit it anywhere.
document.querySelectorAll("[data-contact-form]").forEach((form) => {
  form.addEventListener("submit", (event) => event.preventDefault());
});
