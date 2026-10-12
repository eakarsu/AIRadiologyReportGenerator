// Illustrative prompt context only. Patient measurements, records and images stay user supplied.
const cases = [
  { modality: 'Chest radiograph', body: 'Chest', indication: 'Cough and fever; assess for acute cardiopulmonary findings', finding: 'Illustrative report text: No focal airspace opacity. No pleural effusion or pneumothorax.', history: 'Illustrative history: several days of cough and fever; no verified patient record supplied.' },
  { modality: 'CT', body: 'Abdomen and pelvis', indication: 'Right lower quadrant pain; assess for acute abnormality', finding: 'Illustrative report text: Appendix is not enlarged. No free intraperitoneal air or fluid.', history: 'Illustrative history: acute abdominal pain; correlate with the actual examination and laboratory results.' },
  { modality: 'MRI', body: 'Lumbar spine', indication: 'Persistent low back pain with radicular symptoms', finding: 'Illustrative report text: Mild L4-L5 disc bulge without high-grade canal stenosis.', history: 'Illustrative history: persistent back pain; no verified neurological examination supplied.' },
];

const values = {
  study_description: c => `${c.modality} of the ${c.body.toLowerCase()} for ${c.indication.toLowerCase()}.`,
  modality: c => c.modality, body_part: c => c.body, body_region: c => c.body,
  clinical_indication: c => c.indication, indication: c => c.indication, clinical_question: c => c.indication,
  report_text: c => c.finding, findings: c => c.finding, imaging_findings: c => c.finding,
  current_findings: c => c.finding, current_report: c => c.finding,
  prior_report: () => 'Illustrative prior report: No acute finding was described; verify the actual prior study before comparison.',
  prior_reports: () => 'Illustrative prior summary: No acute finding described. Replace with the actual prior reports.',
  prior_findings: () => 'Illustrative prior finding: no acute abnormality described; comparison is unverified.',
  clinical_history: c => c.history, medical_history: c => c.history, patient_history: c => c.history,
  clinical_context: c => c.history, patient_context: c => c.history,
  prior_studies: () => 'Illustrative prior study: comparison study date and accession must be verified.',
  prior_imaging: () => 'Illustrative prior imaging: comparison availability has not been verified.',
  patient_gender: (_, i) => ['Female', 'Male', 'Not specified'][i], sex: (_, i) => ['Female', 'Male', 'Not specified'][i],
  patient_name: () => 'Patient (illustrative; replace with the authorized name)',
  allergies: () => 'Unknown; confirm against the patient record.',
  contraindications: () => 'Unknown; confirm allergies, renal function and device status before imaging.',
  radiologist_name: () => 'Radiologist (illustrative; enter the actual reviewer)',
  specialization: (_, i) => ['General radiology', 'Abdominal imaging', 'Neuroradiology'][i],
  shift: (_, i) => ['Day shift', 'Evening shift', 'On-call shift'][i],
  exam_type: c => `${c.modality} examination`, specialty_focus: (_, i) => ['General diagnostic imaging', 'Abdominal imaging', 'Spine imaging'][i],
  contrast_used: (_, i) => ['No', 'Yes, confirm agent and dose', 'Unknown; verify protocol'][i],
  audit_summary: () => 'Illustrative audit: review completeness, critical result communication and report turnaround against local policy.',
  time_period: (_, i) => ['Last 7 days', 'Last 30 days', 'Last 90 days'][i],
  department: () => 'Diagnostic radiology', prior_exams_count: (_, i) => String([0, 1, 2][i]),
  diagnosis: () => 'Illustrative differential only; diagnosis requires actual images and clinical review.',
  difficulty_level: (_, i) => ['Introductory', 'Intermediate', 'Advanced'][i],
  total_patients: (_, i) => String([42, 86, 120][i]), total_studies: (_, i) => String([55, 110, 160][i]),
  total_reports: (_, i) => String([48, 99, 147][i]), pending_studies: (_, i) => String([7, 11, 13][i]),
  critical_reports: (_, i) => String([0, 1, 2][i]), ai_reports: (_, i) => String([12, 24, 38][i]),
  active_radiologists: (_, i) => String([3, 5, 7][i]),
  study_protocol: c => `${c.modality} ${c.body.toLowerCase()} protocol; verify acquisition parameters locally.`,
  institution_standard: () => 'Illustrative standard: document indication, technique, comparison, findings, impression and critical communication.',
  reading_level: (_, i) => ['Plain language', 'Grade 8', 'Detailed patient explanation'][i],
  sub_specialty: (_, i) => ['Thoracic imaging', 'Abdominal imaging', 'Musculoskeletal imaging'][i],
  anatomical_site: (_, i) => ['Distal radius', 'Ankle', 'Proximal humerus'][i],
  operator_role: () => 'Qualified point-of-care ultrasound operator',
  view: (_, i) => ['Apical five-chamber', 'Apical three-chamber', 'Parasternal long-axis'][i],
  peak_velocity_ms: (_, i) => String([2.4, 3.2, 4.1][i]),
  mean_gradient_mmhg: (_, i) => String([14, 25, 42][i]), ava_cm2: (_, i) => String([1.7, 1.2, 0.8][i]),
  vessel_name: (_, i) => ['LAD', 'RCA', 'LCx'][i],
  slice_location: (_, i) => ['Proximal segment', 'Mid segment', 'Distal segment'][i],
  vertebral_level: (_, i) => ['L1', 'L2', 'L3'][i],
  sequence: (_, i) => ['T1-weighted', 'T2-weighted', 'STIR'][i],
  family_history: () => 'Illustrative family history: unknown; verify with the patient.',
  density_category: (_, i) => ['Scattered fibroglandular density', 'Heterogeneously dense', 'Extremely dense'][i],
  prior_biopsies: (_, i) => String([0, 1, 2][i]), brca_status: () => 'Unknown; confirm genetic testing status.',
  task: (_, i) => ['Summarize visible structures', 'Identify possible abnormalities for review', 'Produce structured imaging observations'][i],
  output_schema: () => JSON.stringify({ observations: [], limitations: [], review_required: true }, null, 2),
  model: () => 'Use the configured model', chronological_age: (_, i) => String([45, 60, 72][i]),
  psa_ng_ml: (_, i) => String([4.2, 6.8, 9.1][i]), prior_biopsy: () => 'Unknown; confirm with the actual patient record.',
};

export function presetExample(field, index) {
  const example = values[field.key];
  if (example) return example(cases[index], index);
  const configured = field.presets?.[index] ?? field.default;
  if (configured != null && !/^Example\s/i.test(String(configured))) return typeof configured === 'object' ? JSON.stringify(configured, null, 2) : String(configured);
  return `Illustrative ${field.label.toLowerCase()}: review the actual source information before use.`;
}
