// backend/src/config/db.js

const { Pool } = require('pg');
require('dotenv').config();
const { logger } = require('../utils/logger');

// --- DATABASE CONFIGURATION ---
// Either a single DATABASE_URL (convenient for hosted Postgres) or the
// individual PG_* variables (used by local dev and docker-compose).
const connectionConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
          user: process.env.PG_USER || 'postgres',
          host: process.env.PG_HOST || 'localhost',
          database: process.env.PG_DATABASE || 'service_connect',
          password: process.env.PG_PASSWORD || '',
          port: Number(process.env.PG_PORT || 5432),
      };

const pool = new Pool({
    ...connectionConfig,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5_000),
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// Without this listener an error on an idle client (e.g. the database
// restarting) crashes the whole Node process.
pool.on('error', (err) => {
    logger.error('database_idle_client_error', { error: err.message });
});

/**
 * Cheap liveness probe used by /health and the startup check.
 * Never throws: the caller decides how to react.
 */
const checkDatabase = async () => {
    const startedAt = Date.now();
    try {
        await pool.query('SELECT 1');
        return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (err) {
        return { ok: false, latencyMs: Date.now() - startedAt, error: err.message };
    }
};

// Non-fatal startup probe so a still-booting database does not kill the API.
checkDatabase().then((result) => {
    if (result.ok) {
        logger.info('database_connected', { latencyMs: result.latencyMs });
    } else {
        logger.error('database_connection_failed', { error: result.error });
    }
});

module.exports = pool;
module.exports.checkDatabase = checkDatabase;
module.exports.buildConnectionConfig = () => ({ ...connectionConfig });
