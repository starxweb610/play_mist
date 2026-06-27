/* developer-storyboard.js — Storyboard + sketch editor for PlayMist projects */

let sbProjId      = null;
let sbStoryboards = [];
let sbCurrent     = null;   // currently-open storyboard {id,title}
let sbFrames      = [];      // frames of the open storyboard

const SB_CANVAS_W = 1920;
const SB_CANVAS_H = 1080;

// ── Tiny helpers ───────────────────────────────────────────────────────────────
function _sbEsc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function _sbApi(url, opts) {
  return fetch(url, opts).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
}

// ── One-time style injection ───────────────────────────────────────────────────
function _sbInjectStyles() {
  if (document.getElementById('sb-styles')) return;
  const css = `
  .sb-wrap { font-size:13px; }
  .sb-head { display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:10px; }
  .sb-board-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px; }
  .sb-board-card {
    background:var(--surface);border:1px solid var(--line);border-radius:12px;overflow:hidden;
    cursor:pointer;transition:border-color .15s, box-shadow .15s;display:flex;flex-direction:column;
  }
  .sb-board-card:hover { border-color:var(--accent);box-shadow:0 6px 20px rgba(0,0,0,.22); }
  .sb-board-cover {
    aspect-ratio:16/9;background:var(--surface-3);display:flex;align-items:center;justify-content:center;
    background-size:cover;background-position:center;color:var(--ink-4);
  }
  .sb-board-meta { padding:11px 13px;display:flex;justify-content:space-between;align-items:center;gap:8px; }
  .sb-board-title { font-family:'Indie Flower',cursive;font-size:20px;line-height:1.1;color:var(--ink);font-weight:700;word-break:break-word; }
  .sb-board-sub { font-size:11px;color:var(--ink-3);white-space:nowrap; }

  .sb-frames-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px; }
  .sb-frame-card {
    background:#fffef7;border:1px solid var(--line);border-radius:6px;overflow:hidden;
    box-shadow:0 3px 10px rgba(0,0,0,.25);display:flex;flex-direction:column;cursor:pointer;
    transition:transform .12s, box-shadow .12s;
  }
  .sb-frame-card:hover { transform:translateY(-3px);box-shadow:0 10px 24px rgba(0,0,0,.32); }
  .sb-frame-thumb { aspect-ratio:16/9;background:#fff;background-size:cover;background-position:center;border-bottom:1px solid #e6e1cf; }
  .sb-frame-body { padding:9px 11px 12px; }
  .sb-frame-title { font-family:'Indie Flower',cursive;font-size:19px;line-height:1.15;color:#23242a;font-weight:700;word-break:break-word; }
  .sb-frame-desc { font-family:'Indie Flower',cursive;font-size:14px;line-height:1.3;color:#555;margin-top:3px;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
  .sb-frame-num {
    display:inline-block;font-size:10px;font-weight:700;color:var(--ink-3);background:var(--surface-3);
    border-radius:4px;padding:1px 6px;margin-bottom:5px;letter-spacing:.04em;
  }
  .sb-frame-ghost { opacity:.4; }

  /* Editor overlay */
  .sb-editor { position:fixed;inset:0;z-index:9500;background:var(--bg);display:flex;flex-direction:column; }
  .sb-editor-top {
    display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);
    flex-shrink:0;flex-wrap:wrap;background:var(--surface-2);
  }
  .sb-editor-body { flex:1;min-height:0;display:flex;overflow:hidden; }
  .sb-canvas-pane { flex:1;min-width:0;display:flex;align-items:center;justify-content:center;
    padding:18px;overflow:auto;background:repeating-conic-gradient(#2a2a30 0% 25%, #232328 0% 50%) 50%/22px 22px; }
  .sb-canvas-stage {
    position:relative;width:min(100%, calc((100vh - 230px) * 1.7778));aspect-ratio:16/9;
    box-shadow:0 8px 40px rgba(0,0,0,.5);
  }
  .sb-canvas-stage canvas { position:absolute;inset:0;width:100%;height:100%;border-radius:2px; }
  .sb-canvas-stage canvas.sb-draw { cursor:crosshair;touch-action:none; }
  .sb-side {
    width:300px;flex-shrink:0;border-left:1px solid var(--line);padding:18px;overflow-y:auto;
    background:var(--surface);display:flex;flex-direction:column;gap:16px;
  }
  @media (max-width:760px){ .sb-editor-body{flex-direction:column;} .sb-side{width:auto;border-left:none;border-top:1px solid var(--line);} }

  .sb-tool-group { display:flex;align-items:center;gap:6px;padding:0 8px;border-right:1px solid var(--line); }
  .sb-tool-group:last-child { border-right:none; }
  .sb-tool-btn {
    width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--surface);
    color:var(--ink-2);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .12s;
  }
  .sb-tool-btn:hover { border-color:var(--accent);color:var(--ink); }
  .sb-tool-btn.active { background:var(--accent);border-color:var(--accent);color:var(--accent-ink,#fff); }
  .sb-tool-lbl { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-4);margin-right:2px; }
  .sb-color { width:34px;height:34px;border:1px solid var(--line);border-radius:8px;background:none;cursor:pointer;padding:2px; }
  .sb-range { width:96px;accent-color:var(--accent); }
  .sb-field-label { display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);margin-bottom:6px; }
  .sb-input {
    display:block;width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid var(--line);border-radius:8px;
    background:var(--surface-2);color:var(--ink);font-size:13px;font-family:inherit;outline:none;
  }
  .sb-input:focus { border-color:var(--accent); }
  textarea.sb-input.sb-handwriting { font-family:'Indie Flower',cursive;font-size:18px;line-height:1.4; }
  `;
  const s = document.createElement('style');
  s.id = 'sb-styles';
  s.textContent = css;
  document.head.appendChild(s);
}

