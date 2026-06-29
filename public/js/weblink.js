/*
 * Web QR pairing for the public site. A guest clicks "Resume on web", we ask the
 * backend for a short-lived link code, render it as a QR, and poll until the
 * PlayMist phone app scans + approves it — then we adopt that account's session.
 * Endpoints are same-origin (/api/v1/auth/web-link/*).
 */
(function () {
  var API = '/api/v1';
  var pollTimer = null;

  function el(id) { return document.getElementById(id); }

  function setLinkedUI(user) {
    var btn = el('resumeWebBtn');
    if (btn && user) {
      btn.textContent = '@' + user.username + ' • ' + (user.credits != null ? user.credits : 0) + ' c';
      btn.classList.add('is-linked');
    }
  }

  // Restore a previously-linked session on page load.
  try {
    var saved = JSON.parse(localStorage.getItem('pm_web_session') || 'null');
    if (saved && saved.user) setLinkedUI(saved.user);
  } catch (e) { /* ignore */ }

  function openModal() {
    var m = el('weblinkModal');
    if (m) m.style.display = 'flex';
    startSession();
  }

  function closeModal() {
    var m = el('weblinkModal');
    if (m) m.style.display = 'none';
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function startSession() {
    var status = el('weblinkStatus');
    var qrBox = el('weblinkQr');
    qrBox.innerHTML = '';
    status.textContent = 'Generating code…';
    try {
      var res = await fetch(API + '/auth/web-link/start', { method: 'POST' });
      var data = await res.json();
      if (window.QRCode && window.QRCode.toCanvas) {
        var canvas = document.createElement('canvas');
        qrBox.appendChild(canvas);
        window.QRCode.toCanvas(canvas, data.qrPayload, { width: 220, margin: 1 }, function () {});
      } else {
        qrBox.textContent = data.qrPayload; // fallback if the QR lib didn't load
      }
      status.textContent = 'Open PlayMist on your phone → "Link a web session" → scan this code.';
      poll(data.code);
    } catch (e) {
      status.textContent = "Couldn't reach the server. Please try again.";
    }
  }

  function poll(code) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async function () {
      try {
        var res = await fetch(API + '/auth/web-link/status?code=' + encodeURIComponent(code));
        var data = await res.json();
        if (data.status === 'approved') {
          clearInterval(pollTimer); pollTimer = null;
          localStorage.setItem('pm_web_session', JSON.stringify({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            user: data.user
          }));
          setLinkedUI(data.user);
          el('weblinkStatus').textContent = 'Linked as @' + data.user.username + '!';
          setTimeout(closeModal, 900);
        } else if (data.status === 'expired' || data.status === 'consumed') {
          clearInterval(pollTimer); pollTimer = null;
          el('weblinkStatus').innerHTML = 'Code expired. <button id="weblinkRetry" class="weblink-retry">New code</button>';
          var r = el('weblinkRetry'); if (r) r.onclick = startSession;
        }
      } catch (e) { /* transient — keep polling until expiry */ }
    }, 2500);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = el('resumeWebBtn');
    if (btn) btn.addEventListener('click', function (e) {
      if (btn.classList.contains('is-linked')) return; // already linked
      e.preventDefault();
      openModal();
    });
    var close = el('weblinkClose'); if (close) close.addEventListener('click', closeModal);
    var scrim = el('weblinkScrim'); if (scrim) scrim.addEventListener('click', closeModal);
  });
})();
