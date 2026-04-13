/* ─── admin.js – Playmist Admin Panel Client Scripts ─────────────────────── */

// ── Sidebar Toggle ────────────────────────────────────────────────────────
(function initSidebar() {
  const sidebar   = document.getElementById('sidebar');
  const main      = document.getElementById('adminMain');
  const toggle    = document.getElementById('sidebarToggle');
  if (!sidebar || !toggle) return;

  // Mobile: slide in/out
  // Desktop: collapse/expand (optional — left for future enhancement)
  const isMobile = () => window.innerWidth <= 768;

  toggle.addEventListener('click', () => {
    if (isMobile()) {
      sidebar.classList.toggle('mobile-open');
    } else {
      // Desktop collapse — toggle a CSS class for future use
      sidebar.classList.toggle('collapsed');
      main && main.classList.toggle('sidebar-collapsed');
    }
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (!isMobile()) return;
    if (sidebar.classList.contains('mobile-open') &&
        !sidebar.contains(e.target) &&
        e.target !== toggle) {
      sidebar.classList.remove('mobile-open');
    }
  });
})();


// ── Flash Message Auto-dismiss & Close Button ────────────────────────────
(function initFlash() {
  const flashes = document.querySelectorAll('.flash');
  flashes.forEach(flash => {
    // Auto remove after 5s
    setTimeout(() => {
      flash.style.transition = 'opacity 0.4s ease, max-height 0.4s ease';
      flash.style.opacity = '0';
      flash.style.maxHeight = '0';
      flash.style.overflow = 'hidden';
      flash.style.paddingTop = '0';
      flash.style.paddingBottom = '0';
      setTimeout(() => flash.remove(), 400);
    }, 5000);

    // Close button
    const closeBtn = flash.querySelector('.flash-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        flash.style.opacity = '0';
        setTimeout(() => flash.remove(), 300);
      });
    }
  });
})();


// ── Active Nav Highlight (client-side fallback) ──────────────────────────
(function highlightActiveNav() {
  const path  = window.location.pathname;
  const items = document.querySelectorAll('.nav-item');
  items.forEach(item => {
    const href = item.getAttribute('href');
    if (!href) return;
    // Exact match or prefix match for nested routes
    if (path === href || (href !== '/sitehandler/dashboard' && path.startsWith(href))) {
      item.classList.add('active');
    }
  });
})();


// ── Confirm Dangerous Actions ─────────────────────────────────────────────
// Usage: <button data-confirm="Are you sure?">Delete</button>
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-confirm]');
  if (!btn) return;
  const msg = btn.dataset.confirm || 'Are you sure?';
  if (!window.confirm(msg)) e.preventDefault();
});
