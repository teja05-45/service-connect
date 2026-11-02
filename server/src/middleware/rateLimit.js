// backend/src/middleware/rateLimit.js
//
// Dependency-free fixed-window rate limiter. Used to slow down credential
// stuffing / OTP brute force on the public auth endpoints. Intended for a
// single-instance deployment; swap for a shared store if you scale out.

const buckets = new Map();

/**
 * @param {object} options
 * @param {number} options.windowMs window length in milliseconds
 * @param {number} options.max requests allowed per window
 * @param {(req: import('express').Request) => string} [options.keyGenerator]
 */
const createRateLimiter = ({ windowMs = 15 * 60 * 1000, max = 10, keyGenerator } = {}) => {
    const keyFor = keyGenerator || ((req) => req.ip);

    return (req, res, next) => {
        const now = Date.now();
        const key = `${req.method}:${req.baseUrl}${req.path}:${keyFor(req)}`;
        const current = buckets.get(key);

        if (!current || current.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        current.count += 1;
        if (current.count > max) {
            const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
            res.set('Retry-After', String(retryAfterSeconds));
            return res.status(429).json({
                error: 'Too many requests. Please wait a moment and try again.',
                retry_after_seconds: retryAfterSeconds,
            });
        }

        return next();
    };
};

// Periodic cleanup so the map cannot grow without bound. unref() keeps the
// timer from holding the process open during tests/shutdown.
const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
    }
}, 5 * 60 * 1000);
if (typeof cleanup.unref === 'function') cleanup.unref();

module.exports = { createRateLimiter, _buckets: buckets };
