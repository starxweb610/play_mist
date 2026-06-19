/* developer-docs.js — Document management for PlayMist developer projects */

let _docsProjId   = null;
let _docsQuill    = null;

function _escD(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// ── Entry point called by tab activation ──────────────────────────────────────

function initDocs() {
  const root = document.getElementById('docs-root');
  _docsProjId = root?.dataset.projectId;
  if (!_docsProjId) return;
  loadDocs();
}

// ── List docs ─────────────────────────────────────────────────────────────────

async function loadDocs() {
  const root = document.getElementById('docs-root');
  if (!root) return;
  root.innerHTML = '<div style="padding:32px;text-align:center;color:var(--ink-3);">Loading…</div>';
  try {
    const res  = await fetch(`/developer/projects/${_docsProjId}/docs`);
    const data = await res.json();
    const docs = data.docs || [];

    if (!docs.length) {
      root.innerHTML = `
        <div style="padding:48px;text-align:center;color:var(--ink-3);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 12px;opacity:.5;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div style="font-size:14px;margin-bottom:6px;">No documents yet</div>
          <div style="font-size:12px;color:var(--ink-4);">Use <strong style="color:var(--accent);">+ New Doc</strong> to create your Game Design Document, design notes, or upload a PDF brief</div>
        </div>`;
      return;
    }

    const pinned   = docs.filter(d => d.is_pinned);
    const unpinned = docs.filter(d => !d.is_pinned);

    const TYPE_ICON = {
      rich_text: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      html:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
      upload:    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    };
    const TYPE_LABEL = { rich_text: 'Rich Text', html: 'HTML', upload: 'File' };

    const renderDoc = doc => {
      const borderColor = doc.is_pinned ? 'var(--warn)' : 'var(--info)';
      const sizeStr     = doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB · ` : '';
      const dateStr     = new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const pinIcon     = `<svg width="12" height="12" viewBox="0 0 24 24" fill="${doc.is_pinned ? 'var(--warn)' : 'none'}" stroke="${doc.is_pinned ? 'var(--warn)' : 'currentColor'}" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
      const editOrDown  = doc.doc_type !== 'upload'
        ? `<button class="btn sm ghost" onclick="editDoc(${doc.id},'${doc.doc_type}')">Edit</button>`
        : `<a class="btn sm ghost" href="${_escD(doc.file_url)}" target="_blank" download="${_escD(doc.file_name || 'download')}">Download</a>`;
      return `
        <div style="background:var(--surface);border:1px solid var(--line);border-left:3px solid ${borderColor};border-radius:10px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;flex-wrap:wrap;">
              ${doc.is_pinned ? `<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--warn);background:var(--warn-soft);padding:1px 7px;border-radius:999px;">Pinned</span>` : ''}
              <span style="font-weight:600;color:var(--ink);font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escD(doc.title)}</span>
            </div>
            <div style="font-size:12px;color:var(--ink-3);display:flex;align-items:center;gap:5px;">${TYPE_ICON[doc.doc_type] || ''}&nbsp;${TYPE_LABEL[doc.doc_type] || doc.doc_type} · ${sizeStr}${dateStr}</div>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0;align-items:center;">
            <button class="btn sm ghost" onclick="toggleDocPin(${doc.id})" title="${doc.is_pinned ? 'Unpin' : 'Pin'}" style="${doc.is_pinned ? 'color:var(--warn);' : ''}">${pinIcon}</button>
            <button class="btn sm ghost" onclick="viewDoc(${doc.id})">View</button>
            ${editOrDown}
            <button class="btn sm ghost" onclick="deleteDoc(${doc.id})" style="color:var(--danger);">Delete</button>
          </div>
        </div>`;
    };

    let html = '<div style="display:flex;flex-direction:column;gap:10px;">';
    pinned.forEach(d => { html += renderDoc(d); });
    if (pinned.length && unpinned.length) {
      html += `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);padding:4px 2px;margin-top:2px;">Other Documents</div>`;
    }
    unpinned.forEach(d => { html += renderDoc(d); });
    html += '</div>';
    root.innerHTML = html;
  } catch (err) {
    root.innerHTML = '<p style="color:var(--danger);padding:20px;">Error loading documents</p>';
  }
}

