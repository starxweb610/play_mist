const db = require('../../config/database');

exports.getIndex = async (req, res) => {
  const { status, priority } = req.query;
  let sql = `SELECT t.*, u.username AS player
             FROM tickets t LEFT JOIN users u ON t.user_id = u.id WHERE 1=1`;
  const params = [];
  if (status)   { sql += ' AND t.status = ?';   params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  sql += ' ORDER BY FIELD(t.priority,"urgent","high","medium","low"), t.created_at DESC';

  let tickets = [];
  try { [tickets] = await db.query(sql, params); } catch (_) {}

  res.render('sitehandler/tickets/index', {
    title: 'Support Tickets', activePage: 'tickets',
    tickets, filters: { status, priority },
  });
};

exports.getDetail = async (req, res) => {
  try {
    const [[ticket]] = await db.query(
      `SELECT t.*, u.username AS player, u.email AS player_email
       FROM tickets t LEFT JOIN users u ON t.user_id = u.id
       WHERE t.id = ?`, [req.params.id]
    );
    if (!ticket) { req.flash('error_msg', 'Ticket not found.'); return res.redirect('/sitehandler/tickets'); }

    const [replies]  = await db.query(
      `SELECT r.*, a.name AS admin_name FROM ticket_replies r
       LEFT JOIN admins a ON r.admin_id = a.id
       WHERE r.ticket_id = ? ORDER BY r.created_at ASC`, [req.params.id]
    );
    const [admins] = await db.query('SELECT id, name FROM admins WHERE is_active = 1');

    res.render('sitehandler/tickets/detail', {
      title: `Ticket #${ticket.id}`, activePage: 'tickets',
      ticket, replies, admins,
    });
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect('/sitehandler/tickets');
  }
};

exports.postReply = async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  if (!message?.trim()) { req.flash('error_msg', 'Reply cannot be empty.'); return res.redirect(`/sitehandler/tickets/${id}`); }
  try {
    await db.query('INSERT INTO ticket_replies (ticket_id, admin_id, message) VALUES (?, ?, ?)',
      [id, req.session.admin.id, message.trim()]);
    // Auto move to in_progress on first reply
    await db.query("UPDATE tickets SET status = IF(status = 'open', 'in_progress', status) WHERE id = ?", [id]);
    req.flash('success_msg', 'Reply sent.');
    res.redirect(`/sitehandler/tickets/${id}`);
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect(`/sitehandler/tickets/${id}`);
  }
};

exports.postStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await db.query('UPDATE tickets SET status = ? WHERE id = ?', [status, id]);
    req.flash('success_msg', `Status updated to "${status}".`);
    res.redirect(`/sitehandler/tickets/${id}`);
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect(`/sitehandler/tickets/${id}`);
  }
};

exports.postAssign = async (req, res) => {
  const { id } = req.params;
  const { assigned_to } = req.body;
  try {
    await db.query('UPDATE tickets SET assigned_to = ? WHERE id = ?', [assigned_to || null, id]);
    req.flash('success_msg', 'Ticket assigned.');
    res.redirect(`/sitehandler/tickets/${id}`);
  } catch (err) {
    req.flash('error_msg', err.message);
    res.redirect(`/sitehandler/tickets/${id}`);
  }
};
