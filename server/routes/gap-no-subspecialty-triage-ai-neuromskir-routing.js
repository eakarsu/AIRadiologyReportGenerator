// // === Batch 07 Gaps & Frontend Mounts ===
const express = require('express');
const router = express.Router();

const FEATURE_SLUG = 'no-subspecialty-triage-ai-neuromskir-routing';
const FEATURE_TITLE = 'No subspecialty triage AI (neuro/MSK/IR routing)';
const PROJECT = 'AIRadiologyReportGenerator';

async function ensureGapTable(pool) {
  if (!pool) return;
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS gap_features (
      id SERIAL PRIMARY KEY,
      slug TEXT,
      title TEXT,
      project TEXT,
      input JSONB,
      output JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) { /* silent */ }
}

async function logGap(pool, input, output) {
  if (!pool) return;
  try {
    await pool.query(
      'INSERT INTO gap_features(slug,title,project,input,output) VALUES($1,$2,$3,$4,$5)',
      [FEATURE_SLUG, FEATURE_TITLE, PROJECT, JSON.stringify(input || null), JSON.stringify(output || null)]
    );
  } catch (e) { /* silent */ }
}

async function callLLM(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { note: 'OPENROUTER_API_KEY not set; returning mock', mock: true, prompt: prompt.slice(0, 400) };
  }
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You implement the ' + PROJECT + ' feature: ' + FEATURE_TITLE + '. Respond with concise JSON when possible.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('LLM ' + resp.status + ': ' + text.slice(0, 200));
  }
  const data = await resp.json();
  return { model: data.model, content: (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data };
}

router.get('/', (req, res) => {
  res.json({ ok: true, slug: FEATURE_SLUG, title: FEATURE_TITLE, project: PROJECT });
});

router.post('/', async (req, res) => {
  try {
    const pool = (req.app && req.app.locals && req.app.locals.pool) || null;
    await ensureGapTable(pool);
    const input = (req.body && req.body.input) != null ? req.body.input : '';
    const prompt = 'Feature: ' + FEATURE_TITLE + '\nProject: ' + PROJECT + '\nUser input:\n' + (typeof input === 'string' ? input : JSON.stringify(input));
    const output = await callLLM(prompt);
    await logGap(pool, input, output);
    res.json({ ok: true, slug: FEATURE_SLUG, title: FEATURE_TITLE, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e && e.message) || 'Server error' });
  }
});

module.exports = router;
