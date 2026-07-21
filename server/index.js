require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:3000`;

app.use(helmet());
app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Limit', 'X-Total-Pages']
}));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'radiology-report-generator' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/studies', require('./routes/studies'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/templates', require('./routes/templates'));
app.use('/api/radiologists', require('./routes/radiologists'));
app.use('/api/modalities', require('./routes/modalities'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/ai', require('./routes/ai'));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'web', 'build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'web', 'build', 'index.html'));
  });
}

// Background uploads cleanup (sweeps server/uploads/ every hour, deletes files >24h old)
const { startUploadCleanup } = require('./services/uploadCleanup');
startUploadCleanup();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// AI feature mount: subspecialty-routing
app.use('/api/ai/subspecialty-routing', require('./routes/ai-subspecialty-routing'));
// === Batch 07 Gaps & Frontend Mounts ===
app.use('/api/gap-no-priorcomparison-against-patients-own-prio', require('./routes/gap-no-priorcomparison-against-patients-own-prio'));
app.use('/api/gap-no-protocolcomplianceaudit-acrinstitutional', require('./routes/gap-no-protocolcomplianceaudit-acrinstitutional'));
app.use('/api/gap-no-incidentalfindingflag-for-followup-tracki', require('./routes/gap-no-incidentalfindingflag-for-followup-tracki'));
app.use('/api/gap-no-radiationdosetracking-cumulative-exposure', require('./routes/gap-no-radiationdosetracking-cumulative-exposure'));
app.use('/api/gap-no-subspecialty-triage-ai-neuromskir-routing', require('./routes/gap-no-subspecialty-triage-ai-neuromskir-routing'));
app.use('/api/gap-no-pacs-dicom-integration', require('./routes/gap-no-pacs-dicom-integration'));
app.use('/api/gap-no-hl7fhir-messaging-for-ehr-connectivity', require('./routes/gap-no-hl7fhir-messaging-for-ehr-connectivity'));
app.use('/api/gap-no-worklist-management-prioritization-routin', require('./routes/gap-no-worklist-management-prioritization-routin'));
app.use('/api/gap-no-qa-workflow-peer-review-feedback-loop', require('./routes/gap-no-qa-workflow-peer-review-feedback-loop'));
app.use('/api/gap-no-secondread-coordination', require('./routes/gap-no-secondread-coordination'));
app.use('/api/gap-no-notification-system-critical-results-pagi', require('./routes/gap-no-notification-system-critical-results-pagi'));
app.use('/api/gap-no-patient-portal-patientfacing-summaries', require('./routes/gap-no-patient-portal-patientfacing-summaries'));
// === End Batch 07 ===
