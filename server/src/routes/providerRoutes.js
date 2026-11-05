// backend/src/routes/providerRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../../middleware/auth');
const { isValidLatitude, isValidLongitude, parseProviderRadius } = require('../utils/geo');
const { getSettings } = require('../services/settings');

// NOTE: sendEmail is not strictly needed for the routes below but is included
// for consistency if future routes require it.
const { sendEmail } = require('../config/nodemailer');

/**
 * @route GET /api/v1/provider/earnings
 * @desc Get provider earnings and performance analytics
 * @access Private (Provider only)
 */
router.get('/provider/earnings', auth, async (req, res) => {
    const { id: user_id, role } = req.user;
    if (role !== 'provider') {
        return res.status(403).json({ error: 'Access denied. Only providers can view earnings.' });
    }

    try {
        const analyticsQuery = `
            SELECT
                w.balance AS wallet_balance,
                p.average_rating,
                p.review_count,
                COUNT(b.id) FILTER (WHERE b.booking_status = 'closed' AND b.amount IS NOT NULL) AS completed_jobs,
                -- FIX: Total earnings sum should track all money CREDITED from payments
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'payment_received' OR t.type = 'deposit_admin_approved'), 0) AS total_money_credited
            FROM users u
            JOIN providers p ON u.id = p.user_id
            LEFT JOIN wallets w ON w.user_id = u.id
            LEFT JOIN bookings b ON b.provider_id = p.id
            LEFT JOIN transactions t ON t.user_id = u.id
            WHERE u.id = $1
            GROUP BY w.balance, p.average_rating, p.review_count;
        `;

        const result = await pool.query(analyticsQuery, [user_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Provider analytics not found.' });
        }

        const row = result.rows[0];

        res.status(200).json({
            message: 'Provider analytics retrieved successfully.',
            analytics: {
                wallet_balance: parseFloat(row.wallet_balance || 0),
                average_rating: parseFloat(row.average_rating || 0),
                review_count: parseInt(row.review_count || 0, 10),
                completed_jobs: parseInt(row.completed_jobs || 0, 10),
                // FIX: Use total_money_credited as total_earnings
                total_earnings: parseFloat(row.total_money_credited || 0),
            }
        });

    } catch (err) {
        console.error('Provider earnings fetch error:', err);
        res.status(500).json({ error: 'An error occurred during earnings fetch.' });
    }
});

/**
 * @route GET /api/v1/provider/profile
 * @desc Get provider profile details
 * @access Private (Provider only)
 */
router.get('/provider/profile', auth, async (req, res) => {
    const { id: user_id, role } = req.user;
    if (role !== 'provider') {
        return res.status(403).json({ error: 'Access denied. Only providers can view profiles.' });
    }

    try {
        // FIX: Corrected column name to profile_picture_url
        const profileQuery = `
            SELECT p.*, ARRAY_AGG(ps.service_id) AS service_ids, u.profile_picture_url
            FROM providers p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN provider_services ps ON p.id = ps.provider_id
            WHERE p.user_id = $1
            GROUP BY p.id, u.profile_picture_url;
        `;
        const result = await pool.query(profileQuery, [user_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Provider profile not found. Complete setup first.' });
        }

        const profile = result.rows[0];
        profile.service_ids = Array.isArray(profile.service_ids) ? profile.service_ids.filter(id => id !== null) : [];

        res.status(200).json({
            message: 'Provider profile retrieved successfully.',
            provider_profile: profile
        });

    } catch (err) {
        console.error('Provider profile fetch error:', err);
        res.status(500).json({ error: 'An error occurred during profile fetch.' });
    }
});

/**
 * @route POST /api/v1/provider/profile
 * @desc Create or update provider profile details
 * @access Private (Provider only)
 */
router.post('/provider/profile', auth, async (req, res) => {
    const { id: user_id, role } = req.user;
    if (role !== 'provider') {
        return res.status(403).json({ error: 'Access denied. Only providers can update profiles.' });
    }

    const { display_name, bio, location_lat, location_lon, service_radius_km, service_ids, payout_upi_id } = req.body;

    if (!display_name || !bio || !service_ids || !Array.isArray(service_ids) || service_ids.length === 0) {
        return res.status(400).json({ error: 'Display name, bio, and at least one service ID are required.' });
    }

    // Payout UPI ID is only validated/updated if present in the request body (allows separate form updates)
    if (!payout_upi_id && req.body.hasOwnProperty('payout_upi_id')) {
        return res.status(400).json({ error: 'Payout UPI ID is required.' });
    }

    // Location is required for discovery: without a real coordinate the provider
    // cannot appear in distance searches. (0, 0) is rejected as "not a location".
    const lat = Number(location_lat);
    const lon = Number(location_lon);
    if (location_lat === undefined || location_lat === null || location_lat === '' || !isValidLatitude(lat)) {
        return res.status(400).json({ error: 'A valid service latitude between -90 and 90 is required.' });
    }
    if (location_lon === undefined || location_lon === null || location_lon === '' || !isValidLongitude(lon)) {
        return res.status(400).json({ error: 'A valid service longitude between -180 and 180 is required.' });
    }
    if (lat === 0 && lon === 0) {
        return res.status(400).json({ error: 'Please provide your real service location (0, 0 is not valid).' });
    }

    const radiusKm = parseProviderRadius(service_radius_km, 10);
    const uniqueServiceIds = [...new Set(service_ids.map((id) => Number(id)).filter(Number.isInteger))];
    if (uniqueServiceIds.length === 0) {
        return res.status(400).json({ error: 'At least one valid service ID is required.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const servicesExist = await client.query(
            'SELECT id FROM services WHERE id = ANY($1::int[]) AND is_active = TRUE',
            [uniqueServiceIds]
        );
        if (servicesExist.rowCount !== uniqueServiceIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'One or more selected services do not exist or are inactive.' });
        }

        let updateFields = 'display_name = $1, bio = $2, location_lat = $3, location_lon = $4, service_radius_km = $5, updated_at = CURRENT_TIMESTAMP';
        let updateParams = [display_name, bio, lat, lon, radiusKm];

        if (payout_upi_id !== undefined) {
             updateFields += `, payout_upi_id = $${updateParams.length + 1}`;
             updateParams.push(payout_upi_id);
        }
        updateParams.push(user_id); // User ID is the last parameter

        const updateQuery = `
            UPDATE providers
            SET ${updateFields}
            WHERE user_id = $${updateParams.length}
            RETURNING id, verification_status;
        `;
        const result = await client.query(updateQuery, updateParams);

        if (result.rows.length === 0) {
             throw new Error('Provider record not found for this user_id. Setup failed.');
        }

        const provider_id = result.rows[0].id;

        await client.query('DELETE FROM provider_services WHERE provider_id = $1', [provider_id]);

        const serviceInserts = uniqueServiceIds.map(service_id =>
            client.query('INSERT INTO provider_services (provider_id, service_id) VALUES ($1, $2)', [provider_id, service_id])
        );
        await Promise.all(serviceInserts);

        // Optional auto-approval policy (default is manual review). Never
        // overrides a rejected or suspended provider.
        let verificationStatus = result.rows[0].verification_status;
        if (['pending', 'under_review'].includes(verificationStatus)) {
            const settings = await getSettings(client);
            if (settings.provider_approval_policy === 'auto') {
                const approved = await client.query(
                    `UPDATE providers
                     SET verification_status = 'approved', verified_at = CURRENT_TIMESTAMP
                     WHERE id = $1
                     RETURNING verification_status`,
                    [provider_id]
                );
                verificationStatus = approved.rows[0].verification_status;
            }
        }

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Provider profile updated successfully.',
            provider_id: provider_id,
            verification_status: verificationStatus
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Provider profile update error (Details):', err);
        res.status(500).json({ error: 'An error occurred during profile update.' });
    } finally {
        client.release();
    }
});


/**
 * @route GET /api/v1/provider/bookings
 * @desc Get all bookings associated with the logged-in provider
 * @access Private (Provider only)
 */
router.get('/provider/bookings', auth, async (req, res) => {
    const { id: provider_user_id, role } = req.user;
    if (role !== 'provider') {
        return res.status(403).json({ error: 'Access denied. Only providers can view their bookings.' });
    }

    try {
        const providerResult = await pool.query('SELECT id FROM providers WHERE user_id = $1', [provider_user_id]);
        if (providerResult.rows.length === 0) {
            return res.status(404).json({ error: 'Provider profile not found.' });
        }
        const provider_id = providerResult.rows[0].id;

        const bookingsQuery = `
            SELECT
                b.id, b.scheduled_at, b.address, b.customer_notes, b.booking_status, b.amount, b.service_description,
                u.email AS customer_email, u.profile_picture_url AS customer_photo, s.name AS service_name, b.customer_id
            FROM bookings b
            JOIN services s ON b.service_id = s.id
            JOIN users u ON b.customer_id = u.id
            WHERE b.provider_id = $1
            ORDER BY b.scheduled_at DESC;
        `;
        const result = await pool.query(bookingsQuery, [provider_id]);

        res.status(200).json({
            message: `${result.rows.length} bookings retrieved.`,
            bookings: result.rows
        });

    } catch (err) {
        console.error('Provider bookings fetch error:', err);
        res.status(500).json({ error: 'An error occurred while fetching provider bookings.' });
    }
});


/**
 * @route POST /api/v1/provider/wallet/withdraw-request
 * @desc Provider submits a withdrawal request.
 * @access Private (Provider only)
 */
router.post('/provider/wallet/withdraw-request', auth, async (req, res) => {
    const { id: user_id, role } = req.user;
    const { amount, transaction_reference } = req.body; // transaction_reference holds UPI ID or Bank details

    if (role !== 'provider') {
        return res.status(403).json({ error: 'Access denied. Only providers can request withdrawals.' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'Invalid withdrawal amount.' });
    }
    if (!transaction_reference) {
         return res.status(400).json({ error: 'UPI ID or Bank Details are required for withdrawal.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Check if balance is sufficient (FOR UPDATE to lock row)
        const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [user_id]);
        const currentBalance = parseFloat(walletResult.rows[0]?.balance || 0);

        if (amount > currentBalance) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Insufficient wallet balance for withdrawal request.' });
        }

        // 2. Insert withdrawal request
        const result = await client.query(
            'INSERT INTO wallet_requests (user_id, type, amount, transaction_reference) VALUES ($1, $2, $3, $4) RETURNING id',
            [user_id, 'withdrawal', amount, transaction_reference]
        );

        await client.query('COMMIT');

        // Notify admin via email (optional in mock, but good practice)
        console.log(`NEW WITHDRAWAL REQUEST: User ${user_id} for ${amount}. Request ID: ${result.rows[0].id}`);

        res.status(201).json({
            message: 'Withdrawal request submitted for admin approval.',
            request_id: result.rows[0].id
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Withdrawal request error:', err);
        res.status(500).json({ error: 'An error occurred during withdrawal request.' });
    } finally {
        client.release();
    }
});

module.exports = router;