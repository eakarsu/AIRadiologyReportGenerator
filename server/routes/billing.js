const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM billing_codes ORDER BY cpt_code');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM billing_codes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Billing code not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { cpt_code, description, modality, body_part, base_price, rvu, category, requires_contrast, professional_component, technical_component } = req.body;
    const result = await db.query(
      'INSERT INTO billing_codes (cpt_code, description, modality, body_part, base_price, rvu, category, requires_contrast, professional_component, technical_component) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [cpt_code, description, modality, body_part, base_price, rvu, category, requires_contrast || false, professional_component, technical_component]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { cpt_code, description, modality, body_part, base_price, rvu, category, requires_contrast, professional_component, technical_component, status } = req.body;
    const result = await db.query(
      'UPDATE billing_codes SET cpt_code=$1, description=$2, modality=$3, body_part=$4, base_price=$5, rvu=$6, category=$7, requires_contrast=$8, professional_component=$9, technical_component=$10, status=$11 WHERE id=$12 RETURNING *',
      [cpt_code, description, modality, body_part, base_price, rvu, category, requires_contrast, professional_component, technical_component, status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM billing_codes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Billing code deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
