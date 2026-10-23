const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('server exposes a health endpoint', () => {
  const body = fs.readFileSync(__dirname + '/../server/index.js', 'utf8');
  assert.ok(body.includes('/api/health'), 'health endpoint required');
});

test('no hard-coded secret fallback in server entry', () => {
  const body = fs.readFileSync(__dirname + '/../server/index.js', 'utf8');
  assert.ok(!/process\.env\.(JWT_SECRET|SESSION_SECRET)\s*\|\|\s*['"][^'"]+['"]/.test(body), 'secrets must fail closed');
});