// ── Entry point ────────────────────────────────────────────────────────────────
function initStoryboard() {
  _sbInjectStyles();
  const root = document.getElementById('storyboard-root');
  sbProjId = root?.dataset.projectId;
  if (!sbProjId) return;
  loadStoryboards();
}

async function loadStoryboards() {
  const root = document.getElementById('storyboard-root');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-3);">Loading storyboards…</div>';
  try {
    const data = await _sbApi(`/developer/projects/${sbProjId}/storyboards`);
    sbStoryboards = data.storyboards || [];
    sbCurrent = null;
    renderStoryboardList();
  } catch (err) {
    root.innerHTML = `<p style="color:var(--danger);padding:20px;">Error: ${_sbEsc(err.message)}</p>`;
  }
}

// ── Storyboard list view ───────────────────────────────────────────────────────
function renderStoryboardList() {
  const root = document.getElementById('storyboard-root');
  if (!root) return;

  const cards = sbStoryboards.map((s) => {
    const cover = s.cover_url
      ? `style="background-image:url('${_sbEsc(s.cover_url)}')"`
      : '';
    const inner = s.cover_url ? '' : `
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>`;
    return `
      <div class="sb-board-card" onclick="openStoryboard(${s.id})">
        <div class="sb-board-cover" ${cover}>${inner}</div>
        <div class="sb-board-meta">
          <div style="min-width:0;">
            <div class="sb-board-title">${_sbEsc(s.title)}</div>
            <div class="sb-board-sub">${s.frame_count} frame${s.frame_count == 1 ? '' : 's'}</div>
          </div>
          <button onclick="event.stopPropagation();renameStoryboard(${s.id})" title="Rename"
            style="background:none;border:none;cursor:pointer;color:var(--ink-4);padding:4px;flex-shrink:0;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onclick="event.stopPropagation();deleteStoryboard(${s.id})" title="Delete"
            style="background:none;border:none;cursor:pointer;color:var(--danger);padding:4px;flex-shrink:0;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div class="sb-wrap">
      <div class="sb-head">
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--ink);">Storyboards</div>
          <div style="font-size:12px;color:var(--ink-3);margin-top:2px;">Sketch out scenes, levels, and cutscenes frame by frame</div>
        </div>
        <button class="btn primary sm" onclick="createStoryboard()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Storyboard
        </button>
      </div>
      ${sbStoryboards.length
        ? `<div class="sb-board-grid">${cards}</div>`
        : `<div style="padding:60px 20px;text-align:center;color:var(--ink-3);border:1px dashed var(--line);border-radius:12px;">
             No storyboards yet. Create one to start sketching frames.
           </div>`}
    </div>`;
}

async function createStoryboard() {
  const title = prompt('Storyboard title:', 'Untitled Storyboard');
  if (title == null || !title.trim()) return;
  try {
    const data = await _sbApi(`/developer/projects/${sbProjId}/storyboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    });
    sbStoryboards.push(data.storyboard);
    renderStoryboardList();
  } catch (err) { alert('Error: ' + err.message); }
}

async function renameStoryboard(sbId) {
  const sb = sbStoryboards.find((s) => s.id == sbId);
  const title = prompt('Rename storyboard:', sb ? sb.title : '');
  if (title == null || !title.trim()) return;
  try {
    await _sbApi(`/developer/storyboards/${sbId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim() }),
    });
    if (sb) sb.title = title.trim();
    if (sbCurrent && sbCurrent.id == sbId) { sbCurrent.title = title.trim(); renderFrames(); }
    else renderStoryboardList();
  } catch (err) { alert('Error: ' + err.message); }
}

