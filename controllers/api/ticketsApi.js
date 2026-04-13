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
