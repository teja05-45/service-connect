// backend/scripts/migrate.js
//
// Applies db/schema.sql (idempotent base schema), then every pending file in
// db/migrations/ in filename order (tracked in `schema_migrations`), then the
// service catalogue seed. Used by `npm run migrate` locally and by the Docker
// entrypoint, so the database is provisioned before the API serves traffic.
//
// Never drops tables or data.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const pool = require('../src/config/db');

const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
const seedPath = path.join(__dirname, '..', 'db', 'seed.sql');
const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');

const applyMigrations = async () => {
    await pool.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
            filename text PRIMARY KEY,
            applied_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`
    );

    if (!fs.existsSync(migrationsDir)) {
        console.log('[migrate] no migrations directory; skipped');
        return;
    }

    const files = fs
        .readdirSync(migrationsDir)
        .filter((file) => file.endsWith('.sql'))
        .sort();

    const appliedResult = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    for (const file of files) {
        if (applied.has(file)) {
            console.log(`[migrate] migration already applied: ${file}`);
            continue;
        }

        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
            await client.query('COMMIT');
            console.log(`[migrate] applied migration: ${file}`);
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw new Error(`migration ${file} failed: ${err.message}`);
        } finally {
            client.release();
        }
    }
};

(async () => {
    try {
        await pool.query('SELECT 1');

        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);
        console.log('[migrate] base schema applied (db/schema.sql)');

        await applyMigrations();

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
