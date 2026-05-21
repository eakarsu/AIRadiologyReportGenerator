const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const action = req.query.action || '';
    const resource = req.query.resource || '';

    let conditions = [];
    let params = [];
    let idx = 1;

    if (action) { conditions.push(`a.action = $${idx}`); params.push(action); idx++; }
    if (resource) { conditions.push(`a.resource_type = $${idx}`); params.push(resource); idx++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*) FROM audit_logs a ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await db.query(
      `SELECT a.*, u.name as user_name, u.email as user_email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params
    );

    const totalPages = Math.ceil(total / limit);
    res.set({ 'X-Total-Count': String(total), 'X-Page': String(page), 'X-Limit': String(limit), 'X-Total-Pages': String(totalPages) });
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT a.*, u.name as user_name, u.email as user_email
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Audit log not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM audit_logs WHERE id = $1', [req.params.id]);
    res.json({ message: 'Audit log deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
