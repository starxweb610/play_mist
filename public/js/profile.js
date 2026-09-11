/* profile.js — public developer profiles, shared projects and game comments.
   Every piece of user-supplied text is inserted with textContent, never
   innerHTML; server-rendered templates are already escaped by EJS. */
(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ── Helpers ───────────────────────────────────────────────────────────────
  function toast(message) {
    let el = $('.pf-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'pf-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  const loginUrl = () => '/developer/login?next=' + encodeURIComponent(location.pathname + location.hash);

  async function api(url, options = {}) {
    const headers = { Accept: 'application/json' };
    if (options.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json().catch(() => ({})) : {};
    if (res.status === 401) {
      location.href = loginUrl();
      const err = new Error('Please log in.');
      err.silent = true;
      throw err;
    }
    if (!res.ok || !isJson) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  function formatCount(value) {
    const n = Number(value) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  }

  // ── Follow ────────────────────────────────────────────────────────────────
  function setFollowing(btn, following) {
    btn.dataset.following = following ? '1' : '0';
    btn.textContent = following ? 'Following' : 'Follow';
    btn.classList.toggle('btn-primary', !following);
    btn.classList.toggle('btn-ghost', following);
    btn.classList.toggle('is-following', following);
    btn.setAttribute('aria-pressed', following ? 'true' : 'false');
  }

  $$('[data-follow]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const following = btn.dataset.following === '1';
      btn.disabled = true;
      try {
        const data = await api('/developer/follow/' + encodeURIComponent(btn.dataset.follow), {
          method: following ? 'DELETE' : 'POST',
        });
        setFollowing(btn, data.following);
        const count = $('[data-follower-count]');
        if (count) count.textContent = formatCount(data.followers);
        const label = $('[data-follower-label]');
        if (label) label.textContent = data.followers === 1 ? 'follower' : 'followers';
      } catch (err) {
        if (!err.silent) toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // ── Share ─────────────────────────────────────────────────────────────────
  $$('[data-share]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.share;
      const title = btn.dataset.shareTitle || document.title;
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share({ title, url }); } catch (_) { /* dismissed */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch (_) {
        window.prompt('Copy this link:', url);
      }
    });
  });

  // ── Tabs (shared project page) ────────────────────────────────────────────
  const tabs = $$('[role="tab"][aria-controls]');
  if (tabs.length) {
    const select = (tab, updateHash) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (updateHash) history.replaceState(null, '', '#' + tab.dataset.tab);
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t, true));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        select(next, true);
        next.focus();
      });
    });
    const fromHash = tabs.find((t) => '#' + t.dataset.tab === location.hash);
    if (fromHash) select(fromHash, false);
  }

  // ── Modals ────────────────────────────────────────────────────────────────
  let lastFocus = null;
  function openModal(modal) {
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    const close = $('[data-close]', modal);
    if (close) close.focus();
  }
  function closeModal(modal) {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $$('.pf-modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close]')) closeModal(modal);
    });
  });

  // Storyboard lightbox
  const lightbox = $('#lightbox');
  let lbFrames = [];
  let lbIndex = 0;
  function showFrame(index) {
    lbIndex = (index + lbFrames.length) % lbFrames.length;
    const frame = lbFrames[lbIndex];
    const img = $('[data-lb-img]', lightbox);
    img.src = frame.dataset.src;
    img.alt = frame.dataset.title || 'Storyboard frame';
    $('[data-lb-num]', lightbox).textContent = `Frame ${lbIndex + 1} of ${lbFrames.length}`;
    $('[data-lb-title]', lightbox).textContent = frame.dataset.title || 'Untitled';
    $('[data-lb-desc]', lightbox).textContent = frame.dataset.desc || '';
    $$('[data-lb-step]', lightbox).forEach((b) => { b.hidden = lbFrames.length < 2; });
  }
  if (lightbox) {
    $$('[data-frame]').forEach((btn) => {
      btn.addEventListener('click', () => {
        lbFrames = $$('[data-frame]', btn.closest('.sb-block'));
        showFrame(lbFrames.indexOf(btn));
        openModal(lightbox);
      });
    });
    $$('[data-lb-step]', lightbox).forEach((b) => {
      b.addEventListener('click', () => showFrame(lbIndex + Number(b.dataset.lbStep)));
    });
  }

  // Task details
  const taskModal = $('#taskModal');
  if (taskModal) {
    $$('[data-task]').forEach((card) => {
      card.addEventListener('click', () => {
        const tpl = document.getElementById('task-tpl-' + card.dataset.task);
        if (!tpl) return;
        $('[data-task-body]', taskModal).replaceChildren(tpl.content.cloneNode(true));
        openModal(taskModal);
      });
    });
  }

  document.addEventListener('keydown', (e) => {
    const open = $('.pf-modal:not([hidden])');
    if (!open) return;
    if (e.key === 'Escape') closeModal(open);
    if (open === lightbox && lbFrames.length > 1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      showFrame(lbIndex + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });

  // ── Game comments ─────────────────────────────────────────────────────────
  const comments = $('#gameComments');
  if (comments) {
    const max     = Number(comments.dataset.max) || 1000;
    const list    = $('[data-comment-list]', comments);
    const countEl = $('[data-comment-count]', comments);
    const emptyEl = $('[data-comment-empty]', comments);
    const form    = $('[data-comment-form]', comments);

    const adjustCount = (delta) => {
      if (countEl) countEl.textContent = String(Math.max(0, (Number(countEl.textContent) || 0) + delta));
    };

    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };

    function authorAvatar(author) {
      const wrap = el(author.handle ? 'a' : 'span', 'pf-avatar pf-avatar--xs');
      if (author.handle) wrap.href = '/@' + encodeURIComponent(author.handle);
      if (author.avatarUrl) {
        const img = el('img');
        img.src = author.avatarUrl;
        img.alt = '';
        wrap.appendChild(img);
      } else {
        wrap.textContent = String(author.name || '?').charAt(0).toUpperCase();
      }
      return wrap;
    }

    function renderComment(c) {
      const item = el('article', 'gc-item');
      item.dataset.commentId = c.id;
      const main = el('div', 'gc-item-main');
      const head = el('div', 'gc-item-head');

      const name = el(c.author.handle ? 'a' : 'span', 'gc-author', c.author.name);
      if (c.author.handle) name.href = '/@' + encodeURIComponent(c.author.handle);
      head.appendChild(name);
      if (c.author.handle) head.appendChild(el('span', 'gc-handle', '@' + c.author.handle));
      head.appendChild(el('span', 'gc-time', 'Just now'));
      if (c.canDelete) {
        const del = el('button', 'gc-delete', 'Delete');
        del.type = 'button';
        del.dataset.deleteComment = c.id;
        head.appendChild(del);
      }

      main.append(head, el('p', 'gc-body', c.body));
      item.append(authorAvatar(c.author), main);
      return item;
    }

    if (form) {
      const textarea = $('textarea', form);
      const counter  = $('[data-comment-counter]', form);
      const errorEl  = $('[data-comment-error]', form);
      const submit   = $('button[type="submit"]', form);
      const length   = () => [...textarea.value.trim()].length;
      const update   = () => {
        const n = length();
        counter.textContent = `${n} / ${max}`;
        counter.classList.toggle('over', n > max);
      };
      textarea.addEventListener('input', update);
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        const body = textarea.value.trim();
        if (!body) { errorEl.textContent = 'Write something before posting.'; return; }
        if ([...body].length > max) { errorEl.textContent = `Comments can be up to ${max} characters.`; return; }

        submit.disabled = true;
        try {
          const data = await api(`/developer/games/${encodeURIComponent(comments.dataset.gameId)}/comments`, {
            method: 'POST',
            body: JSON.stringify({ body }),
          });
          list.prepend(renderComment(data.comment));
          textarea.value = '';
          update();
          adjustCount(1);
          if (emptyEl) emptyEl.hidden = true;
        } catch (err) {
          if (!err.silent) errorEl.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      });
    }

    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-delete-comment]');
      if (!btn || !window.confirm('Delete this comment?')) return;
      btn.disabled = true;
      try {
        await api('/developer/game-comments/' + encodeURIComponent(btn.dataset.deleteComment), { method: 'DELETE' });
        btn.closest('.gc-item').remove();
        adjustCount(-1);
        if (emptyEl && !$('.gc-item', list)) emptyEl.hidden = false;
      } catch (err) {
        btn.disabled = false;
        if (!err.silent) toast(err.message);
      }
    });
  }
})();
