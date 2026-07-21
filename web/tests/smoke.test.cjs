const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('restored UI boundary contains product workflow and failure handling', () => {
  const appPath = path.join(__dirname, '..', 'src', 'App.js');
  const app = fs.readFileSync(appPath, 'utf8');
  assert.match(app, /AI Radiology Report Generator/);
  assert.match(app, /status: 'loading'/);
  assert.match(app, /status: 'error'/);
  assert.match(app, /Retry connection/);
  assert.ok(app.includes("Open the study worklist"));
  assert.ok(app.includes("Draft a structured report"));
  assert.ok(app.includes("Route critical findings for review"));
});
