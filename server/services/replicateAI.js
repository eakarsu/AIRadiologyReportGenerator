// Replicate API client — runs real medical-AI models (classifiers, segmenters)
// alongside the LLM narrative layer.
//
// Env config:
//   REPLICATE_API_TOKEN          required to call the API
//   REPLICATE_TRAUMA_XRAY_MODEL  model identifier in "owner/name:version" form
//                                (or just "owner/name" — we'll resolve latest)
//   REPLICATE_TIMEOUT_MS         max time to poll (default 60000)
//
// Graceful: if REPLICATE_API_TOKEN is unset, runReplicateModel returns
// { skipped: true, reason: 'no_token' } so the calling endpoint continues
// with just the LLM narrative.

const https = require('https');

const API_HOST = 'api.replicate.com';
const POLL_INTERVAL_MS = 1500;

function httpRequest(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const parsed = buf ? JSON.parse(buf) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: { raw: buf, parseError: e.message } });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function resolveLatestVersion(modelSlug, token) {
  const res = await httpRequest('GET', `/v1/models/${modelSlug}`, { Authorization: `Token ${token}` });
  if (res.status !== 200) throw new Error(`Model ${modelSlug} lookup failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`);
  const version = res.body.latest_version?.id;
  if (!version) throw new Error(`Model ${modelSlug} has no latest_version`);
  return version;
}

// Run a Replicate model end-to-end (create prediction, poll until terminal,
// return output). `modelRef` is "owner/name:version" or "owner/name".
async function runReplicateModel(modelRef, input, opts = {}) {
  const token = opts.token || process.env.REPLICATE_API_TOKEN;
  if (!token) return { skipped: true, reason: 'no_token' };

  const timeoutMs = parseInt(process.env.REPLICATE_TIMEOUT_MS, 10) || 60000;
  const startedAt = Date.now();

  let versionId;
  if (modelRef.includes(':')) {
    versionId = modelRef.split(':')[1];
  } else {
    versionId = await resolveLatestVersion(modelRef, token);
  }

  // Create prediction
  const create = await httpRequest('POST', '/v1/predictions', { Authorization: `Token ${token}` }, {
    version: versionId,
    input,
  });
  if (create.status !== 201 && create.status !== 200) {
    return { error: `Replicate create failed (HTTP ${create.status})`, details: create.body };
  }
  const predictionId = create.body.id;

  // Poll
  while (Date.now() - startedAt < timeoutMs) {
    const poll = await httpRequest('GET', `/v1/predictions/${predictionId}`, { Authorization: `Token ${token}` });
    if (poll.status !== 200) {
      return { error: `Replicate poll failed (HTTP ${poll.status})`, details: poll.body };
    }
    const { status, output, error, metrics, logs } = poll.body;
    if (status === 'succeeded') {
      return { ok: true, output, metrics, prediction_id: predictionId, model_ref: modelRef };
    }
    if (status === 'failed' || status === 'canceled') {
      return { error: `Replicate prediction ${status}`, details: error || logs, prediction_id: predictionId };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { error: 'Replicate prediction timed out', timeout_ms: timeoutMs, prediction_id: predictionId };
}

module.exports = { runReplicateModel, resolveLatestVersion };
