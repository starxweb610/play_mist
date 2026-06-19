/* developer-kanban.js — Kanban board for PlayMist developer projects */

let devKanbanTasks  = [];
let devKanbanProjId = null;
let _devCommentQuill = null;

const KANBAN_STATUSES = ['todo', 'in_progress', 'in_review', 'done'];
const KANBAN_LABELS   = { todo: 'To Do', in_progress: 'In Progress', in_review: 'Testing', done: 'Done' };
const PRI_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280' };
const GAME_LABELS = ['Art', 'Code', 'Design', 'Audio', 'Marketing', 'Bug', 'UI', 'Level', 'Story', 'Feature'];

function _esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function _fmt(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function _ago(dateStr) {
  const ms   = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return _fmt(dateStr);
}

// ── Entry point called by tab activation ──────────────────────────────────────

function initKanban() {
  const root = document.getElementById('kanban-root');
  devKanbanProjId = root?.dataset.projectId;
  if (!devKanbanProjId) return;
  loadKanban();
}

async function loadKanban() {
  const root = document.getElementById('kanban-root');
  if (!root) return;
  root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-3);">Loading tasks…</div>';
  try {
    const res  = await fetch(`/developer/projects/${devKanbanProjId}/tasks`);
    const data = await res.json();
    devKanbanTasks = data.tasks || [];
    renderKanban();
  } catch (err) {
    root.innerHTML = `<p style="color:var(--danger);padding:20px;">Error loading tasks: ${_esc(err.message)}</p>`;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderKanban() {
  const root = document.getElementById('kanban-root');
  if (!root) return;

  const total = devKanbanTasks.length;
  const done  = devKanbanTasks.filter(t => t.status === 'done').length;

  const toolbar = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap;">
      <button type="button" class="btn primary sm" onclick="openAddTaskModal()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Task
      </button>
      <span style="font-size:12px;color:var(--ink-3);">${total} task${total !== 1 ? 's' : ''} · ${done} done · double-click card to open</span>
    </div>`;

  let html = '<div class="dev-kanban-board">';
  KANBAN_STATUSES.forEach(status => {
    const col = devKanbanTasks.filter(t => t.status === status);
    html += `
      <div class="dev-kanban-col">
        <div class="dev-kanban-col-hd">
          <span class="dev-kanban-col-name">${KANBAN_LABELS[status]}</span>
          <span class="dev-kanban-col-count">${col.length}</span>
        </div>
        <div class="dev-kanban-items" data-status="${status}">
          ${col.map(t => renderCard(t)).join('')}
        </div>
      </div>`;
  });
  html += '</div>';

  root.innerHTML = toolbar + html;
  setupDragDrop();
}

function renderCard(t) {
  const priColor = PRI_COLORS[t.priority] || 'var(--ink-3)';
  const due      = t.due_date ? new Date(t.due_date) : null;
  const overdue  = due && due < new Date();
  const labels   = t.labels ? t.labels.split(',').filter(Boolean) : [];
  return `
    <div class="dev-kanban-card" data-task-id="${t.id}" ondblclick="openTaskModal(${t.id})" title="Double-click to open">
      <div class="dev-kanban-card-title">${_esc(t.title)}</div>
      ${t.description ? `<div class="dev-kanban-card-desc">${_esc(t.description)}</div>` : ''}
      <div class="dev-kanban-card-meta">
        ${t.priority ? `<span class="dev-kanban-badge" style="background:${priColor}22;color:${priColor};">${t.priority}</span>` : ''}
        ${labels.map(l => `<span class="dev-kanban-badge" style="background:var(--accent-soft);color:var(--accent);">${_esc(l)}</span>`).join('')}
        ${due ? `<span class="dev-kanban-badge" style="background:${overdue ? 'var(--danger-soft)' : 'var(--surface-3)'};color:${overdue ? 'var(--danger)' : 'var(--ink-3)'};">${_fmt(t.due_date)}</span>` : ''}
      </div>
    </div>`;
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

function setupDragDrop() {
  if (typeof Sortable === 'undefined') return;
  document.querySelectorAll('.dev-kanban-items').forEach(el => {
    if (el._sortable) el._sortable.destroy();
    el._sortable = Sortable.create(el, {
      group:      'devkanban',
      animation:  150,
      ghostClass: 'dev-kanban-ghost',
      onEnd(evt) {
        const taskId   = evt.item.dataset.taskId;
        const newStatus = evt.to.dataset.status;
        if (!taskId || !newStatus) return;
        const task = devKanbanTasks.find(t => t.id == taskId);
        if (task) task.status = newStatus;
        // Update column counts immediately
        document.querySelectorAll('.dev-kanban-col').forEach(col => {
          const items = col.querySelector('.dev-kanban-items');
          const count = col.querySelector('.dev-kanban-col-count');
          if (items && count) count.textContent = items.children.length;
        });
        fetch(`/developer/projects/${devKanbanProjId}/tasks/${taskId}/move`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status: newStatus }),
        }).catch(() => loadKanban());
      },
    });
  });
}

// ── Add Task Modal ────────────────────────────────────────────────────────────

function openAddTaskModal() {
  const scrim = _makeScrim();
  scrim.innerHTML = `
    <div class="modal" style="max-width:520px;width:94%;padding:0;overflow:hidden;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--line);">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--ink);">New Task</h2>
      </div>
      <div style="padding:18px 22px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <label class="kanban-field-label">Title *</label>
          <input type="text" id="add-task-title" class="kanban-field-input" placeholder="What needs to be done?" autofocus />
        </div>
        <div>
          <label class="kanban-field-label">Description</label>
          <textarea id="add-task-desc" class="kanban-field-input" rows="3" style="resize:vertical;" placeholder="More details…"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label class="kanban-field-label">Priority</label>
            <select id="add-task-priority" class="kanban-field-input">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label class="kanban-field-label">Due Date</label>
            <input type="date" id="add-task-due" class="kanban-field-input" style="color-scheme:dark;" />
          </div>
        </div>
        <div>
          <label class="kanban-field-label">Labels</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;">
            ${GAME_LABELS.map(l => `
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;">
                <input type="checkbox" class="add-label-cb" value="${l}" style="accent-color:var(--accent);">
                <span style="font-size:12px;color:var(--ink-2);">${l}</span>
              </label>`).join('')}
          </div>
        </div>
      </div>
      <div style="padding:12px 22px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn ghost sm" onclick="this.closest('.modal-scrim').remove()">Cancel</button>
        <button class="btn primary sm" onclick="submitAddTask()">Create Task</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
}

async function submitAddTask() {
  const titleEl = document.getElementById('add-task-title');
  const title   = titleEl?.value.trim();
  if (!title) { titleEl.style.borderColor = 'var(--danger)'; return; }

  const description = document.getElementById('add-task-desc')?.value.trim() || null;
  const priority    = document.getElementById('add-task-priority')?.value || 'medium';
  const due_date    = document.getElementById('add-task-due')?.value || null;
  const labels      = [...document.querySelectorAll('.add-label-cb:checked')].map(c => c.value).join(',') || null;

  try {
    const res  = await fetch(`/developer/projects/${devKanbanProjId}/tasks`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, description, priority, due_date, labels }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to create task'); return; }
    document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
    devKanbanTasks.push(data.task);
    renderKanban();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── Task Detail Modal ─────────────────────────────────────────────────────────

function openTaskModal(taskId) {
  const task = devKanbanTasks.find(t => t.id == taskId);
  if (!task) return;

  const existing = document.getElementById('dev-task-modal');
  if (existing) { _devCommentQuill = null; existing.remove(); }

  const priColor = PRI_COLORS[task.priority] || 'var(--ink-3)';
  const labels   = task.labels ? task.labels.split(',').filter(Boolean) : [];
  const due      = task.due_date ? _fmt(task.due_date) : '—';
  const statColor = { done: 'var(--ok)', in_progress: 'var(--info)', in_review: 'var(--warn)', todo: 'var(--ink-3)' };

  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.id = 'dev-task-modal';
  scrim.innerHTML = `
    <div class="modal" style="max-width:660px;width:94%;height:min(88vh,760px);display:flex;flex-direction:column;padding:0;overflow:hidden;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--line);flex-shrink:0;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
          <h2 style="margin:0;font-size:17px;font-weight:700;color:var(--ink);line-height:1.4;flex:1;min-width:0;">${_esc(task.title)}</h2>
          <div style="display:flex;gap:8px;flex-shrink:0;">
            <button class="btn sm ghost" onclick="this.closest('.modal-scrim').remove();openEditTaskModal(${task.id})">Edit</button>
            <button onclick="this.closest('.modal-scrim').remove()" style="background:none;border:none;cursor:pointer;color:var(--ink-3);padding:4px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div style="flex:1;min-height:0;overflow-y:auto;padding:20px 22px;">
        <div style="display:flex;flex-wrap:wrap;gap:20px;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--line);">
          <div>
            <div class="task-meta-label">Status</div>
            <div style="font-size:13px;color:${statColor[task.status] || 'var(--ink)'};font-weight:600;text-transform:capitalize;">${(task.status || '').replace(/_/g, ' ')}</div>
          </div>
          <div>
            <div class="task-meta-label">Priority</div>
            <div style="font-size:13px;color:${priColor};font-weight:600;text-transform:capitalize;">${task.priority || '—'}</div>
          </div>
          <div>
            <div class="task-meta-label">Due Date</div>
            <div style="font-size:13px;color:var(--ink);font-weight:500;">${due}</div>
          </div>
        </div>

        ${labels.length ? `
          <div style="margin-bottom:16px;">
            <div class="task-meta-label" style="margin-bottom:6px;">Labels</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;">
              ${labels.map(l => `<span style="background:var(--accent-soft);color:var(--accent);padding:2px 9px;border-radius:4px;font-size:12px;font-weight:600;">${_esc(l)}</span>`).join('')}
            </div>
          </div>` : ''}

        ${task.description ? `
          <div style="margin-bottom:18px;">
            <div class="task-meta-label" style="margin-bottom:6px;">Description</div>
            <div style="font-size:13px;color:var(--ink-2);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:12px 14px;line-height:1.65;white-space:pre-wrap;">${_esc(task.description)}</div>
          </div>` : ''}

        <div>
          <div class="task-meta-label" style="margin-bottom:10px;">
            Comments <span id="task-comment-count" style="font-weight:400;color:var(--ink-3);text-transform:none;letter-spacing:0;"></span>
          </div>
          <div id="task-comments-list" style="display:flex;flex-direction:column;gap:14px;margin-bottom:4px;">
            <div style="color:var(--ink-4);font-size:13px;">Loading…</div>
          </div>
        </div>
      </div>

      <div style="border-top:1px solid var(--line);padding:14px 22px;flex-shrink:0;background:var(--bg);">
        <div id="task-comment-editor" style="border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface);margin-bottom:10px;min-height:70px;"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <button class="btn ghost sm" style="color:var(--danger);" onclick="deleteTask(${task.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            Delete Task
          </button>
          <button class="btn primary sm" onclick="postTaskComment(${task.id})">Post Comment</button>
        </div>
      </div>
    </div>`;

  scrim.addEventListener('click', e => { if (e.target === scrim) { _devCommentQuill = null; scrim.remove(); } });
  document.body.appendChild(scrim);

  if (typeof Quill !== 'undefined') {
    _devCommentQuill = new Quill('#task-comment-editor', {
      theme:   'snow',
      placeholder: 'Write a comment…',
      modules: {
        toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['clean']],
      },
    });
  }

  loadTaskComments(task.id);
}

async function loadTaskComments(taskId) {
  const list    = document.getElementById('task-comments-list');
  const countEl = document.getElementById('task-comment-count');
  if (!list) return;
  try {
    const res  = await fetch(`/developer/projects/${devKanbanProjId}/tasks/${taskId}/comments`);
    const data = await res.json();
    const comments = data.comments || [];
    if (countEl) countEl.textContent = comments.length ? `(${comments.length})` : '';
    if (!comments.length) {
      list.innerHTML = '<div style="color:var(--ink-4);font-size:13px;">No comments yet.</div>';
      return;
    }
    list.innerHTML = comments.map(c => {
      const initial = (c.developer_name || '?').charAt(0).toUpperCase();
      const avatar  = c.avatar_url
        ? `<img src="${_esc(c.avatar_url)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
        : `<div style="width:30px;height:30px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">${initial}</div>`;
      return `
        <div style="display:flex;gap:10px;align-items:flex-start;">
          ${avatar}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
              <span style="font-size:13px;font-weight:600;color:var(--ink);">${_esc(c.developer_name)}</span>
              <span style="font-size:11px;color:var(--ink-4);">${_ago(c.created_at)}</span>
              <button onclick="deleteTaskComment(${taskId},${c.id})" title="Delete" style="background:none;border:none;cursor:pointer;color:var(--ink-4);padding:0;margin-left:auto;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
            <div style="font-size:13px;color:var(--ink-2);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px;line-height:1.6;">${c.content}</div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    if (list) list.innerHTML = '<div style="color:var(--danger);font-size:13px;">Failed to load comments.</div>';
  }
}

async function postTaskComment(taskId) {
  if (!_devCommentQuill) return;
  if (!_devCommentQuill.getText().trim()) { alert('Write a comment first'); return; }
  const content = _devCommentQuill.root.innerHTML.trim();
  try {
    const res = await fetch(`/developer/projects/${devKanbanProjId}/tasks/${taskId}/comments`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    if (res.ok) {
      _devCommentQuill.setContents([]);
      loadTaskComments(taskId);
    } else {
      const err = await res.json();
      alert('Error: ' + (err.error || 'Failed to post'));
    }
  } catch (e) { alert('Error: ' + e.message); }
}

async function deleteTaskComment(taskId, commentId) {
  if (!confirm('Delete this comment?')) return;
  try {
    const res = await fetch(`/developer/projects/${devKanbanProjId}/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' });
    if (res.ok) loadTaskComments(taskId);
  } catch (e) { console.error(e); }
}

async function deleteTask(taskId) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  try {
    const res = await fetch(`/developer/projects/${devKanbanProjId}/tasks/${taskId}`, { method: 'DELETE' });
    if (res.ok) {
      devKanbanTasks = devKanbanTasks.filter(t => t.id != taskId);
      document.getElementById('dev-task-modal')?.remove();
      renderKanban();
    }
  } catch (e) { console.error(e); }
}

// ── Edit Task Modal ───────────────────────────────────────────────────────────

function openEditTaskModal(taskId) {
  const task = devKanbanTasks.find(t => t.id == taskId);
  if (!task) return;
  const taskLabels = task.labels ? task.labels.split(',').filter(Boolean) : [];
  const dueVal = task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : '';

  const scrim = _makeScrim();
  scrim.innerHTML = `
    <div class="modal" style="max-width:520px;width:94%;padding:0;overflow:hidden;">
      <div style="padding:18px 22px;border-bottom:1px solid var(--line);">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:var(--ink);">Edit Task</h2>
      </div>
      <div style="padding:18px 22px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <label class="kanban-field-label">Title *</label>
          <input type="text" id="edit-task-title" class="kanban-field-input" value="${_esc(task.title)}" />
        </div>
        <div>
          <label class="kanban-field-label">Description</label>
          <textarea id="edit-task-desc" class="kanban-field-input" rows="3" style="resize:vertical;">${_esc(task.description || '')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <div>
            <label class="kanban-field-label">Status</label>
            <select id="edit-task-status" class="kanban-field-input">
              <option value="todo"        ${task.status === 'todo'        ? 'selected' : ''}>To Do</option>
              <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
              <option value="in_review"   ${task.status === 'in_review'   ? 'selected' : ''}>In Review</option>
              <option value="done"        ${task.status === 'done'        ? 'selected' : ''}>Done</option>
            </select>
          </div>
          <div>
            <label class="kanban-field-label">Priority</label>
            <select id="edit-task-priority" class="kanban-field-input">
              <option value="low"      ${task.priority === 'low'      ? 'selected' : ''}>Low</option>
              <option value="medium"   ${task.priority === 'medium'   ? 'selected' : ''}>Medium</option>
              <option value="high"     ${task.priority === 'high'     ? 'selected' : ''}>High</option>
              <option value="critical" ${task.priority === 'critical' ? 'selected' : ''}>Critical</option>
            </select>
          </div>
          <div>
            <label class="kanban-field-label">Due Date</label>
            <input type="date" id="edit-task-due" class="kanban-field-input" style="color-scheme:dark;" value="${dueVal}" />
          </div>
        </div>
        <div>
          <label class="kanban-field-label">Labels</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;">
            ${GAME_LABELS.map(l => `
              <label style="display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;">
                <input type="checkbox" class="edit-label-cb" value="${l}" ${taskLabels.includes(l) ? 'checked' : ''} style="accent-color:var(--accent);">
                <span style="font-size:12px;color:var(--ink-2);">${l}</span>
              </label>`).join('')}
          </div>
        </div>
      </div>
      <div style="padding:12px 22px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn ghost sm" onclick="this.closest('.modal-scrim').remove()">Cancel</button>
        <button class="btn primary sm" onclick="submitEditTask(${task.id})">Save Changes</button>
      </div>
    </div>`;
  document.body.appendChild(scrim);
}

async function submitEditTask(taskId) {
  const titleEl = document.getElementById('edit-task-title');
  const title   = titleEl?.value.trim();
  if (!title) { titleEl.style.borderColor = 'var(--danger)'; return; }

  const description = document.getElementById('edit-task-desc')?.value.trim() || null;
  const status      = document.getElementById('edit-task-status')?.value;
  const priority    = document.getElementById('edit-task-priority')?.value;
  const due_date    = document.getElementById('edit-task-due')?.value || null;
  const labels      = [...document.querySelectorAll('.edit-label-cb:checked')].map(c => c.value).join(',') || null;

  try {
    const res  = await fetch(`/developer/projects/${devKanbanProjId}/tasks/${taskId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, description, status, priority, due_date, labels }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Failed to update task'); return; }
    const idx = devKanbanTasks.findIndex(t => t.id == taskId);
    if (idx !== -1) devKanbanTasks[idx] = data.task;
    document.querySelector('.modal-scrim:not(#edit-project-modal)')?.remove();
    renderKanban();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function _makeScrim() {
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.addEventListener('click', e => { if (e.target === scrim) scrim.remove(); });
  return scrim;
}
