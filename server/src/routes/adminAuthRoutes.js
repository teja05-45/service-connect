// backend/src/routes/adminAuthRoutes.js
//
// Administrator authentication is deliberately separate from /auth/login:
//   * only accounts whose database role is 'admin' may authenticate here,
//   * the rate limiter is admin-login specific,
//   * successful logins are written to the audit trail,
//   * there is no public admin registration endpoint.

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const router = express.Router();

const pool = require('../config/db');
const auth = require('../../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { createRateLimiter } = require('../middleware/rateLimit');
const { recordAdminActionSafe } = require('../services/auditLog');
const { logger } = require('../utils/logger');

const adminLoginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
});

/**
 * @route POST /api/v1/admin/login
 * @desc Administrator-only login
 * @access Public (rate limited)
 */
router.post('/admin/login', adminLoginLimiter, async (req, res) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const result = await pool.query(
            `SELECT id, email, password_hash, role, status
             FROM users
             WHERE lower(email) = lower($1)
             LIMIT 1`,
            [email]
        );
        const user = result.rows[0];

        // Same generic response for unknown email, wrong password and
        // non-admin accounts so the endpoint cannot be used to enumerate admins.
        const invalid = () => res.status(401).json({ error: 'Invalid administrator credentials.' });

        if (!user) return invalid();

        const passwordMatches = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatches) return invalid();
        if (user.role !== 'admin') return invalid();
        if (user.status !== 'active') {
            return res.status(403).json({ error: 'This administrator account is not active.' });
        }

        const token = jwt.sign(
            { user: { id: user.id, role: 'admin' } },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        await recordAdminActionSafe({
            adminId: user.id,
            action: 'admin.login',
            targetType: 'user',
            targetId: user.id,
            metadata: { ip: req.ip },
        });

        res.status(200).json({
            message: 'Administrator login successful.',
            token,
            role: 'admin',
            user: { id: user.id, email: user.email, role: 'admin' },
        });
    } catch (err) {
        logger.error('admin_login_failed', { error: err.message });
        res.status(500).json({ error: 'An error occurred during login.' });
    }
});

/**
 * @route GET /api/v1/admin/me
 * @desc Current administrator profile
 * @access Private (admin)
 */
router.get('/admin/me', auth, requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, email, role, status, created_at, profile_picture_url
             FROM users WHERE id = $1`,
            [req.admin.id]
        );
        const admin = result.rows[0];
        if (!admin) return res.status(404).json({ error: 'Administrator not found.' });
        res.status(200).json({ admin });
    } catch (err) {
        logger.error('admin_me_failed', { error: err.message });
        res.status(500).json({ error: 'Failed to load the administrator profile.' });
    }
});

/**
 * @route POST /api/v1/admin/logout
 * @desc JWT is stateless; the client discards the token. Endpoint exists for a
 *       symmetric UI flow and audit visibility.
 * @access Private (admin)
 */
router.post('/admin/logout', auth, requireAdmin, async (req, res) => {
    await recordAdminActionSafe({
        adminId: req.admin.id,
        action: 'admin.logout',
        targetType: 'user',
        targetId: req.admin.id,
    });
    res.status(200).json({ message: 'Logged out. Discard the token on the client.' });
});

module.exports = router;
