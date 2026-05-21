const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const modality = req.query.modality || '';

    let conditions = [];
    let params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx} OR s.accession_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status) { conditions.push(`s.status = $${idx}`); params.push(status); idx++; }
    if (modality) { conditions.push(`m.code = $${idx}`); params.push(modality); idx++; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM studies s
       LEFT JOIN patients p ON s.patient_id = p.id
       LEFT JOIN modalities m ON s.modality_id = m.id
       ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await db.query(
      `SELECT s.*, p.first_name || ' ' || p.last_name as patient_name, p.mrn,
              m.name as modality_name, m.code as modality_code,
              r.first_name || ' ' || r.last_name as radiologist_name
       FROM studies s
       LEFT JOIN patients p ON s.patient_id = p.id
       LEFT JOIN modalities m ON s.modality_id = m.id
       LEFT JOIN radiologists r ON s.radiologist_id = r.id
       ${where}
       ORDER BY s.study_date DESC
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes } = req.body;
    const result = await db.query(
      'INSERT INTO studies (accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status || 'pending', findings, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes } = req.body;
    const result = await db.query(
      'UPDATE studies SET accession_number=$1, patient_id=$2, modality_id=$3, radiologist_id=$4, study_date=$5, body_part=$6, clinical_indication=$7, priority=$8, status=$9, findings=$10, notes=$11 WHERE id=$12 RETURNING *',
      [accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM studies WHERE id = $1', [req.params.id]);
    res.json({ message: 'Study deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
