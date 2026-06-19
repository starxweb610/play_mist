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
(function initScrollReveal() {
  const elements = document.querySelectorAll('[data-aos]');
  if (!elements.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const delay = parseInt(entry.target.dataset.aosDelay || 0);
      setTimeout(() => entry.target.classList.add('aos-animate'), delay);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  elements.forEach(el => observer.observe(el));
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
