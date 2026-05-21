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

// ═══════════════════════════════════════════════════════════════════════════
// LinkedIn Radiology AI Brief Issue #5 — modality-specific feature pack
// F1 HOPPR · F2 AZmed · F3 RIVANNA · F4 EchoIQ · F5 Heartflow
// F6 SimonMed (DTC) · F7 Karolinska · F8 Foundation models · F9 DeepHealth
// ═══════════════════════════════════════════════════════════════════════════

const requirePaidFeature = require('../middleware/requirePaidFeature');

async function runVisionAI(req, res, endpoint, prompt, systemPrompt, extraInputData = {}) {
  if (!req.file) {
    res.status(400).json({ error: 'No image file provided (multipart field: image)' });
    return null;
  }
  const imageBuffer = fs.readFileSync(req.file.path);
  const imageBase64 = imageBuffer.toString('base64');
  const mimeType = req.file.mimetype || 'image/jpeg';
  const response = await callOpenRouter(prompt, systemPrompt, { imageBase64, mimeType, json: true });
  const content = response.choices[0].message.content;
  const model = response.model || 'anthropic/claude-3-5-sonnet-20241022';
  const inputData = { filename: req.file.originalname, size: req.file.size, ...extraInputData };
  await persistAICall(req.user?.id, endpoint, inputData, content, model);
  const parsed = parseAIJson(content);
  return { result: parsed || content, raw: content, model, usage: response.usage };
}