// ── New Doc type chooser ──────────────────────────────────────────────────────

function openNewDocModal() {
  const scrim = _docScrim();
  scrim.innerHTML = `
    <div class="modal" style="padding:28px;max-width:400px;width:92%;">
      <h2 style="margin:0 0 6px;font-size:17px;font-weight:700;color:var(--ink);">New Document</h2>
      <p style="margin:0 0 20px;font-size:13px;color:var(--ink-3);">Choose how to create this document.</p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button class="btn primary" style="justify-content:flex-start;gap:10px;padding:12px 16px;text-align:left;" onclick="openRichTextEditor()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          <div><div style="font-weight:600;">Rich Text</div><div style="font-size:12px;opacity:.7;font-weight:400;">GDD, design notes, meeting minutes</div></div>
        </button>
        <button class="btn ghost" style="justify-content:flex-start;gap:10px;padding:12px 16px;text-align:left;" onclick="openHtmlEditor()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          <div><div style="font-weight:600;">HTML Document</div><div style="font-size:12px;opacity:.7;font-weight:400;">Formatted page with custom markup</div></div>
        </button>
        <button class="btn ghost" style="justify-content:flex-start;gap:10px;padding:12px 16px;text-align:left;" onclick="openUploadDoc()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <div><div style="font-weight:600;">Upload PDF or TXT</div><div style="font-size:12px;opacity:.7;font-weight:400;">Attach an existing file (max 10 MB)</div></div>
        </button>
        <button class="btn ghost" style="color:var(--ink-3);" onclick="this.closest('.modal-scrim').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
}

// ── Rich text editor ──────────────────────────────────────────────────────────

function openRichTextEditor(existingDoc = null) {
  document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
  const scrim = _docScrim(s => { _docsQuill = null; s.remove(); });
  scrim.innerHTML = `
    <div class="modal" style="width:min(780px,94vw);max-height:92vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--line);">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--ink);">${existingDoc ? 'Edit Document' : 'Rich Text Document'}</h2>
        <button onclick="this.closest('.modal-scrim').remove()" style="background:none;border:none;cursor:pointer;color:var(--ink-3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="padding:16px 22px;flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);display:block;margin-bottom:6px;">Title *</label>
          <input type="text" id="rt-doc-title" class="kanban-field-input" placeholder="e.g. Game Design Document v1" value="${existingDoc ? _escD(existingDoc.title) : ''}" />
        </div>
        <div style="flex:1;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);display:block;margin-bottom:6px;">Content</label>
          <div id="doc-quill-editor" style="border:1px solid var(--line);border-radius:8px;background:var(--surface-2);min-height:280px;"></div>
        </div>
      </div>
      <div style="padding:12px 22px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn ghost sm" onclick="this.closest('.modal-scrim').remove()">Cancel</button>
        <button class="btn primary sm" onclick="saveRichTextDoc(${existingDoc ? existingDoc.id : 'null'})">Save Document</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);

  if (typeof Quill !== 'undefined') {
    _docsQuill = new Quill('#doc-quill-editor', {
      theme:   'snow',
      modules: {
        toolbar: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'code-block'],
          [{ color: [] }, { background: [] }],
          ['link'], ['clean'],
        ],
      },
    });
    if (existingDoc?.content) _docsQuill.root.innerHTML = existingDoc.content;
  }
}

