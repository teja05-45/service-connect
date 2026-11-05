// backend/src/middleware/adminAuth.js
//
// Backend-only admin authorization. The JWT role claim is necessary but not
// sufficient: every admin request also re-checks the database so a token
// issued before a role change / suspension stops working immediately.
//
// `auth` (server/middleware/auth.js) must run first and attach req.user.

const pool = require('../config/db');

const adminDenied = (res, message = 'Access denied. Administrator privileges required.') =>
    res.status(403).json({ error: message });

/**
 * Build the guard with an injectable database handle so it can be unit tested
 * without a live PostgreSQL instance.
 */
const createAdminGuard = (db = pool) => async (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return adminDenied(res);
    }

    try {
        const result = await db.query(
            "SELECT id, role, status FROM users WHERE id = $1 AND role = 'admin'",
            [req.user.id]
        );
        const admin = result.rows[0];

        // Role changed in the database, account deleted, or not an admin.
        if (!admin) {
            return adminDenied(res, 'Access denied. This account is not an administrator.');
        }
        if (admin.status !== 'active') {
            return adminDenied(res, 'Access denied. This administrator account is not active.');
        }

        req.admin = { id: admin.id };
        return next();
    } catch (err) {
        return res.status(500).json({ error: 'Could not verify administrator privileges.' });
    }
};

const requireAdmin = createAdminGuard();

module.exports = { createAdminGuard, requireAdmin, adminDenied };
