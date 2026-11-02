// backend/src/routes/customerRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../../middleware/auth');

// Deposit screenshots are uploaded with the shared uploader.
const { createUploader, imageOnly } = require('../config/upload');
const { buildFileUrl } = require('../utils/helpers');

const upload = createUploader({
    prefix: 'deposit',
    allowed: imageOnly,
    rejectionMessage: 'Only images are allowed for deposit proof!',
});



/**
 * @route GET /api/v1/customer/bookings
 * @desc Get all bookings associated with the logged-in customer
 * @access Private (Customer only)
 */
router.get('/customer/bookings', auth, async (req, res) => {
    const { id: customer_user_id, role } = req.user;
    if (role !== 'customer') {
        return res.status(403).json({ error: 'Access denied. Only customers can view their bookings.' });
    }

    try {
        const bookingsQuery = `
            SELECT
                b.id, b.scheduled_at, b.address, b.customer_notes, b.booking_status, b.amount, b.service_description,
                p.display_name AS provider_name, s.name AS service_name, b.provider_id, u.profile_picture_url AS provider_photo
            FROM bookings b
            JOIN providers p ON b.provider_id = p.id
            JOIN services s ON b.service_id = s.id
            JOIN users u ON p.user_id = u.id
            WHERE b.customer_id = $1
            ORDER BY b.scheduled_at DESC;
        `;
        const result = await pool.query(bookingsQuery, [customer_user_id]);

        res.status(200).json({
            message: `${result.rows.length} bookings retrieved.`,
            bookings: result.rows
        });

    } catch (err) {
        console.error('Customer bookings fetch error:', err);
        res.status(500).json({ error: 'An error occurred while fetching customer bookings.' });
    }
});

/**
 * @route POST /api/v1/customer/wallet/deposit-request
 * @desc Customer submits a deposit request after paying via QR/UPI.
 * @access Private (Customer only)
 */
router.post('/customer/wallet/deposit-request', auth, upload.single('screenshot_file'), async (req, res) => {
    const { id: user_id, role } = req.user;
    const { amount: amountStr, transaction_reference } = req.body;
    const file = req.file;

    if (role !== 'customer') {
        return res.status(403).json({ error: 'Access denied. Only customers can request deposits.' });
    }

    // Multer error handling should be done at the entry point if this was the main app,
    // but here we check for the file existence after the middleware runs.

    const amount = parseFloat(amountStr);

    if (typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ error: 'Invalid deposit amount.' });
    }
    if (!transaction_reference) {
         return res.status(400).json({ error: 'UPI Transaction Reference is required.' });
    }
    if (!file) {
        // If file is missing after upload attempt, it might be due to a Multer error
        // captured in index.js, but here we perform a direct check.
        return res.status(400).json({ error: 'Screenshot proof is required.' });
    }

    const screenshotUrl = `${buildFileUrl(req, file.filename)}`;


    try {
        const result = await pool.query(
            'INSERT INTO wallet_requests (user_id, type, amount, transaction_reference, screenshot_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [user_id, 'deposit', amount, transaction_reference, screenshotUrl]
        );

        // Notify admin via email (optional in mock, but good practice)
        console.log(`NEW DEPOSIT REQUEST: User ${user_id} for ${amount}. Request ID: ${result.rows[0].id}`);

        res.status(201).json({
            message: 'Deposit request submitted for admin approval.',
            request_id: result.rows[0].id
        });

    } catch (err) {
        console.error('Deposit request error:', err);
        res.status(500).json({ error: 'An error occurred during deposit request.' });
    }
});


module.exports = router;