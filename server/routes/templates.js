const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM report_templates ORDER BY usage_count DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM report_templates WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { name, modality, body_part, template_text, sections, category, is_default } = req.body;
    const result = await db.query(
      'INSERT INTO report_templates (name, modality, body_part, template_text, sections, category, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, modality, body_part, template_text, JSON.stringify(sections), category, is_default || false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { name, modality, body_part, template_text, sections, category, is_default, status } = req.body;
    const result = await db.query(
      'UPDATE report_templates SET name=$1, modality=$2, body_part=$3, template_text=$4, sections=$5, category=$6, is_default=$7, status=$8 WHERE id=$9 RETURNING *',
      [name, modality, body_part, template_text, JSON.stringify(sections), category, is_default, status, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM report_templates WHERE id = $1', [req.params.id]);
    res.json({ message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