async function deleteStoryboard(sbId) {
  if (!confirm('Delete this storyboard and all its frames? This cannot be undone.')) return;
  try {
    await _sbApi(`/developer/storyboards/${sbId}`, { method: 'DELETE' });
    sbStoryboards = sbStoryboards.filter((s) => s.id != sbId);
    renderStoryboardList();
  } catch (err) { alert('Error: ' + err.message); }
}

// ── Frame grid view (inside a storyboard) ───────────────────────────────────────
async function openStoryboard(sbId) {
  const sb = sbStoryboards.find((s) => s.id == sbId);
  sbCurrent = sb ? { id: sb.id, title: sb.title } : { id: sbId, title: 'Storyboard' };
  const root = document.getElementById('storyboard-root');
  root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-3);">Loading frames…</div>';
  try {
    const data = await _sbApi(`/developer/storyboards/${sbId}/frames`);
    sbFrames = data.frames || [];
    renderFrames();
  } catch (err) {
    root.innerHTML = `<p style="color:var(--danger);padding:20px;">Error: ${_sbEsc(err.message)}</p>`;
  }
}

function renderFrames() {
  const root = document.getElementById('storyboard-root');
  if (!root) return;

  const cards = sbFrames.map((f, i) => {
    const thumb = f.thumb_url ? `style="background-image:url('${_sbEsc(f.thumb_url)}')"` : '';
    return `
      <div class="sb-frame-card" data-frame-id="${f.id}" ondblclick="openFrameEditor(${f.id})">
        <div class="sb-frame-thumb" ${thumb}></div>
        <div class="sb-frame-body">
          <span class="sb-frame-num">FRAME ${i + 1}</span>
          <div class="sb-frame-title">${_sbEsc(f.title) || 'Untitled'}</div>
          ${f.description ? `<div class="sb-frame-desc">${_sbEsc(f.description)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div class="sb-wrap">
      <div class="sb-head">
        <div style="display:flex;align-items:center;gap:12px;min-width:0;">
          <button class="btn ghost sm" onclick="loadStoryboards()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            All
          </button>
          <div class="sb-board-title" style="font-size:24px;">${_sbEsc(sbCurrent.title)}</div>
        </div>
        <button class="btn primary sm" onclick="openFrameEditor()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Frame
        </button>
      </div>
      ${sbFrames.length
        ? `<div class="sb-frames-grid" id="sb-frames-grid">${cards}</div>
           <div style="font-size:11px;color:var(--ink-4);margin-top:14px;">Double-click a frame to edit · drag to reorder</div>`
        : `<div style="padding:60px 20px;text-align:center;color:var(--ink-3);border:1px dashed var(--line);border-radius:12px;">
             No frames yet. Click <strong>Add Frame</strong> to draw your first sketch.
           </div>`}
    </div>`;

  _sbSetupReorder();
}

function _sbSetupReorder() {
  const grid = document.getElementById('sb-frames-grid');
  if (!grid || typeof Sortable === 'undefined') return;
  Sortable.create(grid, {
    animation: 150,
    ghostClass: 'sb-frame-ghost',
    onEnd() {
      const order = [...grid.querySelectorAll('.sb-frame-card')].map((c) => c.dataset.frameId);
      // Re-sync local order so frame numbers stay correct
      sbFrames.sort((a, b) => order.indexOf(String(a.id)) - order.indexOf(String(b.id)));
      grid.querySelectorAll('.sb-frame-card').forEach((c, i) => {
        const num = c.querySelector('.sb-frame-num');
        if (num) num.textContent = `FRAME ${i + 1}`;
      });
      _sbApi(`/developer/storyboards/${sbCurrent.id}/frames/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      }).catch(() => {});
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DRAWING EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

const sbDraw = {
  tool: 'brush',
  color: '#1a1a1a',
  size: 6,
  brushType: 'round',     // 'round' | 'square'
  eraserSize: 30,
  bgColor: '#ffffff',
  drawing: false,
  start: null,
  last: null,
  snapshot: null,         // ImageData captured at stroke start (for shape preview)
  undoStack: [],
  bgCanvas: null,
  drawCanvas: null,
  bctx: null,
  dctx: null,
  frameId: null,          // null = new frame
};

function _sbPaintBg() {
  sbDraw.bctx.fillStyle = sbDraw.bgColor;
  sbDraw.bctx.fillRect(0, 0, SB_CANVAS_W, SB_CANVAS_H);
}

function _sbPointer(e) {
  const rect = sbDraw.drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (SB_CANVAS_W / rect.width),
    y: (e.clientY - rect.top) * (SB_CANVAS_H / rect.height),
  };
}

function _sbApplyStroke() {
  const c = sbDraw.dctx;
  if (sbDraw.tool === 'eraser') {
    // Clear pixels on the transparent draw layer, revealing the background below.
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = sbDraw.eraserSize;
    c.strokeStyle = 'rgba(0,0,0,1)';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    return;
  }
  c.globalCompositeOperation = 'source-over';
  c.lineWidth = sbDraw.size;
  c.strokeStyle = sbDraw.color;
  c.fillStyle = sbDraw.color;
  c.lineCap = sbDraw.brushType === 'square' ? 'square' : 'round';
  c.lineJoin = sbDraw.brushType === 'square' ? 'miter' : 'round';
}

function _sbConstrain(start, cur) {
  // Returns a possibly shift-constrained end point (square bbox).
  const d = Math.max(Math.abs(cur.x - start.x), Math.abs(cur.y - start.y));
  const sx = Math.sign(cur.x - start.x) || 1;
  const sy = Math.sign(cur.y - start.y) || 1;
  return { x: start.x + sx * d, y: start.y + sy * d };
}

function _sbPushUndo() {
  try {
    sbDraw.undoStack.push(sbDraw.dctx.getImageData(0, 0, SB_CANVAS_W, SB_CANVAS_H));
    if (sbDraw.undoStack.length > 8) sbDraw.undoStack.shift();
  } catch (_) { /* tainted canvas — undo disabled */ }
}

function _sbDrawDown(e) {
  e.preventDefault();
  const p = _sbPointer(e);
  sbDraw.drawing = true;
  sbDraw.start = p;
  sbDraw.last = p;
  _sbPushUndo();
  _sbApplyStroke();
  if (sbDraw.tool === 'brush' || sbDraw.tool === 'eraser') {
    const c = sbDraw.dctx;
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x, p.y);
    c.stroke();
  } else {
    // snapshot for live shape preview
    sbDraw.snapshot = sbDraw.dctx.getImageData(0, 0, SB_CANVAS_W, SB_CANVAS_H);
  }
}

