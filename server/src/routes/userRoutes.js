// backend/src/routes/userRoutes.js

const express = require('express');
const multer = require('multer');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../../middleware/auth');
const { createUploader, imageOrPdf } = require('../config/upload');
const { buildFileUrl } = require('../utils/helpers');

// Shared uploader (destination, 5 MB limit and mime whitelist live in config/upload.js)
const upload = createUploader({
    prefix: 'profile',
    allowed: imageOrPdf,
    rejectionMessage: 'Only images and PDF files are allowed!',
});



/**
 * @route GET /api/v1/user/profile
 * @desc Get authenticated user profile data
 * @access Private
 */
router.get('/user/profile', auth, async (req, res) => {
    const user_id = req.user.id;
    const role = req.user.role;

    try {
        // FIX: Corrected column name to profile_picture_url
        const userResult = await pool.query('SELECT id, email, role, created_at, profile_picture_url FROM users WHERE id = $1', [user_id]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(404).json({ msg: 'User not found.' });
        }

        if (role === 'customer') {
            const profileQuery = `
                SELECT
                    cp.full_name, cp.phone_number, cp.address_line_1, cp.city, cp.location_lat, cp.location_lon
                FROM customer_profiles cp
                WHERE cp.user_id = $1
            `;
            const profileResult = await pool.query(profileQuery, [user_id]);
            user.profile = profileResult.rows[0] || {};
        }

        res.status(200).json({
            message: 'Profile data retrieved successfully.',
            user_profile: user
        });
    } catch (err) {
        console.error('User profile fetch error:', err);
        res.status(500).json({ error: 'An error occurred while fetching the profile.' });
    }
});

/**
 * @route PUT /api/v1/user/profile
 * @desc Update authenticated user profile data (email and customer profile details)
 * @access Private
 */
router.put('/user/profile', auth, async (req, res) => {
    const { email, full_name, phone_number, address_line_1, city, location_lat, location_lon } = req.body;
    const user_id = req.user.id;
    const role = req.user.role;

    if (!email) {
        return res.status(400).json({ error: 'Email is required for update.' });
    }

    const lat = location_lat ? parseFloat(location_lat) : null;
    const lon = location_lon ? parseFloat(location_lon) : null;


    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Check if the new email already exists for another user
        const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, user_id]);
        if (emailCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Email already in use by another account.' });
        }

        // 2. Update the user email
        await client.query(
            'UPDATE users SET email = $1 WHERE id = $2',
            [email, user_id]
        );

        // 3. Update customer profile if the user is a customer
        if (role === 'customer') {
            const updateCustomerQuery = `
                INSERT INTO customer_profiles (user_id, full_name, phone_number, address_line_1, city, location_lat, location_lon)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (user_id)
                DO UPDATE SET
                    full_name = COALESCE($2, customer_profiles.full_name),
                    phone_number = COALESCE($3, customer_profiles.phone_number),
                    address_line_1 = COALESCE($4, customer_profiles.address_line_1),
                    city = COALESCE($5, customer_profiles.city),
                    location_lat = COALESCE($6, customer_profiles.location_lat),
                    location_lon = COALESCE($7, customer_profiles.location_lon),
                    updated_at = CURRENT_TIMESTAMP
                WHERE customer_profiles.user_id = $1;
            `;
            await client.query(updateCustomerQuery, [
                user_id,
                full_name,
                phone_number,
                address_line_1,
                city,
                lat,
                lon
            ]);
        }

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Profile updated successfully.',
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('User profile update error:', err);
        res.status(500).json({ error: 'An error occurred during profile update.' });
    } finally {
        client.release();
    }
});

/**
 * @route POST /api/v1/user/profile-photo
 * @desc Uploads and updates authenticated user's profile picture.
 * @access Private
 */
router.post('/user/profile-photo', auth, (req, res, next) => {
    // Single file upload middleware, field name is 'profile_photo'
    // NOTE: The client sends the file under the name 'profile_photo'
    upload.single('profile_photo')(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            // A Multer error occurred when uploading.
            return res.status(400).json({ error: err.message });
        } else if (err) {
            // An unknown error occurred.
            return res.status(500).json({ error: err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const user_id = req.user.id;
        // Construct file URL using the request host
        const fileUrl = `${buildFileUrl(req, req.file.filename)}`;

        try {
            // FIX: Corrected column name to profile_picture_url
            await pool.query(
                'UPDATE users SET profile_picture_url = $1 WHERE id = $2',
                [fileUrl, user_id]
            );

            res.status(200).json({
                message: 'Profile picture uploaded successfully.',
                profile_picture_url: fileUrl // Sending the correct key back
            });
        } catch (dbError) {
            console.error('DB update error on profile photo:', dbError);
            res.status(500).json({ error: 'Failed to save photo URL to database.' });
        }
    });
});


/**
 * @route GET /api/v1/user/wallet
 * @desc Get authenticated user's wallet balance
 * @access Private
 */
router.get('/user/wallet', auth, async (req, res) => {
    const user_id = req.user.id;

    try {
        const walletQuery = await pool.query(
            'SELECT balance FROM wallets WHERE user_id = $1',
            [user_id]
        );

        if (walletQuery.rows.length === 0) {
            // This should not happen if the registration flow is correct, but handle it gracefully
            await pool.query('INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [user_id]);
            return res.status(200).json({ balance: 0.00 });
        }

        // NEW: Also fetch pending requests count
        const pendingRequests = await pool.query(
            'SELECT COUNT(id) FROM wallet_requests WHERE user_id = $1 AND status = $2',
            [user_id, 'pending']
        );


        res.status(200).json({
            message: 'Wallet balance retrieved successfully.',
            balance: parseFloat(walletQuery.rows[0].balance),
            pending_requests_count: parseInt(pendingRequests.rows[0].count, 10)
        });
    } catch (err) {
        console.error('Wallet fetch error:', err);
        res.status(500).json({ error: 'An error occurred while retrieving the wallet.' });
    }
});


/**
 * @route GET /api/v1/user/unread-messages
 * @desc Retrieve count of unread messages for the logged-in user
 * @access Private
 */
router.get('/user/unread-messages', auth, async (req, res) => {
    const user_id = req.user.id;

    try {
        const countQuery = `
            SELECT COUNT(m.id) AS unread_count
            FROM messages m
            WHERE m.recipient_id = $1 AND m.is_read = FALSE;
        `;
        const result = await pool.query(countQuery, [user_id]);

        res.status(200).json({
            unread_count: parseInt(result.rows[0].unread_count, 10)
        });

    } catch (err) {
        console.error('Unread count fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch unread count.' });
    }
});

/**
 * @route PUT /api/v1/messages/read
 * @desc Mark all messages for a specific booking chat as read
 * @access Private
 */
router.put('/messages/read', auth, async (req, res) => {
    const { id: user_id } = req.user;
    const { booking_id } = req.body;

    if (!booking_id) {
        return res.status(400).json({ error: 'Booking ID is required.' });
    }

    try {
        // Only mark as read messages where the logged-in user is the recipient
        const updateQuery = `
            UPDATE messages
            SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE booking_id = $1 AND recipient_id = $2 AND is_read = FALSE;
        `;
        await pool.query(updateQuery, [booking_id, user_id]);

        res.status(200).json({ message: 'Messages marked as read.' });

    } catch (err) {
        console.error('Mark read error:', err.message);
        res.status(500).json({ error: 'Failed to mark messages as read.' });
    }
});


module.exports = router;