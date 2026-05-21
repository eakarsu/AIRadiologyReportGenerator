const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    let where = '';
    let params = [];
    if (search) {
      where = `WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR mrn ILIKE $1 OR email ILIKE $1`;
      params.push(`%${search}%`);
    }

    const countResult = await db.query(`SELECT COUNT(*) FROM patients ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const li = params.length;
    const result = await db.query(
      `SELECT * FROM patients ${where} ORDER BY created_at DESC LIMIT $${li - 1} OFFSET $${li}`,
      params
    );

    const totalPages = Math.ceil(total / limit);
    res.set({ 'X-Total-Count': String(total), 'X-Page': String(page), 'X-Limit': String(limit), 'X-Total-Pages': String(totalPages) });
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { mrn, first_name, last_name, date_of_birth, gender, phone, email, address, insurance_provider, insurance_id, emergency_contact, allergies, medical_history } = req.body;
    const result = await db.query(
      'INSERT INTO patients (mrn, first_name, last_name, date_of_birth, gender, phone, email, address, insurance_provider, insurance_id, emergency_contact, allergies, medical_history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [mrn, first_name, last_name, date_of_birth, gender, phone, email, address, insurance_provider, insurance_id, emergency_contact, allergies, medical_history]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { mrn, first_name, last_name, date_of_birth, gender, phone, email, address, insurance_provider, insurance_id, emergency_contact, allergies, medical_history, status } = req.body;
    const result = await db.query(
      'UPDATE patients SET mrn=$1, first_name=$2, last_name=$3, date_of_birth=$4, gender=$5, phone=$6, email=$7, address=$8, insurance_provider=$9, insurance_id=$10, emergency_contact=$11, allergies=$12, medical_history=$13, status=$14 WHERE id=$15 RETURNING *',
      [mrn, first_name, last_name, date_of_birth, gender, phone, email, address, insurance_provider, insurance_id, emergency_contact, allergies, medical_history, status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM patients WHERE id = $1', [req.params.id]);
    res.json({ message: 'Patient deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
