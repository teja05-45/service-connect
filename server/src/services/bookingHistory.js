// backend/src/services/bookingHistory.js
//
// Booking status history is best-effort: it is written inside the same
// transaction as the status change where possible, but a failure to record
// history must never break the customer/provider flow.

const { logger } = require('../utils/logger');

const recordBookingStatus = async (db, { bookingId, status, changedBy = null, changedByRole = null, note = null }) => {
    try {
        await db.query(
            `INSERT INTO booking_status_history (booking_id, status, changed_by, changed_by_role, note)
             VALUES ($1, $2, $3, $4, $5)`,
            [bookingId, status, changedBy, changedByRole, note]
        );
    } catch (err) {
        // Older databases may not have the table yet; history is non-critical.
        logger.warn('booking_history_write_failed', { bookingId, status, error: err.message });
    }
};

module.exports = { recordBookingStatus };
