// backend/src/routes/adminRoutes.js
//
// Administrator API. Every route below is protected by:
//   1. `auth`        - valid JWT in the x-auth-token header
//   2. `requireAdmin` - token role must be admin AND the database user must
//                       still be an active administrator
//
// All list endpoints are paginated and return:
//   { data: [...], pagination: { page, limit, total, total_pages, ... } }
//
// All mutating endpoints validate input, write an admin_audit_logs row in the
// same transaction as the change, and never touch password hashes / OTPs.

const express = require('express');
const router = express.Router();

const pool = require('../config/db');
const auth = require('../../middleware/auth');
const { requireAdmin } = require('../middleware/adminAuth');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { recordAdminAction } = require('../services/auditLog');
const { getSettings, updateSettings, SETTING_DEFINITIONS } = require('../services/settings');
const { recordBookingStatus } = require('../services/bookingHistory');
const { logger } = require('../utils/logger');

router.use('/admin', auth, requireAdmin);

const PROVIDER_STATUSES = ['pending', 'under_review', 'approved', 'rejected', 'suspended'];
const USER_STATUSES = ['active', 'suspended', 'deactivated'];
const BOOKING_STATUSES = [
    'pending_provider',
    'awaiting_customer_confirmation',
    'accepted',
    'rejected',
    'completed',
    'closed',
];

const fail = (res, err, message) => {
    logger.error('admin_request_failed', { error: err.message, path: err.path });
    const status = err.statusCode || 500;
    return res.status(status).json({ error: status === 500 ? message : err.message });
};

const badRequest = (res, message) => res.status(400).json({ error: message });
const notFound = (res, message) => res.status(404).json({ error: message });

