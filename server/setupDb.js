require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL.replace('/radiology_reports', '/postgres')
});

async function setupDb() {
  try {
    const res = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = 'radiology_reports'");
    if (res.rows.length === 0) {
      await adminPool.query('CREATE DATABASE radiology_reports');
      console.log('Database radiology_reports created');
    } else {
      console.log('Database radiology_reports already exists');
    }
  } catch (err) {
    console.error('Error setting up database:', err.message);
  } finally {
    await adminPool.end();
  }
}

setupDb();
