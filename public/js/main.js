/* ─── main.js – Playmist Website ──────────────────────────────────────────── */

// ── Navbar scroll effect ──────────────────────────────────────────────────
(function initNavbar() {
  const navbar    = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');
  if (!navbar) return;

  const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      const isOpen = hamburger.classList.toggle('open');
      navLinks.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
    });

    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();


// ── Scroll-Reveal (lightweight intersection-based) ────────────────────────
// Elements stay observed for the life of the page so the entrance replays each
// time they come back into view.
//
// Two observers, deliberately:
//   reveal — fires as soon as any part of the element is on screen
//   reset  — fires only once the element is well clear of the viewport
//
// They can't be one observer. Revealing changes the element's own transform
// (translateY(24px) → none), which moves its bounding box. For an element sitting
// near a viewport edge that movement re-crosses the intersection boundary, so a
// single observer resets it, which moves it back, which reveals it… it oscillates
// and settles half-faded. Giving the reset a boundary further out than the reveal
// transform breaks the loop.
(function initScrollReveal() {
  const elements = document.querySelectorAll('[data-aos], .lead-in');
  if (!elements.length) return;

  // Comfortably larger than the largest reveal transform (24px).
  const RESET_MARGIN = '90px';

  const timers = new WeakMap();
  const cancel = (el) => {
    const t = timers.get(el);
    if (t) { clearTimeout(t); timers.delete(el); }
  };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      if (el.classList.contains('aos-animate')) return;
      const delay = parseInt(el.dataset.aosDelay || 0);
      cancel(el);
      if (delay > 0) {
        timers.set(el, setTimeout(() => {
          el.classList.add('aos-animate');
          timers.delete(el);
        }, delay));
      } else {
        el.classList.add('aos-animate');
      }
    });
  }, { threshold: 0, rootMargin: '0px' });

  const resetObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) return;
      const el = entry.target;
      cancel(el);
      el.classList.remove('aos-animate');
    });
  }, { threshold: 0, rootMargin: RESET_MARGIN });

  elements.forEach(el => {
    revealObserver.observe(el);
    resetObserver.observe(el);
  });
})();


// ── Game Tabs (homepage) ──────────────────────────────────────────────────
(function initGameTabs() {
  const tabs   = document.querySelectorAll('.games-tab[data-tab]');
  const panels = document.querySelectorAll('.games-panel');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;

      tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const panel = document.getElementById(`panel-${target}`);
      if (panel) {
        panel.classList.add('active');
        panel.querySelectorAll('[data-aos]').forEach(el => {
          el.classList.remove('aos-animate');
          requestAnimationFrame(() =>
            setTimeout(() => el.classList.add('aos-animate'), parseInt(el.dataset.aosDelay || 0))
          );
        });
      }
    });
  });
})();


// ── Smooth anchor scrolling (respects navbar height) ─────────────────────
(function initSmoothScroll() {
  const NAV_H = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 68;

  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const id = anchor.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - NAV_H - 16;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });
})();


// ── TOC Active Link (Privacy Policy page) ────────────────────────────────
(function initTocHighlight() {
  const tocLinks = document.querySelectorAll('.toc-link');
  if (!tocLinks.length) return;

  const sections = Array.from(tocLinks)
    .map(link => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const id = entry.target.id;
      tocLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
      });
    });
  }, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

  sections.forEach(sec => observer.observe(sec));
})();


