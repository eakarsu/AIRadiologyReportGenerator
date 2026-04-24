const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM modalities ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM modalities WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Modality not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, code, description, body_parts, avg_duration_minutes, radiation_dose, contrast_required, preparation_instructions, cost_range } = req.body;
    const result = await db.query(
      'INSERT INTO modalities (name, code, description, body_parts, avg_duration_minutes, radiation_dose, contrast_required, preparation_instructions, cost_range) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [name, code, description, body_parts, avg_duration_minutes, radiation_dose, contrast_required || false, preparation_instructions, cost_range]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { name, code, description, body_parts, avg_duration_minutes, radiation_dose, contrast_required, preparation_instructions, cost_range, status } = req.body;
    const result = await db.query(
      'UPDATE modalities SET name=$1, code=$2, description=$3, body_parts=$4, avg_duration_minutes=$5, radiation_dose=$6, contrast_required=$7, preparation_instructions=$8, cost_range=$9, status=$10 WHERE id=$11 RETURNING *',
      [name, code, description, body_parts, avg_duration_minutes, radiation_dose, contrast_required, preparation_instructions, cost_range, status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM modalities WHERE id = $1', [req.params.id]);
    res.json({ message: 'Modality deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
