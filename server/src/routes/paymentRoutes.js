// backend/src/routes/paymentRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../../middleware/auth');
const { sendEmail } = require('../config/nodemailer');
const { recordBookingStatus } = require('../services/bookingHistory');

/**
 * @route POST /api/v1/payments
 * @desc Capture payment for a completed booking using customer wallet balance.
 * @access Private (Customer only)
 */
router.post('/payments', auth, async (req, res) => {
    const { id: customer_user_id, role } = req.user;
    const { booking_id } = req.body;

    if (role !== 'customer') {
        return res.status(403).json({ msg: 'Access denied. Only customers can make payments.' });
    }
    if (!booking_id) {
        return res.status(400).json({ error: 'Booking ID is required.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Fetch booking details, ensuring it's the customer's and completed
        const bookingResult = await client.query(
            'SELECT customer_id, booking_status, provider_id, amount FROM bookings WHERE id = $1 FOR UPDATE',
            [booking_id]
        );
        const booking = bookingResult.rows[0];

        if (!booking) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Booking not found.' });
        }
        if (booking.customer_id !== customer_user_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Access denied. You do not own this booking.' });
        }
        if (booking.booking_status !== 'completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Cannot process payment. Booking status is '${booking.booking_status}'.` });
        }

        const paymentAmount = parseFloat(booking.amount);
        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Payment amount is invalid or zero.' });
        }

        // 2. Check customer wallet balance
        const customerWallet = await client.query('SELECT balance, user_id FROM wallets WHERE user_id = $1 FOR UPDATE', [customer_user_id]);
        const customerBalance = parseFloat(customerWallet.rows[0]?.balance || 0);

        if (customerBalance < paymentAmount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `Insufficient wallet balance. Required: ₹${paymentAmount.toFixed(2)}` });
        }

        // 3. Process Transaction: Debit Customer
        await client.query(
            'UPDATE wallets SET balance = balance - $1 WHERE user_id = $2',
            [paymentAmount, customer_user_id]
        );
        await client.query(
            `INSERT INTO transactions (user_id, type, amount, related_id)
             VALUES ($1, $2, $3, $4)`,
            [customer_user_id, 'payment_sent', paymentAmount, booking_id]
        );

        // 4. Process Transaction: Credit Provider
        const providerUserResult = await client.query('SELECT user_id FROM providers WHERE id = $1', [booking.provider_id]);
        const provider_user_id = providerUserResult.rows[0]?.user_id;

        if (!provider_user_id) {
            // Should not happen, but safe rollback if provider user ID is missing
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Provider account user ID not found.' });
        }

        await client.query(
            'UPDATE wallets SET balance = balance + $1 WHERE user_id = $2',
            [paymentAmount, provider_user_id]
        );
        await client.query(
            `INSERT INTO transactions (user_id, type, amount, related_id)
             VALUES ($1, $2, $3, $4)`,
            [provider_user_id, 'payment_received', paymentAmount, booking_id]
        );

        // 5. Log Payment and Update Booking Status to closed
        const transactionId = `txn_${Date.now()}${Math.random().toString(36).substring(2, 8)}`;
        await client.query(
            `INSERT INTO payments (booking_id, amount, status, gateway_transaction_id, paid_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [booking_id, paymentAmount, 'succeeded', transactionId]
        );
        await client.query(
            `UPDATE bookings SET booking_status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [booking_id]
        );
        await recordBookingStatus(client, {
            bookingId: booking_id,
            status: 'closed',
            changedBy: customer_user_id,
            changedByRole: 'customer',
            note: 'Payment captured from wallet.',
        });

        await client.query('COMMIT');

        res.status(200).json({
            message: 'Payment captured successfully. Your provider has been credited.',
            status: 'succeeded',
            transaction_id: transactionId
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('FATAL PAYMENT PROCESSING ERROR (PostgreSQL details):', err);
        res.status(500).json({ error: 'An error occurred during payment processing. Transaction rolled back.' });
    } finally {
        client.release();
    }
});

/**
 * @route POST /api/v1/reviews
 * @desc Submit a review and rating for a paid booking (Optional for Customer)
 * @access Private (Customer only)
 */
router.post('/reviews', auth, async (req, res) => {
    const { id: customer_user_id, role } = req.user;
    const { booking_id, rating, comment } = req.body;

    if (role !== 'customer') {
        return res.status(403).json({ msg: 'Access denied. Only customers can submit reviews.' });
    }
    // reviews.rating is NOT NULL with a CHECK (1..5), so 0 is not storable.
    if (!booking_id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Booking ID and a whole-number rating between 1 and 5 are required.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Validate booking and payment status
        const bookingResult = await client.query(
            'SELECT b.customer_id, b.provider_id, b.booking_status, p.id AS payment_id, r.id AS review_id FROM bookings b LEFT JOIN payments p ON b.id = p.booking_id LEFT JOIN reviews r ON b.id = r.booking_id WHERE b.id = $1',
            [booking_id]
        );
        const booking = bookingResult.rows[0];

        if (!booking || booking.customer_id !== customer_user_id) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Access denied. Booking not found or not owned by you.' });
        }
        if (booking.booking_status !== 'closed' || !booking.payment_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Cannot review unpaid or incomplete bookings.' });
        }
        if (booking.review_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'This booking has already been reviewed.' });
        }

        // 2. Insert Review (rating is required by the schema)
        await client.query(
            `INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment)
             VALUES ($1, $2, $3, $4, $5)`,
            [booking_id, customer_user_id, booking.provider_id, rating, comment]
        );

        // 3. Recalculate Provider Rating (only include reviews with rating > 0)
        const aggregateResult = await client.query(
            `SELECT CAST(AVG(rating) FILTER (WHERE rating > 0) AS DECIMAL(3, 2)) AS avg_rating,
                    COUNT(id) FILTER (WHERE rating > 0) AS review_count
             FROM reviews
             WHERE provider_id = $1 AND is_hidden = FALSE`,
            [booking.provider_id]
        );
        const { avg_rating, review_count } = aggregateResult.rows[0];

        await client.query(
            `UPDATE providers
             SET average_rating = $1, review_count = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [avg_rating || 0, review_count || 0, booking.provider_id]
        );

        // 4. Send email notification to provider
        const providerEmailResult = await client.query('SELECT u.email FROM providers p JOIN users u ON p.user_id = u.id WHERE p.id = $1', [booking.provider_id]);
        const providerEmail = providerEmailResult.rows[0]?.email;

        if (providerEmail) {
            const emailBody = `
                <h2>New Review Received!</h2>
                <p>A customer left a review for booking ID ${booking_id}.</p>
                ${rating > 0 ? `<p>Rating: <strong>${rating} out of 5 stars</strong></p>` : ''}
                ${comment ? `<p>Comment: <em>${comment}</em></p>` : ''}
                <p>Your new average rating is ${avg_rating || 'N/A'}.</p>
            `;
            await sendEmail(providerEmail, `New Customer Review for Booking ${booking_id}`, emailBody);
        }


        await client.query('COMMIT');

        res.status(201).json({ message: 'Review submitted successfully. Provider rating updated.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Review submission error:', err);
        res.status(500).json({ error: 'An error occurred during review submission.' });
    } finally {
        client.release();
    }
});

module.exports = router;