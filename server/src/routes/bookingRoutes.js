// backend/src/routes/bookingRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../../middleware/auth');
const { sendEmail } = require('../config/nodemailer');
const { createUploader, imageOrPdf } = require('../config/upload');
const { buildFileUrl } = require('../utils/helpers');
const { recordBookingStatus } = require('../services/bookingHistory');

// Shared uploader (destination, 5 MB limit and mime whitelist live in config/upload.js)
const upload = createUploader({
    prefix: 'msg',
    allowed: imageOrPdf,
    rejectionMessage: 'Only images and PDF files are allowed for messages!',
});



/**
 * @route POST /api/v1/bookings
 * @desc Customer creates a new booking request
 * @access Private (Customer only)
 */
router.post('/bookings', auth, async (req, res) => {
    const { id: customer_user_id, role } = req.user;
    if (role !== 'customer') {
        return res.status(403).json({ msg: 'Access denied. Only customers can create bookings.' });
    }

    const { provider_id, service_id, scheduled_at, address, customer_notes, service_description } = req.body;

    if (!provider_id || !service_id || !scheduled_at || !address || !service_description) {
        return res.status(400).json({ error: 'Provider ID, Service ID, scheduled time, address, and description are required.' });
    }

    try {
        // Retrieve provider email, display name, and service name for notification
        const providerInfoResult = await pool.query(
            'SELECT u.email, p.display_name, s.name AS service_name FROM providers p JOIN users u ON p.user_id = u.id JOIN services s ON s.id = $2 WHERE p.id = $1',
            [provider_id, service_id]
        );
        const providerInfo = providerInfoResult.rows[0];

        if (!providerInfo) {
            return res.status(404).json({ error: 'Provider or service information not found.' });
        }

        // Insert booking (status is pending_provider)
        const bookingInsert = await pool.query(
            `INSERT INTO bookings (customer_id, provider_id, service_id, scheduled_at, address, customer_notes, service_description, booking_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_provider') RETURNING id`,
            [customer_user_id, provider_id, service_id, scheduled_at, address, customer_notes, service_description]
        );

        const booking_id = bookingInsert.rows[0].id;

        await recordBookingStatus(pool, {
            bookingId: booking_id,
            status: 'pending_provider',
            changedBy: customer_user_id,
            changedByRole: 'customer',
            note: 'Booking requested by customer.',
        });

        // --- REAL EMAIL SENDING: New Booking Request to Provider ---
        const emailBody = `
            <h2>New Booking Request - ${providerInfo.service_name} (ID: ${booking_id})</h2>
            <p>Dear ${providerInfo.display_name},</p>
            <p>A new service request has been submitted for your service:</p>
            <ul>
                <li><strong>Service:</strong> ${providerInfo.service_name}</li>
                <li><strong>Scheduled Time:</strong> ${new Date(scheduled_at).toLocaleString()}</li>
                <li><strong>Location:</strong> ${address}</li>
            </ul>
            <p><strong>Customer's Detailed Description:</strong><br/>${service_description}</p>
            <p>Please log into your Provider Dashboard to review and <strong>Set Price</strong> or <strong>Reject</strong> this request.</p>
        `;
        await sendEmail(
            providerInfo.email,
            `New Service Request (ID: ${booking_id}) on Service Connect`,
            emailBody
        );

        res.status(201).json({
            message: 'Booking request sent successfully to provider.',
            booking_id: booking_id
        });

    } catch (err) {
        console.error('Booking creation error:', err);
        res.status(500).json({ error: 'An error occurred during booking creation.' });
    }
});

/**
 * @route PUT /api/v1/bookings/:id
 * @desc Update booking status (Reject/Complete) AND handle Provider Price Setting (Accept)
 * @access Private (Provider only)
 */
