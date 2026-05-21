require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('./db');

async function migrate() {
  console.log('Running migrations...');

  // ai_analyses table
  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_analyses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      endpoint VARCHAR(100) NOT NULL,
      input_data JSONB DEFAULT '{}',
      result TEXT,
      model VARCHAR(100),
      tokens_used INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('Created ai_analyses table');

  // Add signed_by, parent_report_id, amendment_reason to reports
  const cols = [
    ['signed_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL'],
    ['parent_report_id', 'INTEGER REFERENCES reports(id) ON DELETE SET NULL'],
    ['amendment_reason', 'TEXT'],
  ];
  for (const [col, def] of cols) {
    await db.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS ${col} ${def}`).catch(e => console.log(`Note: ${e.message}`));
  }
  console.log('Added report columns: signed_by, parent_report_id, amendment_reason');

  // Add image columns to studies
  await db.query(`ALTER TABLE studies ADD COLUMN IF NOT EXISTS image_path TEXT`).catch(() => {});
  await db.query(`ALTER TABLE studies ADD COLUMN IF NOT EXISTS image_filename TEXT`).catch(() => {});
  console.log('Added image columns to studies');

  // Add ip_address to audit_logs
  await db.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)`).catch(() => {});
  await db.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(50)`).catch(() => {});
  await db.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id INTEGER`).catch(() => {});
  await db.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'`).catch(() => {});
  console.log('Updated audit_logs columns');

  // paid_features table — direct-to-consumer AI add-on entitlements (F6 / SimonMed)
  await db.query(`
    CREATE TABLE IF NOT EXISTS paid_features (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      feature VARCHAR(100) NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      stripe_session_id VARCHAR(255),
      amount_cents INTEGER,
      currency VARCHAR(10) DEFAULT 'USD',
      activated_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_paid_features_user_feature ON paid_features(user_id, feature) WHERE status = 'active'`).catch(() => {});
  console.log('Created paid_features table (DTC add-ons)');

  console.log('Migrations complete!');
  process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