// ── YouTube promo facade (homepage) ───────────────────────────────────────
// The poster image stands in for the player until the visitor actually asks
// for it, so the homepage never pays YouTube's script cost on load.
(function initPromoVideo() {
  const frame = document.getElementById('promoVideo');
  if (!frame) return;

  const videoId = frame.dataset.ytId;
  if (!videoId) return;

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;

    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&modestbranding=1`;
    iframe.title = 'Playmist promo video';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';

    frame.innerHTML = '';
    frame.appendChild(iframe);
    frame.style.cursor = 'default';
    frame.removeAttribute('role');
    frame.removeAttribute('tabindex');
  };

  frame.addEventListener('click', load);
  frame.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); load(); }
  });
})();


// ── Genre dropdown (game library) ─────────────────────────────────────────
// CSS handles hover-to-open on pointer devices; this covers click, touch and
// keyboard, where hover isn't available.
(function initGenreSelect() {
  const wrap    = document.getElementById('genreSelect');
  const trigger = document.getElementById('genreTrigger');
  if (!wrap || !trigger) return;

  const setOpen = (open) => {
    wrap.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!wrap.classList.contains('open'));
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrap.classList.contains('open')) {
      setOpen(false);
      trigger.focus();
    }
  });

  // Arrow keys walk the list once it's open.
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...wrap.querySelectorAll('.genre-option')];
    if (!items.length) return;
    e.preventDefault();
    setOpen(true);
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? (i < 0 ? 0 : Math.min(i + 1, items.length - 1))
      : (i <= 0 ? 0 : i - 1);
    items[next].focus();
  });
})();


// ── Nav scroll-spy (homepage) ─────────────────────────────────────────────
// Home / Games come pre-marked from the server by route. On the homepage the
// two hash links (#features, #download) additionally light up as their section
// reaches the top of the viewport, so the navbar always reflects where you are.
(function initNavScrollSpy() {
  const spied = [...document.querySelectorAll('.nav-link[data-spy]')];
  if (!spied.length) return;

  const topLink = spied.find(l => l.dataset.spy === 'top');
  const wanted = spied.filter(l => l.dataset.spy !== 'top');
  const targets = wanted
    .map(l => ({ link: l, el: document.getElementById(l.dataset.spy) }))
    .filter(t => t.el);

  // Spy only where every spied section is present — i.e. the homepage. Other
  // pages carry some of these sections (/games has its own #download) but get
  // their active item from the server by route, and must not be overridden.
  if (!topLink || targets.length !== wanted.length) return;

  let current = null;
  const apply = (link) => {
    if (link === current) return;
    current = link;
    spied.forEach(l => {
      const on = l === link;
      l.classList.toggle('active', on);
      if (on) l.setAttribute('aria-current', 'true');
      else l.removeAttribute('aria-current');
    });
  };

  const navH = parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue('--nav-h')) || 68;

  const onScroll = () => {
    const y = window.scrollY + navH + 24;
    let active = topLink;
    for (const t of targets) {
      if (y >= t.el.offsetTop) active = t.link;
    }
    apply(active);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
})();


// ── Genre drawer (homepage) ───────────────────────────────────────────────
// Slides an off-canvas genre panel in from the left. Two ways in:
//   hover — opens while the pointer is on the button or the panel, and closes
//           on its own shortly after leaving both (pointer devices only)
//   click — "pins" the panel open with a scrim; only an explicit close,
//           the scrim, or Escape dismisses it
// Pinning matters because the button sits inside the page while the panel is
// at the screen edge; without it a click-opened panel would vanish the moment
// the pointer strayed into the gap between them.
(function initGenreDrawer() {
  const burger = document.getElementById('genreBurger');
  const drawer = document.getElementById('genreDrawer');
  const scrim  = document.getElementById('genreScrim');
  const closeBtn = document.getElementById('genreDrawerClose');
  if (!burger || !drawer || !scrim) return;

  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const CLOSE_DELAY = 260;
  let pinned = false;
  let timer = null;
  // Set when the user explicitly dismisses the drawer while the pointer is
  // still on the button. Without it, closing re-fires mouseenter (focus() can
  // scroll the button back under a stationary cursor) and hover reopens it
  // instantly. Cleared once the pointer actually leaves.
  let hoverLocked = false;

  const cancelClose = () => { clearTimeout(timer); timer = null; };

  const open = (pin) => {
    cancelClose();
    if (pin) pinned = true;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    burger.classList.add('is-active');
    burger.setAttribute('aria-expanded', 'true');
    scrim.classList.toggle('is-visible', pinned);
  };

  const close = () => {
    cancelClose();
    pinned = false;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    burger.classList.remove('is-active');
    burger.setAttribute('aria-expanded', 'false');
    scrim.classList.remove('is-visible');
  };

  const closeSoon = () => {
    if (pinned) return;
    cancelClose();
    timer = setTimeout(close, CLOSE_DELAY);
  };

  // Explicit dismissal — blocks hover from reopening until the pointer moves off.
  const dismiss = () => { hoverLocked = true; close(); };

  burger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pinned) dismiss();
    else { hoverLocked = false; open(true); }
  });

  closeBtn?.addEventListener('click', dismiss);
  scrim.addEventListener('click', dismiss);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
      dismiss();
      // preventScroll: focusing must not scroll the button back under the cursor.
      burger.focus({ preventScroll: true });
    }
  });

  if (canHover) {
    burger.addEventListener('mouseenter', () => { if (!hoverLocked) open(false); });
    burger.addEventListener('mouseleave', () => { hoverLocked = false; closeSoon(); });
    drawer.addEventListener('mouseenter', cancelClose);
    drawer.addEventListener('mouseleave', closeSoon);
  }

  // No focus-to-open here: the button already fires click on Enter/Space, which
  // opens the drawer pinned. Opening on focus as well would re-open it the
  // instant Escape returned focus to the button.
})();


// ── Scroll progress bar ───────────────────────────────────────────────────
// Scales a fixed bar instead of animating width, so it stays on the compositor.
(function initScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let ticking = false;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const pct = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = `scaleX(${pct})`;
    ticking = false;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();


// ── Stat count-up ─────────────────────────────────────────────────────────
// Counts each [data-count] stat up from zero the first time it scrolls into
// view. Values that aren't numeric (e.g. "Free", "10K+") are left alone.
(function initCountUp() {
  const stats = [...document.querySelectorAll('.stat-value[data-count]')]
    .filter(el => Number.isFinite(parseFloat(el.dataset.count)));
  if (!stats.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const run = (el, done) => {
    const target   = parseFloat(el.dataset.count);
    const suffix   = el.dataset.suffix || '';
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const DURATION = 1100;
    const start = performance.now();

    el.classList.add('is-counting');
    const step = (now) => {
      const t = Math.min((now - start) / DURATION, 1);
      // ease-out cubic — fast off the line, settles gently on the final value
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (target * eased).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else {
        el.textContent = target.toFixed(decimals) + suffix;
        el.classList.remove('is-counting');
        if (done) done();
      }
    };
    requestAnimationFrame(step);
  };

  // Re-runs whenever the row scrolls back into view, matching the reveal
  // animations. `running` stops a second pass starting mid-count.
  const running = new WeakSet();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (running.has(entry.target)) return;
        running.add(entry.target);
        run(entry.target, () => running.delete(entry.target));
      } else if (entry.boundingClientRect.top > window.innerHeight ||
                 entry.boundingClientRect.bottom < 0) {
        running.delete(entry.target);
      }
    });
  }, { threshold: 0.4 });

  stats.forEach(el => observer.observe(el));
})();


// ── Start at the top on reload ────────────────────────────────────────────
// Browsers restore the previous scroll position on refresh, which drops you
// back mid-page with every entrance animation already played. Take over that
// behaviour — but honour a real #hash target, otherwise deep links break.
(function initScrollRestoration() {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const NAV_H = parseInt(getComputedStyle(document.documentElement)
    .getPropertyValue('--nav-h')) || 68;

  const place = () => {
    const id = window.location.hash.slice(1);
    if (id) {
      // 'manual' restoration also suppresses Chrome's own jump-to-fragment on
      // reload, so deep links have to be re-applied by hand. Offsetting by the
      // navbar height keeps the target from sitting under the fixed header.
      const target = document.getElementById(id);
      if (target) {
        window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - NAV_H - 16);
        return;
      }
    }
    window.scrollTo(0, 0);
  };

  place();
  // Re-run once images and fonts have settled — offsets shift as they load.
  window.addEventListener('load', () => requestAnimationFrame(place));
})();
