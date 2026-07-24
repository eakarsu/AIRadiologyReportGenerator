require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('./db');
const bcrypt = require('bcryptjs');

function requireDemoPassword() {
  const password = process.env.DEMO_PASSWORD || process.env.SEED_DEMO_PASSWORD || process.env.DEMO_SEED_PASSWORD || '';
  if (password.length < 12 || password.length > 1024) throw new Error('DEMO_PASSWORD must contain 12-1024 characters');
  return password;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Drop tables if exist
    await client.query(`
      DROP TABLE IF EXISTS audit_logs CASCADE;
      DROP TABLE IF EXISTS billing_codes CASCADE;
      DROP TABLE IF EXISTS reports CASCADE;
      DROP TABLE IF EXISTS report_templates CASCADE;
      DROP TABLE IF EXISTS studies CASCADE;
      DROP TABLE IF EXISTS modalities CASCADE;
      DROP TABLE IF EXISTS patients CASCADE;
      DROP TABLE IF EXISTS radiologists CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);

    // Create tables
    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'radiologist',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE patients (
        id SERIAL PRIMARY KEY,
        mrn VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE NOT NULL,
        gender VARCHAR(10) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(255),
        address TEXT,
        insurance_provider VARCHAR(100),
        insurance_id VARCHAR(50),
        emergency_contact VARCHAR(255),
        allergies TEXT,
        medical_history TEXT,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE radiologists (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        specialization VARCHAR(100) NOT NULL,
        license_number VARCHAR(50) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        years_experience INTEGER,
        board_certified BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'active',
        shift VARCHAR(20) DEFAULT 'day',
        reports_today INTEGER DEFAULT 0,
        accuracy_rate DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE modalities (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(20) UNIQUE NOT NULL,
        description TEXT,
        body_parts TEXT[],
        avg_duration_minutes INTEGER,
        radiation_dose VARCHAR(50),
        contrast_required BOOLEAN DEFAULT false,
        preparation_instructions TEXT,
        cost_range VARCHAR(50),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE studies (
        id SERIAL PRIMARY KEY,
        accession_number VARCHAR(50) UNIQUE NOT NULL,
        patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
        modality_id INTEGER REFERENCES modalities(id),
        radiologist_id INTEGER REFERENCES radiologists(id),
        study_date TIMESTAMP NOT NULL,
        body_part VARCHAR(100) NOT NULL,
        clinical_indication TEXT,
        priority VARCHAR(20) DEFAULT 'routine',
        status VARCHAR(20) DEFAULT 'pending',
        findings TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE report_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        modality VARCHAR(50),
        body_part VARCHAR(100),
        template_text TEXT NOT NULL,
        sections JSONB,
        category VARCHAR(50),
        is_default BOOLEAN DEFAULT false,
        usage_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE reports (
        id SERIAL PRIMARY KEY,
        study_id INTEGER REFERENCES studies(id) ON DELETE CASCADE,
        radiologist_id INTEGER REFERENCES radiologists(id),
        template_id INTEGER REFERENCES report_templates(id),
        content TEXT NOT NULL,
        impression TEXT,
        findings TEXT,
        recommendations TEXT,
        critical_finding BOOLEAN DEFAULT false,
        ai_generated BOOLEAN DEFAULT false,
        ai_confidence DECIMAL(5,2),
        status VARCHAR(20) DEFAULT 'draft',
        signed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE billing_codes (
        id SERIAL PRIMARY KEY,
        cpt_code VARCHAR(20) UNIQUE NOT NULL,
        description TEXT NOT NULL,
        modality VARCHAR(50),
        body_part VARCHAR(100),
        base_price DECIMAL(10,2) NOT NULL,
        rvu DECIMAL(6,2),
        category VARCHAR(50),
        requires_contrast BOOLEAN DEFAULT false,
        professional_component DECIMAL(10,2),
        technical_component DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER,
        details JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Seed Users
    const hashedPassword = await bcrypt.hash(requireDemoPassword(), 10);
    await client.query(`
      INSERT INTO users (email, password, name, role) VALUES
      ('admin@radiology.com', $1, 'Dr. Admin User', 'admin'),
      ('doctor@radiology.com', $1, 'Dr. Sarah Chen', 'radiologist'),
      ('tech@radiology.com', $1, 'John Technician', 'technologist')
    `, [hashedPassword]);

    // Seed Patients (15+)
    await client.query(`
      INSERT INTO patients (mrn, first_name, last_name, date_of_birth, gender, phone, email, address, insurance_provider, insurance_id, emergency_contact, allergies, medical_history, status) VALUES
      ('MRN001', 'James', 'Wilson', '1965-03-15', 'Male', '555-0101', 'james.wilson@email.com', '123 Oak St, Boston, MA', 'BlueCross', 'BC-001', 'Mary Wilson 555-0102', 'Penicillin', 'Hypertension, Type 2 Diabetes', 'active'),
      ('MRN002', 'Emily', 'Roberts', '1978-07-22', 'Female', '555-0103', 'emily.r@email.com', '456 Elm Ave, Cambridge, MA', 'Aetna', 'AE-002', 'Tom Roberts 555-0104', 'None', 'Breast cancer history, BRCA1+', 'active'),
      ('MRN003', 'Michael', 'Chang', '1990-11-08', 'Male', '555-0105', 'mchang@email.com', '789 Pine Rd, Somerville, MA', 'United', 'UH-003', 'Lisa Chang 555-0106', 'Iodine contrast', 'Appendectomy 2015', 'active'),
      ('MRN004', 'Sarah', 'Johnson', '1955-01-30', 'Female', '555-0107', 'sjohnson@email.com', '321 Maple Dr, Brookline, MA', 'Medicare', 'MC-004', 'David Johnson 555-0108', 'Sulfa drugs', 'COPD, Osteoarthritis, Hip replacement 2020', 'active'),
      ('MRN005', 'Robert', 'Martinez', '1982-09-14', 'Male', '555-0109', 'rmartinez@email.com', '654 Birch Ln, Newton, MA', 'Cigna', 'CG-005', 'Ana Martinez 555-0110', 'None', 'ACL tear 2018, Sports injuries', 'active'),
      ('MRN006', 'Patricia', 'Brown', '1948-12-05', 'Female', '555-0111', 'pbrown@email.com', '987 Cedar Ct, Quincy, MA', 'Medicare', 'MC-006', 'William Brown 555-0112', 'Gadolinium', 'Coronary artery disease, Stent placement 2019', 'active'),
      ('MRN007', 'David', 'Lee', '1975-04-18', 'Male', '555-0113', 'dlee@email.com', '147 Walnut St, Medford, MA', 'BlueCross', 'BC-007', 'Jennifer Lee 555-0114', 'None', 'Kidney stones, Gout', 'active'),
      ('MRN008', 'Linda', 'Garcia', '1988-06-25', 'Female', '555-0115', 'lgarcia@email.com', '258 Spruce Ave, Arlington, MA', 'Aetna', 'AE-008', 'Carlos Garcia 555-0116', 'Latex', 'Pregnancy x2, Cesarean 2020', 'active'),
      ('MRN009', 'Thomas', 'Anderson', '1960-08-11', 'Male', '555-0117', 'tanderson@email.com', '369 Ash Blvd, Waltham, MA', 'United', 'UH-009', 'Karen Anderson 555-0118', 'Morphine', 'Lung cancer screening, Heavy smoker 30 years', 'active'),
      ('MRN010', 'Jennifer', 'Taylor', '1995-02-28', 'Female', '555-0119', 'jtaylor@email.com', '471 Poplar Way, Lexington, MA', 'Cigna', 'CG-010', 'Mike Taylor 555-0120', 'None', 'Scoliosis, Migraines', 'active'),
      ('MRN011', 'William', 'Davis', '1970-10-03', 'Male', '555-0121', 'wdavis@email.com', '582 Hickory Rd, Concord, MA', 'BlueCross', 'BC-011', 'Susan Davis 555-0122', 'Aspirin', 'Prostate enlargement, High cholesterol', 'active'),
      ('MRN012', 'Elizabeth', 'Moore', '1985-05-17', 'Female', '555-0123', 'emoore@email.com', '693 Chestnut Dr, Framingham, MA', 'Aetna', 'AE-012', 'John Moore 555-0124', 'None', 'Thyroid nodule, Hashimoto disease', 'active'),
      ('MRN013', 'Richard', 'White', '1952-07-09', 'Male', '555-0125', 'rwhite@email.com', '804 Magnolia Ln, Needham, MA', 'Medicare', 'MC-013', 'Barbara White 555-0126', 'Contrast dye', 'Abdominal aortic aneurysm, CABG 2017', 'active'),
      ('MRN014', 'Maria', 'Thompson', '1993-11-21', 'Female', '555-0127', 'mthompson@email.com', '915 Dogwood Ct, Wellesley, MA', 'United', 'UH-014', 'Chris Thompson 555-0128', 'None', 'Endometriosis, Iron deficiency anemia', 'active'),
      ('MRN015', 'Charles', 'Harris', '1968-03-06', 'Male', '555-0129', 'charris@email.com', '126 Redwood Ave, Natick, MA', 'Cigna', 'CG-015', 'Diane Harris 555-0130', 'Codeine', 'Herniated disc L4-L5, Chronic back pain', 'active'),
      ('MRN016', 'Susan', 'Clark', '1980-08-14', 'Female', '555-0131', 'sclark@email.com', '237 Cypress St, Dedham, MA', 'BlueCross', 'BC-016', 'Robert Clark 555-0132', 'None', 'Fibromyalgia, Anxiety disorder', 'active')
    `);

    // Seed Radiologists (15+)
    await client.query(`
      INSERT INTO radiologists (employee_id, first_name, last_name, specialization, license_number, email, phone, years_experience, board_certified, status, shift, reports_today, accuracy_rate) VALUES
      ('RAD001', 'Sarah', 'Chen', 'Neuroradiology', 'LIC-2001', 'schen@hospital.com', '555-1001', 15, true, 'active', 'day', 12, 98.5),
      ('RAD002', 'Michael', 'Patel', 'Musculoskeletal', 'LIC-2002', 'mpatel@hospital.com', '555-1002', 12, true, 'active', 'day', 8, 97.2),
      ('RAD003', 'Jennifer', 'Kim', 'Breast Imaging', 'LIC-2003', 'jkim@hospital.com', '555-1003', 10, true, 'active', 'day', 15, 99.1),
      ('RAD004', 'David', 'Nguyen', 'Cardiothoracic', 'LIC-2004', 'dnguyen@hospital.com', '555-1004', 20, true, 'active', 'day', 10, 98.8),
      ('RAD005', 'Lisa', 'Anderson', 'Abdominal Imaging', 'LIC-2005', 'landerson@hospital.com', '555-1005', 8, true, 'active', 'evening', 6, 96.5),
      ('RAD006', 'Robert', 'Singh', 'Interventional', 'LIC-2006', 'rsingh@hospital.com', '555-1006', 18, true, 'active', 'day', 5, 99.3),
      ('RAD007', 'Amanda', 'Lewis', 'Pediatric Radiology', 'LIC-2007', 'alewis@hospital.com', '555-1007', 7, true, 'active', 'day', 11, 97.8),
      ('RAD008', 'Christopher', 'Wang', 'Nuclear Medicine', 'LIC-2008', 'cwang@hospital.com', '555-1008', 14, true, 'active', 'evening', 4, 98.1),
      ('RAD009', 'Michelle', 'Garcia', 'Emergency Radiology', 'LIC-2009', 'mgarcia@hospital.com', '555-1009', 9, true, 'active', 'night', 18, 96.9),
      ('RAD010', 'James', 'Brown', 'Oncologic Imaging', 'LIC-2010', 'jbrown@hospital.com', '555-1010', 16, true, 'active', 'day', 7, 98.4),
      ('RAD011', 'Stephanie', 'Miller', 'Body MRI', 'LIC-2011', 'smiller@hospital.com', '555-1011', 11, true, 'active', 'day', 9, 97.6),
      ('RAD012', 'Kevin', 'Taylor', 'Vascular Imaging', 'LIC-2012', 'ktaylor@hospital.com', '555-1012', 13, false, 'active', 'evening', 6, 95.8),
      ('RAD013', 'Rachel', 'Martinez', 'Head & Neck', 'LIC-2013', 'rmartinez@hospital.com', '555-1013', 6, true, 'active', 'day', 13, 97.0),
      ('RAD014', 'Daniel', 'Robinson', 'Genitourinary', 'LIC-2014', 'drobinson@hospital.com', '555-1014', 22, true, 'active', 'day', 8, 99.0),
      ('RAD015', 'Emily', 'Wright', 'Mammography', 'LIC-2015', 'ewright@hospital.com', '555-1015', 5, false, 'on-leave', 'day', 0, 96.2),
      ('RAD016', 'Mark', 'Thompson', 'Spine Imaging', 'LIC-2016', 'mthompson@hospital.com', '555-1016', 17, true, 'active', 'night', 14, 98.7)
    `);

    // Seed Modalities (15+)
    await client.query(`
      INSERT INTO modalities (name, code, description, body_parts, avg_duration_minutes, radiation_dose, contrast_required, preparation_instructions, cost_range, status) VALUES
      ('X-Ray', 'XR', 'Standard radiographic imaging using X-rays', ARRAY['Chest', 'Extremities', 'Spine', 'Abdomen', 'Pelvis'], 10, 'Low (0.01-0.1 mSv)', false, 'Remove jewelry and metal objects. Wear hospital gown.', '$100-$300', 'active'),
      ('CT Scan', 'CT', 'Computed Tomography cross-sectional imaging', ARRAY['Head', 'Chest', 'Abdomen', 'Pelvis', 'Spine', 'Extremities'], 15, 'Moderate (2-20 mSv)', false, 'NPO 4 hours if contrast. Check kidney function.', '$500-$3000', 'active'),
      ('MRI', 'MR', 'Magnetic Resonance Imaging without radiation', ARRAY['Brain', 'Spine', 'Joints', 'Abdomen', 'Pelvis', 'Heart'], 45, 'None', false, 'Remove all metal. Screen for implants/pacemakers.', '$1000-$5000', 'active'),
      ('Ultrasound', 'US', 'Sound wave imaging for soft tissues', ARRAY['Abdomen', 'Pelvis', 'Thyroid', 'Breast', 'Vascular', 'Obstetric'], 30, 'None', false, 'Full bladder for pelvic US. NPO 8hrs for abdominal.', '$200-$800', 'active'),
      ('Mammography', 'MG', 'Breast imaging for screening and diagnosis', ARRAY['Breast'], 20, 'Low (0.4 mSv)', false, 'No deodorant or powder. Schedule after menstruation.', '$150-$500', 'active'),
      ('PET/CT', 'PT', 'Positron Emission Tomography with CT', ARRAY['Whole Body', 'Brain', 'Heart'], 120, 'High (14-32 mSv)', false, 'NPO 6 hours. Low carb diet 24hrs prior. No exercise.', '$3000-$6000', 'active'),
      ('Fluoroscopy', 'FL', 'Real-time X-ray imaging for dynamic studies', ARRAY['GI Tract', 'Joints', 'Spine', 'Vascular'], 30, 'Moderate (1-5 mSv)', true, 'NPO 8 hours for GI studies. Bowel prep may be needed.', '$400-$1500', 'active'),
      ('Nuclear Medicine', 'NM', 'Functional imaging with radioactive tracers', ARRAY['Thyroid', 'Bone', 'Heart', 'Lung', 'Kidney', 'Brain'], 60, 'Moderate (3-15 mSv)', false, 'Specific prep varies by study. Hydrate well.', '$800-$3000', 'active'),
      ('CT Angiography', 'CTA', 'Vascular imaging with contrast-enhanced CT', ARRAY['Head', 'Neck', 'Chest', 'Abdomen', 'Extremities'], 20, 'Moderate (5-15 mSv)', true, 'Check creatinine. NPO 4 hours. IV access needed.', '$1000-$4000', 'active'),
      ('MR Angiography', 'MRA', 'Vascular imaging using MRI technology', ARRAY['Head', 'Neck', 'Chest', 'Abdomen', 'Extremities'], 45, 'None', false, 'Screen for metal implants. May need gadolinium contrast.', '$1500-$5000', 'active'),
      ('DEXA Scan', 'DX', 'Bone density measurement', ARRAY['Spine', 'Hip', 'Forearm'], 15, 'Very Low (0.001 mSv)', false, 'No calcium supplements 24 hours prior.', '$150-$350', 'active'),
      ('Interventional Radiology', 'IR', 'Image-guided minimally invasive procedures', ARRAY['Vascular', 'Biliary', 'Renal', 'Spine', 'Tumor'], 90, 'Variable', true, 'NPO 8 hours. Labs required. Consent needed.', '$2000-$15000', 'active'),
      ('Cardiac MRI', 'CMR', 'Specialized heart imaging with MRI', ARRAY['Heart'], 60, 'None', false, 'Screen for pacemakers/defibrillators. No caffeine 24hrs.', '$2000-$6000', 'active'),
      ('Breast MRI', 'BMR', 'Contrast-enhanced breast MRI', ARRAY['Breast'], 45, 'None', true, 'Schedule day 7-14 of cycle. Check for implants.', '$1500-$4000', 'active'),
      ('Cone Beam CT', 'CBCT', 'Low-dose 3D imaging for dental/ENT', ARRAY['Head', 'Jaw', 'Sinuses', 'Temporal Bone'], 10, 'Low (0.05-0.5 mSv)', false, 'Remove dental appliances and jewelry.', '$200-$600', 'active'),
      ('3D Tomosynthesis', 'TOMO', 'Digital breast tomosynthesis 3D mammography', ARRAY['Breast'], 15, 'Low (0.5 mSv)', false, 'Same as mammography prep. Superior to 2D for dense breasts.', '$200-$600', 'active')
    `);

    // Seed Studies (15+)
    await client.query(`
      INSERT INTO studies (accession_number, patient_id, modality_id, radiologist_id, study_date, body_part, clinical_indication, priority, status, findings, notes) VALUES
      ('ACC-2024-001', 1, 2, 1, '2024-10-01 09:00:00', 'Head', 'Chronic headaches, rule out mass', 'routine', 'completed', 'No acute intracranial abnormality. Mild age-related atrophy.', 'Patient tolerated procedure well'),
      ('ACC-2024-002', 2, 5, 3, '2024-10-01 10:30:00', 'Breast', 'Annual screening mammogram', 'routine', 'completed', 'BIRADS 1 - Negative. No suspicious masses or calcifications.', 'Compared with prior from 2023'),
      ('ACC-2024-003', 3, 1, 9, '2024-10-02 08:15:00', 'Chest', 'Cough and fever x 5 days', 'urgent', 'completed', 'Right lower lobe consolidation consistent with pneumonia.', 'ER referral'),
      ('ACC-2024-004', 4, 3, 2, '2024-10-02 14:00:00', 'Knee', 'Right knee pain after fall', 'routine', 'completed', 'Complete ACL tear with bone bruise pattern. Medial meniscus tear.', 'Orthopedic referral recommended'),
      ('ACC-2024-005', 5, 2, 5, '2024-10-03 11:00:00', 'Abdomen', 'Abdominal pain, elevated lipase', 'stat', 'completed', 'Acute pancreatitis with peripancreatic fluid. No necrosis.', 'Admitted to ICU'),
      ('ACC-2024-006', 6, 9, 4, '2024-10-03 15:30:00', 'Chest', 'Chest pain, elevated troponin', 'stat', 'completed', 'No pulmonary embolism. Coronary artery calcifications noted.', 'Cardiology consulted'),
      ('ACC-2024-007', 7, 4, 5, '2024-10-04 09:45:00', 'Abdomen', 'Flank pain, hematuria', 'urgent', 'completed', '6mm obstructing stone in right UVJ. Mild hydronephrosis.', 'Urology referral placed'),
      ('ACC-2024-008', 8, 4, 7, '2024-10-04 13:00:00', 'Pelvis', 'Pelvic pain, irregular bleeding', 'routine', 'completed', '4cm complex ovarian cyst, left adnexa. Consider follow-up.', 'OB/GYN to follow up'),
      ('ACC-2024-009', 9, 2, 4, '2024-10-05 08:00:00', 'Chest', 'Lung cancer screening, heavy smoker', 'routine', 'completed', 'LungRADS 4B: 15mm spiculated nodule RUL. PET recommended.', 'CRITICAL FINDING - called to ordering physician'),
      ('ACC-2024-010', 10, 3, 16, '2024-10-05 10:30:00', 'Spine', 'Chronic low back pain radiating to legs', 'routine', 'completed', 'L4-L5 disc herniation with left S1 nerve root compression.', 'Neurosurgery referral discussed'),
      ('ACC-2024-011', 11, 4, 14, '2024-10-06 09:00:00', 'Abdomen', 'PSA elevation, rule out mass', 'routine', 'completed', 'Enlarged prostate 45cc. PIRADS 4 lesion in peripheral zone.', 'MRI-guided biopsy recommended'),
      ('ACC-2024-012', 12, 4, 13, '2024-10-06 11:30:00', 'Thyroid', 'Palpable thyroid nodule', 'routine', 'completed', '2.3cm solid hypoechoic nodule right lobe, TIRADS 4.', 'FNA biopsy recommended'),
      ('ACC-2024-013', 13, 9, 4, '2024-10-07 07:30:00', 'Abdomen', 'AAA surveillance', 'routine', 'completed', 'Infrarenal AAA measuring 5.8cm, increased from 5.2cm.', 'CRITICAL - Vascular surgery notified'),
      ('ACC-2024-014', 14, 3, 11, '2024-10-07 14:00:00', 'Pelvis', 'Endometriosis evaluation', 'routine', 'pending', NULL, 'Awaiting interpretation'),
      ('ACC-2024-015', 15, 3, 16, '2024-10-08 08:30:00', 'Spine', 'Post-op evaluation L4-L5 fusion', 'routine', 'pending', NULL, 'Awaiting interpretation'),
      ('ACC-2024-016', 16, 3, 1, '2024-10-08 10:00:00', 'Brain', 'New onset seizures', 'stat', 'in-progress', NULL, 'Stat read requested')
    `);

    // Seed Report Templates (15+)
    await client.query(`
      INSERT INTO report_templates (name, modality, body_part, template_text, sections, category, is_default, usage_count, status) VALUES
      ('Chest X-Ray Normal', 'XR', 'Chest', 'CHEST X-RAY\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nFINDINGS:\nHeart: Normal size and configuration.\nLungs: Clear bilaterally. No focal consolidation, pleural effusion, or pneumothorax.\nMediastinum: Normal. No lymphadenopathy.\nBones: No acute osseous abnormality.\n\nIMPRESSION:\nNo acute cardiopulmonary abnormality.', '{"sections": ["indication", "comparison", "findings", "impression"]}', 'chest', true, 342, 'active'),
      ('CT Head Without Contrast', 'CT', 'Head', 'CT HEAD WITHOUT CONTRAST\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nTECHNIQUE: Non-contrast CT of the head.\n\nFINDINGS:\nBrain parenchyma: No acute hemorrhage, mass, or territorial infarction.\nVentricles: Normal in size and configuration.\nExtra-axial spaces: No subdural or epidural hematoma.\nMidline structures: No shift.\nBony structures: No acute fracture.\n\nIMPRESSION:\nNo acute intracranial abnormality.', '{"sections": ["indication", "comparison", "technique", "findings", "impression"]}', 'neuro', true, 289, 'active'),
      ('MRI Brain With and Without Contrast', 'MR', 'Brain', 'MRI BRAIN WITH AND WITHOUT CONTRAST\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nTECHNIQUE: Multiplanar MRI of the brain with and without gadolinium.\n\nFINDINGS:\nBrain parenchyma: [findings]\nEnhancement: [enhancement]\nDiffusion: No restricted diffusion.\nVentricles: [ventricles]\nExtra-axial spaces: [extra-axial]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "technique", "findings", "impression"]}', 'neuro', false, 198, 'active'),
      ('CT Chest With Contrast', 'CT', 'Chest', 'CT CHEST WITH CONTRAST\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nTECHNIQUE: Contrast-enhanced CT of the chest.\n\nFINDINGS:\nLungs: [lung findings]\nMediastinum: [mediastinal findings]\nHeart: [cardiac findings]\nPleura: [pleural findings]\nBones: [osseous findings]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "technique", "findings", "impression"]}', 'chest', false, 267, 'active'),
      ('Screening Mammogram', 'MG', 'Breast', 'SCREENING MAMMOGRAM\n\nCLINICAL INDICATION: Annual screening\n\nCOMPARISON: [prior studies]\n\nBREAST COMPOSITION: [density]\n\nFINDINGS:\nRight breast: [right findings]\nLeft breast: [left findings]\nAxillary regions: [axillary findings]\n\nIMPRESSION:\nBIRADS [category]: [assessment]\n\nRECOMMENDATION: [recommendation]', '{"sections": ["indication", "comparison", "composition", "findings", "impression", "recommendation"]}', 'breast', true, 456, 'active'),
      ('Abdominal Ultrasound', 'US', 'Abdomen', 'ABDOMINAL ULTRASOUND\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nFINDINGS:\nLiver: [liver]\nGallbladder: [gallbladder]\nBile ducts: [bile ducts]\nPancreas: [pancreas]\nSpleen: [spleen]\nKidneys: [kidneys]\nAorta: [aorta]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "findings", "impression"]}', 'abdomen', true, 312, 'active'),
      ('MRI Lumbar Spine', 'MR', 'Spine', 'MRI LUMBAR SPINE WITHOUT CONTRAST\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nFINDINGS:\nAlignment: [alignment]\nVertebral bodies: [vertebral]\nDisc spaces:\n  L1-L2: [l1l2]\n  L2-L3: [l2l3]\n  L3-L4: [l3l4]\n  L4-L5: [l4l5]\n  L5-S1: [l5s1]\nSpinal canal: [canal]\nConus medullaris: [conus]\nParaspinal soft tissues: [soft tissues]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "findings", "impression"]}', 'spine', true, 178, 'active'),
      ('CT Abdomen and Pelvis', 'CT', 'Abdomen/Pelvis', 'CT ABDOMEN AND PELVIS WITH CONTRAST\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nFINDINGS:\nLiver: [liver]\nGallbladder: [gallbladder]\nPancreas: [pancreas]\nSpleen: [spleen]\nAdrenal glands: [adrenals]\nKidneys: [kidneys]\nBowel: [bowel]\nLymph nodes: [nodes]\nPelvic organs: [pelvis]\nBones: [bones]\nVascular: [vascular]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "findings", "impression"]}', 'abdomen', true, 389, 'active'),
      ('MRI Knee', 'MR', 'Knee', 'MRI OF THE KNEE WITHOUT CONTRAST\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nFINDINGS:\nACL: [acl]\nPCL: [pcl]\nMCL: [mcl]\nLCL: [lcl]\nMedial meniscus: [medial meniscus]\nLateral meniscus: [lateral meniscus]\nArticular cartilage: [cartilage]\nBone marrow: [marrow]\nJoint effusion: [effusion]\nExtensor mechanism: [extensor]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "findings", "impression"]}', 'msk', true, 223, 'active'),
      ('CTA Pulmonary Embolism', 'CTA', 'Chest', 'CT ANGIOGRAPHY OF THE CHEST - PE PROTOCOL\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nTECHNIQUE: CTA chest with PE protocol.\n\nFINDINGS:\nPulmonary arteries: [pa findings]\nRight heart: [right heart]\nLungs: [lung findings]\nMediastinum: [mediastinal]\nPleura: [pleural]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "technique", "findings", "impression"]}', 'chest', false, 156, 'active'),
      ('Thyroid Ultrasound', 'US', 'Thyroid', 'THYROID ULTRASOUND\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nFINDINGS:\nRight lobe: [right] cm. [right findings]\nLeft lobe: [left] cm. [left findings]\nIsthmus: [isthmus] cm. [isthmus findings]\nCervical lymph nodes: [nodes]\n\nTIRADS CLASSIFICATION:\n[tirads]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "findings", "tirads", "impression"]}', 'neck', true, 134, 'active'),
      ('PET/CT Oncology', 'PT', 'Whole Body', 'PET/CT WHOLE BODY\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nRADIOTRACER: FDG [dose] mCi IV\n\nBLOOD GLUCOSE: [glucose] mg/dL\n\nFINDINGS:\nHead/Neck: [head neck]\nChest: [chest]\nAbdomen/Pelvis: [abdomen pelvis]\nMusculoskeletal: [msk]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "comparison", "radiotracer", "findings", "impression"]}', 'nuclear', false, 98, 'active'),
      ('MRI Shoulder', 'MR', 'Shoulder', 'MRI OF THE SHOULDER WITHOUT CONTRAST\n\nCLINICAL INDICATION: [indication]\n\nFINDINGS:\nRotator cuff:\n  Supraspinatus: [supraspinatus]\n  Infraspinatus: [infraspinatus]\n  Subscapularis: [subscapularis]\n  Teres minor: [teres]\nBiceps tendon: [biceps]\nLabrum: [labrum]\nAC joint: [ac joint]\nBone marrow: [marrow]\nEffusion: [effusion]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "findings", "impression"]}', 'msk', false, 145, 'active'),
      ('DEXA Bone Density', 'DX', 'Spine/Hip', 'DEXA BONE DENSITY SCAN\n\nCLINICAL INDICATION: [indication]\n\nCOMPARISON: [comparison]\n\nFINDINGS:\nLumbar Spine (L1-L4):\n  BMD: [bmd] g/cm²\n  T-score: [t-score]\n\nLeft Femoral Neck:\n  BMD: [bmd] g/cm²\n  T-score: [t-score]\n\nLeft Total Hip:\n  BMD: [bmd] g/cm²\n  T-score: [t-score]\n\nFRACTURE RISK: [risk assessment]\n\nIMPRESSION:\n[impression]\n\nRECOMMENDATION: [recommendation]', '{"sections": ["indication", "comparison", "findings", "risk", "impression", "recommendation"]}', 'bone', true, 87, 'active'),
      ('CT Coronary Calcium Score', 'CT', 'Heart', 'CT CORONARY CALCIUM SCORING\n\nCLINICAL INDICATION: [indication]\n\nTECHNIQUE: ECG-gated non-contrast CT of the heart.\n\nFINDINGS:\nLeft Main: [lm] Agatston units\nLAD: [lad] Agatston units\nCircumflex: [cx] Agatston units\nRCA: [rca] Agatston units\n\nTOTAL AGATSTON SCORE: [total]\nPERCENTILE: [percentile] for age and gender\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "technique", "findings", "impression"]}', 'cardiac', false, 76, 'active'),
      ('Renal Ultrasound', 'US', 'Kidneys', 'RENAL ULTRASOUND\n\nCLINICAL INDICATION: [indication]\n\nFINDINGS:\nRight kidney: [right size] cm. [right findings]\nLeft kidney: [left size] cm. [left findings]\nBladder: [bladder findings]\nHydronephrosis: [hydro]\n\nIMPRESSION:\n[impression]', '{"sections": ["indication", "findings", "impression"]}', 'abdomen', false, 112, 'active')
    `);

    // Seed Reports (15+)
    await client.query(`
      INSERT INTO reports (study_id, radiologist_id, template_id, content, impression, findings, recommendations, critical_finding, ai_generated, ai_confidence, status, signed_at) VALUES
      (1, 1, 2, 'CT HEAD WITHOUT CONTRAST\n\nCLINICAL INDICATION: Chronic headaches, rule out mass\n\nCOMPARISON: None available.\n\nTECHNIQUE: Non-contrast CT of the head.\n\nFINDINGS:\nBrain parenchyma: No acute hemorrhage, mass, or territorial infarction. Mild generalized cerebral atrophy appropriate for age.\nVentricles: Normal in size and configuration.\nExtra-axial spaces: No subdural or epidural hematoma.\nMidline structures: No shift.\nBony structures: No acute fracture. Mild mucosal thickening in the maxillary sinuses.\n\nIMPRESSION:\n1. No acute intracranial abnormality.\n2. Mild age-related cerebral atrophy.\n3. Incidental maxillary sinus mucosal thickening.', 'No acute intracranial abnormality. Mild age-related cerebral atrophy.', 'No acute hemorrhage, mass, or territorial infarction. Mild generalized cerebral atrophy.', 'Consider MRI brain if symptoms persist. ENT referral for sinus symptoms if present.', false, false, NULL, 'signed', '2024-10-01 10:30:00'),
      (2, 3, 5, 'SCREENING MAMMOGRAM\n\nCLINICAL INDICATION: Annual screening. History of BRCA1+.\n\nCOMPARISON: Mammogram dated 10/2023.\n\nBREAST COMPOSITION: Heterogeneously dense (Category C)\n\nFINDINGS:\nRight breast: No suspicious masses, calcifications, or architectural distortion.\nLeft breast: No suspicious masses, calcifications, or architectural distortion.\nAxillary regions: No suspicious lymphadenopathy.\n\nIMPRESSION:\nBIRADS 1: Negative bilateral mammogram.\n\nRECOMMENDATION: Continue annual screening. Consider supplemental MRI given BRCA1+ status and dense breast tissue.', 'BIRADS 1: Negative. No suspicious findings.', 'No suspicious masses, calcifications, or architectural distortion bilaterally.', 'Annual screening mammogram. Supplemental breast MRI recommended given BRCA1+ status.', false, false, NULL, 'signed', '2024-10-01 12:00:00'),
      (3, 9, 1, 'CHEST X-RAY PA AND LATERAL\n\nCLINICAL INDICATION: Cough and fever x 5 days. Rule out pneumonia.\n\nCOMPARISON: None available.\n\nFINDINGS:\nHeart: Normal size.\nLungs: Right lower lobe consolidation with air bronchograms consistent with pneumonia. No pleural effusion.\nMediastinum: Normal.\nBones: No acute fracture.\n\nIMPRESSION:\n1. Right lower lobe pneumonia.\n2. No pleural effusion or pneumothorax.', 'Right lower lobe pneumonia. No complications.', 'Right lower lobe consolidation with air bronchograms.', 'Antibiotic therapy. Follow-up chest X-ray in 4-6 weeks to confirm resolution.', false, false, NULL, 'signed', '2024-10-02 09:00:00'),
      (4, 2, 9, 'MRI RIGHT KNEE WITHOUT CONTRAST\n\nCLINICAL INDICATION: Right knee pain after fall.\n\nCOMPARISON: None.\n\nFINDINGS:\nACL: Complete tear with retraction of the proximal stump. Bone bruise pattern in lateral femoral condyle and posterior lateral tibial plateau.\nPCL: Intact.\nMCL: Mild sprain, grade 1.\nLCL: Intact.\nMedial meniscus: Complex tear involving the body and posterior horn.\nLateral meniscus: Intact.\nArticular cartilage: Grade 2 chondromalacia patella.\nBone marrow: Bone bruises as described.\nJoint effusion: Moderate.\n\nIMPRESSION:\n1. Complete ACL tear with characteristic bone bruise pattern.\n2. Complex medial meniscus tear.\n3. Grade 1 MCL sprain.\n4. Moderate joint effusion.', 'Complete ACL tear. Complex medial meniscus tear. MCL sprain.', 'Complete ACL tear, complex medial meniscus tear, grade 1 MCL sprain.', 'Orthopedic surgery consultation for ACL reconstruction and meniscus repair.', false, false, NULL, 'signed', '2024-10-02 16:00:00'),
      (5, 5, 8, 'CT ABDOMEN AND PELVIS WITH CONTRAST\n\nCLINICAL INDICATION: Abdominal pain, elevated lipase 1200.\n\nFINDINGS:\nPancreas: Diffusely enlarged and edematous pancreas with peripancreatic fat stranding and fluid. No pancreatic necrosis identified. No pseudocyst. Modified CT Severity Index: 4.\nLiver: Normal.\nGallbladder: No gallstones. No wall thickening.\nKidneys: Normal bilaterally.\nBowel: No obstruction.\n\nIMPRESSION:\n1. Acute interstitial pancreatitis without necrosis (CTSI 4).\n2. Peripancreatic fluid collections.\n3. No biliary etiology identified.', 'Acute interstitial pancreatitis without necrosis.', 'Diffusely enlarged, edematous pancreas with peripancreatic fluid.', 'ICU admission. NPO with IV fluids. Follow-up imaging if clinical deterioration.', true, false, NULL, 'signed', '2024-10-03 12:00:00'),
      (6, 4, 10, 'CT ANGIOGRAPHY OF THE CHEST - PE PROTOCOL\n\nCLINICAL INDICATION: Chest pain, elevated troponin, D-dimer positive.\n\nFINDINGS:\nPulmonary arteries: No filling defect to suggest pulmonary embolism. Main PA diameter 28mm (normal).\nRight heart: Normal size.\nLungs: Clear. No consolidation.\nMediastinum: Extensive coronary artery calcifications involving LAD, circumflex, and RCA.\nPleura: No effusion.\n\nIMPRESSION:\n1. No pulmonary embolism.\n2. Extensive coronary artery calcifications suggesting significant atherosclerotic disease.', 'No pulmonary embolism. Extensive coronary calcifications.', 'No PE. Extensive coronary calcifications in LAD, circumflex, RCA.', 'Cardiology consultation for coronary artery disease evaluation.', false, false, NULL, 'signed', '2024-10-03 17:00:00'),
      (7, 5, 16, 'RENAL ULTRASOUND\n\nCLINICAL INDICATION: Right flank pain, hematuria.\n\nFINDINGS:\nRight kidney: 11.2 cm. Mild hydronephrosis. 6mm echogenic focus at the right ureterovesical junction consistent with obstructing calculus.\nLeft kidney: 11.0 cm. Normal echogenicity. No hydronephrosis or stones.\nBladder: Partially distended. No mass.\n\nIMPRESSION:\n1. 6mm obstructing right UVJ calculus with mild hydronephrosis.\n2. Normal left kidney.', '6mm obstructing right UVJ stone with mild hydronephrosis.', '6mm stone at right UVJ, mild right hydronephrosis.', 'Urology referral. Consider CT KUB for additional stone burden assessment.', false, false, NULL, 'signed', '2024-10-04 11:00:00'),
      (8, 7, 6, 'PELVIC ULTRASOUND\n\nCLINICAL INDICATION: Pelvic pain, irregular bleeding.\n\nFINDINGS:\nUterus: Normal size and echogenicity. Endometrial thickness 8mm.\nRight ovary: Normal, 3.2 x 2.1 cm.\nLeft ovary: 4.0 cm complex cyst with internal echoes and thin septation. No solid component. No internal vascularity.\nFree fluid: Small amount in cul-de-sac.\n\nIMPRESSION:\n1. 4 cm complex left ovarian cyst, likely hemorrhagic cyst.\n2. Small pelvic free fluid.\n3. Normal uterus and right ovary.', '4cm complex left ovarian cyst, likely hemorrhagic.', '4cm complex left ovarian cyst with internal echoes.', 'Follow-up ultrasound in 6-8 weeks. OB/GYN consultation.', false, false, NULL, 'signed', '2024-10-04 14:30:00'),
      (9, 4, 4, 'CT CHEST LOW DOSE - LUNG CANCER SCREENING\n\nCLINICAL INDICATION: Lung cancer screening. 60M, 30 pack-year smoking history.\n\nCOMPARISON: None.\n\nFINDINGS:\n15mm spiculated nodule in the right upper lobe (series 3, image 45). Multiple additional sub-5mm nodules bilaterally. No lymphadenopathy. No pleural effusion.\n\nLung-RADS 4B: Suspicious finding.\n\nIMPRESSION:\n1. CRITICAL FINDING: 15mm spiculated RUL nodule highly suspicious for malignancy (Lung-RADS 4B).\n2. Scattered sub-5mm nodules, likely benign.', 'CRITICAL: 15mm spiculated RUL nodule, Lung-RADS 4B. Highly suspicious for malignancy.', '15mm spiculated RUL nodule. Multiple sub-5mm nodules.', 'URGENT: PET/CT recommended. Pulmonology/thoracic surgery referral. Tissue sampling.', true, false, NULL, 'signed', '2024-10-05 09:30:00'),
      (10, 16, 7, 'MRI LUMBAR SPINE WITHOUT CONTRAST\n\nCLINICAL INDICATION: Chronic low back pain radiating to left leg.\n\nFINDINGS:\nAlignment: Normal lordosis maintained.\nVertebral bodies: Normal signal and height.\nL4-L5: Large left paracentral disc herniation compressing the left S1 nerve root. Moderate central canal stenosis.\nL5-S1: Mild disc bulge. No significant stenosis.\nOther levels: Unremarkable.\nConus: Normal, terminates at L1.\n\nIMPRESSION:\n1. Large L4-L5 left paracentral disc herniation with left S1 nerve root compression.\n2. Moderate central canal stenosis at L4-L5.', 'Large L4-L5 disc herniation with S1 nerve root compression.', 'L4-L5 left paracentral disc herniation, moderate stenosis.', 'Neurosurgery consultation. Consider epidural steroid injection vs surgical decompression.', false, false, NULL, 'signed', '2024-10-05 12:00:00'),
      (11, 14, 6, 'PROSTATE ULTRASOUND\n\nCLINICAL INDICATION: Elevated PSA 8.2, rule out mass.\n\nFINDINGS:\nProstate: Enlarged, volume 45cc. Heterogeneous echotexture.\nSuspicious hypoechoic lesion in the right peripheral zone measuring 1.5cm.\nSeminal vesicles: Normal.\nBladder: No mass. Mild post-void residual.\n\nIMPRESSION:\n1. Enlarged prostate (45cc) with suspicious peripheral zone lesion.\n2. Recommend multiparametric MRI for further characterization (PIRADS assessment).', 'Enlarged prostate with suspicious lesion. MRI recommended.', 'Enlarged prostate 45cc, 1.5cm hypoechoic lesion right peripheral zone.', 'Multiparametric prostate MRI. Urology referral for possible biopsy.', false, false, NULL, 'signed', '2024-10-06 10:30:00'),
      (12, 13, 11, 'THYROID ULTRASOUND\n\nCLINICAL INDICATION: Palpable thyroid nodule.\n\nFINDINGS:\nRight lobe: 5.2 x 2.1 x 1.8 cm. Solid hypoechoic nodule measuring 2.3 x 1.8 x 1.5 cm with irregular margins and punctate echogenic foci (microcalcifications). Increased vascularity.\nLeft lobe: 4.8 x 1.9 x 1.7 cm. 6mm colloid cyst.\nIsthmus: 3mm. Normal.\nCervical lymph nodes: Mildly prominent right level III node, 1.2cm.\n\nTIRADS: TR5 (Highly Suspicious)\n\nIMPRESSION:\n1. TIRADS 5 right thyroid nodule (2.3cm) - highly suspicious for malignancy.\n2. Mildly prominent right cervical lymph node.\n3. Benign left thyroid cyst.', 'TIRADS 5 right thyroid nodule, highly suspicious. FNA recommended.', '2.3cm solid hypoechoic nodule with microcalcifications, TIRADS 5.', 'FNA biopsy of right thyroid nodule. Consider FNA of right level III lymph node.', false, false, NULL, 'signed', '2024-10-06 13:00:00'),
      (13, 4, 8, 'CT ANGIOGRAPHY ABDOMEN\n\nCLINICAL INDICATION: AAA surveillance.\n\nCOMPARISON: CTA abdomen 4/2024 showing 5.2cm infrarenal AAA.\n\nFINDINGS:\nInfrarenal abdominal aortic aneurysm measuring 5.8cm (previously 5.2cm). Mural thrombus present. No evidence of rupture or dissection. Iliac arteries: Normal caliber.\n\nIMPRESSION:\nCRITICAL FINDING:\n1. Infrarenal AAA now 5.8cm, increased from 5.2cm (6 months ago). Growth rate exceeds 1cm/year.\n2. Exceeds 5.5cm threshold for surgical intervention.\n3. No evidence of rupture.', 'CRITICAL: AAA 5.8cm, rapid growth. Exceeds surgical threshold.', 'Infrarenal AAA 5.8cm, increased from 5.2cm in 6 months.', 'URGENT: Vascular surgery referral for elective repair. Consider EVAR vs open repair.', true, false, NULL, 'signed', '2024-10-07 09:00:00'),
      (3, 9, 1, 'AI-GENERATED FOLLOW-UP REPORT\n\nThis follow-up report was generated using AI analysis of the original findings.\n\nOriginal Finding: Right lower lobe pneumonia\nAI Assessment: Based on the clinical presentation and imaging findings, community-acquired pneumonia is the most likely diagnosis. The consolidation pattern with air bronchograms is characteristic.\n\nAI Confidence: 94.5%', 'AI-assisted analysis confirms right lower lobe pneumonia diagnosis.', 'Consolidation pattern consistent with community-acquired pneumonia.', 'Complete antibiotic course. Follow-up imaging in 4-6 weeks.', false, true, 94.5, 'draft', NULL),
      (9, 4, 4, 'AI-GENERATED RISK ASSESSMENT\n\nAI Analysis of Lung Nodule:\nSize: 15mm\nMorphology: Spiculated\nLocation: Right upper lobe\n\nAI Risk Assessment:\n- Probability of malignancy: 89.2%\n- Recommended next step: PET/CT within 2 weeks\n- Differential: Primary lung adenocarcinoma (most likely), metastasis, granuloma\n\nAI Confidence: 89.2%', 'AI analysis: 89.2% probability of malignancy for RUL nodule.', 'AI-assessed spiculated nodule characteristics suggest high malignancy risk.', 'Urgent PET/CT. Multidisciplinary tumor board discussion.', true, true, 89.2, 'draft', NULL)
    `);

    // Seed Billing Codes (15+)
    await client.query(`
      INSERT INTO billing_codes (cpt_code, description, modality, body_part, base_price, rvu, category, requires_contrast, professional_component, technical_component, status) VALUES
      ('71046', 'Chest X-Ray 2 views', 'XR', 'Chest', 145.00, 0.31, 'diagnostic', false, 28.00, 117.00, 'active'),
      ('70553', 'MRI Brain with and without contrast', 'MR', 'Brain', 2850.00, 5.56, 'diagnostic', true, 550.00, 2300.00, 'active'),
      ('70551', 'MRI Brain without contrast', 'MR', 'Brain', 2200.00, 4.20, 'diagnostic', false, 420.00, 1780.00, 'active'),
      ('74178', 'CT Abdomen and Pelvis with contrast', 'CT', 'Abdomen/Pelvis', 1650.00, 3.50, 'diagnostic', true, 320.00, 1330.00, 'active'),
      ('73721', 'MRI Knee without contrast', 'MR', 'Knee', 1800.00, 3.76, 'diagnostic', false, 360.00, 1440.00, 'active'),
      ('77067', 'Screening Mammogram bilateral', 'MG', 'Breast', 285.00, 1.30, 'screening', false, 65.00, 220.00, 'active'),
      ('76856', 'Pelvic Ultrasound complete', 'US', 'Pelvis', 425.00, 1.48, 'diagnostic', false, 95.00, 330.00, 'active'),
      ('71275', 'CTA Chest PE Protocol', 'CTA', 'Chest', 1950.00, 4.18, 'diagnostic', true, 380.00, 1570.00, 'active'),
      ('78816', 'PET/CT Whole Body', 'PT', 'Whole Body', 4500.00, 7.25, 'diagnostic', false, 850.00, 3650.00, 'active'),
      ('72148', 'MRI Lumbar Spine without contrast', 'MR', 'Spine', 1750.00, 3.54, 'diagnostic', false, 340.00, 1410.00, 'active'),
      ('76536', 'Thyroid Ultrasound', 'US', 'Thyroid', 350.00, 1.15, 'diagnostic', false, 75.00, 275.00, 'active'),
      ('77080', 'DEXA Bone Density', 'DX', 'Spine/Hip', 275.00, 0.65, 'screening', false, 55.00, 220.00, 'active'),
      ('75571', 'CT Coronary Calcium Score', 'CT', 'Heart', 350.00, 1.05, 'screening', false, 70.00, 280.00, 'active'),
      ('74177', 'CT Abdomen with contrast', 'CT', 'Abdomen', 1250.00, 2.85, 'diagnostic', true, 245.00, 1005.00, 'active'),
      ('73222', 'MRI Shoulder with and without contrast', 'MR', 'Shoulder', 2100.00, 4.35, 'diagnostic', true, 410.00, 1690.00, 'active'),
      ('76770', 'Renal Ultrasound complete', 'US', 'Kidneys', 380.00, 1.25, 'diagnostic', false, 80.00, 300.00, 'active')
    `);

    // Seed Audit Logs (15+)
    await client.query(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, created_at) VALUES
      (1, 'LOGIN', 'user', 1, '{"method": "password"}', '192.168.1.100', '2024-10-01 08:00:00'),
      (2, 'CREATE', 'report', 1, '{"study_id": 1, "status": "draft"}', '192.168.1.101', '2024-10-01 09:30:00'),
      (2, 'SIGN', 'report', 1, '{"status": "signed"}', '192.168.1.101', '2024-10-01 10:30:00'),
      (2, 'VIEW', 'patient', 1, '{"action": "viewed patient record"}', '192.168.1.101', '2024-10-01 09:00:00'),
      (1, 'CREATE', 'patient', 3, '{"mrn": "MRN003"}', '192.168.1.100', '2024-10-02 07:50:00'),
      (2, 'CREATE', 'report', 3, '{"study_id": 3, "status": "draft"}', '192.168.1.102', '2024-10-02 08:30:00'),
      (2, 'CRITICAL_FINDING', 'report', 9, '{"finding": "Lung-RADS 4B", "notified": "Dr. Smith"}', '192.168.1.101', '2024-10-05 09:00:00'),
      (1, 'UPDATE', 'patient', 6, '{"field": "insurance_id", "old": "MC-005", "new": "MC-006"}', '192.168.1.100', '2024-10-03 14:00:00'),
      (2, 'AI_GENERATE', 'report', 14, '{"model": "claude-haiku", "confidence": 94.5}', '192.168.1.101', '2024-10-05 15:00:00'),
      (1, 'DELETE', 'template', 99, '{"reason": "duplicate template"}', '192.168.1.100', '2024-10-04 16:00:00'),
      (2, 'SIGN', 'report', 10, '{"status": "signed"}', '192.168.1.101', '2024-10-05 12:00:00'),
      (1, 'EXPORT', 'report', 5, '{"format": "PDF"}', '192.168.1.100', '2024-10-03 13:00:00'),
      (2, 'CRITICAL_FINDING', 'report', 13, '{"finding": "AAA 5.8cm", "notified": "Vascular Surgery"}', '192.168.1.101', '2024-10-07 09:00:00'),
      (3, 'LOGIN', 'user', 3, '{"method": "password"}', '192.168.1.103', '2024-10-06 07:00:00'),
      (1, 'UPDATE', 'radiologist', 15, '{"field": "status", "old": "active", "new": "on-leave"}', '192.168.1.100', '2024-10-07 08:00:00'),
      (2, 'AI_GENERATE', 'report', 15, '{"model": "claude-haiku", "confidence": 89.2}', '192.168.1.101', '2024-10-07 10:00:00')
    `);

    await client.query('COMMIT');
    console.log('Database seeded successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
