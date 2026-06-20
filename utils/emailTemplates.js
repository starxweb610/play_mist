const APP_NAME = () => process.env.APP_NAME || 'PlayMist';
const BASE_URL = () => process.env.BASE_URL || 'https://playmist.com';

// ── Shared wrapper ────────────────────────────────────────────────────────────

function wrap(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${APP_NAME()}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#0d0d14;font-family:'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0d0d14;">
    <tr>
      <td align="center" style="padding:32px 16px 48px;">

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#16161f;border-radius:16px;border:1px solid rgba(255,255,255,.08);overflow:hidden;">

          <!-- Header stripe -->
          <tr>
            <td style="background:linear-gradient(135deg,#B5FF6B 0%,#7EE64A 100%);padding:0;height:4px;line-height:4px;font-size:0;">&nbsp;</td>
          </tr>

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:32px 40px 0;">
              <a href="${BASE_URL()}" style="text-decoration:none;display:inline-block;">
                <img src="${BASE_URL()}/images/play_logo.png" alt="${APP_NAME()}" width="120" style="display:block;max-width:120px;height:auto;" />
              </a>
              <p style="margin:6px 0 0;font-size:12px;color:#6b7280;letter-spacing:.5px;text-transform:uppercase;">Developer Portal</p>
            </td>
          </tr>

          <!-- Body -->
          ${content}

          <!-- Footer -->
          <tr>
            <td style="padding:0 40px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr><td style="border-top:1px solid rgba(255,255,255,.06);padding-top:24px;"></td></tr>
              </table>
              <p style="margin:0;font-size:12px;color:#4b5563;text-align:center;line-height:1.6;">
                This email was sent by <strong style="color:#6b7280">${APP_NAME()} Developer Portal</strong>.<br/>
                If you did not request this, you can safely ignore it.<br/>
                <a href="${BASE_URL()}" style="color:#B5FF6B;text-decoration:none;">${BASE_URL()}</a>
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status) {
  const map = {
    under_review: { label: 'Under Review', bg: '#1e3a5f', color: '#60a5fa' },
    approved:     { label: 'Approved',     bg: '#14421f', color: '#4ade80' },
    rejected:     { label: 'Rejected',     bg: '#4a1020', color: '#f87171' },
    pending:      { label: 'Pending',      bg: '#2d2a1a', color: '#fbbf24' },
  };
  const s = map[status] || { label: status, bg: '#1f2937', color: '#9ca3af' };
  return `<span style="display:inline-block;background:${s.bg};color:${s.color};font-size:12px;font-weight:600;padding:4px 12px;border-radius:20px;letter-spacing:.5px;">${s.label}</span>`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

exports.verificationCode = ({ name, code }) => wrap(`
  <tr>
    <td style="padding:32px 40px 16px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">Verify your email</h1>
      <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.6;">Hi <strong style="color:#e5e7eb">${name}</strong>, welcome to ${APP_NAME()} Developers! Use the code below to verify your email and activate your account.</p>
    </td>
  </tr>

  <!-- Code block -->
  <tr>
    <td align="center" style="padding:24px 40px;">
      <table cellpadding="0" cellspacing="0" role="presentation" style="background:#1e1e2e;border:1px solid rgba(181,255,107,.3);border-radius:12px;width:100%;max-width:320px;">
        <tr>
          <td align="center" style="padding:28px 24px;">
            <p style="margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Verification Code</p>
            <p style="margin:0;font-size:48px;font-weight:800;letter-spacing:12px;color:#B5FF6B;font-family:'Courier New',monospace;">${code}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:0 40px 32px;">
      <p style="margin:0 0 12px;font-size:14px;color:#6b7280;line-height:1.6;">
        This code expires in <strong style="color:#9ca3af">15 minutes</strong>. Do not share this code with anyone.
      </p>
      <p style="margin:0;font-size:13px;color:#4b5563;">
        If you did not create an account on ${APP_NAME()} Developers, please ignore this email.
      </p>
    </td>
  </tr>
`);

exports.submissionStatusChanged = ({ name, gameTitle, status, rejectionReason, dashboardUrl }) => {
  const messages = {
    under_review: {
      headline: 'Your game is under review',
      body: `Your submission <strong style="color:#e5e7eb">${gameTitle}</strong> is now being reviewed by our team. We'll notify you once a decision has been made.`,
    },
    approved: {
      headline: 'Your game has been approved! 🎉',
      body: `Great news! <strong style="color:#e5e7eb">${gameTitle}</strong> has been approved and is now live on ${APP_NAME()}. Our team may still add thumbnails before publishing it publicly — stay tuned!`,
    },
    rejected: {
      headline: 'Your game submission was not approved',
      body: `After reviewing <strong style="color:#e5e7eb">${gameTitle}</strong>, our team has decided not to approve this submission at this time.`,
    },
  };

  const msg = messages[status] || { headline: `Submission status updated`, body: `Your submission <strong style="color:#e5e7eb">${gameTitle}</strong> has been updated.` };

  const reasonBlock = (status === 'rejected' && rejectionReason)
    ? `<tr><td style="padding:0 40px 24px;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="background:#1e1414;border:1px solid rgba(248,113,113,.15);border-radius:8px;width:100%;">
          <tr><td style="padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:12px;color:#f87171;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Reason</p>
            <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;">${rejectionReason}</p>
          </td></tr>
        </table>
       </td></tr>`
    : '';

  return wrap(`
    <tr>
      <td style="padding:32px 40px 16px;">
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">${msg.headline}</h1>
        <p style="margin:0 0 16px;font-size:15px;color:#9ca3af;line-height:1.6;">Hi <strong style="color:#e5e7eb">${name}</strong>, ${msg.body}</p>
        ${statusBadge(status)}
      </td>
    </tr>

    <tr>
      <td style="padding:8px 40px 16px;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="background:#1c1c28;border-radius:8px;width:100%;">
          <tr>
            <td style="padding:16px 20px;">
              <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Game</p>
              <p style="margin:0;font-size:16px;font-weight:600;color:#e5e7eb;">${gameTitle}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${reasonBlock}

    <tr>
      <td align="center" style="padding:8px 40px 32px;">
        <a href="${dashboardUrl || (BASE_URL() + '/developer/dashboard')}" style="display:inline-block;background:#B5FF6B;color:#1a1d24;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">View Dashboard</a>
      </td>
    </tr>
  `);
};

exports.noteApproved = ({ name, noteTitle }) => wrap(`
  <tr>
    <td style="padding:32px 40px 16px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">Your note is now live! 🎉</h1>
      <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.6;">Hi <strong style="color:#e5e7eb">${name}</strong>, your note has been reviewed and approved. It is now visible to the entire ${APP_NAME()} developer community.</p>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 40px 24px;">
      <table cellpadding="0" cellspacing="0" role="presentation" style="background:#1c1c28;border-left:3px solid #B5FF6B;border-radius:0 8px 8px 0;width:100%;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Note</p>
            <p style="margin:0;font-size:16px;font-weight:600;color:#e5e7eb;">${noteTitle}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td align="center" style="padding:0 40px 32px;">
      <a href="${BASE_URL()}/developer/knowledge" style="display:inline-block;background:#B5FF6B;color:#1a1d24;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">View Knowledge Sphere</a>
    </td>
  </tr>
`);

exports.passwordChanged = ({ name }) => wrap(`
  <tr>
    <td style="padding:32px 40px 16px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">Your password was changed</h1>
      <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.6;">Hi <strong style="color:#e5e7eb">${name}</strong>, your ${APP_NAME()} developer account password was successfully updated.</p>
    </td>
  </tr>

  <tr>
    <td style="padding:8px 40px 24px;">
      <table cellpadding="0" cellspacing="0" role="presentation" style="background:#1e1414;border:1px solid rgba(248,113,113,.15);border-radius:8px;width:100%;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:13px;color:#f87171;font-weight:600;">If you didn't make this change</p>
            <p style="margin:0;font-size:13px;color:#d1d5db;line-height:1.6;">Your account may be compromised. Please contact our support team immediately and secure your account.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td align="center" style="padding:0 40px 32px;">
      <a href="${BASE_URL()}/developer/profile" style="display:inline-block;background:#B5FF6B;color:#1a1d24;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">Go to My Profile</a>
    </td>
  </tr>
`);

exports.noteRejected = ({ name, noteTitle, reason }) => wrap(`
  <tr>
    <td style="padding:32px 40px 16px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f9fafb;">Note sharing request declined</h1>
      <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.6;">Hi <strong style="color:#e5e7eb">${name}</strong>, after review, your note was not approved for the community Knowledge Sphere at this time. You can edit your note and submit it again.</p>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 40px 8px;">
      <table cellpadding="0" cellspacing="0" role="presentation" style="background:#1c1c28;border-left:3px solid #f87171;border-radius:0 8px 8px 0;width:100%;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">Note</p>
            <p style="margin:0;font-size:16px;font-weight:600;color:#e5e7eb;">${noteTitle}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  ${reason ? `<tr>
    <td style="padding:12px 40px 24px;">
      <table cellpadding="0" cellspacing="0" role="presentation" style="background:#1e1414;border:1px solid rgba(248,113,113,.15);border-radius:8px;width:100%;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:12px;color:#f87171;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Reason</p>
          <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;">${reason}</p>
        </td></tr>
      </table>
    </td>
  </tr>` : '<tr><td style="padding:0 40px 24px;"></td></tr>'}

  <tr>
    <td align="center" style="padding:0 40px 32px;">
      <a href="${BASE_URL()}/developer/knowledge" style="display:inline-block;background:#B5FF6B;color:#1a1d24;text-decoration:none;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;">Edit Your Note</a>
    </td>
  </tr>
`);