const parseId = (value) => {
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const normaliseReason = (value) => (typeof value === 'string' ? value.trim() : '');

const slugify = (name) =>
    String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * @route GET /api/v1/admin/dashboard/stats
 * @desc Real database counts for the dashboard overview
 * @access Private (admin)
 */
router.get('/admin/dashboard/stats', async (req, res) => {
    try {
        const [
            usersResult,
            providersResult,
            servicesResult,
            bookingsResult,
            reviewsResult,
            complaintsResult,
            recentUsersResult,
            recentBookingsResult,
            recentAuditResult,
        ] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*)::int AS total_users,
                    COUNT(*) FILTER (WHERE role = 'customer')::int AS total_customers,
                    COUNT(*) FILTER (WHERE role = 'provider')::int AS total_providers,
                    COUNT(*) FILTER (WHERE role = 'admin')::int AS total_admins,
                    COUNT(*) FILTER (WHERE status = 'active')::int AS active_users,
                    COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended_users,
                    COUNT(*) FILTER (WHERE email_verified_at IS NOT NULL)::int AS email_verified_users
                FROM users
            `),
            pool.query(`
                SELECT
                    COUNT(*)::int AS total_providers,
                    COUNT(*) FILTER (WHERE verification_status = 'approved')::int AS approved_providers,
                    COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending_providers,
                    COUNT(*) FILTER (WHERE verification_status = 'under_review')::int AS under_review_providers,
                    COUNT(*) FILTER (WHERE verification_status = 'rejected')::int AS rejected_providers,
                    COUNT(*) FILTER (WHERE verification_status = 'suspended')::int AS suspended_providers
                FROM providers
            `),
            pool.query(`
                SELECT
                    COUNT(*)::int AS total_services,
                    COUNT(*) FILTER (WHERE is_active)::int AS active_services
                FROM services
            `),
            pool.query(`
                SELECT
                    COUNT(*)::int AS total_bookings,
                    COUNT(*) FILTER (WHERE booking_status = 'pending_provider')::int AS pending_bookings,
                    COUNT(*) FILTER (WHERE booking_status = 'awaiting_customer_confirmation')::int AS awaiting_confirmation_bookings,
                    COUNT(*) FILTER (WHERE booking_status = 'accepted')::int AS accepted_bookings,
                    COUNT(*) FILTER (WHERE booking_status = 'completed')::int AS completed_bookings,
                    COUNT(*) FILTER (WHERE booking_status = 'closed')::int AS closed_bookings,
                    COUNT(*) FILTER (WHERE booking_status = 'rejected')::int AS cancelled_bookings
                FROM bookings
            `),
            pool.query(`
                SELECT COUNT(*)::int AS total_reviews,
                       COUNT(*) FILTER (WHERE is_hidden)::int AS hidden_reviews
                FROM reviews
            `),
            pool.query(`
                SELECT COUNT(*)::int AS total_complaints,
                       COUNT(*) FILTER (WHERE is_resolved = FALSE)::int AS unresolved_complaints
                FROM contact_messages
            `),
            pool.query(`
                SELECT u.id, u.email, u.role, u.status, u.created_at, u.email_verified_at,
                       cp.full_name
                FROM users u
                LEFT JOIN customer_profiles cp ON cp.user_id = u.id
                ORDER BY u.created_at DESC, u.id DESC
                LIMIT 5
            `),
            pool.query(`
                SELECT b.id, b.booking_status, b.created_at, b.amount,
                       cu.email AS customer_email, p.display_name AS provider_name,
                       s.name AS service_name
                FROM bookings b
                JOIN users cu ON cu.id = b.customer_id
                JOIN providers p ON p.id = b.provider_id
                JOIN services s ON s.id = b.service_id
                ORDER BY b.created_at DESC, b.id DESC
                LIMIT 5
            `),
            pool.query(`
                SELECT l.id, l.action, l.target_type, l.target_id, l.reason, l.created_at,
                       a.email AS admin_email
                FROM admin_audit_logs l
                JOIN users a ON a.id = l.admin_id
                ORDER BY l.created_at DESC, l.id DESC
                LIMIT 5
            `),
        ]);

        res.status(200).json({
            generated_at: new Date().toISOString(),
            users: usersResult.rows[0],
            providers: providersResult.rows[0],
            services: servicesResult.rows[0],
            bookings: bookingsResult.rows[0],
            reviews: reviewsResult.rows[0],
            complaints: complaintsResult.rows[0],
            recent_registrations: recentUsersResult.rows,
            recent_bookings: recentBookingsResult.rows,
            recent_admin_activity: recentAuditResult.rows,
        });
    } catch (err) {
        fail(res, err, 'Failed to load dashboard statistics.');
    }
});

/**
 * @route GET /api/v1/admin/dashboard/recent-activity
 * @desc Paginated audit trail (most recent first)
 * @access Private (admin)
 */
router.get('/admin/dashboard/recent-activity', async (req, res) => {
    req.query = { ...req.query, limit: req.query.limit || '15' };
    return listAuditLogs(req, res);
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

router.get('/admin/users', async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const role = req.query.role;
    const status = req.query.status;
    const search = (req.query.q || '').trim();

    if (role && !['customer', 'provider', 'admin'].includes(role)) {
        return badRequest(res, 'Invalid role filter.');
    }
    if (status && !USER_STATUSES.includes(status)) {
        return badRequest(res, 'Invalid status filter.');
    }

    const conditions = [];
    const values = [];

    if (role) {
        values.push(role);
        conditions.push(`u.role = $${values.length}`);
    }
    if (status) {
        values.push(status);
        conditions.push(`u.status = $${values.length}`);
    }
    if (search) {
        values.push(`%${search}%`);
        conditions.push(
            `(u.email ILIKE $${values.length}
              OR COALESCE(cp.full_name, '') ILIKE $${values.length}
              OR COALESCE(p.display_name, '') ILIKE $${values.length})`
        );
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const joins = `
        FROM users u
        LEFT JOIN customer_profiles cp ON cp.user_id = u.id
        LEFT JOIN providers p ON p.user_id = u.id
    `;

    try {
        const countResult = await pool.query(`SELECT COUNT(*)::int AS total ${joins} ${where}`, values);

        const listValues = [...values, limit, offset];
        const listResult = await pool.query(
            `SELECT u.id, u.email, u.role, u.status, u.status_reason, u.created_at,
                    u.email_verified_at, u.profile_picture_url,
                    cp.full_name, cp.city,
                    p.id AS provider_id, p.display_name, p.verification_status, p.is_verified
             ${joins}
             ${where}
             ORDER BY u.id DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
            listValues
        );

        res.status(200).json({
            data: listResult.rows,
            pagination: buildPaginationMeta(countResult.rows[0].total, page, limit),
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch users.');
    }
});

router.get('/admin/users/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'Invalid user id.');

    try {
        const userResult = await pool.query(
            `SELECT u.id, u.email, u.role, u.status, u.status_reason, u.created_at,
                    u.updated_at, u.email_verified_at, u.profile_picture_url
             FROM users u WHERE u.id = $1`,
            [id]
        );
        const user = userResult.rows[0];
        if (!user) return notFound(res, 'User not found.');

        const [customerResult, providerResult, statsResult, bookingsResult] = await Promise.all([
            pool.query(
                `SELECT full_name, phone_number, address_line_1, city, location_lat, location_lon
                 FROM customer_profiles WHERE user_id = $1`,
                [id]
            ),
            pool.query(
                `SELECT id, display_name, bio, location_lat, location_lon, service_radius_km,
                        is_verified, verification_status, verification_notes, rejection_reason,
                        suspended_reason, average_rating, review_count, created_at, verified_at
                 FROM providers WHERE user_id = $1`,
                [id]
            ),
            pool.query(
                `SELECT
                    (SELECT COUNT(*) FROM bookings WHERE customer_id = $1)::int AS customer_bookings,
                    (SELECT COUNT(*) FROM bookings b JOIN providers p ON p.id = b.provider_id
                     WHERE p.user_id = $1)::int AS provider_bookings,
                    (SELECT COUNT(*) FROM reviews WHERE customer_id = $1)::int AS reviews_written
                `,
                [id]
            ),
            pool.query(
                `SELECT b.id, b.booking_status, b.scheduled_at, b.amount, b.created_at,
                        cu.email AS customer_email, p.display_name AS provider_name,
                        s.name AS service_name
                 FROM bookings b
                 JOIN users cu ON cu.id = b.customer_id
                 JOIN providers p ON p.id = b.provider_id
                 JOIN users pu ON pu.id = p.user_id
                 JOIN services s ON s.id = b.service_id
                 WHERE b.customer_id = $1 OR p.user_id = $1
                 ORDER BY b.created_at DESC
                 LIMIT 10`,
                [id]
            ),
        ]);

        res.status(200).json({
            user,
            customer_profile: customerResult.rows[0] || null,
            provider_profile: providerResult.rows[0] || null,
            stats: statsResult.rows[0],
            recent_bookings: bookingsResult.rows,
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch the user profile.');
    }
});

router.patch('/admin/users/:id/status', async (req, res) => {
    const id = parseId(req.params.id);
    const { status } = req.body || {};
    const reason = normaliseReason(req.body && req.body.reason);

    if (!id) return badRequest(res, 'Invalid user id.');
    if (!USER_STATUSES.includes(status)) {
        return badRequest(res, `Status must be one of: ${USER_STATUSES.join(', ')}.`);
    }
    if (id === req.admin.id) return badRequest(res, 'You cannot change your own account status.');
    if (status !== 'active' && !reason) {
        return badRequest(res, 'A reason is required when suspending or deactivating an account.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const targetResult = await client.query(
            'SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE',
            [id]
        );
        const target = targetResult.rows[0];
        if (!target) {
            await client.query('ROLLBACK');
            return notFound(res, 'User not found.');
        }
        if (target.role === 'admin') {
            await client.query('ROLLBACK');
            return badRequest(res, 'Administrator accounts cannot be suspended from this endpoint.');
        }

        await client.query(
            `UPDATE users
             SET status = $1, status_reason = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [status, status === 'active' ? null : reason, id]
        );

        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'user.status_change',
            targetType: 'user',
            targetId: id,
            reason: status === 'active' ? null : reason,
            metadata: { previous_status: target.status, new_status: status, role: target.role },
        });

        await client.query('COMMIT');
        res.status(200).json({ message: `User ${id} status set to ${status}.` });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'Failed to update the user status.');
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

router.get('/admin/providers', async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, service_id: serviceId } = req.query;
    const search = (req.query.q || '').trim();

    if (status && !PROVIDER_STATUSES.includes(status)) {
        return badRequest(res, 'Invalid provider status filter.');
    }
    if (serviceId !== undefined && !parseId(serviceId)) {
        return badRequest(res, 'Invalid service id filter.');
    }

    const conditions = [];
    const values = [];

    if (status) {
        values.push(status);
        conditions.push(`p.verification_status = $${values.length}`);
    }
    if (serviceId) {
        values.push(parseId(serviceId));
        conditions.push(
            `EXISTS (SELECT 1 FROM provider_services psf
                     WHERE psf.provider_id = p.id AND psf.service_id = $${values.length})`
        );
    }
    if (search) {
        values.push(`%${search}%`);
        conditions.push(`(p.display_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const joins = `
        FROM providers p
        JOIN users u ON u.id = p.user_id
    `;

    try {
        const countResult = await pool.query(`SELECT COUNT(*)::int AS total ${joins} ${where}`, values);

        const listValues = [...values, limit, offset];
        const listResult = await pool.query(
            `SELECT p.id, p.user_id, p.display_name, p.bio, p.is_verified,
                    p.verification_status, p.average_rating, p.review_count,
                    p.location_lat, p.location_lon, p.service_radius_km,
                    p.rejection_reason, p.suspended_reason, p.created_at, p.verified_at,
                    u.email, u.status AS user_status, u.profile_picture_url,
                    COALESCE(
                        (SELECT array_agg(DISTINCT s.name ORDER BY s.name)
                         FROM provider_services ps
                         JOIN services s ON s.id = ps.service_id
                         WHERE ps.provider_id = p.id),
                        '{}'
                    ) AS services
             ${joins}
             ${where}
             ORDER BY (p.verification_status IN ('pending', 'under_review')) DESC,
                      p.created_at DESC, p.id DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
            listValues
        );

        res.status(200).json({
            data: listResult.rows,
            pagination: buildPaginationMeta(countResult.rows[0].total, page, limit),
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch providers.');
    }
});

router.get('/admin/providers/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'Invalid provider id.');

    try {
        const providerResult = await pool.query(
            `SELECT p.*, u.email, u.status AS user_status, u.created_at AS user_created_at,
                    u.email_verified_at, u.profile_picture_url
             FROM providers p
             JOIN users u ON u.id = p.user_id
             WHERE p.id = $1`,
            [id]
        );
        const provider = providerResult.rows[0];
        if (!provider) return notFound(res, 'Provider not found.');

        // Never expose secrets: only safe profile fields.
        delete provider.payout_upi_id;

        const [servicesResult, reviewsResult, statsResult] = await Promise.all([
            pool.query(
                `SELECT s.id, s.name, s.slug, s.is_active, ps.rate_per_hour
                 FROM provider_services ps
                 JOIN services s ON s.id = ps.service_id
                 WHERE ps.provider_id = $1
                 ORDER BY s.name`,
                [id]
            ),
            pool.query(
                `SELECT r.id, r.rating, r.comment, r.created_at, r.is_hidden, r.moderation_reason,
                        u.email AS customer_email
                 FROM reviews r
                 JOIN users u ON u.id = r.customer_id
                 WHERE r.provider_id = $1
                 ORDER BY r.created_at DESC
                 LIMIT 10`,
                [id]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total_bookings,
                        COUNT(*) FILTER (WHERE booking_status = 'closed')::int AS completed_bookings,
                        COUNT(*) FILTER (WHERE booking_status = 'rejected')::int AS cancelled_bookings
                 FROM bookings WHERE provider_id = $1`,
                [id]
            ),
        ]);

        res.status(200).json({
            provider,
            services: servicesResult.rows,
            reviews: reviewsResult.rows,
            booking_stats: statsResult.rows[0],
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch the provider profile.');
    }
});

const changeProviderStatus = ({ status, action, requireReason }) => async (req, res) => {
    const id = parseId(req.params.id);
    const reason = normaliseReason(req.body && (req.body.reason || req.body.notes));

    if (!id) return badRequest(res, 'Invalid provider id.');
    if (requireReason && !reason) {
        return badRequest(res, `A reason is required to ${action.replace('provider.', '')} this provider.`);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const currentResult = await client.query(
            'SELECT id, user_id, verification_status FROM providers WHERE id = $1 FOR UPDATE',
            [id]
        );
        const current = currentResult.rows[0];
        if (!current) {
            await client.query('ROLLBACK');
            return notFound(res, 'Provider not found.');
        }

        const isApproved = status === 'approved';
        await client.query(
            `UPDATE providers
             SET verification_status = $1::text,
                 rejection_reason = CASE WHEN $1::text = 'rejected' THEN $2 ELSE NULL END,
                 suspended_reason = CASE WHEN $1::text = 'suspended' THEN $2 ELSE NULL END,
                 verification_notes = CASE WHEN $1::text = 'under_review' THEN $2 ELSE verification_notes END,
                 verified_at = CASE WHEN $3::boolean THEN CURRENT_TIMESTAMP ELSE NULL END,
                 verified_by = CASE WHEN $3::boolean THEN $4::int ELSE NULL END,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [status, reason || null, isApproved, req.admin.id, id]
        );

        await recordAdminAction(client, {
            adminId: req.admin.id,
            action,
            targetType: 'provider',
            targetId: id,
            reason: reason || null,
            metadata: {
                previous_status: current.verification_status,
                new_status: status,
                provider_user_id: current.user_id,
            },
        });

        await client.query('COMMIT');
        res.status(200).json({
            message: `Provider ${id} set to ${status}.`,
            verification_status: status,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'Failed to update the provider status.');
    } finally {
        client.release();
    }
};

router.patch(
    '/admin/providers/:id/approve',
    changeProviderStatus({ status: 'approved', action: 'provider.approve', requireReason: false })
);
router.patch(
    '/admin/providers/:id/reject',
    changeProviderStatus({ status: 'rejected', action: 'provider.reject', requireReason: true })
);
router.patch(
    '/admin/providers/:id/suspend',
    changeProviderStatus({ status: 'suspended', action: 'provider.suspend', requireReason: true })
);
router.patch(
    '/admin/providers/:id/request-info',
    changeProviderStatus({ status: 'under_review', action: 'provider.request_info', requireReason: true })
);
router.patch(
    '/admin/providers/:id/reactivate',
    changeProviderStatus({ status: 'approved', action: 'provider.reactivate', requireReason: false })
);

/**
 * Legacy compatibility endpoint used by the old admin UI.
 * It is mapped onto the lifecycle model (approve / return to pending).
 */
router.put('/admin/providers/:id/verify', async (req, res) => {
    const id = parseId(req.params.id);
    const { is_verified: isVerified } = req.body || {};
    if (!id) return badRequest(res, 'Invalid provider id.');
    if (typeof isVerified !== 'boolean') {
        return badRequest(res, 'Verification status must be a boolean.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE providers
             SET verification_status = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2
             RETURNING id, verification_status`,
            [isVerified ? 'approved' : 'pending', id]
        );
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return notFound(res, 'Provider not found.');
        }
        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: isVerified ? 'provider.approve' : 'provider.revoke',
            targetType: 'provider',
            targetId: id,
            metadata: { new_status: result.rows[0].verification_status, via: 'legacy_verify_endpoint' },
        });
        await client.query('COMMIT');
        res.status(200).json({
            message: `Provider ${id} verification status set to ${result.rows[0].verification_status}.`,
            verification_status: result.rows[0].verification_status,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'Failed to update verification status.');
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

router.get('/admin/services', async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50 });
    const search = (req.query.q || '').trim();
    const includeInactive = req.query.include_inactive !== 'false';

    const conditions = [];
    const values = [];

    if (!includeInactive) conditions.push('s.is_active = TRUE');
    if (search) {
        values.push(`%${search}%`);
        conditions.push(`(s.name ILIKE $${values.length} OR COALESCE(s.slug, '') ILIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM services s ${where}`, values);
        const listValues = [...values, limit, offset];
        const listResult = await pool.query(
            `SELECT s.id, s.name, s.slug, s.description, s.icon_url, s.is_active, s.created_at,
                    (SELECT COUNT(*)::int FROM provider_services ps WHERE ps.service_id = s.id) AS provider_count,
                    (SELECT COUNT(DISTINCT ps.provider_id)::int
                     FROM provider_services ps
                     JOIN providers p ON p.id = ps.provider_id
                     WHERE ps.service_id = s.id AND p.verification_status = 'approved') AS active_provider_count,
                    (SELECT COUNT(*)::int FROM bookings b WHERE b.service_id = s.id) AS booking_count
             FROM services s
             ${where}
             ORDER BY s.is_active DESC, s.name
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
            listValues
        );

        res.status(200).json({
            data: listResult.rows,
            pagination: buildPaginationMeta(countResult.rows[0].total, page, limit),
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch services.');
    }
});

router.post('/admin/services', async (req, res) => {
    const { name, description, icon_url: iconUrl, is_active: isActive } = req.body || {};
    const trimmedName = typeof name === 'string' ? name.trim() : '';

    if (trimmedName.length < 2 || trimmedName.length > 100) {
        return badRequest(res, 'Service name must be between 2 and 100 characters.');
    }

    const slug = slugify(req.body.slug || trimmedName);
    if (!slug) return badRequest(res, 'A valid slug could not be derived from the name.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `INSERT INTO services (name, slug, description, icon_url, is_active)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, name, slug, description, icon_url, is_active, created_at`,
            [trimmedName, slug, description || null, iconUrl || null, isActive !== false]
        );

        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'service.create',
            targetType: 'service',
            targetId: result.rows[0].id,
            metadata: { name: trimmedName, slug },
        });
        await client.query('COMMIT');

        res.status(201).json({ service: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return res.status(409).json({ error: 'A service with this name or slug already exists.' });
        fail(res, err, 'Failed to create the service.');
    } finally {
        client.release();
    }
});

router.patch('/admin/services/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'Invalid service id.');

    const body = req.body || {};
    const fields = [];
    const values = [];

    const set = (column, value) => {
        values.push(value);
        fields.push(`${column} = $${values.length}`);
    };

    if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (name.length < 2 || name.length > 100) return badRequest(res, 'Service name must be between 2 and 100 characters.');
        set('name', name);
    }
    if (body.slug !== undefined) {
        const slug = slugify(body.slug);
        if (!slug) return badRequest(res, 'Invalid slug.');
        set('slug', slug);
    }
    if (body.description !== undefined) set('description', body.description || null);
    if (body.icon_url !== undefined) set('icon_url', body.icon_url || null);
    if (body.is_active !== undefined) {
        if (typeof body.is_active !== 'boolean') return badRequest(res, 'is_active must be a boolean.');
        set('is_active', body.is_active);
    }

    if (fields.length === 0) return badRequest(res, 'No supported fields were provided.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        values.push(id);
        const result = await client.query(
            `UPDATE services SET ${fields.join(', ')} WHERE id = $${values.length}
             RETURNING id, name, slug, description, icon_url, is_active, created_at`,
            values
        );
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return notFound(res, 'Service not found.');
        }

        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'service.update',
            targetType: 'service',
            targetId: id,
            metadata: { changed_fields: Object.keys(body) },
        });
        await client.query('COMMIT');
        res.status(200).json({ service: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return res.status(409).json({ error: 'A service with this name or slug already exists.' });
        fail(res, err, 'Failed to update the service.');
    } finally {
        client.release();
    }
});

/**
 * @desc Safe deactivation. Existing bookings/providers keep referencing the
 *       category; public discovery excludes it. Nothing is deleted so booking
 *       history and past reviews stay intact.
 */
router.delete('/admin/services/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'Invalid service id.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE services SET is_active = FALSE WHERE id = $1
             RETURNING id, name, is_active`,
            [id]
        );
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return notFound(res, 'Service not found.');
        }

        const counts = await client.query(
            `SELECT
                (SELECT COUNT(*)::int FROM bookings WHERE service_id = $1) AS booking_count,
                (SELECT COUNT(*)::int FROM provider_services WHERE service_id = $1) AS provider_count`,
            [id]
        );

        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'service.deactivate',
            targetType: 'service',
            targetId: id,
            metadata: counts.rows[0],
        });
        await client.query('COMMIT');

        res.status(200).json({
            message: `Service ${id} deactivated. Existing bookings and reviews were kept.`,
            deactivated: true,
            dependents: counts.rows[0],
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'Failed to deactivate the service.');
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

router.get('/admin/bookings', async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const { status, service_id: serviceId, customer_id: customerId, provider_id: providerId } = req.query;
    const from = req.query.from;
    const to = req.query.to;
    const search = (req.query.q || '').trim();

    if (status && !BOOKING_STATUSES.includes(status)) return badRequest(res, 'Invalid booking status filter.');
    if (serviceId !== undefined && !parseId(serviceId)) return badRequest(res, 'Invalid service id filter.');
    if (customerId !== undefined && !parseId(customerId)) return badRequest(res, 'Invalid customer id filter.');
    if (providerId !== undefined && !parseId(providerId)) return badRequest(res, 'Invalid provider id filter.');

    const conditions = [];
    const values = [];
    const push = (sql, value) => {
        values.push(value);
        conditions.push(sql.replace('$?', `$${values.length}`));
    };

    if (status) push('b.booking_status = $?', status);
    if (serviceId) push('b.service_id = $?', parseId(serviceId));
    if (customerId) push('b.customer_id = $?', parseId(customerId));
    if (providerId) push('b.provider_id = $?', parseId(providerId));
    if (from) push('b.created_at >= $?::timestamptz', from);
    if (to) push('b.created_at <= $?::timestamptz', `${to}`);
    if (search) {
        if (parseId(search)) {
            push('b.id = $?', parseId(search));
        } else {
            values.push(`%${search}%`);
            conditions.push(
                `(cu.email ILIKE $${values.length} OR pu.email ILIKE $${values.length} OR p.display_name ILIKE $${values.length})`
            );
        }
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const joins = `
        FROM bookings b
        JOIN users cu ON cu.id = b.customer_id
        JOIN providers p ON p.id = b.provider_id
        JOIN users pu ON pu.id = p.user_id
        JOIN services s ON s.id = b.service_id
    `;

    try {
        const countResult = await pool.query(`SELECT COUNT(*)::int AS total ${joins} ${where}`, values);
        const listValues = [...values, limit, offset];
        const listResult = await pool.query(
            `SELECT b.id, b.booking_status, b.scheduled_at, b.created_at, b.updated_at,
                    b.amount, b.address, b.service_description, b.customer_notes,
                    cu.id AS customer_id, cu.email AS customer_email,
                    cp.full_name AS customer_name,
                    p.id AS provider_id, p.display_name AS provider_name,
                    pu.email AS provider_email,
                    s.id AS service_id, s.name AS service_name,
                    pay.status AS payment_status
             ${joins}
             LEFT JOIN customer_profiles cp ON cp.user_id = cu.id
             LEFT JOIN payments pay ON pay.booking_id = b.id
             ${where}
             ORDER BY b.created_at DESC, b.id DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
            listValues
        );

        res.status(200).json({
            data: listResult.rows,
            pagination: buildPaginationMeta(countResult.rows[0].total, page, limit),
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch bookings.');
    }
});

router.get('/admin/bookings/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return badRequest(res, 'Invalid booking id.');

    try {
        const bookingResult = await pool.query(
            `SELECT b.*, cu.email AS customer_email, cp.full_name AS customer_name,
                    p.display_name AS provider_name, pu.email AS provider_email,
                    s.name AS service_name, pay.status AS payment_status,
                    pay.amount AS paid_amount, pay.paid_at,
                    r.id AS review_id, r.rating AS review_rating, r.comment AS review_comment,
                    r.is_hidden AS review_hidden
             FROM bookings b
             JOIN users cu ON cu.id = b.customer_id
             LEFT JOIN customer_profiles cp ON cp.user_id = cu.id
             JOIN providers p ON p.id = b.provider_id
             JOIN users pu ON pu.id = p.user_id
             JOIN services s ON s.id = b.service_id
             LEFT JOIN payments pay ON pay.booking_id = b.id
             LEFT JOIN reviews r ON r.booking_id = b.id
             WHERE b.id = $1`,
            [id]
        );
        const booking = bookingResult.rows[0];
        if (!booking) return notFound(res, 'Booking not found.');

        const [historyResult, messageCountResult] = await Promise.all([
            pool.query(
                `SELECT h.id, h.status, h.changed_by_role, h.note, h.created_at,
                        u.email AS changed_by_email
                 FROM booking_status_history h
                 LEFT JOIN users u ON u.id = h.changed_by
                 WHERE h.booking_id = $1
                 ORDER BY h.created_at ASC, h.id ASC`,
                [id]
            ),
            pool.query('SELECT COUNT(*)::int AS total FROM messages WHERE booking_id = $1', [id]),
        ]);

        res.status(200).json({
            booking,
            status_history: historyResult.rows,
            message_count: messageCountResult.rows[0].total,
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch the booking.');
    }
});

router.patch('/admin/bookings/:id/status', async (req, res) => {
    const id = parseId(req.params.id);
    const { status } = req.body || {};
    const reason = normaliseReason(req.body && req.body.reason);

    if (!id) return badRequest(res, 'Invalid booking id.');
    if (!BOOKING_STATUSES.includes(status)) {
        return badRequest(res, `Status must be one of: ${BOOKING_STATUSES.join(', ')}.`);
    }
    if ((status === 'rejected' || status === 'closed') && !reason) {
        return badRequest(res, 'A reason is required when cancelling or closing a booking.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const currentResult = await client.query(
            'SELECT id, booking_status FROM bookings WHERE id = $1 FOR UPDATE',
            [id]
        );
        const current = currentResult.rows[0];
        if (!current) {
            await client.query('ROLLBACK');
            return notFound(res, 'Booking not found.');
        }

        await client.query(
            'UPDATE bookings SET booking_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [status, id]
        );
        await recordBookingStatus(client, {
            bookingId: id,
            status,
            changedBy: req.admin.id,
            changedByRole: 'admin',
            note: reason || 'Status changed by administrator.',
        });
        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'booking.status_change',
            targetType: 'booking',
            targetId: id,
            reason: reason || null,
            metadata: { previous_status: current.booking_status, new_status: status },
        });

        await client.query('COMMIT');
        res.status(200).json({ message: `Booking ${id} status set to ${status}.`, booking_status: status });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'Failed to update the booking status.');
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Reviews & complaints
// ---------------------------------------------------------------------------

router.get('/admin/reviews', async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const { provider_id: providerId, rating } = req.query;
    const hidden = req.query.hidden;

    if (providerId !== undefined && !parseId(providerId)) return badRequest(res, 'Invalid provider id filter.');
    if (rating !== undefined && ![1, 2, 3, 4, 5].includes(Number(rating))) {
        return badRequest(res, 'Rating filter must be between 1 and 5.');
    }
    if (hidden !== undefined && !['true', 'false'].includes(hidden)) {
        return badRequest(res, 'hidden must be true or false.');
    }

    const conditions = [];
    const values = [];
    const push = (sql, value) => {
        values.push(value);
        conditions.push(sql.replace('$?', `$${values.length}`));
    };

    if (providerId) push('r.provider_id = $?', parseId(providerId));
    if (rating) push('r.rating = $?', Number(rating));
    if (hidden !== undefined) push('r.is_hidden = $?', hidden === 'true');

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM reviews r ${where}`,
            values
        );
        const listValues = [...values, limit, offset];
        const listResult = await pool.query(
            `SELECT r.id, r.booking_id, r.customer_id, r.provider_id, r.rating, r.comment,
                    r.created_at, r.is_hidden, r.moderation_reason, r.moderated_at,
                    p.display_name AS provider_name,
                    u.email AS customer_email
             FROM reviews r
             JOIN providers p ON p.id = r.provider_id
             JOIN users u ON u.id = r.customer_id
             ${where}
             ORDER BY r.created_at DESC, r.id DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
            listValues
        );

        res.status(200).json({
            data: listResult.rows,
            pagination: buildPaginationMeta(countResult.rows[0].total, page, limit),
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch reviews.');
    }
});

router.patch('/admin/reviews/:id/moderate', async (req, res) => {
    const id = parseId(req.params.id);
    const action = req.body && req.body.action;
    const reason = normaliseReason(req.body && req.body.reason);

    if (!id) return badRequest(res, 'Invalid review id.');
    if (!['hide', 'unhide'].includes(action)) {
        return badRequest(res, "Action must be 'hide' or 'unhide'.");
    }
    if (action === 'hide' && !reason) {
        return badRequest(res, 'A reason is required to hide a review.');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const updateResult = await client.query(
            `UPDATE reviews
             SET is_hidden = $1, moderation_reason = $2, moderated_by = $3, moderated_at = CURRENT_TIMESTAMP
             WHERE id = $4
             RETURNING id, provider_id, is_hidden`,
            [action === 'hide', reason || null, req.admin.id, id]
        );
        const review = updateResult.rows[0];
        if (!review) {
            await client.query('ROLLBACK');
            return notFound(res, 'Review not found.');
        }

        // Rating aggregates only include visible reviews.
        await client.query(
            `UPDATE providers p
             SET average_rating = COALESCE(
                    (SELECT ROUND(AVG(r.rating)::numeric, 2) FROM reviews r
                     WHERE r.provider_id = $1 AND r.is_hidden = FALSE), 0),
                 review_count = (SELECT COUNT(*) FROM reviews r
                                 WHERE r.provider_id = $1 AND r.is_hidden = FALSE),
                 updated_at = CURRENT_TIMESTAMP
             WHERE p.id = $1`,
            [review.provider_id]
        );

        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: action === 'hide' ? 'review.hide' : 'review.unhide',
            targetType: 'review',
            targetId: id,
            reason: reason || null,
            metadata: { provider_id: review.provider_id },
        });
        await client.query('COMMIT');

        res.status(200).json({
            message: `Review ${id} ${action === 'hide' ? 'hidden' : 'restored'}.`,
            is_hidden: review.is_hidden,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'Failed to moderate the review.');
    } finally {
        client.release();
    }
});

router.get('/admin/complaints', async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    const resolved = req.query.resolved;

    if (resolved !== undefined && !['true', 'false'].includes(resolved)) {
        return badRequest(res, 'resolved must be true or false.');
    }

    const values = [];
    let where = '';
    if (resolved !== undefined) {
        values.push(resolved === 'true');
        where = `WHERE is_resolved = $${values.length}`;
    }

    try {
        const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM contact_messages ${where}`, values);
        const listValues = [...values, limit, offset];
        const listResult = await pool.query(
            `SELECT id, sender_name, sender_email, message, is_resolved, created_at
             FROM contact_messages
             ${where}
             ORDER BY is_resolved ASC, created_at DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
            listValues
        );

        res.status(200).json({
            data: listResult.rows,
            pagination: buildPaginationMeta(countResult.rows[0].total, page, limit),
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch complaints.');
    }
});

router.patch('/admin/complaints/:id/resolve', async (req, res) => {
    const id = parseId(req.params.id);
    const resolved = req.body && req.body.resolved;
    const note = normaliseReason(req.body && req.body.note);

    if (!id) return badRequest(res, 'Invalid complaint id.');
    if (typeof resolved !== 'boolean') return badRequest(res, 'resolved must be a boolean.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            'UPDATE contact_messages SET is_resolved = $1 WHERE id = $2 RETURNING id, is_resolved',
            [resolved, id]
        );
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return notFound(res, 'Complaint not found.');
        }

        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: resolved ? 'complaint.resolve' : 'complaint.reopen',
            targetType: 'contact_message',
            targetId: id,
            reason: note || null,
        });
        await client.query('COMMIT');

        res.status(200).json({ message: `Complaint ${id} ${resolved ? 'resolved' : 'reopened'}.` });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'Failed to update the complaint.');
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

async function listAuditLogs(req, res) {
    const { page, limit, offset } = parsePagination(req.query);
    const { admin_id: adminId, action, target_type: targetType } = req.query;

    if (adminId !== undefined && !parseId(adminId)) return badRequest(res, 'Invalid admin id filter.');

    const conditions = [];
    const values = [];
    const push = (sql, value) => {
        values.push(value);
        conditions.push(sql.replace('$?', `$${values.length}`));
    };

    if (adminId) push('l.admin_id = $?', parseId(adminId));
    if (action) push('l.action ILIKE $?', `%${action}%`);
    if (targetType) push('l.target_type = $?', targetType);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM admin_audit_logs l ${where}`, values);
        const listValues = [...values, limit, offset];
        const listResult = await pool.query(
            `SELECT l.id, l.admin_id, a.email AS admin_email, l.action, l.target_type,
                    l.target_id, l.reason, l.metadata, l.created_at
             FROM admin_audit_logs l
             JOIN users a ON a.id = l.admin_id
             ${where}
             ORDER BY l.created_at DESC, l.id DESC
             LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
            listValues
        );

        res.status(200).json({
            data: listResult.rows,
            pagination: buildPaginationMeta(countResult.rows[0].total, page, limit),
        });
    } catch (err) {
        fail(res, err, 'Failed to fetch audit logs.');
    }
}

router.get('/admin/audit-logs', listAuditLogs);

// ---------------------------------------------------------------------------
// Platform settings
// ---------------------------------------------------------------------------

router.get('/admin/settings', async (req, res) => {
    try {
        const settings = await getSettings(pool);
        const definitions = Object.entries(SETTING_DEFINITIONS).map(([key, definition]) => ({
            key,
            type: definition.type,
            default: definition.default,
            ...(definition.min !== undefined ? { min: definition.min, max: definition.max } : {}),
            ...(definition.values ? { values: definition.values } : {}),
        }));
        res.status(200).json({ settings, definitions });
    } catch (err) {
        fail(res, err, 'Failed to load platform settings.');
    }
});

router.patch('/admin/settings', async (req, res) => {
    const body = (req.body && (req.body.settings || req.body)) || {};
    const updates = {};

    for (const [key, value] of Object.entries(body)) {
        if (!SETTING_DEFINITIONS[key]) {
            return badRequest(res, `Unknown or non-editable setting: ${key}`);
        }
        updates[key] = value;
    }
    if (Object.keys(updates).length === 0) return badRequest(res, 'No settings were provided.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const settings = await updateSettings(client, updates, req.admin.id);
        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'settings.update',
            targetType: 'platform_settings',
            metadata: { changed_keys: Object.keys(updates), new_values: updates },
        });
        await client.query('COMMIT');
        res.status(200).json({ message: 'Platform settings updated.', settings });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.statusCode === 400) return badRequest(res, err.message);
        fail(res, err, 'Failed to update platform settings.');
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Wallet requests (existing feature, kept and audited)
// ---------------------------------------------------------------------------

router.get('/admin/wallet-requests', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT wr.id, wr.user_id, wr.type, wr.amount, wr.transaction_reference,
                    wr.screenshot_url, wr.requested_at, u.email, u.role, wr.status
             FROM wallet_requests wr
             JOIN users u ON wr.user_id = u.id
             ORDER BY wr.status, wr.requested_at ASC`
        );
        res.status(200).json(result.rows);
    } catch (err) {
        fail(res, err, 'Failed to fetch wallet requests.');
    }
});

router.put('/admin/wallet-requests/:id/approve', async (req, res) => {
    const requestId = parseId(req.params.id);
    if (!requestId) return badRequest(res, 'Invalid request id.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const requestResult = await client.query(
            'SELECT id, user_id, type, amount, status FROM wallet_requests WHERE id = $1 AND status = $2 FOR UPDATE',
            [requestId, 'pending']
        );
        const request = requestResult.rows[0];
        if (!request) {
            await client.query('ROLLBACK');
            return notFound(res, 'Pending request not found.');
        }

        const { user_id: userId, type, amount } = request;
        const adjustment = type === 'deposit' ? amount : -amount;

        await client.query('INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
        const walletUpdate = await client.query(
            'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 RETURNING balance',
            [adjustment, userId]
        );

        if (type === 'withdrawal' && walletUpdate.rows[0].balance < 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Withdrawal failed: insufficient funds.' });
        }

        await client.query(
            'INSERT INTO transactions (user_id, type, amount) VALUES ($1, $2, $3)',
            [userId, type === 'deposit' ? 'deposit_admin_approved' : 'withdrawal_sent', amount]
        );
        await client.query(
            'UPDATE wallet_requests SET status = $1, processed_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['approved', requestId]
        );
        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'wallet_request.approve',
            targetType: 'wallet_request',
            targetId: requestId,
            metadata: { user_id: userId, type, amount: Number(amount) },
        });

        await client.query('COMMIT');
        res.status(200).json({
            message: `${type.toUpperCase()} request #${requestId} approved. Balance updated.`,
            new_balance: parseFloat(walletUpdate.rows[0].balance),
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'An error occurred during approval.');
    } finally {
        client.release();
    }
});

router.put('/admin/wallet-requests/:id/reject', async (req, res) => {
    const requestId = parseId(req.params.id);
    const reason = normaliseReason(req.body && req.body.reason);
    if (!requestId) return badRequest(res, 'Invalid request id.');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(
            `UPDATE wallet_requests
             SET status = 'rejected', processed_at = CURRENT_TIMESTAMP, transaction_reference = $1
             WHERE id = $2 AND status = 'pending'
             RETURNING id`,
            [reason || 'Rejected by Admin.', requestId]
        );
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return notFound(res, 'Pending request not found or already processed.');
        }
        await recordAdminAction(client, {
            adminId: req.admin.id,
            action: 'wallet_request.reject',
            targetType: 'wallet_request',
            targetId: requestId,
            reason: reason || null,
        });
        await client.query('COMMIT');

        res.status(200).json({ message: `Request #${requestId} rejected.` });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        fail(res, err, 'An error occurred during rejection.');
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------------
// Legacy compatibility aliases
// ---------------------------------------------------------------------------

router.get('/admin/overview-metrics', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                (SELECT COUNT(*)::int FROM users) AS total_users,
                (SELECT COUNT(*)::int FROM bookings) AS total_bookings,
                (SELECT COUNT(*)::int FROM providers WHERE verification_status <> 'approved') AS pending_verification,
                (SELECT COUNT(*)::int FROM wallet_requests WHERE status = 'pending' AND type = 'deposit') AS pending_deposits,
                (SELECT COUNT(*)::int FROM wallet_requests WHERE status = 'pending' AND type = 'withdrawal') AS pending_withdrawals
        `);
        res.status(200).json(result.rows[0]);
    } catch (err) {
        fail(res, err, 'Failed to fetch overview metrics.');
    }
});

router.get('/admin/contact-messages', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, sender_name, sender_email, message, is_resolved, created_at FROM contact_messages ORDER BY created_at DESC'
        );
        res.status(200).json(result.rows);
    } catch (err) {
        fail(res, err, 'Failed to fetch contact messages.');
    }
});

module.exports = router;