function _sbDrawMove(e) {
  if (!sbDraw.drawing) return;
  e.preventDefault();
  const p = _sbPointer(e);
  const c = sbDraw.dctx;
  _sbApplyStroke();

  if (sbDraw.tool === 'brush' || sbDraw.tool === 'eraser') {
    c.beginPath();
    c.moveTo(sbDraw.last.x, sbDraw.last.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    sbDraw.last = p;
    return;
  }

  // shape preview
  c.putImageData(sbDraw.snapshot, 0, 0);
  const s = sbDraw.start;
  let end = p;

  if (sbDraw.tool === 'line') {
    if (e.shiftKey) {
      const ang = Math.atan2(p.y - s.y, p.x - s.x);
      const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(p.x - s.x, p.y - s.y);
      end = { x: s.x + Math.cos(snap) * len, y: s.y + Math.sin(snap) * len };
    }
    c.beginPath();
    c.moveTo(s.x, s.y);
    c.lineTo(end.x, end.y);
    c.stroke();
  } else if (sbDraw.tool === 'rect') {
    if (e.shiftKey) end = _sbConstrain(s, p);
    c.strokeRect(s.x, s.y, end.x - s.x, end.y - s.y);
  } else if (sbDraw.tool === 'circle') {
    if (e.shiftKey) end = _sbConstrain(s, p);
    const cx = (s.x + end.x) / 2, cy = (s.y + end.y) / 2;
    const rx = Math.abs(end.x - s.x) / 2, ry = Math.abs(end.y - s.y) / 2;
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.stroke();
  }
}

function _sbDrawUp() {
  sbDraw.drawing = false;
  sbDraw.snapshot = null;
  if (sbDraw.dctx) sbDraw.dctx.globalCompositeOperation = 'source-over';
}

function _sbUndo() {
  if (!sbDraw.undoStack.length) return;
  const img = sbDraw.undoStack.pop();
  sbDraw.dctx.putImageData(img, 0, 0);
}

function _sbClear() {
  if (!confirm('Clear the entire sketch?')) return;
  _sbPushUndo();
  sbDraw.dctx.clearRect(0, 0, SB_CANVAS_W, SB_CANVAS_H);
}

function _sbToolBtn(tool, label, svg) {
  return `<button class="sb-tool-btn" data-tool="${tool}" title="${label}" onclick="sbSelectTool('${tool}')">${svg}</button>`;
}

function sbSelectTool(tool) {
  sbDraw.tool = tool;
  document.querySelectorAll('#sb-toolbar .sb-tool-btn[data-tool]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
}

function sbSetBrushType(t) {
  sbDraw.brushType = t;
  document.querySelectorAll('#sb-brushtype .sb-tool-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.btype === t);
  });
}

// Open the editor. frameId omitted/null => new frame.
async function openFrameEditor(frameId) {
  // reset state
  sbDraw.tool = 'brush';
  sbDraw.color = '#1a1a1a';
  sbDraw.size = 6;
  sbDraw.brushType = 'round';
  sbDraw.eraserSize = 30;
  sbDraw.bgColor = '#ffffff';
  sbDraw.undoStack = [];
  sbDraw.frameId = frameId || null;

  let frame = null;
  if (frameId) {
    frame = sbFrames.find((f) => f.id == frameId);
    if (frame) sbDraw.bgColor = frame.bg_color || '#ffffff';
  }

  const overlay = document.createElement('div');
  overlay.className = 'sb-editor';
  overlay.id = 'sb-editor';
  overlay.innerHTML = `
    <div class="sb-editor-top" id="sb-toolbar">
      <button class="btn ghost sm" onclick="closeFrameEditor()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Close
      </button>

      <div class="sb-tool-group">
        ${_sbToolBtn('brush', 'Brush', '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>')}
        ${_sbToolBtn('line', 'Line', '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>')}
        ${_sbToolBtn('rect', 'Box', '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>')}
        ${_sbToolBtn('circle', 'Circle', '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>')}
        ${_sbToolBtn('eraser', 'Eraser', '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.24 3.56l4.2 4.2a1.5 1.5 0 0 1 0 2.12L11.4 19H7.6l-3.16-3.16a1.5 1.5 0 0 1 0-2.12l9.68-9.68a1.5 1.5 0 0 1 2.12 0z"/><line x1="22" y1="21" x2="7" y2="21"/></svg>')}
      </div>

      <div class="sb-tool-group">
        <span class="sb-tool-lbl">Brush</span>
        <input type="color" class="sb-color" value="${sbDraw.color}" title="Brush color" oninput="sbDraw.color=this.value">
        <input type="range" class="sb-range" min="1" max="60" value="${sbDraw.size}" title="Brush size"
          oninput="sbDraw.size=+this.value;document.getElementById('sb-size-val').textContent=this.value">
        <span id="sb-size-val" style="font-size:12px;color:var(--ink-3);width:22px;">${sbDraw.size}</span>
      </div>

      <div class="sb-tool-group">
        <span class="sb-tool-lbl">Eraser</span>
        <input type="range" class="sb-range" min="4" max="160" value="${sbDraw.eraserSize}" title="Eraser size"
          oninput="sbDraw.eraserSize=+this.value;document.getElementById('sb-eraser-val').textContent=this.value">
        <span id="sb-eraser-val" style="font-size:12px;color:var(--ink-3);width:26px;">${sbDraw.eraserSize}</span>
      </div>

      <div class="sb-tool-group" id="sb-brushtype">
        <span class="sb-tool-lbl">Tip</span>
        <button class="sb-tool-btn active" data-btype="round" title="Round tip" onclick="sbSetBrushType('round')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/></svg></button>
        <button class="sb-tool-btn" data-btype="square" title="Boxy tip" onclick="sbSetBrushType('square')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14"/></svg></button>
      </div>

      <div class="sb-tool-group">
        <span class="sb-tool-lbl">BG</span>
        <input type="color" class="sb-color" value="${sbDraw.bgColor}" title="Background color"
          oninput="sbDraw.bgColor=this.value;_sbPaintBg()">
      </div>

      <div class="sb-tool-group">
        <button class="sb-tool-btn" title="Undo" onclick="_sbUndo()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg></button>
        <button class="sb-tool-btn" title="Clear" onclick="_sbClear()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div>

      <div style="margin-left:auto;">
        <button class="btn primary sm" id="sb-save-btn" onclick="saveFrame()">Save Frame</button>
      </div>
    </div>

    <div class="sb-editor-body">
      <div class="sb-canvas-pane">
        <div class="sb-canvas-stage">
          <canvas class="sb-bg"   width="${SB_CANVAS_W}" height="${SB_CANVAS_H}"></canvas>
          <canvas class="sb-draw" width="${SB_CANVAS_W}" height="${SB_CANVAS_H}"></canvas>
        </div>
      </div>
      <div class="sb-side">
        <div>
          <label class="sb-field-label">Frame Title</label>
          <input type="text" id="sb-frame-title" class="sb-input" placeholder="Scene name…" value="${frame ? _sbEsc(frame.title) : ''}">
        </div>
        <div style="flex:1;display:flex;flex-direction:column;min-height:160px;">
          <label class="sb-field-label">Description</label>
          <textarea id="sb-frame-desc" class="sb-input sb-handwriting" style="flex:1;resize:none;min-height:140px;"
            placeholder="What happens in this frame…">${frame ? _sbEsc(frame.description) : ''}</textarea>
        </div>
        <div style="font-size:11px;color:var(--ink-4);line-height:1.6;">
          Tip: hold <strong>Shift</strong> while dragging a shape for a perfect square, circle, or straight line.
        </div>
        ${frame ? `
        <button class="btn ghost sm" style="color:var(--danger);justify-content:center;" onclick="deleteFrameFromEditor()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          Delete Frame
        </button>` : ''}
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Wire canvases
  sbDraw.bgCanvas   = overlay.querySelector('.sb-bg');
  sbDraw.drawCanvas = overlay.querySelector('.sb-draw');
  sbDraw.bctx = sbDraw.bgCanvas.getContext('2d');
  sbDraw.dctx = sbDraw.drawCanvas.getContext('2d');
  _sbPaintBg();
  sbSelectTool('brush');

  const dc = sbDraw.drawCanvas;
  dc.addEventListener('pointerdown', (e) => { dc.setPointerCapture(e.pointerId); _sbDrawDown(e); });
  dc.addEventListener('pointermove', _sbDrawMove);
  dc.addEventListener('pointerup', _sbDrawUp);
  dc.addEventListener('pointercancel', _sbDrawUp);

  // Load existing sketch via same-origin proxy (avoids canvas taint)
  if (frame && frame.image_url) {
    const img = new Image();
    img.onload = () => {
      sbDraw.dctx.drawImage(img, 0, 0, SB_CANVAS_W, SB_CANVAS_H);
    };
    img.src = `/developer/frames/${frame.id}/image?t=${Date.now()}`;
  }
}

function closeFrameEditor() {
  if (sbDraw.drawing) return;
  document.getElementById('sb-editor')?.remove();
  sbDraw.bgCanvas = sbDraw.drawCanvas = sbDraw.bctx = sbDraw.dctx = null;
  sbDraw.undoStack = [];
}

function _sbCanvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

async function saveFrame() {
  const btn = document.getElementById('sb-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const title = document.getElementById('sb-frame-title')?.value.trim() || '';
  const description = document.getElementById('sb-frame-desc')?.value.trim() || '';

  // Compose full-resolution PNG (bg + strokes)
  const full = document.createElement('canvas');
  full.width = SB_CANVAS_W; full.height = SB_CANVAS_H;
  const fctx = full.getContext('2d');
  fctx.fillStyle = sbDraw.bgColor;
  fctx.fillRect(0, 0, SB_CANVAS_W, SB_CANVAS_H);
  fctx.drawImage(sbDraw.drawCanvas, 0, 0);

  // Thumbnail
  const thumb = document.createElement('canvas');
  thumb.width = 480; thumb.height = 270;
  thumb.getContext('2d').drawImage(full, 0, 0, 480, 270);

  try {
    const [imgBlob, thumbBlob] = await Promise.all([
      _sbCanvasToBlob(full), _sbCanvasToBlob(thumb),
    ]);
    const fd = new FormData();
    fd.append('title', title);
    fd.append('description', description);
    fd.append('bg_color', sbDraw.bgColor);
    fd.append('image', imgBlob, 'frame-full.png');
    fd.append('thumb', thumbBlob, 'frame-thumb.png');

    const url = sbDraw.frameId
      ? `/developer/frames/${sbDraw.frameId}`
      : `/developer/storyboards/${sbCurrent.id}/frames`;
    const method = sbDraw.frameId ? 'PUT' : 'POST';

    const res = await fetch(url, { method, body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to save');

    if (sbDraw.frameId) {
      const idx = sbFrames.findIndex((f) => f.id == sbDraw.frameId);
      if (idx !== -1) sbFrames[idx] = data.frame;
    } else {
      sbFrames.push(data.frame);
    }
    closeFrameEditor();
    renderFrames();
  } catch (err) {
    alert('Error: ' + err.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Save Frame'; }
  }
}

async function deleteFrameFromEditor() {
  if (!sbDraw.frameId) { closeFrameEditor(); return; }
  if (!confirm('Delete this frame? This cannot be undone.')) return;
  try {
    await _sbApi(`/developer/frames/${sbDraw.frameId}`, { method: 'DELETE' });
    sbFrames = sbFrames.filter((f) => f.id != sbDraw.frameId);
    closeFrameEditor();
    renderFrames();
  } catch (err) { alert('Error: ' + err.message); }
}
