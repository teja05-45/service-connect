// backend/src/utils/logger.js
//
// Minimal structured logger (one JSON object per line). Keeps the project
// dependency-free while making container logs greppable and parseable.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const activeLevel = LEVELS[configuredLevel] === undefined ? LEVELS.info : LEVELS[configuredLevel];

const write = (level, message, meta) => {
    if (LEVELS[level] > activeLevel) return;
    const entry = {
        time: new Date().toISOString(),
        level,
        message: typeof message === 'string' ? message : String(message),
        ...(meta && typeof meta === 'object' ? meta : {}),
    };
    const line = `${JSON.stringify(entry)}\n`;
    if (level === 'error') process.stderr.write(line);
    else process.stdout.write(line);
};

const logger = {
    error: (message, meta) => write('error', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    info: (message, meta) => write('info', message, meta),
    debug: (message, meta) => write('debug', message, meta),
};

let requestCounter = 0;

/** Request logger: one line per completed request with timing and status. */
const requestLogger = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    requestCounter = (requestCounter + 1) % 1_000_000;
    req.id = `req-${Date.now().toString(36)}-${requestCounter}`;

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        logger.info('http_request', {
            requestId: req.id,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Math.round(durationMs * 10) / 10,
        });
    });

    next();
};

module.exports = { logger, requestLogger };