// ─── F1: HOPPR — Vision-language narrative report from image ───────────────
router.post('/narrative-from-image', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { modality, patient_context, body_part } = req.body;
    const systemPrompt = 'You are an expert radiologist producing structured narrative reports from medical images. Always return strict JSON.';
    const prompt = `Generate a structured radiology report from this image.
Modality: ${modality || 'unspecified'}
Body part: ${body_part || 'unspecified'}
Patient context: ${deidentify(patient_context || 'not provided')}

Return JSON with these keys:
- findings: array of {region, description, severity}
- impression: string (numbered key findings)
- next_steps: array of strings
- critical_findings: array of strings (flag urgent items)`;
    const data = await runVisionAI(req, res, 'narrative-from-image', prompt, systemPrompt, { modality, body_part });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F2: AZmed AZtrauma — Trauma X-ray analysis ────────────────────────────
router.post('/trauma-xray-analysis', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { body_region, patient_age } = req.body;
    const systemPrompt = 'You are a trauma radiology AI specialized in fracture, joint effusion, and dislocation detection on plain X-rays for adult and pediatric patients. Return strict JSON.';
    const prompt = `Analyze this trauma X-ray.
Body region: ${body_region || 'unspecified'}
Patient age: ${patient_age || 'unspecified'}

Return JSON:
- fractures: array of {location, type (transverse/oblique/comminuted/spiral/greenstick), displacement_mm, confidence}
- joint_effusions: array of {joint, size (small/moderate/large), confidence}
- dislocations: array of {joint, direction, confidence}
- severity: "low" | "moderate" | "severe"
- pediatric_specific_findings: array of strings (growth plate, buckle, etc.)
- recommended_imaging: array of strings`;
    const data = await runVisionAI(req, res, 'trauma-xray-analysis', prompt, systemPrompt, { body_region, patient_age });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F3: RIVANNA — Point-of-care ultrasound fracture detection ─────────────
router.post('/poc-ultrasound-fracture', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { anatomical_site, operator_role } = req.body;
    const systemPrompt = 'You are an AI specialized in point-of-care ultrasound (POCUS) fracture detection for non-physician operators (paramedics, nurses, medics). Return strict JSON.';
    const prompt = `Analyze this point-of-care ultrasound image for fracture.
Anatomical site: ${anatomical_site || 'unspecified'}
Operator role: ${operator_role || 'non-physician'}

Return JSON:
- fracture_present: boolean
- confidence: 0-1
- site: string
- cortical_disruption: boolean
- hematoma_present: boolean
- sonographer_notes: string (plain-language guidance for non-physician operator)
- escalation_needed: boolean
- recommended_followup: string`;
    const data = await runVisionAI(req, res, 'poc-ultrasound-fracture', prompt, systemPrompt, { anatomical_site, operator_role });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F4: EchoIQ — Aortic stenosis screen from echo ─────────────────────────
router.post('/echo-aortic-stenosis', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { view, peak_velocity_ms, mean_gradient_mmhg, ava_cm2 } = req.body;
    const systemPrompt = 'You are an echocardiography AI specialized in identifying aortic stenosis from echo images. Return strict JSON.';
    const prompt = `Screen this echocardiogram frame for aortic stenosis.
View: ${view || 'unspecified'}
Peak velocity (m/s): ${peak_velocity_ms || 'n/a'}
Mean gradient (mmHg): ${mean_gradient_mmhg || 'n/a'}
AVA (cm²): ${ava_cm2 || 'n/a'}

Return JSON:
- as_likelihood: 0-1
- severity: "none" | "mild" | "moderate" | "severe"
- leaflet_calcification: "none" | "mild" | "moderate" | "severe"
- lv_hypertrophy_present: boolean
- referral_recommended: boolean
- urgency: "routine" | "urgent" | "emergent"
- reasoning: string`;
    const data = await runVisionAI(req, res, 'echo-aortic-stenosis', prompt, systemPrompt, { view, peak_velocity_ms, mean_gradient_mmhg, ava_cm2 });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F5: Heartflow — Cardiac CT plaque + FFR-CT analysis ───────────────────
router.post('/cardiac-ct-plaque', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { vessel_name, slice_location } = req.body;
    const systemPrompt = 'You are a cardiac CT AI specialized in plaque quantification and FFR-CT estimation for CCTA studies. Return strict JSON.';
    const prompt = `Analyze this cardiac CT slice for plaque and functional significance.
Vessel: ${vessel_name || 'unspecified'}
Slice location: ${slice_location || 'unspecified'}

Return JSON:
- plaque_burden_pct: 0-100
- ffr_ct_estimate: 0-1 (≤0.80 indicates significant)
- stenosis_severity: "none" | "minimal" | "mild" | "moderate" | "severe" | "occluded"
- calcified_volume_mm3: number
- non_calcified_volume_mm3: number
- vulnerable_plaque_features: array of strings (positive remodeling, low attenuation, napkin-ring, spotty calcium)
- vessel_involvement: array of strings
- recommended_management: string`;
    const data = await runVisionAI(req, res, 'cardiac-ct-plaque', prompt, systemPrompt, { vessel_name, slice_location });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F6: SimonMed — Direct-to-consumer paid AI add-ons ─────────────────────

// DTC marketplace catalog
router.get('/dtc/catalog', auth, async (req, res) => {
  res.json({
    features: [
      { id: 'calcium-score-plus', name: 'Calcium Score+', description: 'Enhanced coronary calcium scoring with risk stratification', price_cents: 4900, modality: 'CT' },
      { id: 'ct-bone-density', name: 'CT Bone Density', description: 'Opportunistic osteoporosis screening from CT imaging', price_cents: 3900, modality: 'CT' },
      { id: 'mr-lumbar-spine-plus', name: 'MR Lumbar Spine+', description: 'Advanced MR lumbar spine analysis with disc-by-disc grading', price_cents: 5900, modality: 'MR' }
    ]
  });
});

// Purchase entitlement (dev: simulates Stripe checkout; production wires real session)
router.post('/dtc/purchase/:feature', auth, async (req, res) => {
  try {
    const { feature } = req.params;
    const allowed = ['calcium-score-plus', 'ct-bone-density', 'mr-lumbar-spine-plus'];
    if (!allowed.includes(feature)) return res.status(400).json({ error: 'Unknown feature' });
    const prices = { 'calcium-score-plus': 4900, 'ct-bone-density': 3900, 'mr-lumbar-spine-plus': 5900 };
    const stripeSessionId = req.body.stripe_session_id || `dev_${Date.now()}_${feature}`;
    const result = await db.query(
      `INSERT INTO paid_features (user_id, feature, status, stripe_session_id, amount_cents, currency, expires_at)
       VALUES ($1, $2, 'active', $3, $4, 'USD', NOW() + INTERVAL '90 days')
       RETURNING id, feature, status, expires_at`,
      [req.user.id, feature, stripeSessionId, prices[feature]]
    );
    res.json({ entitlement: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// User's active entitlements
router.get('/dtc/entitlements', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT feature, status, activated_at, expires_at FROM paid_features
       WHERE user_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY activated_at DESC`,
      [req.user.id]
    );
    res.json({ entitlements: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// F6a: Calcium Score+ (paid)
router.post('/calcium-score-plus', auth, requirePaidFeature('calcium-score-plus'), aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { patient_age, sex } = req.body;
    const systemPrompt = 'You are a cardiac CT AI specialized in coronary artery calcium (CAC) scoring with MESA-based risk stratification. Return strict JSON.';
    const prompt = `Compute Calcium Score+ from this cardiac CT.
Patient age: ${patient_age || 'unspecified'}
Sex: ${sex || 'unspecified'}

Return JSON:
- agatston_score: number
- volume_score: number
- mass_score: number
- vessel_breakdown: { lad: number, lcx: number, rca: number, lm: number }
- risk_percentile_mesa: 0-100
- ten_year_ascvd_risk_pct: 0-100
- statin_eligibility: boolean
- lifestyle_recommendations: array of strings`;
    const data = await runVisionAI(req, res, 'calcium-score-plus', prompt, systemPrompt, { patient_age, sex });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// F6b: CT Bone Density (paid)
router.post('/ct-bone-density', auth, requirePaidFeature('ct-bone-density'), aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { vertebral_level, patient_age, sex } = req.body;
    const systemPrompt = 'You are a CT AI specialized in opportunistic osteoporosis screening using vertebral HU attenuation. Return strict JSON.';
    const prompt = `Assess bone density from this CT slice.
Vertebral level: ${vertebral_level || 'L1'}
Patient age: ${patient_age || 'unspecified'}
Sex: ${sex || 'unspecified'}

Return JSON:
- hounsfield_units_l1: number
- t_score_estimate: number
- category: "normal" | "osteopenia" | "osteoporosis"
- fracture_risk_2yr_pct: 0-100
- vertebral_fractures_detected: array of {level, grade (Genant 1/2/3)}
- dxa_referral_recommended: boolean
- treatment_options: array of strings`;
    const data = await runVisionAI(req, res, 'ct-bone-density', prompt, systemPrompt, { vertebral_level, patient_age, sex });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// F6c: MR Lumbar Spine+ (paid)
router.post('/mr-lumbar-spine-plus', auth, requirePaidFeature('mr-lumbar-spine-plus'), aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { sequence, patient_age } = req.body;
    const systemPrompt = 'You are an MR spine AI providing disc-by-disc grading using Pfirrmann, modic, and stenosis classification. Return strict JSON.';
    const prompt = `Analyze this MR lumbar spine.
Sequence: ${sequence || 'T2'}
Patient age: ${patient_age || 'unspecified'}

Return JSON:
- disc_findings: array of {level (L1-L2..L5-S1), pfirrmann_grade (I-V), herniation_type (none/bulge/protrusion/extrusion/sequestration), modic_changes (0/I/II/III)}
- canal_stenosis: array of {level, severity (none/mild/moderate/severe)}
- foraminal_stenosis: array of {level, side (L/R), severity}
- facet_arthropathy: array of {level, grade (Weishaupt 0-3)}
- spondylolisthesis: array of {level, meyerding_grade (I-IV)}
- impression: string
- surgical_referral_recommended: boolean`;
    const data = await runVisionAI(req, res, 'mr-lumbar-spine-plus', prompt, systemPrompt, { sequence, patient_age });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F7: Karolinska — Mammography 10-year risk prediction ──────────────────
router.post('/mammo-10yr-risk', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { patient_age, family_history, density_category, prior_biopsies, brca_status } = req.body;
    const systemPrompt = 'You are a mammography AI specialized in long-horizon (10-year) breast cancer risk prediction integrating image features with clinical risk factors. Return strict JSON.';
    const prompt = `Predict 10-year breast cancer risk from this mammogram + clinical context.
Patient age: ${patient_age || 'unspecified'}
Family history: ${family_history || 'unspecified'}
Density category (BI-RADS a-d): ${density_category || 'unspecified'}
Prior biopsies: ${prior_biopsies || 'none'}
BRCA status: ${brca_status || 'unknown'}

Return JSON:
- ten_year_probability: 0-1
- auc_band: "0.65-0.75" | "0.55-0.65" | "0.75-0.85"
- risk_tier: "low" | "average" | "elevated" | "high"
- image_derived_features: { density_pct: number, masking_risk: "low|moderate|high", microcalcifications_present: boolean, architectural_distortion: boolean }
- recommended_follow_up_interval_months: number
- supplemental_imaging_recommended: array of strings (e.g., MRI, ABUS, contrast mammo)
- genetic_counseling_recommended: boolean`;
    const data = await runVisionAI(req, res, 'mammo-10yr-risk', prompt, systemPrompt, { patient_age, family_history, density_category });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F8: Imaging foundation model inference ────────────────────────────────
router.post('/foundation-model-inference', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { task, output_schema, model } = req.body;
    if (!task) return res.status(400).json({ error: 'task (free-form prompt) is required' });
    const systemPrompt = 'You are an imaging foundation model wrapper. Apply the user-specified task to the image and return strict JSON matching the output_schema if provided.';
    const prompt = `TASK: ${task}

OUTPUT_SCHEMA: ${output_schema || '(none — return any structured JSON appropriate to the task)'}

Apply the task to the image and return JSON.`;
    const data = await runVisionAI(req, res, 'foundation-model-inference', prompt, systemPrompt, { task, output_schema });
    if (data) {
      if (model) data.model = model;
      res.json(data);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── F9: DeepHealth — Connected imaging suite (neuro/prostate/MSK) ─────────

router.post('/brain-age-estimation', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { chronological_age, sequence } = req.body;
    const systemPrompt = 'You are a brain MRI AI estimating biological brain age from structural imaging. Return strict JSON.';
    const prompt = `Estimate brain age from this MRI.
Chronological age: ${chronological_age || 'unspecified'}
Sequence: ${sequence || 'T1'}

Return JSON:
- estimated_brain_age_years: number
- brain_age_gap_years: number (estimated minus chronological)
- atrophy_pattern: "none" | "global" | "frontotemporal" | "posterior_cortical" | "subcortical"
- regional_volumes_z: { hippocampus: number, entorhinal: number, temporal: number, frontal: number, ventricles: number }
- accelerated_aging_flag: boolean
- recommended_workup: array of strings`;
    const data = await runVisionAI(req, res, 'brain-age-estimation', prompt, systemPrompt, { chronological_age, sequence });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/brain-health-screen', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { patient_age, sequence } = req.body;
    const systemPrompt = 'You are a brain MRI AI performing broad brain-health screening (WMH burden, microbleeds, infarcts, atrophy). Return strict JSON.';
    const prompt = `Screen this brain MRI for cerebrovascular and neurodegenerative findings.
Patient age: ${patient_age || 'unspecified'}
Sequence: ${sequence || 'FLAIR/T2'}

Return JSON:
- wmh_fazekas_periventricular: 0-3
- wmh_fazekas_deep: 0-3
- microbleeds_count: number
- lacunar_infarcts_count: number
- enlarged_perivascular_spaces: "none" | "mild" | "moderate" | "severe"
- chronic_infarcts: array of {location, size_mm}
- mass_lesion_present: boolean
- atrophy_global: "none" | "mild" | "moderate" | "severe"
- vascular_risk_summary: string
- recommended_followup: array of strings`;
    const data = await runVisionAI(req, res, 'brain-health-screen', prompt, systemPrompt, { patient_age, sequence });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/lumbar-mri-analysis', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { sequence, clinical_question } = req.body;
    const systemPrompt = 'You are an MR spine AI analyzing lumbar MRI with structured grading. Return strict JSON.';
    const prompt = `Analyze this lumbar MRI.
Sequence: ${sequence || 'T2'}
Clinical question: ${deidentify(clinical_question || 'general assessment')}

Return JSON:
- disc_findings: array of {level, pfirrmann_grade, herniation_type, modic_changes}
- canal_stenosis: array of {level, severity}
- foraminal_stenosis: array of {level, side, severity}
- nerve_root_compression: array of {level, side, nerve_root}
- impression: string
- recommended_management: array of strings`;
    const data = await runVisionAI(req, res, 'lumbar-mri-analysis', prompt, systemPrompt, { sequence, clinical_question });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/prostate-mri-analysis', auth, aiRateLimiter, upload.single('image'), async (req, res) => {
  try {
    const { psa_ng_ml, prior_biopsy } = req.body;
    const systemPrompt = 'You are a prostate MRI AI providing PI-RADS v2.1 lesion characterization. Return strict JSON.';
    const prompt = `Analyze this prostate MRI.
PSA (ng/mL): ${psa_ng_ml || 'unspecified'}
Prior biopsy: ${prior_biopsy || 'unspecified'}

Return JSON:
- prostate_volume_cc: number
- psa_density: number
- lesions: array of {zone (PZ/TZ/CZ/AFS), location_clock, size_mm, pi_rads_v2_1 (1-5), dwi_score, t2_score, dce_positive (boolean)}
- ece_suspected: boolean
- svi_suspected: boolean
- index_lesion: { lesion_index: number, pi_rads: number }
- biopsy_recommendation: "no" | "consider" | "yes_targeted" | "yes_systematic_plus_targeted"
- impression: string`;
    const data = await runVisionAI(req, res, 'prostate-mri-analysis', prompt, systemPrompt, { psa_ng_ml, prior_biopsy });
    if (data) res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
