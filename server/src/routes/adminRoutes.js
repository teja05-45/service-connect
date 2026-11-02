const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../../middleware/auth'); // Import auth middleware (attaches req.user)


// --- Middleware Function to ensure Admin Role ---
const isAdmin = (req, res, next) => {
    // req.user is guaranteed to exist because 'auth' middleware is applied first.
    if (req.user?.role !== 'admin') {
        // Log the role that failed the check for debugging
        console.warn(`Admin access denied for user ID ${req.user?.id || 'N/A'}. Role: ${req.user?.role || 'N/A'}`);
        return res.status(403).json({ msg: 'Access denied. Admin role required.' });
    }
    next();
};


// 1. Apply the auth middleware and the isAdmin check to ALL requests coming through this router.
// This is the cleanest way to secure all admin endpoints.
// Scope the guard to /admin/* only. Mounting it router-wide at /api/v1 also
// intercepted unknown API paths, turning 404s into 401s.
router.use('/admin', auth, isAdmin);


/**
 * @route GET /api/v1/admin/overview-metrics
 * @desc Get key counts for Admin Overview, including pending wallet requests
 * @access Private (Admin only, enforced by router.use above)
 */
router.get('/admin/overview-metrics', async (req, res) => {
    try {
        const totalUsers = await pool.query('SELECT COUNT(id) FROM users');
        const totalBookings = await pool.query('SELECT COUNT(id) FROM bookings');
        const pendingVerification = await pool.query('SELECT COUNT(id) FROM providers WHERE is_verified = FALSE');

        // FIX: Fetch counts of pending wallet requests (Deposit and Withdrawal)
        const pendingDeposits = await pool.query("SELECT COUNT(id) FROM wallet_requests WHERE status = 'pending' AND type = 'deposit'");
        const pendingWithdrawals = await pool.query("SELECT COUNT(id) FROM wallet_requests WHERE status = 'pending' AND type = 'withdrawal'");

        res.status(200).json({
            total_users: parseInt(totalUsers.rows[0].count, 10),
            total_bookings: parseInt(totalBookings.rows[0].count, 10),
            pending_verification: parseInt(pendingVerification.rows[0].count, 10),
            pending_deposits: parseInt(pendingDeposits.rows[0].count, 10),
            pending_withdrawals: parseInt(pendingWithdrawals.rows[0].count, 10),
        });
    } catch (err) {
        console.error('Admin overview metric fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch overview metrics.' });
    }
});


/**
 * @route GET /api/v1/admin/contact-messages
 * @desc Get all contact form messages
 * @access Private (Admin only)
 */
router.get('/admin/contact-messages', async (req, res) => {
    try {
        // Assumes contact_messages table exists
        const query = 'SELECT * FROM contact_messages ORDER BY created_at DESC';
        const result = await pool.query(query);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Admin contact message fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch contact messages.' });
    }
});


/**
 * @route GET /api/v1/admin/wallet-requests
 * @desc Get all pending wallet requests (deposit/withdrawal)
 * @access Private (Admin only)
 */
router.get('/admin/wallet-requests', async (req, res) => {
    try {
        const query = `
            SELECT
                wr.id,
                wr.user_id,
                wr.type,
                wr.amount,
                wr.transaction_reference,
                wr.screenshot_url,
                wr.requested_at,
                u.email,
                u.role,
                wr.status
            FROM wallet_requests wr
            JOIN users u ON wr.user_id = u.id
            ORDER BY wr.status, wr.requested_at ASC;
        `;
        const result = await pool.query(query);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Admin wallet request fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch wallet requests.' });
    }
});

/**
 * @route PUT /api/v1/admin/wallet-requests/:id/approve
 * @desc Admin approves a wallet request and updates balances/transactions.
 * @access Private (Admin only)
 */
