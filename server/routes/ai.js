const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { aiRateLimiter } = require('../middleware/rateLimiter');
const https = require('https');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// ─── Multer Setup ──────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|gif|webp|bmp|tiff)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// ─── PHI De-identification ─────────────────────────────────────────────────
function deidentify(text) {
  if (!text) return text;
  return text
    .replace(/\b(MRN|Medical Record Number|Patient ID)[:\s]*[\w-]+/gi, 'MRN: [REDACTED]')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[DATE]')
    .replace(/\b(DOB|Date of Birth)[:\s]*[\w\/\-]+/gi, 'DOB: [REDACTED]')
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b(?=\s*(,|\.|;|\s+\d|\s+M|\s+F|\s+male|\s+female))/g, '[PATIENT_NAME]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
    .replace(/\b\d{10,}\b/g, '[ID]');
}

// ─── 3-Strategy parseAIJson ────────────────────────────────────────────────
function parseAIJson(text) {
  if (!text) return null;
  // Strategy 1: direct parse
  try { return JSON.parse(text); } catch (_) {}
  // Strategy 2: extract JSON block
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) { try { return JSON.parse(match[1]); } catch (_) {} }
  // Strategy 3: find first { } block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) { try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {} }
  return null;
}

// ─── OpenRouter Call ───────────────────────────────────────────────────────
async function callOpenRouter(prompt, systemPrompt, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENROUTER_API_KEY missing');
    err.code = 'NO_KEY';
    throw err;
  }
  const model = options.model || process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet-20241022';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ];

  if (options.imageBase64) {
    messages[1] = {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${options.mimeType || 'image/jpeg'};base64,${options.imageBase64}` } },
        { type: 'text', text: prompt }
      ]
    };
  }

  const body = JSON.stringify({
    model,
    messages,
    max_tokens: options.max_tokens || 4000,
    temperature: options.temperature || 0.3,
    response_format: options.json ? { type: 'json_object' } : undefined
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:3000',
        'X-Title': 'AI Radiology Report Generator'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message || 'OpenRouter API error'));
          else resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse API response'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Persist AI Call ───────────────────────────────────────────────────────
async function persistAICall(userId, endpoint, inputData, result, model) {
  try {
    await db.query(
      `INSERT INTO ai_analyses (user_id, endpoint, input_data, result, model, tokens_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, endpoint, JSON.stringify(inputData), result, model, null]
    );
  } catch (err) {
    console.error('Failed to persist AI call:', err.message);
  }
}

// ─── Helper: run AI + persist + respond ───────────────────────────────────
async function runAI(req, res, endpoint, prompt, systemPrompt, inputData, options = {}) {
  const response = await callOpenRouter(prompt, systemPrompt, options);
  const content = response.choices[0].message.content;
  const model = response.model || options.model || 'anthropic/claude-3-5-sonnet-20241022';
  await persistAICall(req.user?.id, endpoint, inputData, content, model);
  return { result: content, model, usage: response.usage };
}

