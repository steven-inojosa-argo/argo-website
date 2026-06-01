/* Argo Analytics — scroll choreography.
 *
 * Static SSG site: this runs after hydration on the client. It does three
 * things, all gated behind prefers-reduced-motion:
 *   1. Reveals .reveal elements one-by-one as they scroll into view.
 *   2. Counts up [data-count] numbers when the stat band is reached.
 *   3. Adds .stuck to the nav once the page is scrolled past the hero lip.
 *
 * It is defer-loaded and idempotent: a MutationObserver re-arms it if Dioxus
 * swaps the routed page (Home -> Privacy/Terms) so reveals keep working.
 */
(function () {
  "use strict";

  var reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- 1. Reveal on scroll ---- */
  function armReveals() {
    var els = document.querySelectorAll(".reveal:not(.in)");
    if (!els.length) return;

    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (el) {
        el.classList.add("in");
      });
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    els.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---- 2. Count-up numbers ----
   * Animates the number AND a 0..1 progress var (--fill) on the owning
   * .stat row so a CSS bar fills in lockstep. dur defaults to data-dur or
   * 1500ms; the value clamps to data-count so the bar = the number. */
  function countUp(el, dur) {
    var target = parseFloat(el.getAttribute("data-count"));
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    if (isNaN(target)) return;
    var row = el.closest(".stat");
    dur = dur || parseFloat(el.getAttribute("data-dur")) || 1500;

    if (reduce) {
      el.textContent = prefix + target + suffix;
      if (row) row.style.setProperty("--fill", target / 100);
      return;
    }

    var t0 = null;
    function tick(now) {
      if (t0 === null) t0 = now;
      var p = Math.min((now - t0) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(eased * target) + suffix;
      if (row) row.style.setProperty("--fill", (eased * target) / 100);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* Choreographed stat list: when the list enters view, run the failure
   * stats fast back-to-back, hold a beat, then land the payoff stat slow
   * + glowing. Falls back to plain independent count-up elsewhere. */
  function armStatChoreo(list) {
    if (list.__choreo) return;
    list.__choreo = true;
    var rows = Array.prototype.slice.call(
      list.querySelectorAll(".stat")
    );
    var run = function () {
      var t = 0;
      rows.forEach(function (row) {
        var num = row.querySelector("[data-count]");
        var win = row.classList.contains("stat--win");
        var dur = win ? 1600 : 900;
        if (win) t += 480; // the beat of silence before the payoff
        (function (n, d) {
          setTimeout(function () {
            row.classList.add("counting");
            if (n) countUp(n, d);
            else if (row.style) row.style.setProperty("--fill", 1);
          }, t);
        })(num, dur);
        t += dur + 160;
      });
    };
    if (reduce || !("IntersectionObserver" in window)) {
      rows.forEach(function (r) {
        var n = r.querySelector("[data-count]");
        if (n) countUp(n);
        else r.style.setProperty("--fill", 1);
        r.classList.add("counting");
      });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.disconnect();
          run();
        });
      },
      { threshold: 0.4 }
    );
    io.observe(list);
  }

  function armCounters() {
    document.querySelectorAll(".stat-list").forEach(armStatChoreo);

    // Any standalone [data-count] not inside a choreographed .stat-list.
    var nums = document.querySelectorAll(
      "[data-count]:not([data-done])"
    );
    nums = Array.prototype.slice.call(nums).filter(function (el) {
      return !el.closest(".stat-list");
    });
    if (!nums.length) return;

    if (reduce || !("IntersectionObserver" in window)) {
      nums.forEach(function (el) {
        el.setAttribute("data-done", "1");
        countUp(el);
      });
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.setAttribute("data-done", "1");
          countUp(e.target);
          io.unobserve(e.target);
        });
      },
      { threshold: 0.5 }
    );

    nums.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---- 3. Sticky nav background + mobile menu auto-close ---- */
  function armNav() {
    var nav = document.querySelector(".nav");
    if (!nav || nav.__armed) return;
    nav.__armed = true;
    var onScroll = function () {
      nav.classList.toggle("stuck", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // Tapping a link in the open mobile dropdown should close it. The menu
    // is a CSS-only :checked toggle; just uncheck it on link click.
    var toggle = document.getElementById("nav-toggle");
    if (toggle) {
      nav.querySelectorAll(".nav__links > a").forEach(function (a) {
        a.addEventListener("click", function () {
          toggle.checked = false;
        });
      });
    }
  }

  /* ---- 4. Lazy iframe (booking embed) ----
   * The Google Calendar embed is the heaviest resource on the page. Defer
   * it until the user scrolls within ~600px of it, then promote
   * data-src -> src. Falls back to immediate load without IO. */
  function armLazyFrames() {
    var frames = document.querySelectorAll("iframe[data-src]");
    if (!frames.length) return;

    var load = function (f) {
      if (f.__loaded) return;
      f.__loaded = true;
      f.src = f.getAttribute("data-src");
      f.removeAttribute("data-src");
    };

    if (!("IntersectionObserver" in window)) {
      frames.forEach(load);
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            load(e.target);
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "600px 0px" }
    );
    frames.forEach(function (f) {
      io.observe(f);
    });
  }

  /* ---- 5. Subtle hero parallax ----
   * Content drifts up slightly slower than scroll; the warm aura drifts
   * the opposite way for depth. GPU transforms only, rAF-throttled, and
   * disabled entirely under reduced-motion. Stops once hero is offscreen. */
  function armParallax() {
    if (reduce) return;
    var hero = document.querySelector(".hero");
    if (!hero || hero.__px) return;
    hero.__px = true;
    var inner = hero.querySelector(".hero__inner");
    if (!inner) return;
    var ticking = false;
    var apply = function () {
      ticking = false;
      var y = window.scrollY;
      if (y > window.innerHeight) return; // hero gone, skip work
      inner.style.transform = "translate3d(0," + (y * 0.14) + "px,0)";
      inner.style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.85)));
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
    apply();
  }

  /* ---- 6. Cursor-reactive depth (Stripe-style "responds to you") ----
   * Hero: --mx/--my (-1..1 from hero center) drift the content, --px/--py
   * (0..1) position a glow under the pointer. The Why-Argo card gets its
   * own --cx/--cy local glow. rAF-throttled, pointer-only, no-op under
   * reduced-motion. */
  function armCursor() {
    if (reduce) return;
    var hero = document.querySelector(".hero");
    if (hero && !hero.__cur) {
      hero.__cur = true;
      var hq = false;
      hero.addEventListener("pointermove", function (e) {
        if (hq) return; hq = true;
        requestAnimationFrame(function () {
          hq = false;
          var r = hero.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width;
          var py = (e.clientY - r.top) / r.height;
          hero.style.setProperty("--mx", (px * 2 - 1).toFixed(3));
          hero.style.setProperty("--my", (py * 2 - 1).toFixed(3));
        });
      }, { passive: true });
    }
    var card = document.querySelector(".about-card");
    if (card && !card.__cur) {
      card.__cur = true;
      var cq = false;
      card.addEventListener("pointermove", function (e) {
        if (cq) return; cq = true;
        requestAnimationFrame(function () {
          cq = false;
          var r = card.getBoundingClientRect();
          card.style.setProperty("--cx",
            ((e.clientX - r.left) / r.width).toFixed(3));
          card.style.setProperty("--cy",
            ((e.clientY - r.top) / r.height).toFixed(3));
        });
      }, { passive: true });
    }
  }

  function arm() {
    armReveals();
    armCounters();
    armNav();
    armLazyFrames();
    armParallax();
    armCursor();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arm);
  } else {
    arm();
  }

  /* Re-arm after Dioxus route swaps (new .reveal nodes appear in <main>). */
  if ("MutationObserver" in window) {
    var mo = new MutationObserver(function () {
      arm();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
})();
