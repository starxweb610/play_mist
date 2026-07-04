/* ─── users-table.js – client-side filtering, sorting & pagination ───────────
 * Enhances the Player Accounts table with instant search, filters
 * (status, registered date range, "today", transaction count range),
 * sortable columns, and automatic pagination — no external libraries.
 * ─────────────────────────────────────────────────────────────────────────── */
(function () {
  const table = document.getElementById('usersTable');
  const tbody = document.getElementById('usersTbody');
  if (!table || !tbody) return;

  const rows = Array.from(tbody.querySelectorAll('.user-row'));

  // ── Elements ──────────────────────────────────────────────────────────────
  const el = {
    search:   document.getElementById('filterSearch'),
    status:   document.getElementById('filterStatus'),
    dateFrom: document.getElementById('filterDateFrom'),
    dateTo:   document.getElementById('filterDateTo'),
    txMin:    document.getElementById('filterTxMin'),
    txMax:    document.getElementById('filterTxMax'),
    today:    document.getElementById('filterToday'),
    reset:    document.getElementById('filterReset'),
    empty:    document.getElementById('usersEmpty'),
    summary:  document.getElementById('usersSummary'),
    pageSize: document.getElementById('pageSize'),
    prev:     document.getElementById('pagePrev'),
    next:     document.getElementById('pageNext'),
    pageInfo: document.getElementById('pageInfo'),
  };

  const state = {
    page: 1,
    pageSize: parseInt(el.pageSize && el.pageSize.value, 10) || 25,
    sortKey: 'created',
    sortDir: 'desc',   // matches the default `sort-desc` header
    todayOnly: false,
    visible: rows.slice(),
  };

  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  };

  // ── Filtering ───────────────────────────────────────────────────────────────
  function applyFilters() {
    const q      = (el.search.value || '').trim().toLowerCase();
    const status = el.status.value;                         // '', '1', '0'
    const from   = el.dateFrom.value;                       // 'YYYY-MM-DD' or ''
    const to     = el.dateTo.value;
    const txMin  = el.txMin.value !== '' ? Number(el.txMin.value) : null;
    const txMax  = el.txMax.value !== '' ? Number(el.txMax.value) : null;
    const today  = state.todayOnly ? todayStr() : null;

    state.visible = rows.filter(row => {
      const d = row.dataset;
      if (q && !(d.username.includes(q) || d.email.includes(q))) return false;
      if (status !== '' && d.status !== status) return false;
      if (from && d.date < from) return false;
      if (to && d.date > to) return false;
      const tx = Number(d.tx);
      if (txMin !== null && tx < txMin) return false;
      if (txMax !== null && tx > txMax) return false;
      if (today && d.date !== today) return false;
      return true;
    });

    // Mark filtered state on every row (used by select-all logic).
    const visibleSet = new Set(state.visible);
    rows.forEach(r => r.classList.toggle('filtered-out', !visibleSet.has(r)));

    state.page = 1;
    sortVisible();
    render();
  }

  // ── Sorting ─────────────────────────────────────────────────────────────────
  function sortVisible() {
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    const th  = table.querySelector(`th[data-sort="${key}"]`);
    const type = th ? th.dataset.type : 'text';

    state.visible.sort((a, b) => {
      let av = a.dataset[key];
      let bv = b.dataset[key];
      if (type === 'num') {
        av = Number(av); bv = Number(bv);
        return (av - bv) * dir;
      }
      return av.localeCompare(bv) * dir;
    });
  }

  function bindSortHeaders() {
    table.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = th.dataset.type === 'num' ? 'desc' : 'asc';
        }
        table.querySelectorAll('th.sortable').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        sortVisible();
        render();
      });
    });
  }

  // ── Render (pagination) ──────────────────────────────────────────────────────
  function render() {
    const total = state.visible.length;
    const size  = state.pageSize;
    const pages = Math.max(1, Math.ceil(total / size));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * size;
    const end   = start + size;

    // Hide all, then show the current page slice in sorted order.
    rows.forEach(r => r.classList.add('paged-out'));
    const pageRows = state.visible.slice(start, end);
    pageRows.forEach(r => { r.classList.remove('paged-out'); tbody.appendChild(r); });

    // Summary + controls
    if (el.summary) {
      el.summary.textContent = total === 0
        ? '0 players'
        : `Showing ${start + 1}–${Math.min(end, total)} of ${total} player${total === 1 ? '' : 's'}`;
    }
    if (el.pageInfo) el.pageInfo.textContent = `Page ${state.page} / ${pages}`;
    if (el.prev) el.prev.disabled = state.page <= 1;
    if (el.next) el.next.disabled = state.page >= pages;
    if (el.empty) el.empty.style.display = total === 0 ? 'block' : 'none';
    table.style.display = total === 0 ? 'none' : '';

    if (typeof window.__updateBulkToolbar === 'function') window.__updateBulkToolbar();
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────
  let debounce;
  function onFilterChange() {
    clearTimeout(debounce);
    debounce = setTimeout(applyFilters, 120);
  }

  [el.search, el.txMin, el.txMax].forEach(i => i && i.addEventListener('input', onFilterChange));
  [el.status, el.dateFrom, el.dateTo].forEach(i => i && i.addEventListener('change', applyFilters));

  if (el.today) {
    el.today.addEventListener('click', () => {
      state.todayOnly = !state.todayOnly;
      el.today.classList.toggle('filter-chip--active', state.todayOnly);
      applyFilters();
    });
  }

  if (el.reset) {
    el.reset.addEventListener('click', () => {
      el.search.value = '';
      el.status.value = '';
      el.dateFrom.value = '';
      el.dateTo.value = '';
      el.txMin.value = '';
      el.txMax.value = '';
      state.todayOnly = false;
      el.today.classList.remove('filter-chip--active');
      applyFilters();
    });
  }

  if (el.pageSize) {
    el.pageSize.addEventListener('change', () => {
      state.pageSize = parseInt(el.pageSize.value, 10) || 25;
      state.page = 1;
      render();
    });
  }
  if (el.prev) el.prev.addEventListener('click', () => { if (state.page > 1) { state.page--; render(); } });
  if (el.next) el.next.addEventListener('click', () => { state.page++; render(); });

  // ── Init ─────────────────────────────────────────────────────────────────────
  bindSortHeaders();
  sortVisible();
  render();
})();
