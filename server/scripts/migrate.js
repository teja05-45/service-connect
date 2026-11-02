// backend/scripts/migrate.js
//
// Applies db/schema.sql (idempotent) and optionally db/seed.sql.
// Used both by `npm run migrate` locally and by the Docker entrypoint, so the
// database is always provisioned before the API starts serving traffic.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const pool = require('../src/config/db');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const seedPath = path.join(__dirname, '..', 'db', 'seed.sql');

(async () => {
    try {
        await pool.query('SELECT 1');

        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);
        console.log('[migrate] schema applied (db/schema.sql)');

        if (process.env.SEED === 'false') {
            console.log('[migrate] seed skipped (SEED=false)');
        } else {
            const seed = fs.readFileSync(seedPath, 'utf8');
            await pool.query(seed);
            console.log('[migrate] seed applied (db/seed.sql)');
        }

        const { rows } = await pool.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' ORDER BY table_name`
        );
        console.log(`[migrate] ${rows.length} tables present: ${rows.map((r) => r.table_name).join(', ')}`);
        await pool.end();
        process.exit(0);
    } catch (err) {
        console.error('[migrate] FAILED:', err.message);
        await pool.end().catch(() => {});
        process.exit(1);
    }
})();
