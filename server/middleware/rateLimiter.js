const requestCounts = new Map();

function createRateLimiter({ windowMs = 60 * 60 * 1000, max = 20, keyFn = null } = {}) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : (req.user?.id ? `uid:${req.user.id}` : `ip:${req.ip}`);
    const now = Date.now();
    const record = requestCounts.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count += 1;
    requestCounts.set(key, record);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - record.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetAt / 1000));

    if (record.count > max) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil((record.resetAt - now) / 1000)
      });
    }
    next();
  };
}

const aiRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });

module.exports = { createRateLimiter, aiRateLimiter };
