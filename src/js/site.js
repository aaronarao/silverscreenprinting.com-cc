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

// Contact form: it posts straight to Insightly (the browser checks the required fields first), and
// Insightly redirects to /thank-you or /form-error. While it sends, disable the button so it can't be
// clicked twice.
document.querySelectorAll("[data-contact-form]").forEach((form) => {
  const button = form.querySelector('[type="submit"]');

  form.addEventListener("submit", () => {
    button.disabled = true;
    button.textContent = "Sending…";
  });

  // Coming back with the Back button can restore the page as it was left, button still disabled.
  window.addEventListener("pageshow", () => {
    button.disabled = false;
    button.textContent = "Send Message";
  });
});

// Blog page: show the first posts and a "Show More" button that reveals the rest. Every card is in
// the HTML (and shows without JavaScript); the hidden cards' lazy photos load only once shown.
document.querySelectorAll("[data-show-more-list]").forEach((list) => {
  const count = Number(list.dataset.showMoreCount);
  const extra = [...list.children].slice(count);
  const button = list.parentElement.querySelector("[data-show-more]");
  if (!extra.length || !button) return;

  extra.forEach((item) => (item.hidden = true));
  button.hidden = false;
  button.addEventListener("click", () => {
    extra.forEach((item) => (item.hidden = false));
    button.hidden = true;
    // Keep keyboard users in place: move focus to the first card that just appeared.
    extra[0].querySelector(".blog-card__title a").focus();
  });
});

// Shipping reach map (homepage): two tabs, each with a radio-style group of option chips.
// The US map SVG is fetched when the section nears the viewport, then inlined so CSS can color it.
// On phones the chips live in a pop-up menu opened from the button in the map card's corner.
document.querySelectorAll("[data-reach]").forEach((reach) => {
  const tabs = [...reach.querySelectorAll('[role="tab"]')];
  const phone = window.matchMedia("(max-width: 767px)");

  // Tabs: click or arrow keys (automatic activation); only the selected tab is in the Tab order.
  function selectTab(tab, focus) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !selected;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[(next + tabs.length) % tabs.length], true);
    });
  });

  reach.querySelectorAll("[data-reach-card]").forEach((card) => {
    const map = card.querySelector("[data-reach-map]");
    const chips = [...card.querySelectorAll('[role="radio"]')];
    const menuButton = card.querySelector("[data-reach-menu-button]");
    const current = menuButton.querySelector("[data-reach-current]");
    const options = card.querySelector("[data-reach-options]");

    function openMenu() {
      options.classList.add("is-open");
      menuButton.setAttribute("aria-expanded", "true");
      (chips.find((c) => c.tabIndex === 0) || chips[0]).focus();
    }
    function closeMenu(returnFocus = true) {
      if (!options.classList.contains("is-open")) return;
      options.classList.remove("is-open");
      menuButton.setAttribute("aria-expanded", "false");
      if (returnFocus) menuButton.focus();
    }

    // Chips: one checked at a time; arrow keys move and select, like native radio buttons.
    function choose(chip, focus) {
      chips.forEach((c) => {
        const checked = c === chip;
        c.setAttribute("aria-checked", String(checked));
        c.tabIndex = checked ? 0 : -1;
      });
      map.dataset.value = chip.dataset.value;
      map.setAttribute("aria-label", chip.dataset.label);
      current.textContent = chip.textContent.trim();
      if (focus) chip.focus();
    }
    chips.forEach((chip, i) => {
      chip.addEventListener("click", () => {
        choose(chip);
        if (phone.matches) closeMenu();
      });
      chip.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        choose(chips[(i + step + chips.length) % chips.length], true);
      });
    });

    menuButton.addEventListener("click", () => (options.classList.contains("is-open") ? closeMenu() : openMenu()));
    card.querySelector("[data-reach-close]").addEventListener("click", () => closeMenu());
    card.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && options.classList.contains("is-open")) {
        event.stopPropagation();
        closeMenu();
      }
    });
    // Tabbing out of the open menu closes it (focus has already moved on, so leave it there).
    card.addEventListener("focusout", (event) => {
      if (event.relatedTarget && !options.contains(event.relatedTarget) && event.relatedTarget !== menuButton) closeMenu(false);
    });
    phone.addEventListener("change", () => closeMenu(false));
  });

  // Lazy-load the US map once the section is within about a screen of the viewport.
  const usMap = reach.querySelector("[data-us-map]");
  if (!usMap) return;
  const load = () =>
    fetch(usMap.dataset.usMap)
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then((svg) => {
        usMap.insertAdjacentHTML("afterbegin", svg);
        usMap.classList.add("is-loaded");
      })
      .catch(() => {}); // The placeholder stays; the caption and text summary still describe the map.
  if (!("IntersectionObserver" in window)) {
    load();
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    load();
  }, { rootMargin: "600px 0px" });
  observer.observe(reach);
});
