// backend/scripts/create-admin.js
//
// Secure one-time administrator bootstrap / credential rotation.
//
// Usage (from server/):
//   npm run create-admin -- --email admin@example.com --password "a-long-secret"
//   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD="a-long-secret" npm run create-admin
//   npm run create-admin -- --email admin@example.com --password "new-secret" --rotate-password
//   npm run create-admin -- --email admin@example.com --password "secret" --promote
//
// Safety:
//   * never prints the password,
//   * refuses to silently promote a customer/provider (use --promote to do it
//     deliberately),
//   * --rotate-password updates an existing admin's password (credential change),
//   * idempotent: running twice with the same email does not create duplicates.

const bcrypt = require('bcrypt');
require('dotenv').config();
const pool = require('../src/config/db');

const parseArgs = (argv) => {
    const args = { promote: false, rotatePassword: false, ifNone: false };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--promote') args.promote = true;
        else if (arg === '--rotate-password') args.rotatePassword = true;
        else if (arg === '--if-none') args.ifNone = true;
        else if (arg === '--email') args.email = argv[++i];
        else if (arg === '--password') args.password = argv[++i];
        else if (arg.startsWith('--email=')) args.email = arg.slice('--email='.length);
        else if (arg.startsWith('--password=')) args.password = arg.slice('--password='.length);
    }
    return args;
};

const MIN_PASSWORD_LENGTH = 12;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

(async () => {
    const args = parseArgs(process.argv.slice(2));
    const email = String(args.email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = String(args.password || process.env.ADMIN_PASSWORD || '');

    if (!email || !EMAIL_PATTERN.test(email)) {
        console.error('[create-admin] a valid --email (or ADMIN_EMAIL) is required.');
        process.exit(1);
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
        console.error(`[create-admin] --password (or ADMIN_PASSWORD) must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        process.exit(1);
    }

    try {
        const adminCount = await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
        if (args.ifNone && adminCount.rowCount > 0) {
            console.log('[create-admin] an administrator already exists; nothing to do.');
            await pool.end();
            process.exit(0);
        }

        const existing = await pool.query(
            'SELECT id, role FROM users WHERE lower(email) = $1',
            [email]
        );
        const passwordHash = await bcrypt.hash(password, 12);

        if (existing.rowCount > 0) {
            const user = existing.rows[0];

            if (user.role !== 'admin' && !args.promote) {
                console.error(
                    `[create-admin] ${email} already belongs to a ${user.role} account. ` +
                        'Re-run with --promote only if you intend to grant administrator access.'
                );
                await pool.end();
                process.exit(1);
            }

            if (user.role === 'admin' && !args.rotatePassword) {
                console.log(`[create-admin] administrator ${email} already exists. Use --rotate-password to change the password.`);
                await pool.end();
                process.exit(0);
            }

            await pool.query(
                `UPDATE users
                 SET password_hash = $1, role = 'admin', status = 'active',
                     email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
                     otp_code = NULL, otp_expiry = NULL
                 WHERE id = $2`,
                [passwordHash, user.id]
            );
            console.log(`[create-admin] updated administrator account ${email} (id ${user.id}).`);
        } else {
            const inserted = await pool.query(
                `INSERT INTO users (email, password_hash, role, status, email_verified_at)
                 VALUES ($1, $2, 'admin', 'active', CURRENT_TIMESTAMP)
                 RETURNING id`,
                [email, passwordHash]
            );
            console.log(`[create-admin] created administrator ${email} (id ${inserted.rows[0].id}).`);
        }

        console.log('[create-admin] done. Sign in at /admin/login with the configured email and password.');
        await pool.end();
        process.exit(0);
    } catch (err) {
        console.error('[create-admin] FAILED:', err.message);
        await pool.end().catch(() => {});
        process.exit(1);
    }
})();
