// backend/src/services/adminBootstrap.js
//
// Creates the *first* administrator from ADMIN_EMAIL + ADMIN_PASSWORD.
//
// Safety properties:
//   * no-op when the variables are unset (the normal case),
//   * no-op when any admin account already exists (so restarts never create
//     or overwrite administrators),
//   * never promotes an existing non-admin account automatically,
//   * bcrypt hash, active status, email verified.

const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { logger } = require('../utils/logger');

const MIN_ADMIN_PASSWORD_LENGTH = 12;

const ensureInitialAdmin = async ({ db = pool, email, password } = {}) => {
    const adminEmail = String(email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = String(password || process.env.ADMIN_PASSWORD || '');

    if (!adminEmail || !adminPassword) {
        return { created: false, reason: 'not_configured' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
        logger.error('admin_bootstrap_invalid_email', { hint: 'ADMIN_EMAIL is not a valid email address.' });
        return { created: false, reason: 'invalid_email' };
    }
    if (adminPassword.length < MIN_ADMIN_PASSWORD_LENGTH) {
        logger.error('admin_bootstrap_weak_password', {
            hint: `ADMIN_PASSWORD must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
        });
        return { created: false, reason: 'weak_password' };
    }

    const adminCount = await db.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
    if (adminCount.rowCount > 0) {
        return { created: false, reason: 'admin_exists' };
    }

    const existing = await db.query('SELECT id, role FROM users WHERE lower(email) = $1', [adminEmail]);
    if (existing.rowCount > 0) {
        // Refuse to escalate an existing customer/provider from an env var.
        logger.error('admin_bootstrap_email_in_use', {
            hint: 'ADMIN_EMAIL belongs to a non-admin account. Create the admin with scripts/create-admin.js instead.',
        });
        return { created: false, reason: 'email_owned_by_non_admin' };
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const inserted = await db.query(
        `INSERT INTO users (email, password_hash, role, status, email_verified_at)
         VALUES ($1, $2, 'admin', 'active', CURRENT_TIMESTAMP)
         RETURNING id, email`,
        [adminEmail, passwordHash]
    );

    logger.info('admin_bootstrap_created', { userId: inserted.rows[0].id, email: inserted.rows[0].email });
    return { created: true, userId: inserted.rows[0].id, email: inserted.rows[0].email };
};

module.exports = { ensureInitialAdmin, MIN_ADMIN_PASSWORD_LENGTH };