async function saveRichTextDoc(existingDocId) {
  const titleEl = document.getElementById('rt-doc-title');
  const title   = titleEl?.value.trim();
  if (!title) { titleEl.style.borderColor = 'var(--danger)'; return; }
  const content = _docsQuill ? _docsQuill.root.innerHTML : '';
  try {
    const res = existingDocId
      ? await fetch(`/developer/docs/${existingDocId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })
      : await fetch(`/developer/projects/${_docsProjId}/docs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, doc_type: 'rich_text', content }),
        });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to save'); return; }
    _docsQuill = null;
    document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
    loadDocs();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── HTML editor ───────────────────────────────────────────────────────────────

function openHtmlEditor(existingDoc = null) {
  document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
  const scrim = _docScrim();
  scrim.innerHTML = `
    <div class="modal" style="width:min(780px,94vw);max-height:92vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--line);">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--ink);">${existingDoc ? 'Edit HTML Doc' : 'HTML Document'}</h2>
        <button onclick="this.closest('.modal-scrim').remove()" style="background:none;border:none;cursor:pointer;color:var(--ink-3);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style="padding:16px 22px;flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);display:block;margin-bottom:6px;">Title *</label>
          <input type="text" id="html-doc-title" class="kanban-field-input" placeholder="Document title" value="${existingDoc ? _escD(existingDoc.title) : ''}" />
        </div>
        <div style="flex:1;">
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);display:block;margin-bottom:6px;">HTML Content</label>
          <textarea id="html-doc-content" class="kanban-field-input" style="resize:vertical;min-height:280px;font-family:monospace;font-size:13px;line-height:1.6;" placeholder="<h1>Title</h1>&#10;<p>Content…</p>">${existingDoc ? _escD(existingDoc.content || '') : ''}</textarea>
        </div>
      </div>
      <div style="padding:12px 22px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn ghost sm" onclick="this.closest('.modal-scrim').remove()">Cancel</button>
        <button class="btn primary sm" onclick="saveHtmlDoc(${existingDoc ? existingDoc.id : 'null'})">Save Document</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
}

async function saveHtmlDoc(existingDocId) {
  const titleEl = document.getElementById('html-doc-title');
  const title   = titleEl?.value.trim();
  if (!title) { titleEl.style.borderColor = 'var(--danger)'; return; }
  const content = document.getElementById('html-doc-content')?.value || '';
  try {
    const res = existingDocId
      ? await fetch(`/developer/docs/${existingDocId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })
      : await fetch(`/developer/projects/${_docsProjId}/docs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, doc_type: 'html', content }),
        });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to save'); return; }
    document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
    loadDocs();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── File upload ───────────────────────────────────────────────────────────────

function openUploadDoc() {
  document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
  const scrim = _docScrim();
  scrim.innerHTML = `
    <div class="modal" style="max-width:440px;width:92%;padding:0;overflow:hidden;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--line);">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--ink);">Upload Document</h2>
      </div>
      <div style="padding:18px 22px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);display:block;margin-bottom:6px;">Title <span style="font-weight:400;text-transform:none;color:var(--ink-3);">(optional — defaults to filename)</span></label>
          <input type="text" id="upload-doc-title" class="kanban-field-input" placeholder="e.g. Art Bible v2" />
        </div>
        <div>
          <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-4);display:block;margin-bottom:6px;">File <span style="font-weight:400;text-transform:none;color:var(--ink-3);">PDF or TXT · max 10 MB</span></label>
          <input type="file" id="upload-doc-file" accept=".pdf,.txt,application/pdf,text/plain"
            style="display:block;width:100%;font-size:13px;color:var(--ink-2);background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px;cursor:pointer;box-sizing:border-box;" />
        </div>
        <div id="upload-doc-error" style="display:none;color:var(--danger);font-size:12px;"></div>
      </div>
      <div style="padding:12px 22px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn ghost sm" onclick="this.closest('.modal-scrim').remove()">Cancel</button>
        <button class="btn primary sm" onclick="submitUploadDoc()" id="upload-doc-btn">Upload</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
}

