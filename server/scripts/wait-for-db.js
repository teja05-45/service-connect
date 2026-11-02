// backend/scripts/wait-for-db.js
//
// Blocks until PostgreSQL accepts connections (or times out). The compose
// healthcheck already gates startup, but this makes `docker compose up` robust
// even on slow machines and gives local dev a clear error message.

const pool = require('../src/config/db');

const timeoutSeconds = Number(process.env.DB_WAIT_TIMEOUT_SECONDS || 60);
const retryDelayMs = 2000;
const deadline = Date.now() + timeoutSeconds * 1000;

(async () => {
    let attempt = 0;
    for (;;) {
        attempt += 1;
        try {
            await pool.query('SELECT 1');
            console.log(`[wait-for-db] database is ready (attempt ${attempt})`);
            await pool.end();
            process.exit(0);
        } catch (err) {
            if (Date.now() >= deadline) {
                console.error(
                    `[wait-for-db] timed out after ${timeoutSeconds}s waiting for the database: ${err.message}`
                );
                console.error('[wait-for-db] check PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE');
                await pool.end().catch(() => {});
                process.exit(1);
            }
            console.log(`[wait-for-db] attempt ${attempt} failed (${err.message}); retrying in ${retryDelayMs / 1000}s`);
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
    }
})();