router.put('/admin/wallet-requests/:id/approve', async (req, res) => {
    const request_id = req.params.id;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Fetch and lock the request
        const requestResult = await client.query(
            'SELECT id, user_id, type, amount, status FROM wallet_requests WHERE id = $1 AND status = $2 FOR UPDATE',
            [request_id, 'pending']
        );
        const request = requestResult.rows[0];

        if (!request) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pending request not found.' });
        }

        const { user_id, type, amount } = request;
        const adjustment = type === 'deposit' ? amount : -amount;
        const txnType = type === 'deposit' ? 'deposit_admin_approved' : 'withdrawal_sent';

        // 2. Make sure a wallet row exists (older accounts may not have one),
        // then update the balance.
        await client.query(
            'INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [user_id]
        );

        const walletUpdate = await client.query(
            'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2 RETURNING balance',
            [adjustment, user_id]
        );

        // Safety check for withdrawal to prevent negative balance if balance changed externally
        if (type === 'withdrawal' && walletUpdate.rows[0].balance < 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Withdrawal failed: Insufficient funds or concurrent modification.' });
        }


        // 3. Log transaction
        await client.query(
            'INSERT INTO transactions (user_id, type, amount) VALUES ($1, $2, $3)',
            [user_id, txnType, amount]
        );

        // 4. Update request status
        await client.query(
            'UPDATE wallet_requests SET status = $1, processed_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['approved', request_id]
        );

        await client.query('COMMIT');

        res.status(200).json({
            message: `${type.toUpperCase()} request #${request_id} approved. Balance updated.`,
            new_balance: parseFloat(walletUpdate.rows[0].balance)
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Admin request approval error:', err);
        res.status(500).json({ error: 'An error occurred during approval process.' });
    } finally {
        client.release();
    }
});

/**
 * @route PUT /api/v1/admin/wallet-requests/:id/reject
 * @desc Admin rejects a wallet request.
 * @access Private (Admin only)
 */
router.put('/admin/wallet-requests/:id/reject', async (req, res) => {
    const request_id = req.params.id;
    const { reason } = req.body;

    try {
        const result = await pool.query(
            // We use transaction_reference to store rejection reason for simplicity
            'UPDATE wallet_requests SET status = $1, processed_at = CURRENT_TIMESTAMP, transaction_reference = $3 WHERE id = $2 AND status = $4 RETURNING id',
            ['rejected', request_id, reason || 'Rejected by Admin.', 'pending']
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pending request not found or already processed.' });
        }

        res.status(200).json({ message: `Request #${request_id} rejected successfully.` });
    } catch (err) {
        console.error('Admin request rejection error:', err);
        res.status(500).json({ error: 'An error occurred during rejection.' });
    }
});


router.get('/admin/users', async (req, res) => {
    try {
        // FIX: Corrected column name to profile_picture_url
        const result = await pool.query('SELECT id, email, role, status, created_at, profile_picture_url FROM users ORDER BY id DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Admin user fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch user list.' });
    }
});

router.get('/admin/providers', async (req, res) => {
    try {
        const pgQuery = `
            SELECT
                p.id AS id,
                p.display_name,
                p.is_verified,
                p.average_rating,
                p.review_count,
                u.email,
                u.profile_picture_url,
                STRING_AGG(s.name, ', ') AS services_offered
            FROM providers p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN provider_services ps ON p.id = ps.provider_id
            LEFT JOIN services s ON ps.service_id = s.id
            GROUP BY p.id, u.email, u.profile_picture_url
            ORDER BY p.id DESC;
        `;
        const result = await pool.query(pgQuery);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Admin provider fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch provider list.' });
    }
});

router.get('/admin/bookings', async (req, res) => {
    try {
        const query = `
            SELECT
                b.id,
                p.display_name AS provider_name,
                u.email AS customer_email,
                b.scheduled_at,
                b.booking_status,
                b.created_at
            FROM bookings b
            JOIN providers p ON b.provider_id = p.id
            JOIN users u ON b.customer_id = u.id
            ORDER BY b.created_at DESC;
        `;
        const result = await pool.query(query);

        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Admin bookings fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch booking list.' });
    }
});

router.put('/admin/providers/:id/verify', async (req, res) => {
    const provider_id = req.params.id;
    const { is_verified } = req.body;

    if (typeof is_verified !== 'boolean') {
        return res.status(400).json({ error: 'Verification status must be a boolean.' });
    }

    try {
        const result = await pool.query(
            'UPDATE providers SET is_verified = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING user_id',
            [is_verified, provider_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Provider not found.' });
        }

        res.status(200).json({ message: `Provider ${provider_id} verification status set to ${is_verified}.` });
    } catch (err) {
        console.error('Admin verification error:', err);
        res.status(500).json({ error: 'Failed to update verification status.' });
    }
});

module.exports = router;