async function submitUploadDoc() {
  const file   = document.getElementById('upload-doc-file')?.files[0];
  const errEl  = document.getElementById('upload-doc-error');
  const btn    = document.getElementById('upload-doc-btn');
  if (!file) { errEl.textContent = 'Please select a file'; errEl.style.display = 'block'; return; }

  const formData = new FormData();
  formData.append('doc', file);
  const title = document.getElementById('upload-doc-title')?.value.trim();
  if (title) formData.append('title', title);

  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const res = await fetch(`/developer/projects/${_docsProjId}/docs/upload`, { method: 'POST', body: formData });
    if (!res.ok) { const e = await res.json(); errEl.textContent = e.error || 'Upload failed'; errEl.style.display = 'block'; return; }
    document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
    loadDocs();
  } catch (e) {
    errEl.textContent = 'Upload failed: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Upload'; }
  }
}

// ── View doc ──────────────────────────────────────────────────────────────────

async function viewDoc(docId) {
  try {
    const res  = await fetch(`/developer/docs/${docId}`);
    const data = await res.json();
    const doc  = data.doc;
    if (!doc) return;

    let body;
    if (doc.doc_type === 'upload') {
      body = `
        <div style="text-align:center;padding:40px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="1.5" style="display:block;margin:0 auto 14px;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <p style="color:var(--ink-2);font-size:14px;margin-bottom:18px;">${_escD(doc.file_name || 'document')}</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <a class="btn primary" href="${_escD(doc.file_url)}" target="_blank">Open File</a>
            <a class="btn ghost" href="${_escD(doc.file_url)}" download="${_escD(doc.file_name || 'download')}">Download</a>
          </div>
        </div>`;
    } else if (doc.doc_type === 'html') {
      body = `<div style="font-size:14px;color:var(--ink-2);line-height:1.7;">${doc.content || ''}</div>`;
    } else {
      body = `<div class="ql-editor" style="padding:0;font-size:14px;color:var(--ink-2);line-height:1.7;">${doc.content || ''}</div>`;
    }

    const scrim = _docScrim();
    scrim.innerHTML = `
      <div class="modal" style="width:min(760px,94vw);max-height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--line);flex-shrink:0;">
          <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escD(doc.title)}</h2>
          <button onclick="this.closest('.modal-scrim').remove()" style="background:none;border:none;cursor:pointer;color:var(--ink-3);flex-shrink:0;margin-left:12px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:22px;">${body}</div>
      </div>`;
    document.body.appendChild(scrim);
  } catch (e) {
    alert('Failed to load document');
  }
}

// ── Edit doc ──────────────────────────────────────────────────────────────────

async function editDoc(docId, docType) {
  try {
    const res  = await fetch(`/developer/docs/${docId}`);
    const data = await res.json();
    const doc  = data.doc;
    if (!doc) return;
    if (docType === 'html' || doc.doc_type === 'html') {
      openHtmlEditor(doc);
    } else {
      openRichTextEditor(doc);
    }
  } catch (e) {
    alert('Failed to load document for editing');
  }
}

// ── Pin / delete ──────────────────────────────────────────────────────────────

async function toggleDocPin(docId) {
  try {
    const res = await fetch(`/developer/docs/${docId}/pin`, { method: 'PUT' });
    if (res.ok) loadDocs();
    else { const e = await res.json(); alert(e.error || 'Failed to update pin'); }
  } catch (e) { console.error(e); }
}

async function deleteDoc(docId) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  try {
    const res = await fetch(`/developer/docs/${docId}`, { method: 'DELETE' });
    if (res.ok) loadDocs();
    else { const e = await res.json(); alert(e.error || 'Failed to delete'); }
  } catch (e) { console.error(e); }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function _docScrim(onBgClick) {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.addEventListener('click', e => {
    if (e.target === scrim) {
      if (onBgClick) onBgClick(scrim); else scrim.remove();
    }
  });
  return scrim;
}
