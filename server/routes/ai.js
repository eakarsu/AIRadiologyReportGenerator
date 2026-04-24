const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const https = require('https');

async function callOpenRouter(prompt, systemPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5';

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    max_tokens: 4000,
    temperature: 0.3
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'AI Radiology Report Generator'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'OpenRouter API error'));
          } else {
            resolve(parsed);
          }
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

// 1. AI Report Generation
router.post('/generate-report', auth, async (req, res) => {
  try {
    const { study_description, modality, body_part, clinical_indication, patient_age, patient_gender } = req.body;
    const systemPrompt = 'You are an expert radiologist AI assistant. Generate professional, structured radiology reports following ACR guidelines. Use standard radiology reporting format with FINDINGS and IMPRESSION sections. Be thorough, precise, and clinically relevant.';
    const prompt = `Generate a detailed radiology report for the following study:
Modality: ${modality}
Body Part: ${body_part}
Clinical Indication: ${clinical_indication}
Patient: ${patient_age} year old ${patient_gender}
Study Description/Findings: ${study_description}

Please provide a complete structured report with:
1. TECHNIQUE
2. COMPARISON
3. FINDINGS (organized by anatomy)
4. IMPRESSION (numbered key findings)
5. RECOMMENDATIONS`;

    const response = await callOpenRouter(prompt, systemPrompt);
    const content = response.choices[0].message.content;
    res.json({ result: content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. AI Clinical Findings Extraction
router.post('/extract-findings', auth, async (req, res) => {
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
${report_text}

Format as a structured analysis with each finding clearly categorized.`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. AI Diagnosis Suggestion
router.post('/suggest-diagnosis', auth, async (req, res) => {
  try {
    const { findings, clinical_history, modality } = req.body;
    const systemPrompt = 'You are an expert diagnostic radiology AI. Provide differential diagnoses based on imaging findings, ranked by likelihood. Include supporting evidence for each diagnosis.';
    const prompt = `Based on the following imaging findings and clinical context, provide differential diagnoses:

Modality: ${modality}
Clinical History: ${clinical_history}
Imaging Findings: ${findings}

Provide:
1. Primary diagnosis with confidence level
2. Differential diagnoses ranked by likelihood (top 5)
3. Supporting imaging features for each diagnosis
4. Recommended additional workup for each differential
5. Red flags or critical findings to consider`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. AI Report Summarization
router.post('/summarize-report', auth, async (req, res) => {
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
${report_text}`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. AI Critical Finding Detection
router.post('/detect-critical', auth, async (req, res) => {
  try {
    const { report_text, findings } = req.body;
    const systemPrompt = 'You are a critical finding detection AI for radiology. Identify any findings that require immediate clinical attention based on ACR guidelines for critical results communication.';
    const prompt = `Analyze the following radiology report/findings for critical or urgent findings that require immediate communication:

${report_text || findings}

Evaluate for:
1. Is this a CRITICAL finding requiring immediate communication? (Yes/No)
2. Urgency level (Critical/Urgent/Routine)
3. Specific critical findings identified
4. ACR appropriateness criteria reference
5. Recommended immediate actions
6. Communication requirements (who to notify, timeframe)
7. Potential life-threatening conditions to rule out`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. AI Report Quality Check
router.post('/quality-check', auth, async (req, res) => {
  try {
    const { report_text, modality, body_part } = req.body;
    const systemPrompt = 'You are a radiology report quality assurance AI. Evaluate reports for completeness, accuracy, clarity, and adherence to reporting standards.';
    const prompt = `Perform a quality check on this radiology report:

Modality: ${modality}
Body Part: ${body_part}
Report:
${report_text}

Evaluate:
1. Completeness Score (1-10): Are all expected sections present?
2. Clarity Score (1-10): Is the language clear and unambiguous?
3. Structure Score (1-10): Does it follow standard reporting format?
4. Clinical Relevance Score (1-10): Does it address the clinical question?
5. Missing elements or sections
6. Suggested improvements
7. Overall quality grade (A/B/C/D/F)
8. Specific recommendations for improvement`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. AI Patient Communication (patient-friendly summary)
router.post('/patient-summary', auth, async (req, res) => {
  try {
    const { report_text, patient_name } = req.body;
    const systemPrompt = 'You are a medical communication AI that translates complex radiology reports into patient-friendly language. Use simple terms, avoid jargon, and be reassuring while accurate.';
    const prompt = `Convert this radiology report into a patient-friendly summary that ${patient_name || 'the patient'} can understand:

${report_text}

Include:
1. What test was done (in simple terms)
2. What was found (plain language, no medical jargon)
3. What this means for the patient
4. What happens next (follow-up steps)
5. Questions the patient might want to ask their doctor
6. Any lifestyle recommendations based on findings`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. AI Differential Diagnosis
router.post('/differential-diagnosis', auth, async (req, res) => {
  try {
    const { imaging_findings, patient_age, patient_gender, clinical_history } = req.body;
    const systemPrompt = 'You are an expert diagnostic radiology AI specializing in differential diagnosis. Provide comprehensive differential diagnoses with imaging correlates.';
    const prompt = `Generate a comprehensive differential diagnosis for:

Patient: ${patient_age} year old ${patient_gender}
Clinical History: ${clinical_history}
Imaging Findings: ${imaging_findings}

Provide:
1. Most likely diagnosis with confidence percentage
2. Complete differential list (up to 8 diagnoses) ranked by probability
3. Key imaging features supporting each diagnosis
4. Key imaging features arguing against each diagnosis
5. Recommended additional imaging or tests to narrow the differential
6. Clinical pearl or teaching point`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. AI Follow-up Recommendations
router.post('/follow-up-recommendations', auth, async (req, res) => {
  try {
    const { findings, modality, body_part, clinical_context } = req.body;
    const systemPrompt = 'You are a radiology follow-up recommendation AI based on ACR Appropriateness Criteria and Fleischner Society guidelines.';
    const prompt = `Based on the following findings, provide evidence-based follow-up recommendations:

Modality: ${modality}
Body Part: ${body_part}
Findings: ${findings}
Clinical Context: ${clinical_context}

Provide:
1. Recommended follow-up imaging (modality, timing, protocol)
2. Evidence basis (ACR criteria, Fleischner guidelines, etc.)
3. Urgency of follow-up (immediate/weeks/months/annual)
4. Alternative follow-up options
5. Red flags that should prompt earlier follow-up
6. When no follow-up is needed and why`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. AI Report Comparison
router.post('/compare-reports', auth, async (req, res) => {
  try {
    const { current_report, prior_report } = req.body;
    const systemPrompt = 'You are a radiology AI that compares current and prior imaging reports to identify changes, progression, or improvement.';
    const prompt = `Compare these two radiology reports and identify changes:

PRIOR REPORT:
${prior_report}

CURRENT REPORT:
${current_report}

Provide:
1. Summary of changes since prior study
2. New findings not present in prior study
3. Resolved findings from prior study
4. Findings that have progressed/worsened
5. Findings that have improved
6. Stable/unchanged findings
7. Overall assessment (improved/stable/worsened/mixed)
8. Clinical implications of the changes`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. AI Patient Risk Assessment
router.post('/patient-risk', auth, async (req, res) => {
  try {
    const { patient_age, patient_gender, medical_history, allergies, current_findings } = req.body;
    const systemPrompt = 'You are a clinical risk assessment AI for radiology departments. Evaluate patient risk factors for imaging procedures and provide safety recommendations.';
    const prompt = `Assess the risk profile for this radiology patient:

Patient: ${patient_age} year old ${patient_gender}
Medical History: ${medical_history}
Known Allergies: ${allergies}
Current Findings: ${current_findings}

Provide:
1. Overall risk level (Low/Moderate/High/Critical)
2. Contrast reaction risk assessment
3. Radiation exposure considerations (cumulative dose awareness)
4. Sedation risk if applicable
5. Comorbidity-related imaging risks
6. Recommended pre-procedure precautions
7. Contraindicated imaging modalities
8. Patient safety checklist for imaging`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. AI Study Protocol Recommendation
router.post('/protocol-recommendation', auth, async (req, res) => {
  try {
    const { clinical_indication, body_part, patient_age, patient_gender, prior_studies } = req.body;
    const systemPrompt = 'You are a radiology protocol optimization AI. Recommend the most appropriate imaging protocol based on clinical indication, following ACR Appropriateness Criteria.';
    const prompt = `Recommend the optimal imaging protocol:

Clinical Indication: ${clinical_indication}
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

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. AI Radiologist Workload Analysis
router.post('/workload-analysis', auth, async (req, res) => {
  try {
    const { radiologist_name, specialization, reports_today, accuracy_rate, shift, years_experience } = req.body;
    const systemPrompt = 'You are a radiology department management AI. Analyze radiologist workload, performance metrics, and provide optimization recommendations.';
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

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. AI Modality Selection
router.post('/modality-selection', auth, async (req, res) => {
  try {
    const { clinical_question, body_region, patient_age, patient_gender, contraindications, prior_imaging } = req.body;
    const systemPrompt = 'You are a radiology imaging modality selection AI based on ACR Appropriateness Criteria. Help clinicians choose the best imaging modality.';
    const prompt = `Recommend the best imaging modality for this clinical scenario:

Clinical Question: ${clinical_question}
Body Region: ${body_region}
Patient: ${patient_age} year old ${patient_gender}
Contraindications: ${contraindications || 'None known'}
Prior Imaging: ${prior_imaging || 'None'}

Provide:
1. Best modality recommendation with justification
2. ACR Appropriateness Score (1-9) for top 5 modality options
3. Radiation dose comparison between options
4. Cost-effectiveness analysis
5. Diagnostic accuracy comparison for this indication
6. Contraindication check for each modality
7. Time-to-diagnosis comparison
8. When to escalate to advanced imaging`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 15. AI Template Generator
router.post('/generate-template', auth, async (req, res) => {
  try {
    const { modality, body_part, exam_type, specialty_focus } = req.body;
    const systemPrompt = 'You are a radiology report template creation AI. Generate structured, comprehensive report templates following RSNA and ACR reporting guidelines.';
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

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 16. AI Billing Code Suggestion
router.post('/billing-suggestion', auth, async (req, res) => {
  try {
    const { study_description, modality, body_part, contrast_used, clinical_indication } = req.body;
    const systemPrompt = 'You are a radiology billing and coding AI expert. Suggest appropriate CPT codes, ICD-10 codes, and billing optimization based on the study performed.';
    const prompt = `Suggest billing codes for this radiology study:

Study: ${study_description}
Modality: ${modality}
Body Part: ${body_part}
Contrast Used: ${contrast_used || 'No'}
Clinical Indication: ${clinical_indication}

Provide:
1. Primary CPT code with description
2. Additional/modifier CPT codes if applicable
3. ICD-10 diagnosis codes for the indication
4. Professional vs Technical component breakdown
5. Estimated reimbursement range
6. RVU calculation
7. Common billing errors to avoid for this study type
8. Documentation requirements for clean claims
9. Prior authorization requirements`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 17. AI Audit Anomaly Detection
router.post('/audit-analysis', auth, async (req, res) => {
  try {
    const { audit_summary, time_period, department } = req.body;
    const systemPrompt = 'You are a radiology department audit and compliance AI. Analyze audit data for anomalies, compliance issues, and improvement opportunities.';
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

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 18. AI Radiation Dose Optimization
router.post('/dose-optimization', auth, async (req, res) => {
  try {
    const { modality, body_part, patient_age, patient_weight, clinical_indication, prior_exams_count } = req.body;
    const systemPrompt = 'You are a radiation dose optimization AI following ALARA principles and ACR Dose Index Registry guidelines.';
    const prompt = `Optimize radiation dose for this imaging study:

Modality: ${modality}
Body Part: ${body_part}
Patient Age: ${patient_age}
Patient Weight: ${patient_weight || 'Average'}
Clinical Indication: ${clinical_indication}
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

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 19. AI Teaching Case Generator
router.post('/teaching-case', auth, async (req, res) => {
  try {
    const { findings, modality, diagnosis, difficulty_level } = req.body;
    const systemPrompt = 'You are a radiology education AI. Create comprehensive teaching cases for radiology residents and fellows with clinical correlations and learning points.';
    const prompt = `Create a teaching case from these findings:

Modality: ${modality}
Key Findings: ${findings}
Final Diagnosis: ${diagnosis}
Difficulty Level: ${difficulty_level || 'Intermediate'}

Generate:
1. Clinical presentation (history, symptoms, labs)
2. Imaging findings description (structured)
3. Key diagnostic features (what makes this diagnosis)
4. Differential diagnosis with distinguishing features
5. Pathophysiology correlation
6. Classic imaging signs and their names
7. Pitfalls and mimics to avoid
8. Management implications
9. Board-style multiple choice question with explanation
10. Key references and learning resources`;

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20. AI Dashboard Insights
router.post('/dashboard-insights', auth, async (req, res) => {
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

    const response = await callOpenRouter(prompt, systemPrompt);
    res.json({ result: response.choices[0].message.content, model: response.model, usage: response.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
