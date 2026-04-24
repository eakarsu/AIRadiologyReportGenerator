const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT rp.*, s.accession_number, s.body_part, s.clinical_indication,
             p.first_name || ' ' || p.last_name as patient_name, p.mrn,
             rd.first_name || ' ' || rd.last_name as radiologist_name,
             m.name as modality_name
      FROM reports rp
      LEFT JOIN studies s ON rp.study_id = s.id
      LEFT JOIN patients p ON s.patient_id = p.id
      LEFT JOIN radiologists rd ON rp.radiologist_id = rd.id
      LEFT JOIN modalities m ON s.modality_id = m.id
      ORDER BY rp.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT rp.*, s.accession_number, s.body_part, s.clinical_indication, s.study_date,
             p.first_name || ' ' || p.last_name as patient_name, p.mrn, p.date_of_birth, p.gender,
             rd.first_name || ' ' || rd.last_name as radiologist_name, rd.specialization,
             m.name as modality_name, m.code as modality_code,
             t.name as template_name
      FROM reports rp
      LEFT JOIN studies s ON rp.study_id = s.id
      LEFT JOIN patients p ON s.patient_id = p.id
      LEFT JOIN radiologists rd ON rp.radiologist_id = rd.id
      LEFT JOIN modalities m ON s.modality_id = m.id
      LEFT JOIN report_templates t ON rp.template_id = t.id
      WHERE rp.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status } = req.body;
    const result = await db.query(
      'INSERT INTO reports (study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding || false, ai_generated || false, ai_confidence, status || 'draft']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status } = req.body;
    const signed_at = status === 'signed' ? new Date() : null;
    const result = await db.query(
      'UPDATE reports SET study_id=$1, radiologist_id=$2, template_id=$3, content=$4, impression=$5, findings=$6, recommendations=$7, critical_finding=$8, ai_generated=$9, ai_confidence=$10, status=$11, signed_at=$12, updated_at=NOW() WHERE id=$13 RETURNING *',
      [study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status, signed_at, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    res.json({ message: 'Report deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
