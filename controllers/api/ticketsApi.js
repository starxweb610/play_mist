const db = require('../../config/database');

/**
 * POST /api/tickets
 * Players submit support tickets from within the mobile app.
 * Body: { user_id, subject, message, priority? }
 */
exports.createTicket = async (req, res) => {
  const { user_id = null, subject, message, priority = 'medium' } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ success: false, error: 'subject and message are required' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO tickets (user_id, subject, message, priority) VALUES (?, ?, ?, ?)',
      [user_id, subject, message, priority]
    );
    res.status(201).json({ success: true, ticket_id: result.insertId });
  } catch (err) {
    console.error('tickets/create error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/v1/user/tickets
 * Fetch tickets submitted by the logged-in player along with support replies.
 */
exports.getUserTickets = async (req, res) => {
  try {
    const userId = req.user.id;
    // Query all tickets for this user
    const [tickets] = await db.query(
      `SELECT id, subject, message, status, priority, created_at, updated_at 
       FROM tickets 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );

    // For each ticket, fetch replies
    const ticketIds = tickets.map(t => t.id);
    let repliesMap = {};
    if (ticketIds.length > 0) {
      const [replies] = await db.query(
        `SELECT r.id, r.ticket_id, r.message, r.created_at, a.name AS admin_name 
         FROM ticket_replies r
         LEFT JOIN admins a ON r.admin_id = a.id
         WHERE r.ticket_id IN (?) 
         ORDER BY r.created_at ASC`,
        [ticketIds]
      );
      replies.forEach(reply => {
        if (!repliesMap[reply.ticket_id]) {
          repliesMap[reply.ticket_id] = [];
        }
        repliesMap[reply.ticket_id].push(reply);
      });
    }

    const result = tickets.map(t => ({
      ...t,
      replies: repliesMap[t.id] || []
    }));

    res.json(result);
  } catch (err) {
    console.error('getUserTickets error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
