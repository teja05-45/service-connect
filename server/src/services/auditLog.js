// backend/src/services/auditLog.js
//
// Append-only audit trail. Only the admin routes and the admin login write
// here; there is deliberately no update/delete endpoint.

const pool = require('../config/db');
const { logger } = require('../utils/logger');

/**
 * @param {object} db pg Pool or connected client (pass the transaction client
 *                    when the audited change must commit atomically)
 * @param {object} entry
 * @param {number} entry.adminId
 * @param {string} entry.action e.g. 'provider.approve', 'user.suspend'
 * @param {string} [entry.targetType]
 * @param {string|number} [entry.targetId]
 * @param {string} [entry.reason]
 * @param {object} [entry.metadata] non-sensitive structured details
 */
const recordAdminAction = async (db, { adminId, action, targetType, targetId, reason, metadata }) => {
    if (!adminId || !action) {
        throw new Error('recordAdminAction requires adminId and action.');
    }

    await db.query(
        `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, reason, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
            adminId,
            action,
            targetType || null,
            targetId === undefined || targetId === null ? null : String(targetId),
            reason || null,
            JSON.stringify(metadata || {}),
        ]
    );
};

/** Fire-and-forget variant for logging that must never fail a request (e.g. login). */
const recordAdminActionSafe = async (entry) => {
    try {
        await recordAdminAction(pool, entry);
    } catch (err) {
        logger.error('audit_log_failed', { action: entry && entry.action, error: err.message });
    }
};

module.exports = { recordAdminAction, recordAdminActionSafe };
