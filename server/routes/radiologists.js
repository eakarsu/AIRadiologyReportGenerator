const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM radiologists ORDER BY last_name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM radiologists WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Radiologist not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { employee_id, first_name, last_name, specialization, license_number, email, phone, years_experience, board_certified, shift } = req.body;
    const result = await db.query(
      'INSERT INTO radiologists (employee_id, first_name, last_name, specialization, license_number, email, phone, years_experience, board_certified, shift) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [employee_id, first_name, last_name, specialization, license_number, email, phone, years_experience, board_certified || false, shift || 'day']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { employee_id, first_name, last_name, specialization, license_number, email, phone, years_experience, board_certified, status, shift } = req.body;
    const result = await db.query(
      'UPDATE radiologists SET employee_id=$1, first_name=$2, last_name=$3, specialization=$4, license_number=$5, email=$6, phone=$7, years_experience=$8, board_certified=$9, status=$10, shift=$11 WHERE id=$12 RETURNING *',
      [employee_id, first_name, last_name, specialization, license_number, email, phone, years_experience, board_certified, status, shift, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM radiologists WHERE id = $1', [req.params.id]);
    res.json({ message: 'Radiologist deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