router.put('/bookings/:id', auth, async (req, res) => {
    const { id: provider_user_id, role } = req.user;
    const booking_id = req.params.id;
    const { status, amount } = req.body; // amount is optional, used only for 'accepted' status

    if (role !== 'provider') {
        return res.status(403).json({ msg: 'Access denied. Only providers can update booking status.' });
    }

    // FIX: Updated validStatuses to contain client-side triggers (rejected, completed, closed, accepted)
    const validStatuses = ['accepted', 'rejected', 'completed', 'closed'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status update provided.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const providerResult = await client.query('SELECT id FROM providers WHERE user_id = $1', [provider_user_id]);

        if (providerResult.rows.length === 0) {
             await client.query('ROLLBACK');
             return res.status(404).json({ error: 'Provider profile not found for this logged-in user.' });
        }

        const provider_id = providerResult.rows[0].id;
        let customer_user_id;
        let updateQuery;
        let queryParams;
        let nextStatus = status;


        if (status === 'accepted') {
            // Logic: Provider sets the price, moves status to AWAITING CUSTOMER CONFIRMATION
            if (typeof amount !== 'number' || amount <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Amount is required and must be positive when accepting a service.' });
            }

            nextStatus = 'awaiting_customer_confirmation';
            updateQuery = `
                UPDATE bookings
                SET booking_status = $3, amount = $4, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND provider_id = $2
                RETURNING customer_id, booking_status, amount;
            `;
            queryParams = [booking_id, provider_id, nextStatus, amount];

        } else if (status === 'rejected' || status === 'completed' || status === 'closed') {
            // Simple status update
            updateQuery = `
                UPDATE bookings
                SET booking_status = $3, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1 AND provider_id = $2
                RETURNING customer_id, booking_status, amount;
            `;
            queryParams = [booking_id, provider_id, nextStatus];
        } else {
             // Should not happen due to validation, but ensures safety
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid operation.' });
        }

        const result = await client.query(updateQuery, queryParams);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Booking not found or not owned by this provider.' });
        }

        customer_user_id = result.rows[0].customer_id;

        await recordBookingStatus(client, {
            bookingId: booking_id,
            status: nextStatus,
            changedBy: provider_user_id,
            changedByRole: 'provider',
            note: amount ? `Provider quoted ${amount}.` : 'Booking status updated by provider.',
        });

        // Retrieve customer email for notification
        const customerEmailResult = await client.query('SELECT email FROM users WHERE id = $1', [customer_user_id]);
        const customerEmail = customerEmailResult.rows[0]?.email;

        // --- REAL EMAIL SENDING: Notification to Customer ---
        if (customerEmail) {
            let subject = `Service Connect Booking Update: ${nextStatus.toUpperCase()}`;
            let emailBody = `<p>Your booking (ID: ${booking_id}) status has been updated to <strong>${nextStatus}</strong>.</p>`;

            if (nextStatus === 'awaiting_customer_confirmation') {
                subject = `Service Connect: Price Quote Received for Booking ${booking_id}`;
                emailBody = `
                    <h2>Action Required: Price Quote Received!</h2>
                    <p>Your service request (ID: ${booking_id}) has been reviewed by the provider.</p>
                    <p>The quoted price is <strong>₹${parseFloat(amount).toFixed(2)}</strong>.</p>
                    <p>Please log into your Customer Dashboard to **Confirm** or **Reject** this price before proceeding.</p>
                `;
            } else if (nextStatus === 'completed') {
                subject = `Service Connect: Action Required - Payment Due for Booking ${booking_id}`;
                emailBody = `
                    <h2>Service Completed - Payment Due</h2>
                    <p>Your service for booking ID ${booking_id} has been marked as <strong>Completed</strong> by the provider.</p>
                    <p>Please log in to your dashboard to complete the payment.</p>
                `;
            } else if (nextStatus === 'rejected') {
                 emailBody = `
                    <h2>Service Request Rejected</h2>
                    <p>We are sorry, but your service request (ID: ${booking_id}) was **rejected** by the provider.</p>
                    <p>Please search for another service provider in your area.</p>
                `;
            }

            await sendEmail(customerEmail, subject, emailBody);
        }

        await client.query('COMMIT');

        res.status(200).json({
            message: `Booking #${booking_id} status updated to ${nextStatus}.`,
            new_status: nextStatus
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Booking update error:', err);
        res.status(500).json({ error: 'An error occurred while updating the booking status.' });
    } finally {
        client.release();
    }
});


/**
 * @route PUT /api/v1/bookings/:id/confirm-price
 * @desc Customer accepts or rejects the provider's quoted price.
 * @access Private (Customer only)
 */
router.put('/bookings/:id/confirm-price', auth, async (req, res) => {
    const { id: customer_user_id, role } = req.user;
    const booking_id = req.params.id;
    const { accepted } = req.body; // boolean: true for accept, false for reject

    if (role !== 'customer') {
        return res.status(403).json({ error: 'Access denied. Only customers can confirm prices.' });
    }
    if (typeof accepted !== 'boolean') {
        return res.status(400).json({ error: 'Confirmation status (accepted) must be a boolean.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        let newStatus;
        let subject;
        let message;

        if (accepted) {
            newStatus = 'accepted';
            subject = `Booking ${booking_id} Price ACCEPTED!`;
            message = 'Price confirmed! The service is now officially accepted.';
        } else {
            newStatus = 'rejected';
            subject = `Booking ${booking_id} Price REJECTED (Booking Cancelled)`;
            message = 'Price rejected. The booking has been cancelled.';
        }

        const updateQuery = `
            UPDATE bookings
            SET booking_status = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND customer_id = $2 AND booking_status = 'awaiting_customer_confirmation'
            RETURNING provider_id, amount;
        `;
        const result = await client.query(updateQuery, [booking_id, customer_user_id, newStatus]);

        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Booking not found, not owned by you, or status is incorrect.' });
        }

        const provider_id = result.rows[0].provider_id;

        await recordBookingStatus(client, {
            bookingId: booking_id,
            status: newStatus,
            changedBy: customer_user_id,
            changedByRole: 'customer',
            note: accepted ? 'Customer accepted the quoted price.' : 'Customer rejected the quoted price.',
        });

        // Retrieve provider email for notification
        const providerEmailResult = await client.query('SELECT u.email FROM providers p JOIN users u ON p.user_id = u.id WHERE p.id = $1', [provider_id]);
        const providerEmail = providerEmailResult.rows[0]?.email;

        // Notify provider
        if (providerEmail) {
            const emailBody = `
                <h2>Booking ${booking_id} Update: ${newStatus.toUpperCase()}</h2>
                <p>The customer has **${newStatus.toUpperCase()}** the quoted price of ₹${parseFloat(result.rows[0].amount).toFixed(2)}.</p>
                ${accepted ? '<p>The booking is now ACCEPTED. You may start communication via chat.</p>' : '<p>The booking has been cancelled and moved to rejected status.</p>'}
            `;
            await sendEmail(providerEmail, subject, emailBody);
        }

        await client.query('COMMIT');

        res.status(200).json({
            message: message,
            new_status: newStatus
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Price confirmation error:', err);
        res.status(500).json({ error: 'An error occurred during price confirmation.' });
    } finally {
        client.release();
    }
});


/**
 * @route GET /api/v1/bookings/:id/messages
 * @desc Retrieve all messages for a specific booking chat
 * @access Private (Customer or Provider who is a party to the booking)
 */
router.get('/bookings/:id/messages', auth, async (req, res) => {
    const user_id = req.user.id;
    const booking_id = req.params.id;

    try {
        const bookingResult = await pool.query(
            'SELECT customer_id, provider_id FROM bookings WHERE id = $1 AND (customer_id = $2 OR (SELECT user_id FROM providers WHERE id = provider_id) = $2)',
            [booking_id, user_id]
        );

        if (bookingResult.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied. You are not a party to this booking.' });
        }

        const messagesQuery = `
            SELECT m.id, m.sender_id, m.content, m.created_at, m.file_url, u.email AS sender_email
            FROM messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.booking_id = $1
            ORDER BY m.created_at ASC;
        `;
        const messagesResult = await pool.query(messagesQuery, [booking_id]);

        res.status(200).json({
            message: `${messagesResult.rows.length} messages retrieved.`,
            messages: messagesResult.rows
        });

    } catch (err) {
        console.error('Message fetch error:', err);
        res.status(500).json({ error: 'An error occurred while fetching messages.' });
    }
});


/**
 * @route POST /api/v1/bookings/:id/messages
 * @desc Send a text message within a booking chat
 * @access Private (Customer or Provider)
 */
router.post('/bookings/:id/messages', auth, async (req, res) => {
    const sender_id = req.user.id;
    const booking_id = req.params.id;
    const { content } = req.body;

    if (!content) {
        return res.status(400).json({ error: 'Message content is required.' });
    }

    try {
        const bookingResult = await pool.query(
            'SELECT customer_id, provider_id FROM bookings WHERE id = $1 AND (customer_id = $2 OR (SELECT user_id FROM providers WHERE id = provider_id) = $2)',
            [booking_id, sender_id]
        );

        if (bookingResult.rows.length === 0) {
            return res.status(403).json({ error: 'Access denied. You are not a party to this booking.' });
        }

        const booking = bookingResult.rows[0];

        // Determine recipient ID
        let recipient_id;
        if (sender_id === booking.customer_id) {
            recipient_id = await pool.query('SELECT user_id FROM providers WHERE id = $1', [booking.provider_id]).then(r => r.rows[0]?.user_id);
        } else {
            recipient_id = booking.customer_id;
        }

        if (!recipient_id) {
            return res.status(404).json({ error: 'Recipient user ID could not be determined.' });
        }

        const messageInsert = await pool.query(
            // is_read defaults to FALSE
            'INSERT INTO messages (booking_id, sender_id, recipient_id, content) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
            [booking_id, sender_id, recipient_id, content]
        );

        res.status(201).json({
            message: 'Message sent successfully.',
            message_id: messageInsert.rows[0].id,
            created_at: messageInsert.rows[0].created_at
        });

    } catch (err) {
        console.error('Message send error:', err);
        res.status(500).json({ error: 'An error occurred while sending the message.' });
    }
});


/**
 * @route POST /api/v1/bookings/:id/messages/upload
 * @desc Send a file attachment within a booking chat
 * @access Private (Customer or Provider)
 */
router.post('/bookings/:id/messages/upload', auth, (req, res, next) => {
    // Wrap multer middleware to handle errors and proceed
    upload.single('file')(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ error: err.message || 'File upload failed.' });
        }

        const sender_id = req.user.id;
        const booking_id = req.params.id;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ error: 'File attachment is required.' });
        }

        // FIX: Use actual server path for file access
        const fileUrl = `${buildFileUrl(req, file.filename)}`;
        const content = `File uploaded: ${file.originalname}`;

        try {
            const bookingResult = await pool.query(
                'SELECT customer_id, provider_id FROM bookings WHERE id = $1 AND (customer_id = $2 OR (SELECT user_id FROM providers WHERE id = provider_id) = $2)',
                [booking_id, sender_id]
            );

            if (bookingResult.rows.length === 0) {
                return res.status(403).json({ error: 'Access denied. You are not a party to this booking.' });
            }

            const booking = bookingResult.rows[0];

            // Determine recipient ID
            let recipient_id;
            if (sender_id === booking.customer_id) {
                recipient_id = await pool.query('SELECT user_id FROM providers WHERE id = $1', [booking.provider_id]).then(r => r.rows[0]?.user_id);
            } else {
                recipient_id = booking.customer_id;
            }

            if (!recipient_id) {
                return res.status(404).json({ error: 'Recipient user ID could not be determined.' });
            }

            const messageInsert = await pool.query(
                // is_read defaults to FALSE
                'INSERT INTO messages (booking_id, sender_id, recipient_id, content, file_url) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
                [booking_id, sender_id, recipient_id, content, fileUrl]
            );

            res.status(201).json({
                message: 'File sent successfully.',
                message_id: messageInsert.rows[0].id,
                created_at: messageInsert.rows[0].created_at,
                file_url: fileUrl
            });

        } catch (dbError) {
            console.error('File send error:', dbError);
            res.status(500).json({ error: 'An error occurred while sending the file.' });
        }
    });
});


module.exports = router;