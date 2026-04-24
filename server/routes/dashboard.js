const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const [patients, studies, reports, radiologists, templates, billing, pendingStudies, criticalReports, aiReports, modalities] = await Promise.all([
      db.query('SELECT COUNT(*) as count FROM patients'),
      db.query('SELECT COUNT(*) as count FROM studies'),
      db.query('SELECT COUNT(*) as count FROM reports'),
      db.query('SELECT COUNT(*) as count FROM radiologists WHERE status = $1', ['active']),
      db.query('SELECT COUNT(*) as count FROM report_templates'),
      db.query('SELECT SUM(base_price) as total FROM billing_codes'),
      db.query("SELECT COUNT(*) as count FROM studies WHERE status IN ('pending', 'in-progress')"),
      db.query('SELECT COUNT(*) as count FROM reports WHERE critical_finding = true'),
      db.query('SELECT COUNT(*) as count FROM reports WHERE ai_generated = true'),
      db.query('SELECT COUNT(*) as count FROM modalities WHERE status = $1', ['active']),
    ]);

    const recentStudies = await db.query(`
      SELECT s.id, s.accession_number, s.body_part, s.status, s.priority, s.study_date,
             p.first_name || ' ' || p.last_name as patient_name,
             m.name as modality_name
      FROM studies s
      LEFT JOIN patients p ON s.patient_id = p.id
      LEFT JOIN modalities m ON s.modality_id = m.id
      ORDER BY s.study_date DESC LIMIT 5
    `);

    const studyByStatus = await db.query(`
      SELECT status, COUNT(*) as count FROM studies GROUP BY status
    `);

    const reportByStatus = await db.query(`
      SELECT status, COUNT(*) as count FROM reports GROUP BY status
    `);

    res.json({
      stats: {
        totalPatients: parseInt(patients.rows[0].count),
        totalStudies: parseInt(studies.rows[0].count),
        totalReports: parseInt(reports.rows[0].count),
        activeRadiologists: parseInt(radiologists.rows[0].count),
        totalTemplates: parseInt(templates.rows[0].count),
        totalBillingValue: parseFloat(billing.rows[0].total || 0),
        pendingStudies: parseInt(pendingStudies.rows[0].count),
        criticalReports: parseInt(criticalReports.rows[0].count),
        aiReports: parseInt(aiReports.rows[0].count),
        activeModalities: parseInt(modalities.rows[0].count),
      },
      recentStudies: recentStudies.rows,
      studyByStatus: studyByStatus.rows,
      reportByStatus: reportByStatus.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
