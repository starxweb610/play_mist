/**
 * public/js/developer-builder.js
 * Client for the in-browser Game Builder IDE.
 *
 * Structure:
 *   api        — every server call, with one error shape
 *   state      — open tabs, the tree, the active file
 *   tree       — the file explorer, including the context menu
 *   editor     — CodeMirror instances, one document per open file
 *   preview    — the sandboxed run frame
 *   consolePane— messages posted out of that frame
 *   dialog     — a real modal, because window.prompt is unusable on mobile
 *
 * Bootstrapped from window.PM_BUILDER, rendered by builder-ide.ejs.
 */
(function () {
  'use strict';

  var CFG = window.PM_BUILDER;
  if (!CFG) return;

  var LIMITS = CFG.limits || {};
  var PROTECTED = LIMITS.protectedFile || 'index.html';

  // ── Element lookups ────────────────────────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    body:        $('ideBody'),
    tree:        $('tree'),
    tabbar:      $('tabbar'),
    editorHost:  $('editorHost'),
    editorEmpty: $('editorEmpty'),
    editorImage: $('editorImage'),
    editorImageEl:   $('editorImageEl'),
    editorImageMeta: $('editorImageMeta'),
    status:      $('ideStatus'),
    usageFiles:  $('usageFiles'),
    usageSize:   $('usageSize'),
    previewStage:$('previewStage'),
    previewIdle: $('previewIdle'),
    consoleEl:   $('console'),
    consoleBody: $('consoleBody'),
    consoleCount:$('consoleCount'),
    ctxMenu:     $('ctxMenu'),
    moreMenu:    $('moreMenu'),
    toastHost:   $('toastHost'),
    mobileBar:   $('mobileBar'),
    mobileErr:   $('mobileErrBadge'),
    uploadInput: $('uploadInput')
  };

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    tree: CFG.tree || [],
    usage: CFG.usage || { files: 0, bytes: 0 },
    open: [],            // [{ path, name, doc, clean, mode, editable }]
    activePath: null,    // the document the editor is showing
    selectedPath: null,  // what the explorer has highlighted (click, not open)
    // Folders the developer has expanded. Rebuilding the tree after every
    // mutation would otherwise collapse everything back to the root.
    expanded: {},
    ctxTarget: null,
    longPressed: false,  // a touch long-press opened the context menu
    frame: null,
    previewUrl: null,
    errorCount: 0,
    logCount: 0
  };

  // ── Utilities ──────────────────────────────────────────────────────────────

  function basename(p) {
    var at = String(p || '').lastIndexOf('/');
    return at === -1 ? String(p || '') : p.slice(at + 1);
  }
  function dirname(p) {
    var at = String(p || '').lastIndexOf('/');
    return at === -1 ? '' : p.slice(0, at);
  }
  function extOf(name) {
    var at = String(name || '').lastIndexOf('.');
    return at === -1 ? '' : name.slice(at + 1).toLowerCase();
  }
  function formatBytes(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'ide-toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    els.toastHost.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 220);
    }, kind === 'error' ? 4200 : 2400);
  }

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = 'ide-status' + (kind ? ' ' + kind : '');
  }

  // ── API ────────────────────────────────────────────────────────────────────
  var api = {
    request: function (method, path, options) {
      options = options || {};
      var url = CFG.base + path;
      if (options.query) {
        var qs = Object.keys(options.query)
          .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(options.query[k]); })
          .join('&');
        if (qs) url += (url.indexOf('?') === -1 ? '?' : '&') + qs;
      }

      var init = { method: method, headers: {}, credentials: 'same-origin' };
      if (options.body instanceof FormData) {
        // Never set Content-Type for FormData — the boundary must come from
        // the browser, and setting it by hand makes multer see no files.
        init.body = options.body;
      } else if (options.body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }

      return fetch(url, init).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || 'Request failed (' + res.status + ').');
            err.status = res.status;
            err.needsTemplate = !!data.needsTemplate;
            throw err;
          }
          return data;
        });
      });
    },

    listFiles:   function () { return api.request('GET', '/files'); },
    readFile:    function (p) { return api.request('GET', '/file', { query: { path: p } }); },
    saveFile:    function (p, content) { return api.request('PUT', '/file', { body: { path: p, content: content } }); },
    createFile:  function (parent, name) { return api.request('POST', '/file', { body: { parent: parent, name: name } }); },
    createFolder:function (parent, name) { return api.request('POST', '/folder', { body: { parent: parent, name: name } }); },
    rename:      function (p, name) { return api.request('POST', '/rename', { body: { path: p, name: name } }); },
    remove:      function (p) { return api.request('DELETE', '/entry', { query: { path: p } }); },
    previewToken:function () { return api.request('POST', '/preview-token'); },
    upload:      function (parent, file) {
      var fd = new FormData();
      fd.append('parent', parent || '');
      fd.append('file', file);
      return api.request('POST', '/upload', { body: fd });
    }
  };

  /** One place to turn an API rejection into something the developer sees. */
  function handleError(err) {
    if (err && err.needsTemplate) {
      toast('This project’s files are gone. Reloading…', 'error');
      setTimeout(function () { window.location.reload(); }, 1400);
      return;
    }
    // The session-expired banner is installed by partials/head.ejs, which
    // already tells the developer what to do — don't double up on it.
    if (err && err.status === 401) return;
    toast((err && err.message) || 'Something went wrong.', 'error');
  }

  // ── Dialog ─────────────────────────────────────────────────────────────────
  var dialog = (function () {
    var scrim   = $('dialogScrim');
    var title   = $('dialogTitle');
    var hint    = $('dialogHint');
    var input   = $('dialogInput');
    var errorEl = $('dialogError');
    var okBtn   = $('dialogConfirm');
    var noBtn   = $('dialogCancel');
    var onSubmit = null;

    function close() {
      scrim.classList.remove('open');
      onSubmit = null;
      input.value = '';
      errorEl.classList.remove('open');
    }

    function showError(message) {
      errorEl.textContent = message;
      errorEl.classList.add('open');
      input.focus();
    }

    function submit() {
      if (!onSubmit) return;
      var value = input.value.trim();
      if (!input.hidden && !value) return showError('Please enter a name.');
      var handler = onSubmit;
      okBtn.disabled = true;
      Promise.resolve(handler(value))
        .then(function (ok) { if (ok !== false) close(); })
        .catch(function (err) { showError((err && err.message) || 'That did not work.'); })
        .then(function () { okBtn.disabled = false; });
    }

    okBtn.addEventListener('click', submit);
    noBtn.addEventListener('click', close);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) close(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });

    return {
      open: function (options) {
        title.textContent = options.title || 'Name';
        hint.textContent  = options.hint || '';
        hint.style.display = options.hint ? '' : 'none';
        input.value = options.value || '';
        input.hidden = !!options.noInput;
        okBtn.textContent = options.confirm || 'Confirm';
        okBtn.className = 'btn sm ' + (options.danger ? 'btn-danger' : 'primary');
        errorEl.classList.remove('open');
        onSubmit = options.onSubmit;
        scrim.classList.add('open');

        setTimeout(function () {
          if (options.noInput) return okBtn.focus();
          input.focus();
          // Select the stem of a filename so typing replaces the name but
          // keeps the extension — which a rename requires anyway.
          var dot = options.selectStem ? input.value.lastIndexOf('.') : -1;
          if (dot > 0) input.setSelectionRange(0, dot);
          else input.select();
        }, 40);
      },
      close: close
    };
  })();

  // ── File tree ──────────────────────────────────────────────────────────────

  var FILE_ICONS = {
    html: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
    img:  '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>'
  };

  function iconFor(name) {
    var ext = extOf(name);
    if (ext === 'html' || ext === 'htm') return { svg: FILE_ICONS.html, cls: 'html' };
    if (ext === 'css')  return { svg: FILE_ICONS.code, cls: 'css' };
    if (ext === 'js' || ext === 'mjs') return { svg: FILE_ICONS.code, cls: 'js' };
    if (ext === 'json') return { svg: FILE_ICONS.code, cls: 'json' };
    if (['png','jpg','jpeg','gif','webp','svg','ico'].indexOf(ext) !== -1) return { svg: FILE_ICONS.img, cls: 'img' };
    return { svg: FILE_ICONS.file, cls: '' };
  }

  var CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
  var FOLDER_SVG = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
  var LOCK_SVG = '<svg class="tree-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function renderTree() {
    if (!state.tree.length) {
      els.tree.innerHTML = '<div class="tree-empty">This project has no files.<br />Use the + buttons above to add one.</div>';
      return;
    }

    function renderNodes(nodes, depth) {
      var html = '';
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var pad = 10 + depth * 13;

        if (node.type === 'dir') {
          var open = !!state.expanded[node.path];
          html += '<div class="tree-node">'
            + '<button type="button" class="tree-row' + (open ? ' open' : '')
              + '" data-path="' + escapeHtml(node.path) + '" data-type="dir" style="padding-left:' + pad + 'px">'
            + '<span class="tree-caret">' + CARET + '</span>'
            + '<svg class="tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + FOLDER_SVG + '</svg>'
            + '<span class="tree-name">' + escapeHtml(node.name) + '</span>'
            + '</button>'
            + '<div class="tree-children' + (open ? ' open' : '') + '">'
            + renderNodes(node.children || [], depth + 1)
            + '</div></div>';
        } else {
          var icon = iconFor(node.name);
          var tab = findTab(node.path);
          // Two DISTINCT states, never one shared '.active':
          //   open-doc — the file the editor is showing
          //   selected — the explorer cursor (where a new file would be made)
          // Painting both with the same class made two rows look equally
          // "selected", which is exactly what it looked like.
          html += '<button type="button" class="tree-row'
              + (state.activePath === node.path ? ' open-doc' : '')
              + (state.selectedPath === node.path ? ' selected' : '')
              + '" data-path="' + escapeHtml(node.path) + '" data-type="file"'
              + ' data-editable="' + (node.editable ? '1' : '0') + '"'
              + ' style="padding-left:' + pad + 'px">'
            + '<span class="tree-caret blank"></span>'
            + '<svg class="tree-icon ' + icon.cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + icon.svg + '</svg>'
            + '<span class="tree-name">' + escapeHtml(node.name) + '</span>'
            + (tab && !tab.clean ? '<span class="tree-dot" title="Unsaved changes"></span>' : '')
            + (node.protected ? LOCK_SVG : '')
            + '</button>';
        }
      }
      return html;
    }

    els.tree.innerHTML = renderNodes(state.tree, 0);
  }

  function renderUsage() {
    els.usageFiles.textContent = state.usage.files + ' / ' + (LIMITS.maxFiles || '—') + ' files';
    els.usageSize.textContent = formatBytes(state.usage.bytes);
  }

  /** Reloads the tree from the server after any mutation. */
  function refreshTree() {
    return api.listFiles().then(function (data) {
      state.tree = data.tree || [];
      state.usage = data.usage || state.usage;
      renderTree();
      renderUsage();
      return data;
    });
  }

  /** Walks the tree looking for one path. */
  function findNode(target, nodes) {
    nodes = nodes || state.tree;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].path === target) return nodes[i];
      if (nodes[i].children) {
        var hit = findNode(target, nodes[i].children);
        if (hit) return hit;
      }
    }
    return null;
  }

  /** Expands every ancestor folder of a path so the file is visible. */
  function revealPath(p) {
    var parts = String(p || '').split('/');
    var acc = '';
    for (var i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i];
      state.expanded[acc] = true;
    }
  }

  /**
   * Repaints the `.active` highlight without rebuilding the tree.
   *
   * This exists because `dblclick` only fires when both clicks land on the
   * SAME element. The single-click handler used to call renderTree(), which
   * assigns els.tree.innerHTML and therefore replaces the row between the two
   * clicks — so the second click landed on a brand-new node and the browser
   * never fired dblclick at all. Nothing in the click path may re-render the
   * tree; selection and folder expansion are both surgical DOM updates now.
   */
  function paintSelection() {
    var rows = els.tree.querySelectorAll('.tree-row');
    for (var i = 0; i < rows.length; i++) {
      var rp = rows[i].getAttribute('data-path');
      rows[i].classList.toggle('open-doc', rp === state.activePath);
      rows[i].classList.toggle('selected', rp === state.selectedPath);
    }
  }

  /** Expands or collapses one folder in place. */
  function toggleFolder(row, path) {
    var open = !state.expanded[path];
    state.expanded[path] = open;
    row.classList.toggle('open', open);
    // renderTree() puts the folder's children in the row's next sibling.
    var children = row.nextElementSibling;
    if (children && children.classList.contains('tree-children')) {
      children.classList.toggle('open', open);
    }
  }

  // Single click selects and toggles folders; double click (or a second tap)
  // opens a file — the behaviour asked for, and what every desktop IDE does.
  els.tree.addEventListener('click', function (e) {
    var row = e.target.closest('.tree-row');
    if (!row) return;
    var p = row.getAttribute('data-path');

    state.selectedPath = p;
    paintSelection();
    if (row.getAttribute('data-type') === 'dir') toggleFolder(row, p);
  });

  function openRow(row) {
    if (!row || row.getAttribute('data-type') !== 'file') return;
    openFile(row.getAttribute('data-path'), row.getAttribute('data-editable') === '1');
  }

  els.tree.addEventListener('dblclick', function (e) {
    // Stops the second click selecting the filename text.
    e.preventDefault();
    openRow(e.target.closest('.tree-row'));
  });

  // Tree rows are <button>s, so Enter/Space reach them as a click — which only
  // selects. Without this a keyboard user could never open a file.
  els.tree.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.closest('.tree-row');
    if (!row) return;
    if (row.getAttribute('data-type') === 'dir') return; // click already toggles it
    e.preventDefault();
    openRow(row);
  });

  // Touch has no dblclick in every browser, so a second tap within 400ms on
  // the same row counts as one.
  (function () {
    var lastPath = null;
    var lastAt = 0;
    els.tree.addEventListener('touchend', function (e) {
      // A long press already acted on this touch. preventDefault stops the
      // browser synthesising mousedown/mouseup/click from it — one of which
      // would dismiss the menu the long press just opened — and stops the
      // press being counted as the first tap of a double tap.
      if (state.longPressed) {
        state.longPressed = false;
        e.preventDefault();
        lastPath = null;
        return;
      }
      var row = e.target.closest('.tree-row');
      if (!row || row.getAttribute('data-type') !== 'file') return;
      var p = row.getAttribute('data-path');
      var now = Date.now();
      if (p === lastPath && now - lastAt < 400) {
        e.preventDefault();
        openFile(p, row.getAttribute('data-editable') === '1');
        lastPath = null;
      } else {
        lastPath = p;
        lastAt = now;
      }
    }, { passive: false });
  })();

  // ── Context menu ───────────────────────────────────────────────────────────

  function openContextMenu(x, y, row) {
    state.ctxTarget = {
      path: row.getAttribute('data-path'),
      type: row.getAttribute('data-type'),
      editable: row.getAttribute('data-editable') === '1'
    };

    var isProtected = state.ctxTarget.path === PROTECTED;
    var isDir = state.ctxTarget.type === 'dir';
    var menu = els.ctxMenu;

    menu.querySelector('[data-action="open"]').disabled = isDir || !state.ctxTarget.editable;
    menu.querySelector('[data-action="new-file"]').disabled = false;
    menu.querySelector('[data-action="new-folder"]').disabled = false;
    menu.querySelector('[data-action="rename"]').disabled = isProtected;
    menu.querySelector('[data-action="delete"]').disabled = isProtected;

    menu.classList.add('open');
    // Measure after it is displayed, then keep it inside the viewport.
    var rect = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';

    // Next tick — see the note above armContextDismiss.
    disarmContextDismiss();
    setTimeout(armContextDismiss, 0);
  }

  // The gesture that OPENS the menu also delivers events that would close it:
  // macOS Ctrl+Click emits a full primary-button click alongside `contextmenu`,
  // and a touch long-press is followed by synthetic mouse events. A permanent
  // dismiss-on-click listener therefore ate the opening gesture and shut the
  // menu the instant it appeared. Dismissal is armed on the NEXT tick instead,
  // so nothing from the opening gesture can reach it.
  var ctxDismiss = null;

  function armContextDismiss() {
    if (ctxDismiss) return;
    ctxDismiss = function (e) {
      // Clicks on the menu itself are the menu's own business.
      if (e.target && e.target.closest && e.target.closest('#ctxMenu')) return;
      closeContextMenu();
    };
    // mousedown/touchstart rather than click: dismiss should feel immediate,
    // and it fires even for gestures that never produce a click.
    document.addEventListener('mousedown', ctxDismiss, true);
    document.addEventListener('touchstart', ctxDismiss, true);
    document.addEventListener('wheel', closeContextMenu, { passive: true });
    // The menu is position:fixed, so a scroll would leave it stranded.
    els.tree.addEventListener('scroll', closeContextMenu, true);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('blur', closeContextMenu);
  }

  function disarmContextDismiss() {
    if (!ctxDismiss) return;
    document.removeEventListener('mousedown', ctxDismiss, true);
    document.removeEventListener('touchstart', ctxDismiss, true);
    document.removeEventListener('wheel', closeContextMenu);
    els.tree.removeEventListener('scroll', closeContextMenu, true);
    window.removeEventListener('resize', closeContextMenu);
    window.removeEventListener('blur', closeContextMenu);
    ctxDismiss = null;
  }

  function closeContextMenu() {
    els.ctxMenu.classList.remove('open');
    state.ctxTarget = null;
    disarmContextDismiss();
  }

  els.tree.addEventListener('contextmenu', function (e) {
    var row = e.target.closest('.tree-row');
    if (!row) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, row);
  });

  // Long press is the touch equivalent of right click.
  (function () {
    var timer = null;
    var startX = 0;
    var startY = 0;

    els.tree.addEventListener('touchstart', function (e) {
      var row = e.target.closest('.tree-row');
      if (!row) return;
      var touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      state.longPressed = false;
      timer = setTimeout(function () {
        timer = null;
        state.longPressed = true;
        openContextMenu(startX, startY, row);
      }, 520);
    }, { passive: true });

    function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
    // A scroll must not fire the menu, so any real movement cancels it.
    els.tree.addEventListener('touchmove', function (e) {
      if (!timer) return;
      var touch = e.touches[0];
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) cancel();
    }, { passive: true });
    els.tree.addEventListener('touchend', cancel, { passive: true });
    els.tree.addEventListener('touchcancel', cancel, { passive: true });
  })();

  // Only the "more actions" menu is dismissed here; the context menu manages
  // its own dismissal (armContextDismiss) because it has to ignore the very
  // gesture that opened it.
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#moreMenu') && !e.target.closest('#moreBtn')) {
      els.moreMenu.classList.remove('open');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeContextMenu(); els.moreMenu.classList.remove('open'); }
  });

  els.ctxMenu.addEventListener('click', function (e) {
    var item = e.target.closest('.ctx-item');
    if (!item || item.disabled) return;
    var action = item.getAttribute('data-action');
    var target = state.ctxTarget;
    closeContextMenu();
    if (!target) return;

    // A new entry goes inside a folder, or beside a file.
    var parent = target.type === 'dir' ? target.path : dirname(target.path);

    if (action === 'open') openFile(target.path, target.editable);
    else if (action === 'new-file') promptNewFile(parent);
    else if (action === 'new-folder') promptNewFolder(parent);
    else if (action === 'rename') promptRename(target);
    else if (action === 'delete') promptDelete(target);
  });

  // ── Create / rename / delete ───────────────────────────────────────────────

  function promptNewFile(parent) {
    dialog.open({
      title: 'New file',
      hint: parent ? 'Created in ' + parent + '/' : 'Created in the project root.',
      value: '',
      confirm: 'Create',
      onSubmit: function (name) {
        return api.createFile(parent, name).then(function (data) {
          revealPath(data.path);
          return refreshTree().then(function () {
            openFile(data.path, true);
            toast('Created ' + basename(data.path), 'ok');
          });
        });
      }
    });
  }

  function promptNewFolder(parent) {
    dialog.open({
      title: 'New folder',
      hint: parent ? 'Created in ' + parent + '/' : 'Created in the project root.',
      value: '',
      confirm: 'Create',
      onSubmit: function (name) {
        return api.createFolder(parent, name).then(function (data) {
          state.expanded[data.path] = true;
          revealPath(data.path);
          return refreshTree().then(function () { toast('Created ' + basename(data.path) + '/', 'ok'); });
        });
      }
    });
  }

  function promptRename(target) {
    var current = basename(target.path);
    dialog.open({
      title: 'Rename ' + (target.type === 'dir' ? 'folder' : 'file'),
      hint: target.type === 'dir' ? '' : 'Keep the extension — a file’s type cannot change on rename.',
      value: current,
      confirm: 'Rename',
      selectStem: target.type !== 'dir',
      onSubmit: function (name) {
        if (name === current) return true;
        return api.rename(target.path, name).then(function (data) {
          // Open tabs still point at the old path, and so does `expanded`.
          // Remapping both keeps the editor and the tree consistent with a
          // rename that may have moved a whole subtree.
          remapPaths(target.path, data.path);
          revealPath(data.path);
          return refreshTree().then(function () { toast('Renamed to ' + basename(data.path), 'ok'); });
        });
      }
    });
  }

  function promptDelete(target) {
    var name = basename(target.path);
    var isDir = target.type === 'dir';

    var remove = function () {
      return api.remove(target.path).then(function () {
        closeTabsUnder(target.path);
        return refreshTree().then(function () { toast('Deleted ' + name, 'ok'); });
      });
    };

    // Deleting a folder can destroy a lot of work at once, so that one asks
    // for the name. A single file is one click to delete and one keystroke
    // to retype, so a plain confirm is enough friction.
    if (!isDir) {
      return dialog.open({
        title: 'Delete ' + name + '?',
        hint: 'This cannot be undone.',
        noInput: true,
        confirm: 'Delete',
        danger: true,
        onSubmit: remove
      });
    }

    dialog.open({
      title: 'Delete this folder?',
      hint: 'Everything inside ' + name + '/ is deleted too. Type the folder name to confirm.',
      value: '',
      confirm: 'Delete folder',
      danger: true,
      onSubmit: function (typed) {
        if (typed !== name) throw new Error('That does not match "' + name + '".');
        return remove();
      }
    });
  }

  /** After a rename, move any open tab and expanded folder to the new path. */
  function remapPaths(fromPath, toPath) {
    state.open.forEach(function (tab) {
      if (tab.path === fromPath) {
        tab.path = toPath;
        tab.name = basename(toPath);
      } else if (tab.path.indexOf(fromPath + '/') === 0) {
        tab.path = toPath + tab.path.slice(fromPath.length);
      }
    });
    ['activePath', 'selectedPath'].forEach(function (key) {
      if (state[key] === fromPath) state[key] = toPath;
      else if (state[key] && state[key].indexOf(fromPath + '/') === 0) {
        state[key] = toPath + state[key].slice(fromPath.length);
      }
    });

    var nextExpanded = {};
    Object.keys(state.expanded).forEach(function (key) {
      if (key === fromPath) nextExpanded[toPath] = state.expanded[key];
      else if (key.indexOf(fromPath + '/') === 0) nextExpanded[toPath + key.slice(fromPath.length)] = state.expanded[key];
      else nextExpanded[key] = state.expanded[key];
    });
    state.expanded = nextExpanded;
    renderTabs();
  }

  /** Closes tabs for a deleted file, or for everything under a deleted folder. */
  function closeTabsUnder(p) {
    for (var i = state.open.length - 1; i >= 0; i--) {
      var tab = state.open[i];
      if (tab.path === p || tab.path.indexOf(p + '/') === 0) state.open.splice(i, 1);
    }
    if (state.activePath === p || (state.activePath && state.activePath.indexOf(p + '/') === 0)) {
      state.activePath = state.open.length ? state.open[state.open.length - 1].path : null;
    }
    if (state.selectedPath === p || (state.selectedPath && state.selectedPath.indexOf(p + '/') === 0)) {
      state.selectedPath = state.activePath;
    }
    renderTabs();
    showActiveDocument();
  }

  // ── Editor ─────────────────────────────────────────────────────────────────

  var cm = null;

  function initEditor() {
    cm = CodeMirror(els.editorHost, {
      value: '',
      mode: 'htmlmixed',
      lineNumbers: true,
      lineWrapping: true,
      autoCloseBrackets: true,
      autoCloseTags: true,
      matchBrackets: true,
      styleActiveLine: true,
      indentUnit: 2,
      tabSize: 2,
      // A contenteditable surface breaks IME and autocorrect on mobile
      // keyboards; the hidden textarea is what makes phone typing work.
      inputStyle: 'textarea',
      extraKeys: {
        'Ctrl-S': function () { saveActive(); },
        'Cmd-S':  function () { saveActive(); },
        // Tab must indent, not move focus out of the editor.
        Tab: function (editor) {
          if (editor.somethingSelected()) editor.indentSelection('add');
          else editor.replaceSelection('  ', 'end');
        }
      }
    });
    cm.getWrapperElement().style.display = 'none';

    cm.on('change', function () {
      var tab = activeTab();
      if (!tab || tab.suppressChange) return;
      if (tab.clean) {
        tab.clean = false;
        renderTabs();
        renderTree();
      }
      setStatus('Unsaved changes', 'dirty');
      scheduleAutosave();
    });
  }

  function activeTab() { return findTab(state.activePath); }

  function findTab(p) {
    for (var i = 0; i < state.open.length; i++) if (state.open[i].path === p) return state.open[i];
    return null;
  }

  function renderTabs() {
    var html = '';
    for (var i = 0; i < state.open.length; i++) {
      var tab = state.open[i];
      html += '<button type="button" class="tab'
        + (tab.path === state.activePath ? ' active' : '')
        + (tab.clean ? '' : ' dirty')
        + '" data-path="' + escapeHtml(tab.path) + '">'
        + '<span class="tab-name">' + escapeHtml(tab.name) + '</span>'
        + '<span class="tab-close" data-close="' + escapeHtml(tab.path) + '" role="button" aria-label="Close"></span>'
        + '</button>';
    }
    els.tabbar.innerHTML = html;
  }

  els.tabbar.addEventListener('click', function (e) {
    var close = e.target.closest('[data-close]');
    if (close) {
      e.stopPropagation();
      closeTab(close.getAttribute('data-close'));
      return;
    }
    var tab = e.target.closest('.tab');
    if (tab) activateTab(tab.getAttribute('data-path'));
  });

  function openFile(p, editable, opts) {
    // focusPane is suppressed on boot: on a phone the explorer is the first
    // pane, and preloading index.html must not yank the developer into it.
    var focusPane = !(opts && opts.focusPane === false);
    var existing = findTab(p);
    if (existing) { activateTab(p); if (focusPane) switchPane('editor'); return Promise.resolve(); }

    var node = findNode(p);
    if (node && node.image) return openImage(node);
    if (editable === false || (node && node.editable === false)) {
      toast('That file type cannot be opened in the editor.', 'error');
      return Promise.resolve();
    }

    setStatus('Opening…');
    return api.readFile(p).then(function (data) {
      var doc = CodeMirror.Doc(data.content, data.mode || 'null');
      state.open.push({
        path: data.path,
        name: basename(data.path),
        doc: doc,
        mode: data.mode || 'null',
        clean: true,
        image: false
      });
      activateTab(data.path);
      if (focusPane) switchPane('editor');
      setStatus('');
    }).catch(function (err) {
      setStatus('');
      handleError(err);
    });
  }

  /** Images get a preview pane instead of an editor. */
  function openImage(node) {
    state.activePath = node.path;
    state.selectedPath = node.path;
    // Served through the preview token — the workspace has no other public
    // URL, and reusing the token keeps image bytes under the same grant.
    return ensurePreviewToken().then(function (baseUrl) {
      els.editorImageEl.src = baseUrl + node.path.split('/').map(encodeURIComponent).join('/');
      els.editorImageMeta.innerHTML = '<code>' + escapeHtml(node.path) + '</code><br />' + formatBytes(node.size);
      els.editorEmpty.style.display = 'none';
      if (cm) cm.getWrapperElement().style.display = 'none';
      els.editorImage.classList.add('open');
      switchPane('editor');
      renderTree();
    }).catch(function (err) {
      handleError(err);
    });
  }

  function activateTab(p) {
    var tab = findTab(p);
    if (!tab) return;
    state.activePath = p;
    state.selectedPath = p;
    els.editorImage.classList.remove('open');
    showActiveDocument();
    renderTabs();
    paintSelection();
    setStatus(tab.clean ? '' : 'Unsaved changes', tab.clean ? '' : 'dirty');
  }

  function showActiveDocument() {
    var tab = activeTab();
    if (!cm) return;

    if (!tab) {
      cm.getWrapperElement().style.display = 'none';
      if (!els.editorImage.classList.contains('open')) els.editorEmpty.style.display = '';
      return;
    }

    els.editorEmpty.style.display = 'none';
    els.editorImage.classList.remove('open');
    cm.getWrapperElement().style.display = '';

    // swapDoc fires a 'change' for the whole document; without the guard every
    // tab switch would mark the newly shown file dirty.
    tab.suppressChange = true;
    cm.swapDoc(tab.doc);
    cm.setOption('mode', tab.mode);
    tab.suppressChange = false;

    // CodeMirror measures on show; a refresh is required after unhiding it or
    // the gutter and cursor land in the wrong place.
    setTimeout(function () { cm.refresh(); }, 0);
  }

  function closeTab(p) {
    var tab = findTab(p);
    if (!tab) return;

    var proceed = function () {
      var index = state.open.indexOf(tab);
      state.open.splice(index, 1);
      if (state.activePath === p) {
        var next = state.open[index] || state.open[index - 1];
        state.activePath = next ? next.path : null;
      }
      renderTabs();
      showActiveDocument();
      renderTree();
    };

    if (tab.clean) return proceed();
    dialog.open({
      title: 'Close without saving?',
      hint: tab.name + ' has unsaved changes that will be lost.',
      noInput: true,
      confirm: 'Discard changes',
      danger: true,
      onSubmit: function () { proceed(); return true; }
    });
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  var autosaveTimer = null;
  var lastUsageRefresh = 0;

  /**
   * The footer's file/byte counters only change materially over a session, so
   * a full tree re-read on every autosave would double the request rate for
   * nothing. At most once every 10 seconds is plenty.
   */
  function refreshUsageSoon() {
    if (Date.now() - lastUsageRefresh < 10000) return;
    lastUsageRefresh = Date.now();
    refreshTree().catch(function () {});
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    // Long enough that a burst of typing is one request, short enough that
    // Run almost always picks up what is on screen.
    autosaveTimer = setTimeout(function () { saveActive(true); }, 1600);
  }

  function saveActive(isAuto) {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    var tab = activeTab();
    if (!tab) return Promise.resolve();
    if (tab.clean) { if (!isAuto) setStatus('Saved', 'saved'); return Promise.resolve(); }

    var content = tab.doc.getValue();
    setStatus('Saving…', 'saving');

    return api.saveFile(tab.path, content).then(function (data) {
      // Only mark clean if nothing was typed while the request was in flight —
      // otherwise those keystrokes would be silently dropped from the next save.
      if (tab.doc.getValue() === content) {
        tab.clean = true;
        renderTabs();
        renderTree();
        setStatus('Saved', 'saved');
        setTimeout(function () { if (els.status.textContent === 'Saved') setStatus(''); }, 2200);
      } else {
        setStatus('Unsaved changes', 'dirty');
        scheduleAutosave();
      }
      refreshUsageSoon();
    }).catch(function (err) {
      setStatus('Not saved', 'error');
      handleError(err);
    });
  }

  /** Saves every dirty tab — used before Run so the preview matches the editor. */
  function saveAll() {
    var dirty = state.open.filter(function (tab) { return !tab.clean; });
    if (!dirty.length) return Promise.resolve();

    setStatus('Saving…', 'saving');
    return Promise.all(dirty.map(function (tab) {
      var content = tab.doc.getValue();
      return api.saveFile(tab.path, content).then(function () {
        if (tab.doc.getValue() === content) tab.clean = true;
      });
    })).then(function () {
      renderTabs();
      renderTree();
      setStatus('Saved', 'saved');
      setTimeout(function () { if (els.status.textContent === 'Saved') setStatus(''); }, 2200);
    }).catch(function (err) {
      setStatus('Not saved', 'error');
      handleError(err);
      throw err;
    });
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  var tokenPromise = null;

  /** One token per session, reused until the server rejects it. */
  function ensurePreviewToken() {
    if (state.previewUrl) return Promise.resolve(state.previewUrl);
    if (tokenPromise) return tokenPromise;
    tokenPromise = api.previewToken().then(function (data) {
      state.previewUrl = data.url;
      tokenPromise = null;
      return data.url;
    }).catch(function (err) {
      tokenPromise = null;
      throw err;
    });
    return tokenPromise;
  }

  function openPreview() {
    els.body.classList.add('preview-open');
  }

  function run() {
    // Saving first is the whole point: a developer presses Run expecting to
    // see what is on screen, not what was last written to disk.
    saveAll().then(ensurePreviewToken).then(function (url) {
      openPreview();
      switchPane('preview');
      consolePane.clear();
      consolePane.system('Running ' + PROTECTED + '…');
      mountFrame(url);
    }).catch(function (err) {
      // A token minted before a restart is gone; one retry with a fresh one.
      if (err && err.status === 403 && state.previewUrl) {
        state.previewUrl = null;
        return run();
      }
      handleError(err);
    });
  }

  function mountFrame(url) {
    if (state.frame) state.frame.remove();

    var frame = document.createElement('iframe');
    // No allow-same-origin: the game gets an opaque origin and cannot reach
    // the portal's cookies, storage or DOM. Everything a game legitimately
    // needs (scripts, pointer lock, fullscreen, its own forms) is granted.
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-orientation-lock');
    frame.setAttribute('allow', 'fullscreen; autoplay; gamepad; accelerometer; gyroscope');
    frame.setAttribute('title', 'Game preview');
    // Cache-bust so a rerun always fetches the file just saved.
    frame.src = url + '?t=' + Date.now();

    els.previewIdle.style.display = 'none';
    els.previewStage.appendChild(frame);
    state.frame = frame;
  }

  function reloadPreview() {
    if (!state.frame) return run();
    saveAll().then(function () {
      consolePane.clear();
      consolePane.system('Reloading…');
      mountFrame(state.previewUrl);
    }).catch(function () {});
  }

  function closePreview() {
    els.body.classList.remove('preview-open');
    if (state.frame) { state.frame.remove(); state.frame = null; }
    els.previewIdle.style.display = '';
    switchPane('editor');
  }

  // ── Console ────────────────────────────────────────────────────────────────

  var consolePane = (function () {
    var MAX_LOGS = 400;

    function stamp() {
      var d = new Date();
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    }

    function push(level, text) {
      if (state.logCount === 0) els.consoleBody.innerHTML = '';

      var row = document.createElement('div');
      row.className = 'log ' + level;
      var time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = stamp();
      var body = document.createElement('span');
      body.className = 'log-text';
      body.textContent = text;
      row.appendChild(time);
      row.appendChild(body);

      // Stick to the bottom only when already there, so reading scrollback is
      // not yanked away by a chatty game loop.
      var atBottom = els.consoleBody.scrollTop + els.consoleBody.clientHeight >= els.consoleBody.scrollHeight - 30;
      els.consoleBody.appendChild(row);
      state.logCount++;

      while (els.consoleBody.childElementCount > MAX_LOGS) els.consoleBody.removeChild(els.consoleBody.firstChild);
      if (atBottom) els.consoleBody.scrollTop = els.consoleBody.scrollHeight;

      if (level === 'error') {
        state.errorCount++;
        els.mobileErr.textContent = state.errorCount;
        els.mobileErr.hidden = false;
      }
      els.consoleCount.textContent = state.logCount;
      els.consoleCount.classList.toggle('has-errors', state.errorCount > 0);
    }

    return {
      push: push,
      system: function (text) { push('system', text); },
      clear: function () {
        els.consoleBody.innerHTML = '<div class="console-empty">Console output from your game appears here while it runs.</div>';
        state.logCount = 0;
        state.errorCount = 0;
        els.consoleCount.textContent = '0';
        els.consoleCount.classList.remove('has-errors');
        els.mobileErr.hidden = true;
      }
    };
  })();

  // Messages from the sandboxed frame. Its origin is opaque ("null"), so the
  // frame is identified by event.source rather than by origin — and anything
  // that is not the current preview frame is ignored.
  window.addEventListener('message', function (e) {
    if (!state.frame || e.source !== state.frame.contentWindow) return;
    var data = e.data;
    if (!data || data.__pmBuilderConsole !== true) return;

    var level = ['log', 'info', 'warn', 'error', 'debug'].indexOf(data.level) === -1 ? 'log' : data.level;
    if (level === 'debug') level = 'log';
    var parts = Array.isArray(data.parts) ? data.parts : [String(data.parts)];
    consolePane.push(level, parts.map(function (p) { return String(p); }).join(' '));
  });

  // ── Panes ──────────────────────────────────────────────────────────────────

  function switchPane(pane) {
    els.body.setAttribute('data-pane', pane);
    els.mobileBar.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-pane') === pane);
    });
    if (pane === 'preview') openPreview();
    // The editor was display:none while another pane showed, so CodeMirror
    // measured zero height — it needs a refresh once it is visible again.
    if (pane === 'editor' && cm) setTimeout(function () { cm.refresh(); }, 30);
  }

  els.mobileBar.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-pane]');
    if (!btn) return;
    var pane = btn.getAttribute('data-pane');
    if (pane === 'preview' && !state.frame) return run();
    switchPane(pane);
  });

  // ── Wiring ─────────────────────────────────────────────────────────────────

  $('saveBtn').addEventListener('click', function () { saveActive(); });
  $('runBtn').addEventListener('click', run);
  $('reloadBtn').addEventListener('click', reloadPreview);
  $('closePreviewBtn').addEventListener('click', closePreview);
  $('clearConsoleBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    consolePane.clear();
  });

  $('popOutBtn').addEventListener('click', function () {
    saveAll().then(ensurePreviewToken).then(function (url) {
      window.open(url + '?t=' + Date.now(), '_blank', 'noopener');
    }).catch(handleError);
  });

  $('consoleHead').addEventListener('click', function (e) {
    if (e.target.closest('#clearConsoleBtn')) return;
    els.consoleEl.classList.toggle('collapsed');
  });

  $('newFileBtn').addEventListener('click', function () { promptNewFile(currentFolder()); });
  $('newFolderBtn').addEventListener('click', function () { promptNewFolder(currentFolder()); });

  /** New entries land inside the selected folder, beside the selected file,
      or at the root when nothing is selected. */
  function currentFolder() {
    var ref = state.selectedPath || state.activePath;
    if (!ref) return '';
    var node = findNode(ref);
    if (node && node.type === 'dir') return node.path;
    return dirname(ref);
  }

  $('uploadBtn').addEventListener('click', function () { els.uploadInput.click(); });
  els.uploadInput.addEventListener('change', function () {
    var file = els.uploadInput.files && els.uploadInput.files[0];
    if (!file) return;
    var parent = currentFolder();
    setStatus('Uploading…', 'saving');
    api.upload(parent, file).then(function (data) {
      revealPath(data.path);
      return refreshTree().then(function () {
        setStatus('');
        toast('Added ' + basename(data.path), 'ok');
      });
    }).catch(function (err) {
      setStatus('');
      handleError(err);
    }).then(function () {
      // Cleared so re-picking the same file fires 'change' again.
      els.uploadInput.value = '';
    });
  });

  $('moreBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    els.moreMenu.classList.toggle('open');
  });

  $('resetBtn').addEventListener('click', function () {
    els.moreMenu.classList.remove('open');
    dialog.open({
      title: 'Change template?',
      hint: 'This deletes every file in this project’s workspace and lets you pick a new template. '
          + 'Type the project name to confirm — consider downloading a zip first.',
      value: '',
      confirm: 'Delete and start over',
      danger: true,
      onSubmit: function (typed) {
        if (typed.trim().toLowerCase() !== CFG.projectName.trim().toLowerCase()) {
          throw new Error('That does not match the project name.');
        }
        $('resetConfirmName').value = typed;
        $('resetForm').submit();
        return true;
      }
    });
  });

  // Ctrl/Cmd+S anywhere on the page, not only inside the editor.
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveActive();
    }
  });

  // Last line of defence for unsaved work — the autosave usually beats it.
  window.addEventListener('beforeunload', function (e) {
    if (!state.open.some(function (tab) { return !tab.clean; })) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // A resize can cross the mobile breakpoint, which changes which panes are
  // displayed; CodeMirror must remeasure whenever it becomes visible again.
  window.addEventListener('resize', function () {
    if (cm) cm.refresh();
  });

  // ── Boot ───────────────────────────────────────────────────────────────────
  initEditor();
  renderTree();
  renderUsage();
  switchPane(window.innerWidth <= 900 ? 'files' : 'editor');

  // Open index.html straight away — it is the entry point and what a developer
  // almost always wants first.
  if (findNode(PROTECTED)) {
    openFile(PROTECTED, true, { focusPane: false });
  }
})();
