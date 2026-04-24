const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*, p.first_name || ' ' || p.last_name as patient_name, p.mrn,
             m.name as modality_name, m.code as modality_code,
             r.first_name || ' ' || r.last_name as radiologist_name
      FROM studies s
      LEFT JOIN patients p ON s.patient_id = p.id
      LEFT JOIN modalities m ON s.modality_id = m.id
      LEFT JOIN radiologists r ON s.radiologist_id = r.id
      ORDER BY s.study_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT s.*, p.first_name || ' ' || p.last_name as patient_name, p.mrn,
             m.name as modality_name, m.code as modality_code,
             r.first_name || ' ' || r.last_name as radiologist_name
      FROM studies s
      LEFT JOIN patients p ON s.patient_id = p.id
      LEFT JOIN modalities m ON s.modality_id = m.id
      LEFT JOIN radiologists r ON s.radiologist_id = r.id
      WHERE s.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Study not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes } = req.body;
    const result = await db.query(
      'INSERT INTO studies (accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status || 'pending', findings, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes } = req.body;
    const result = await db.query(
      'UPDATE studies SET accession_number=$1, patient_id=$2, modality_id=$3, radiologist_id=$4, study_date=$5, body_part=$6, clinical_indication=$7, priority=$8, status=$9, findings=$10, notes=$11 WHERE id=$12 RETURNING *',
      [accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM studies WHERE id = $1', [req.params.id]);
    res.json({ message: 'Study deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
