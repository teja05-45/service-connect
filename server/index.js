// backend/index.js
//
// Express entrypoint: middleware, route mounting, health endpoint,
// centralized error handling and graceful shutdown.

const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const pool = require('./src/config/db');
const { logger, requestLogger } = require('./src/utils/logger');
const { uploadsDir } = require('./src/config/upload');

const app = express();

app.disable('x-powered-by');
// Required to read the real client IP / protocol behind a reverse proxy.
app.set('trust proxy', 1);

// --- CORS MIDDLEWARE ---
// Comma-separated list, e.g. "http://localhost:3000,https://app.example.com".
// "*" allows any origin (use only for throwaway environments).
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            // Requests without an Origin header (curl, server-to-server, mobile)
            // are allowed; browser cross-origin requests are checked.
            if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }
            logger.warn('cors_origin_rejected', { origin });
            return callback(null, false);
        },
        credentials: true,
    })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(requestLogger);

// --- STATIC FILES (uploaded profile photos, deposit proofs, chat attachments) ---
app.use('/uploads', express.static(uploadsDir, { maxAge: '1d' }));

// --- HEALTH CHECK ---
// Used by Docker/Compose healthchecks and by operators. Returns 503 when the
// database is unreachable so an orchestrator can restart the container.
app.get('/health', async (req, res) => {
    const db = await pool.checkDatabase();
    const status = db.ok ? 'ok' : 'degraded';

    res.status(db.ok ? 200 : 503).json({
        status,
        service: 'service-connect-api',
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        database: {
            status: db.ok ? 'up' : 'down',
            latency_ms: db.latencyMs,
        },
    });
});

// --- ROUTE MOUNTING ---
// 1. Public Routes (server status, /services, /providers, /contact-us)
app.use('/api/v1', require('./src/routes/publicRoutes'));

// 2. Authentication Routes
app.use('/api/v1/auth', require('./src/routes/authRoutes'));

// 3. Shared User/Profile Routes (wallet, unread-messages, profile update)
app.use('/api/v1', require('./src/routes/userRoutes'));

// 4. Booking and Chat Routes
app.use('/api/v1', require('./src/routes/bookingRoutes'));

// 5. Customer Specific Routes
app.use('/api/v1', require('./src/routes/customerRoutes'));

// 6. Provider Specific Routes
app.use('/api/v1', require('./src/routes/providerRoutes'));

// 7. Payment & Review Routes
app.use('/api/v1', require('./src/routes/paymentRoutes'));

// 8. Admin Routes (secured internally by auth + role check)
app.use('/api/v1', require('./src/routes/adminRoutes'));

// --- 404 HANDLER (JSON, after all routes) ---
app.use((req, res) => {
    res.status(404).json({
        error: 'Route not found.',
        method: req.method,
        path: req.originalUrl,
    });
});

// --- CENTRALIZED ERROR HANDLER ---
// Every route still returns its own specific 4xx responses; this catch-all
// prevents HTML stack traces and unhandled promise rejections from leaking.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    let statusCode = err.statusCode || err.status || 500;
    let message = err.message || 'Internal server error.';

    if (err instanceof multer.MulterError) {
        statusCode = 400;
        message =
            err.code === 'LIMIT_FILE_SIZE'
                ? 'File is too large. The maximum size is 5 MB.'
                : `Upload failed: ${err.message}`;
    } else if (err.type === 'entity.parse.failed') {
        statusCode = 400;
        message = 'Request body is not valid JSON.';
    } else if (err.type === 'entity.too.large') {
        statusCode = 413;
        message = 'Request body is too large.';
    }

    logger.error('request_failed', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        status: statusCode,
        error: err.message,
        ...(process.env.NODE_ENV === 'production' ? {} : { stack: err.stack }),
    });

    res.status(statusCode).json({
        error: statusCode >= 500 ? 'Internal server error.' : message,
    });
});

// --- CONFIGURATION VALIDATION ---
const validateEnvironment = () => {
    const problems = [];
    if (!process.env.JWT_SECRET) {
        problems.push('JWT_SECRET is not set. Copy server/.env.example to server/.env and set a value.');
    }
    if (!process.env.DATABASE_URL && !process.env.PG_DATABASE) {
        logger.warn('configuration_warning', {
            hint: 'Neither DATABASE_URL nor PG_DATABASE is set; falling back to defaults from src/config/db.js.',
        });
    }
    if (problems.length > 0) {
        problems.forEach((problem) => logger.error('configuration_error', { problem }));
        process.exit(1);
    }
};

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

let server = null;

const start = () => {
    validateEnvironment();
    server = app.listen(PORT, HOST, () => {
        logger.info('server_started', {
            host: HOST,
            port: PORT,
            environment: process.env.NODE_ENV || 'development',
            uploadsDir,
        });
    });
    server.on('error', (err) => {
        logger.error('server_error', { error: err.message });
        process.exitCode = 1;
    });
};

const shutdown = (signal) => {
    logger.info('shutdown_initiated', { signal });
    const finish = async () => {
        await pool.end().catch(() => {});
        process.exit(0);
    };
    if (server) {
        server.close(finish);
        // Do not hang forever on lingering keep-alive connections.
        const forceExit = setTimeout(() => process.exit(1), 10_000);
        if (typeof forceExit.unref === 'function') forceExit.unref();
    } else {
        finish();
    }
};

['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));

process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_promise_rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});

process.on('uncaughtException', (err) => {
    logger.error('uncaught_exception', { error: err.message, stack: err.stack });
    process.exit(1);
});

if (require.main === module) {
    start();
}

module.exports = app;
module.exports.start = start;
