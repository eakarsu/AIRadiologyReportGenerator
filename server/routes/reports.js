const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { logAudit } = require('../middleware/logAudit');
const { body, validationResult } = require('express-validator');

// ─── Validation middleware ─────────────────────────────────────────────────
const validateReport = [
  body('study_id').optional().isInt(),
  body('radiologist_id').optional().isInt(),
  body('status').optional().isIn(['draft', 'pending-review', 'signed', 'amended']),
  body('ai_confidence').optional().isFloat({ min: 0, max: 100 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    next();
  }
];

router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';

    let conditions = [];
    let params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(p.first_name ILIKE $${idx} OR p.last_name ILIKE $${idx} OR s.accession_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status) {
      conditions.push(`rp.status = $${idx}`);
      params.push(status);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM reports rp
       LEFT JOIN studies s ON rp.study_id = s.id
       LEFT JOIN patients p ON s.patient_id = p.id
       ${where}`, params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await db.query(
      `SELECT rp.*, s.accession_number, s.body_part, s.clinical_indication,
              p.first_name || ' ' || p.last_name as patient_name, p.mrn,
              rd.first_name || ' ' || rd.last_name as radiologist_name,
              m.name as modality_name
       FROM reports rp
       LEFT JOIN studies s ON rp.study_id = s.id
       LEFT JOIN patients p ON s.patient_id = p.id
       LEFT JOIN radiologists rd ON rp.radiologist_id = rd.id
       LEFT JOIN modalities m ON s.modality_id = m.id
       ${where}
       ORDER BY rp.created_at DESC
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

    await logAudit(req.user?.id, 'READ', 'report', req.params.id, { ip: req.ip });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', auth, validateReport, async (req, res) => {
  try {
    const { study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status } = req.body;
    const result = await db.query(
      'INSERT INTO reports (study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding || false, ai_generated || false, ai_confidence, status || 'draft']
    );
    await logAudit(req.user?.id, 'CREATE', 'report', result.rows[0].id, { ip: req.ip });
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', auth, validateReport, async (req, res) => {
  try {
    // Block edits on signed reports
    const current = await db.query('SELECT status, signed_at FROM reports WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    if (current.rows[0].status === 'signed' && current.rows[0].signed_at) {
      return res.status(403).json({ error: 'Report is signed and cannot be edited. Use the amend endpoint to create an amendment.' });
    }

    const { study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status } = req.body;
    const result = await db.query(
      'UPDATE reports SET study_id=$1, radiologist_id=$2, template_id=$3, content=$4, impression=$5, findings=$6, recommendations=$7, critical_finding=$8, ai_generated=$9, ai_confidence=$10, status=$11, updated_at=NOW() WHERE id=$12 RETURNING *',
      [study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status, req.params.id]
    );
    await logAudit(req.user?.id, 'EDIT', 'report', req.params.id, { ip: req.ip, status });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM reports WHERE id = $1', [req.params.id]);
    await logAudit(req.user?.id, 'DELETE', 'report', req.params.id, { ip: req.ip });
    res.json({ message: 'Report deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── E-Signature ───────────────────────────────────────────────────────────
router.put('/:id/sign', auth, async (req, res) => {
  try {
    const report = await db.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
    if (report.rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    if (report.rows[0].signed_at) return res.status(400).json({ error: 'Report is already signed' });

    const result = await db.query(
      `UPDATE reports SET status = 'signed', signed_at = NOW(), signed_by = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [req.user?.id, req.params.id]
    );
    await logAudit(req.user?.id, 'SIGN', 'report', req.params.id, { ip: req.ip });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Amendment Trail ───────────────────────────────────────────────────────
router.post('/:id/amend', auth, async (req, res) => {
  try {
    const parentReport = await db.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
    if (parentReport.rows.length === 0) return res.status(404).json({ error: 'Report not found' });

    const parent = parentReport.rows[0];
    const { content, impression, findings, recommendations, amendment_reason } = req.body;

    const result = await db.query(
      `INSERT INTO reports (study_id, radiologist_id, template_id, content, impression, findings, recommendations,
        critical_finding, ai_generated, ai_confidence, status, parent_report_id, amendment_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'amended',$11,$12) RETURNING *`,
      [
        parent.study_id, parent.radiologist_id, parent.template_id,
        content || parent.content,
        impression || parent.impression,
        findings || parent.findings,
        recommendations || parent.recommendations,
        parent.critical_finding, parent.ai_generated, parent.ai_confidence,
        parent.id,
        amendment_reason || 'Amendment'
      ]
    );
    await logAudit(req.user?.id, 'AMEND', 'report', req.params.id, { ip: req.ip, amendment_id: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