// 503 wrapper for new endpoints (existing endpoints keep prior behavior)
function aiErrorStatus(err) {
  return err && err.code === 'NO_KEY' ? 503 : 500;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI ENDPOINTS (all rate-limited)
// ═══════════════════════════════════════════════════════════════════════════

// 1. AI Report Generation
router.post('/generate-report', auth, aiRateLimiter, async (req, res) => {
  try {
    const { study_description, modality, body_part, clinical_indication, patient_age, patient_gender } = req.body;
    const systemPrompt = 'You are an expert radiologist AI assistant. Generate professional, structured radiology reports following ACR guidelines. Use standard radiology reporting format with FINDINGS and IMPRESSION sections. Be thorough, precise, and clinically relevant.';
    const prompt = `Generate a detailed radiology report for the following study:
Modality: ${modality}
Body Part: ${body_part}
Clinical Indication: ${clinical_indication}
Patient: ${patient_age} year old ${patient_gender}
Study Description/Findings: ${deidentify(study_description)}

Provide a complete structured report with:
1. TECHNIQUE
2. COMPARISON
3. FINDINGS (organized by anatomy)
4. IMPRESSION (numbered key findings)
5. RECOMMENDATIONS`;
    const data = await runAI(req, res, 'generate-report', prompt, systemPrompt, { modality, body_part, patient_age, patient_gender });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. AI Clinical Findings Extraction
router.post('/extract-findings', auth, aiRateLimiter, async (req, res) => {
  try {
    const { report_text } = req.body;
    const systemPrompt = 'You are a radiology AI that extracts and categorizes clinical findings from radiology reports. Provide structured, detailed extraction.';
    const prompt = `Extract all clinical findings from this radiology report. Categorize each finding by:
- Finding description
- Anatomical location
- Severity (normal/mild/moderate/severe/critical)
- Clinical significance
- Whether it requires follow-up

Report:
${deidentify(report_text)}

Format as a structured analysis with each finding clearly categorized.`;
    const data = await runAI(req, res, 'extract-findings', prompt, systemPrompt, { report_text: '[redacted]' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. AI Diagnosis Suggestion
router.post('/suggest-diagnosis', auth, aiRateLimiter, async (req, res) => {
  try {
    const { findings, clinical_history, modality } = req.body;
    const systemPrompt = 'You are an expert diagnostic radiology AI. Provide differential diagnoses based on imaging findings, ranked by likelihood.';
    const prompt = `Based on the following imaging findings and clinical context, provide differential diagnoses:

Modality: ${modality}
Clinical History: ${deidentify(clinical_history)}
Imaging Findings: ${deidentify(findings)}

Provide:
1. Primary diagnosis with confidence level
2. Differential diagnoses ranked by likelihood (top 5)
3. Supporting imaging features for each diagnosis
4. Recommended additional workup
5. Red flags or critical findings to consider`;
    const data = await runAI(req, res, 'suggest-diagnosis', prompt, systemPrompt, { modality });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. AI Report Summarization
router.post('/summarize-report', auth, aiRateLimiter, async (req, res) => {
  try {
    const { report_text } = req.body;
    const systemPrompt = 'You are a radiology report summarization AI. Create clear, concise summaries that highlight the most clinically important findings.';
    const prompt = `Summarize this radiology report into:
1. One-line summary (for quick review)
2. Key findings (bullet points)
3. Critical/urgent findings (if any)
4. Recommended actions
5. Follow-up timeline

Report:
${deidentify(report_text)}`;
    const data = await runAI(req, res, 'summarize-report', prompt, systemPrompt, {});
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. AI Critical Finding Detection
router.post('/detect-critical', auth, aiRateLimiter, async (req, res) => {
  try {
    const { report_text, findings } = req.body;
    const systemPrompt = 'You are a critical finding detection AI for radiology. Identify any findings that require immediate clinical attention based on ACR guidelines.';
    const prompt = `Analyze the following radiology report/findings for critical or urgent findings:

${deidentify(report_text || findings)}

Evaluate for:
1. Is this a CRITICAL finding requiring immediate communication? (Yes/No)
2. Urgency level (Critical/Urgent/Routine)
3. Specific critical findings identified
4. ACR appropriateness criteria reference
5. Recommended immediate actions
6. Communication requirements (who to notify, timeframe)
7. Potential life-threatening conditions to rule out`;
    const data = await runAI(req, res, 'detect-critical', prompt, systemPrompt, {});
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. AI Report Quality Check
router.post('/quality-check', auth, aiRateLimiter, async (req, res) => {
  try {
    const { report_text, modality, body_part } = req.body;
    const systemPrompt = 'You are a radiology report quality assurance AI. Evaluate reports for completeness, accuracy, clarity, and adherence to reporting standards.';
    const prompt = `Perform a quality check on this radiology report:

Modality: ${modality}
Body Part: ${body_part}
Report:
${deidentify(report_text)}

Evaluate:
1. Completeness Score (1-10)
2. Clarity Score (1-10)
3. Structure Score (1-10)
4. Clinical Relevance Score (1-10)
5. Missing elements or sections
6. Suggested improvements
7. Overall quality grade (A/B/C/D/F)
8. Specific recommendations for improvement`;
    const data = await runAI(req, res, 'quality-check', prompt, systemPrompt, { modality, body_part });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. AI Patient Communication
router.post('/patient-summary', auth, aiRateLimiter, async (req, res) => {
  try {
    const { report_text, patient_name } = req.body;
    const systemPrompt = 'You are a medical communication AI that translates complex radiology reports into patient-friendly language.';
    const prompt = `Convert this radiology report into a patient-friendly summary that the patient can understand:

${deidentify(report_text)}

Include:
1. What test was done (in simple terms)
2. What was found (plain language)
3. What this means for the patient
4. What happens next
5. Questions the patient might want to ask their doctor
6. Any lifestyle recommendations based on findings`;
    const data = await runAI(req, res, 'patient-summary', prompt, systemPrompt, {});
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. AI Differential Diagnosis
router.post('/differential-diagnosis', auth, aiRateLimiter, async (req, res) => {
  try {
    const { imaging_findings, patient_age, patient_gender, clinical_history } = req.body;
    const systemPrompt = 'You are an expert diagnostic radiology AI specializing in differential diagnosis.';
    const prompt = `Generate a comprehensive differential diagnosis for:

Patient: ${patient_age} year old ${patient_gender}
Clinical History: ${deidentify(clinical_history)}
Imaging Findings: ${deidentify(imaging_findings)}

Provide:
1. Most likely diagnosis with confidence percentage
2. Complete differential list (up to 8 diagnoses) ranked by probability
3. Key imaging features supporting each diagnosis
4. Key imaging features arguing against each diagnosis
5. Recommended additional imaging or tests
6. Clinical pearl or teaching point`;
    const data = await runAI(req, res, 'differential-diagnosis', prompt, systemPrompt, { patient_age, patient_gender });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. AI Follow-up Recommendations
router.post('/follow-up-recommendations', auth, aiRateLimiter, async (req, res) => {
  try {
    const { findings, modality, body_part, clinical_context } = req.body;
    const systemPrompt = 'You are a radiology follow-up recommendation AI based on ACR Appropriateness Criteria and Fleischner Society guidelines.';
    const prompt = `Based on the following findings, provide evidence-based follow-up recommendations:

Modality: ${modality}
Body Part: ${body_part}
Findings: ${deidentify(findings)}
Clinical Context: ${deidentify(clinical_context)}

Provide:
1. Recommended follow-up imaging (modality, timing, protocol)
2. Evidence basis (ACR criteria, Fleischner guidelines, etc.)
3. Urgency of follow-up
4. Alternative follow-up options
5. Red flags that should prompt earlier follow-up
6. When no follow-up is needed and why`;
    const data = await runAI(req, res, 'follow-up-recommendations', prompt, systemPrompt, { modality, body_part });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 10. AI Report Comparison
router.post('/compare-reports', auth, aiRateLimiter, async (req, res) => {
  try {
    const { current_report, prior_report } = req.body;
    const systemPrompt = 'You are a radiology AI that compares current and prior imaging reports to identify changes, progression, or improvement.';
    const prompt = `Compare these two radiology reports and identify changes:

PRIOR REPORT:
${deidentify(prior_report)}

CURRENT REPORT:
${deidentify(current_report)}

Provide:
1. Summary of changes since prior study
2. New findings not present in prior study
3. Resolved findings from prior study
4. Findings that have progressed/worsened
5. Findings that have improved
6. Stable/unchanged findings
7. Overall assessment (improved/stable/worsened/mixed)
8. Clinical implications of the changes`;
    const data = await runAI(req, res, 'compare-reports', prompt, systemPrompt, {});
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 11. AI Patient Risk Assessment
router.post('/patient-risk', auth, aiRateLimiter, async (req, res) => {
  try {
    const { patient_age, patient_gender, medical_history, allergies, current_findings } = req.body;
    const systemPrompt = 'You are a clinical risk assessment AI for radiology departments.';
    const prompt = `Assess the risk profile for this radiology patient:

Patient: ${patient_age} year old ${patient_gender}
Medical History: ${deidentify(medical_history)}
Known Allergies: ${allergies}
Current Findings: ${deidentify(current_findings)}

Provide:
1. Overall risk level (Low/Moderate/High/Critical)
2. Contrast reaction risk assessment
3. Radiation exposure considerations
4. Sedation risk if applicable
5. Comorbidity-related imaging risks
6. Recommended pre-procedure precautions
7. Contraindicated imaging modalities
8. Patient safety checklist for imaging`;
    const data = await runAI(req, res, 'patient-risk', prompt, systemPrompt, { patient_age, patient_gender });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 12. AI Study Protocol Recommendation
router.post('/protocol-recommendation', auth, aiRateLimiter, async (req, res) => {
  try {
    const { clinical_indication, body_part, patient_age, patient_gender, prior_studies } = req.body;
    const systemPrompt = 'You are a radiology protocol optimization AI based on ACR Appropriateness Criteria.';
    const prompt = `Recommend the optimal imaging protocol:

Clinical Indication: ${deidentify(clinical_indication)}
Body Part: ${body_part}
Patient: ${patient_age} year old ${patient_gender}
Prior Studies: ${prior_studies || 'None'}

Provide:
1. Recommended primary modality and protocol
2. ACR Appropriateness rating (1-9)
3. Alternative protocols ranked by appropriateness
4. Contrast requirement (type, volume, rate)
5. Special sequences or techniques needed
6. Estimated scan duration
7. Patient preparation instructions
8. Radiation dose optimization strategies`;
    const data = await runAI(req, res, 'protocol-recommendation', prompt, systemPrompt, { body_part, patient_age, patient_gender });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 13. AI Radiologist Workload Analysis
router.post('/workload-analysis', auth, aiRateLimiter, async (req, res) => {
  try {
    const { radiologist_name, specialization, reports_today, accuracy_rate, shift, years_experience } = req.body;
    const systemPrompt = 'You are a radiology department management AI.';
    const prompt = `Analyze workload and performance for this radiologist:

Name: ${radiologist_name}
Specialization: ${specialization}
Reports Today: ${reports_today}
Accuracy Rate: ${accuracy_rate}%
Current Shift: ${shift}
Years Experience: ${years_experience}

Provide:
1. Workload assessment (under/optimal/over capacity)
2. Burnout risk level
3. Recommended daily report target for their specialty
4. Performance trend analysis
5. Suggestions for case distribution optimization
6. Continuing education recommendations
7. Peer comparison benchmark
8. Work-life balance recommendations`;
    const data = await runAI(req, res, 'workload-analysis', prompt, systemPrompt, { specialization, shift });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 14. AI Modality Selection
router.post('/modality-selection', auth, aiRateLimiter, async (req, res) => {
  try {
    const { clinical_question, body_region, patient_age, patient_gender, contraindications, prior_imaging } = req.body;
    const systemPrompt = 'You are a radiology imaging modality selection AI based on ACR Appropriateness Criteria.';
    const prompt = `Recommend the best imaging modality for this clinical scenario:

Clinical Question: ${deidentify(clinical_question)}
Body Region: ${body_region}
Patient: ${patient_age} year old ${patient_gender}
Contraindications: ${contraindications || 'None known'}
Prior Imaging: ${prior_imaging || 'None'}

Provide:
1. Best modality recommendation with justification
2. ACR Appropriateness Score (1-9) for top 5 modality options
3. Radiation dose comparison between options
4. Cost-effectiveness analysis
5. Diagnostic accuracy comparison
6. Contraindication check for each modality
7. Time-to-diagnosis comparison
8. When to escalate to advanced imaging`;
    const data = await runAI(req, res, 'modality-selection', prompt, systemPrompt, { body_region, patient_age, patient_gender });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 15. AI Template Generator
router.post('/generate-template', auth, aiRateLimiter, async (req, res) => {
  try {
    const { modality, body_part, exam_type, specialty_focus } = req.body;
    const systemPrompt = 'You are a radiology report template creation AI following RSNA and ACR reporting guidelines.';
    const prompt = `Generate a professional radiology report template for:

Modality: ${modality}
Body Part: ${body_part}
Exam Type: ${exam_type}
Specialty Focus: ${specialty_focus || 'General'}

Create a complete template with:
1. Standard header (exam type, indication, comparison, technique)
2. Structured findings section with all relevant anatomical areas
3. Placeholder brackets [description] for each finding
4. Impression section format
5. Recommendation section
6. Critical finding communication checklist
7. Quality metrics tracking fields
8. Follow the RSNA reporting template standards`;
    const data = await runAI(req, res, 'generate-template', prompt, systemPrompt, { modality, body_part, exam_type });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 16. AI Billing Code Suggestion
router.post('/billing-suggestion', auth, aiRateLimiter, async (req, res) => {
  try {
    const { study_description, modality, body_part, contrast_used, clinical_indication } = req.body;
    const systemPrompt = 'You are a radiology billing and coding AI expert.';
    const prompt = `Suggest billing codes for this radiology study:

Study: ${study_description}
Modality: ${modality}
Body Part: ${body_part}
Contrast Used: ${contrast_used || 'No'}
Clinical Indication: ${deidentify(clinical_indication)}

Provide:
1. Primary CPT code with description
2. Additional/modifier CPT codes if applicable
3. ICD-10 diagnosis codes for the indication
4. Professional vs Technical component breakdown
5. Estimated reimbursement range
6. RVU calculation
7. Common billing errors to avoid
8. Documentation requirements for clean claims
9. Prior authorization requirements`;
    const data = await runAI(req, res, 'billing-suggestion', prompt, systemPrompt, { modality, body_part });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 17. AI Audit Anomaly Detection
router.post('/audit-analysis', auth, aiRateLimiter, async (req, res) => {
  try {
    const { audit_summary, time_period, department } = req.body;
    const systemPrompt = 'You are a radiology department audit and compliance AI.';
    const prompt = `Analyze this radiology department audit data:

Audit Summary: ${audit_summary}
Time Period: ${time_period || 'Last 30 days'}
Department: ${department || 'Radiology'}

Provide:
1. Anomaly detection (unusual patterns in access, timing, volume)
2. Compliance risk assessment
3. HIPAA compliance concerns
4. Turnaround time analysis
5. Critical finding communication compliance rate
6. Peer review recommendations
7. Process improvement suggestions
8. Staff training needs identified
9. Regulatory risk areas`;
    const data = await runAI(req, res, 'audit-analysis', prompt, systemPrompt, { time_period, department });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 18. AI Radiation Dose Optimization
router.post('/dose-optimization', auth, aiRateLimiter, async (req, res) => {
  try {
    const { modality, body_part, patient_age, patient_weight, clinical_indication, prior_exams_count } = req.body;
    const systemPrompt = 'You are a radiation dose optimization AI following ALARA principles and ACR Dose Index Registry guidelines.';
    const prompt = `Optimize radiation dose for this imaging study:

Modality: ${modality}
Body Part: ${body_part}
Patient Age: ${patient_age}
Patient Weight: ${patient_weight || 'Average'}
Clinical Indication: ${deidentify(clinical_indication)}
Prior Exams (last 12 months): ${prior_exams_count || 'Unknown'}

Provide:
1. Recommended dose parameters (kVp, mAs, CTDIvol)
2. Estimated effective dose (mSv)
3. Comparison to diagnostic reference levels (DRL)
4. Cumulative dose assessment
5. ALARA optimization strategies
6. Pediatric-specific dose considerations if applicable
7. Alternative lower-dose protocols
8. Dose tracking and monitoring recommendations
9. When benefits outweigh radiation risks`;
    const data = await runAI(req, res, 'dose-optimization', prompt, systemPrompt, { modality, body_part, patient_age });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 19. AI Teaching Case Generator
router.post('/teaching-case', auth, aiRateLimiter, async (req, res) => {
  try {
    const { findings, modality, diagnosis, difficulty_level } = req.body;
    const systemPrompt = 'You are a radiology education AI. Create comprehensive teaching cases for radiology residents and fellows.';
    const prompt = `Create a teaching case from these findings:

Modality: ${modality}
Key Findings: ${deidentify(findings)}
Final Diagnosis: ${diagnosis}
Difficulty Level: ${difficulty_level || 'Intermediate'}

Generate:
1. Clinical presentation (history, symptoms, labs)
2. Imaging findings description (structured)
3. Key diagnostic features
4. Differential diagnosis with distinguishing features
5. Pathophysiology correlation
6. Classic imaging signs and their names
7. Pitfalls and mimics to avoid
8. Management implications
9. Board-style multiple choice question with explanation
10. Key references and learning resources`;
    const data = await runAI(req, res, 'teaching-case', prompt, systemPrompt, { modality, diagnosis, difficulty_level });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 20. AI Dashboard Insights
router.post('/dashboard-insights', auth, aiRateLimiter, async (req, res) => {
  try {
    const { total_patients, total_studies, total_reports, pending_studies, critical_reports, ai_reports, active_radiologists } = req.body;
    const systemPrompt = 'You are a radiology department analytics AI. Provide actionable insights and recommendations based on department metrics.';
    const prompt = `Analyze these radiology department metrics and provide insights:

Total Patients: ${total_patients}
Total Studies: ${total_studies}
Total Reports: ${total_reports}
Pending Studies: ${pending_studies}
Critical Reports: ${critical_reports}
AI-Assisted Reports: ${ai_reports}
Active Radiologists: ${active_radiologists}

Provide:
1. Department efficiency score (1-100)
2. Bottleneck identification
3. Capacity utilization analysis
4. AI adoption rate assessment
5. Critical finding response performance
6. Staffing adequacy assessment
7. Revenue optimization opportunities
8. Quality improvement priorities
9. Predictive workload forecast
10. Top 5 actionable recommendations`;
    const data = await runAI(req, res, 'dashboard-insights', prompt, systemPrompt, req.body);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Image Upload ──────────────────────────────────────────────────────────
router.post('/studies/:id/upload-image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const studyId = req.params.id;
    // Store image reference in studies or a separate table
    const filePath = req.file.path;
    const fileName = req.file.filename;
    await db.query(
      `UPDATE studies SET image_path = $1, image_filename = $2 WHERE id = $3`,
      [filePath, fileName, studyId]
    ).catch(() => {}); // graceful: columns may not exist yet
    res.json({ message: 'Image uploaded successfully', filename: fileName, path: filePath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Vision AI Image Analysis ──────────────────────────────────────────────
router.post('/studies/:id/ai-image-analysis', auth, aiRateLimiter, async (req, res) => {
  try {
    const studyId = req.params.id;

    // Get study info
    const studyResult = await db.query(
      `SELECT s.*, m.name as modality_name FROM studies s LEFT JOIN modalities m ON s.modality_id = m.id WHERE s.id = $1`,
      [studyId]
    );
    if (studyResult.rows.length === 0) return res.status(404).json({ error: 'Study not found' });
    const study = studyResult.rows[0];

    // Try to read image
    const imagePath = study.image_path || req.body.image_path;
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(400).json({ error: 'No image found for this study. Please upload an image first.' });
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp' };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    const systemPrompt = 'You are an expert radiologist AI. Analyze the provided medical image and provide detailed findings, impressions, and recommendations. Be thorough, precise, and clinically relevant.';
    const prompt = `Analyze this radiology image (${study.modality_name || 'unknown modality'} of ${study.body_part || 'unknown body part'}).
Clinical Indication: ${deidentify(study.clinical_indication || 'Not provided')}

Please provide:
1. TECHNIQUE: Describe the imaging technique apparent from the image
2. FINDINGS: Detailed structured findings organized by anatomical area
3. IMPRESSION: Numbered key findings with clinical significance
4. SEVERITY: Overall severity (normal/mild/moderate/severe/critical)
5. RECOMMENDATIONS: Follow-up or additional workup recommendations
6. CRITICAL FINDINGS: Any findings requiring immediate attention`;

    const response = await callOpenRouter(prompt, systemPrompt, { imageBase64, mimeType });
    const content = response.choices[0].message.content;
    await persistAICall(req.user?.id, 'ai-image-analysis', { studyId, modality: study.modality_name }, content, response.model);

    res.json({ result: content, model: response.model, usage: response.usage, studyId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Prior Comparison (compare current to a patient's own prior exams)
router.post('/prior-comparison', auth, aiRateLimiter, async (req, res) => {
  try {
    const { patient_id, current_report, prior_reports } = req.body;
    const systemPrompt = 'You are a radiology AI specialized in longitudinal comparison across a single patient\'s priors.';
    const priors = Array.isArray(prior_reports)
      ? prior_reports.map((r, i) => `--- Prior #${i + 1} (${r.date || 'unknown date'}, ${r.modality || 'unknown modality'}) ---\n${deidentify(r.report || r)}`).join('\n\n')
      : deidentify(prior_reports || '');
    const prompt = `Compare the patient's current radiology report to all prior exams below.

PATIENT: ${patient_id || 'unspecified'}

CURRENT REPORT:
${deidentify(current_report)}

PRIOR REPORTS:
${priors}

Provide:
1. Trajectory summary (stable / improving / worsening / mixed)
2. New findings vs each prior
3. Resolved findings vs each prior
4. Progression timeline of any chronic findings
5. Recommended next imaging interval based on trajectory
6. Clinical concerns flagged by the trend`;
    const data = await runAI(req, res, 'prior-comparison', prompt, systemPrompt, { patient_id });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Protocol Compliance Audit (vs ACR / institutional standards)
router.post('/protocol-compliance-audit', auth, aiRateLimiter, async (req, res) => {
  try {
    const { study_protocol, modality, clinical_indication, institution_standard } = req.body;
    const systemPrompt = 'You are a radiology compliance AI checking exam protocols against ACR Appropriateness Criteria and institutional standards.';
    const prompt = `Audit this study protocol for compliance.

Modality: ${modality || 'unspecified'}
Clinical Indication: ${deidentify(clinical_indication || '')}
Protocol Used: ${deidentify(study_protocol || '')}
Institution Standard: ${institution_standard || 'ACR Appropriateness Criteria'}

Return JSON:
{
  "compliant": true,
  "compliance_score": 0-100,
  "missing_sequences": [],
  "extra_sequences": [],
  "deviations": [{"item": "", "severity": "low|moderate|high", "rationale": ""}],
  "recommendations": [],
  "citations": ["ACR section if known"]
}`;
    const data = await runAI(req, res, 'protocol-compliance-audit', prompt, systemPrompt, { modality });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Incidental Finding Flagger
router.post('/incidental-finding-flag', auth, aiRateLimiter, async (req, res) => {
  try {
    const { report_text, clinical_indication } = req.body;
    const systemPrompt = 'You are a radiology AI that identifies incidental findings (findings unrelated to the reason for the exam) and grades follow-up urgency.';
    const prompt = `Identify all incidental findings in the report below.

Clinical Indication: ${deidentify(clinical_indication || '')}

REPORT:
${deidentify(report_text)}

Return JSON:
{
  "incidental_findings": [
    {
      "finding": "",
      "location": "",
      "size": "",
      "follow_up_required": true,
      "follow_up_urgency": "routine|soon|urgent",
      "recommended_followup_modality": "",
      "guideline_reference": "e.g. Fleischner, ACR Incidental Findings Committee"
    }
  ],
  "summary_for_referrer": "",
  "patient_letter_paragraph": ""
}`;
    const data = await runAI(req, res, 'incidental-finding-flag', prompt, systemPrompt, {});
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// AI Radiation Dose Tracking
router.post('/radiation-dose-tracking', auth, aiRateLimiter, async (req, res) => {
  try {
    const { patient_id, dose_history, modality, body_part, current_exam_dose } = req.body;
    if (!Array.isArray(dose_history)) {
      return res.status(400).json({ error: 'dose_history must be an array' });
    }
    const systemPrompt = 'You are a medical physics AI tracking cumulative ionizing radiation exposure across imaging studies. Apply ICRP recommendations and ALARA principles.';
    const prompt = `Assess cumulative radiation exposure and risk for this patient.

Modality (current): ${modality || 'unspecified'}
Body Part (current): ${body_part || 'unspecified'}
Current Exam Estimated Dose (mSv): ${current_exam_dose ?? 'unspecified'}
Prior Dose History: ${JSON.stringify(dose_history)}

Return JSON:
{
  "cumulative_dose_msv": 0,
  "current_exam_dose_msv": 0,
  "risk_band": "low|moderate|high|very_high",
  "lifetime_attributable_risk_estimate": "",
  "alara_recommendations": [],
  "alternative_modalities": [{"modality": "", "rationale": "", "dose_msv": 0}],
  "follow_up_schedule_advice": "",
  "citations": ["ICRP 103", "ACR Appropriateness"]
}`;
    const data = await runAI(req, res, 'radiation-dose-tracking', prompt, systemPrompt, { patient_id, modality, body_part });
    res.json(data);
  } catch (err) { res.status(aiErrorStatus(err)).json({ error: err.message }); }
});

// AI Patient-Facing Plain-Language Summary
router.post('/patient-friendly-summary', auth, aiRateLimiter, async (req, res) => {
  try {
    const { report_text, reading_level } = req.body;
    if (!report_text) return res.status(400).json({ error: 'report_text is required' });
    const systemPrompt = 'You translate radiology reports into plain-language summaries for patients without losing accuracy. Avoid jargon.';
    const prompt = `Translate this radiology report into a plain-language summary for a patient.

Target reading level: ${reading_level || '6th grade'}

REPORT:
${deidentify(report_text)}

Return JSON:
{
  "headline": "",
  "what_we_looked_for": "",
  "what_we_found": "",
  "what_it_means": "",
  "next_steps": [],
  "questions_to_ask_doctor": [],
  "important_disclaimers": ""
}`;
    const data = await runAI(req, res, 'patient-friendly-summary', prompt, systemPrompt, { reading_level });
    res.json(data);
  } catch (err) { res.status(aiErrorStatus(err)).json({ error: err.message }); }
});

// AI Reporting Template Recommender
router.post('/reporting-template-recommender', auth, aiRateLimiter, async (req, res) => {
  try {
    const { modality, body_part, clinical_indication, sub_specialty } = req.body;
    if (!modality || !body_part) return res.status(400).json({ error: 'modality and body_part are required' });
    const systemPrompt = 'You recommend structured radiology reporting templates aligned with RadLex/RSNA RadReport templates and ACR guidelines.';
    const prompt = `Recommend a structured reporting template.

Modality: ${modality}
Body Part: ${body_part}
Sub-Specialty: ${sub_specialty || 'general'}
Clinical Indication: ${deidentify(clinical_indication || '')}

Return JSON:
{
  "recommended_template": {
    "name": "",
    "rsna_radreport_id": "",
    "sections": [{"section": "", "required": true, "fields": []}]
  },
  "alternative_templates": [{"name": "", "when_to_use": ""}],
  "key_required_elements": [],
  "rationale": "",
  "citations": []
}`;
    const data = await runAI(req, res, 'reporting-template-recommender', prompt, systemPrompt, { modality, body_part, sub_specialty });
    res.json(data);
  } catch (err) { res.status(aiErrorStatus(err)).json({ error: err.message }); }
});

// ─── AI History ────────────────────────────────────────────────────────────
router.get('/history', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const endpoint = req.query.endpoint || null;

    let whereClause = '';
    const params = [limit, offset];
    if (endpoint) {
      whereClause = 'WHERE endpoint = $3';
      params.push(endpoint);
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM ai_analyses ${endpoint ? 'WHERE endpoint = $1' : ''}`,
      endpoint ? [endpoint] : []
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await db.query(
      `SELECT id, user_id, endpoint, model, tokens_used, created_at
       FROM ai_analyses
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    res.json({
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
