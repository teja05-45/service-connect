// backend/src/config/nodemailer.js

const nodemailer = require('nodemailer');
require('dotenv').config();
const { logger } = require('../utils/logger');

// --- NODEMAILER CONFIGURATION ---
// Email is optional in local development: when SMTP credentials are missing the
// API keeps working and the verification code is surfaced to the developer
// (see authRoutes) instead of silently disappearing.
const isEmailConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

let transporter = null;
if (isEmailConfigured) {
    transporter = nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });
}

let warnedAboutMissingConfig = false;

/**
 * @function sendEmail
 * @desc Sends an email using Nodemailer. Failures are logged, never thrown, so
 *       the HTTP request that triggered the email still succeeds.
 * @returns {Promise<boolean>} true when the message was handed to SMTP.
 */
const sendEmail = async (to, subject, html) => {
    if (!isEmailConfigured || !transporter) {
        if (!warnedAboutMissingConfig) {
            warnedAboutMissingConfig = true;
            logger.warn('email_not_configured', {
                hint: 'Set EMAIL_USER and EMAIL_PASS to enable outgoing email. Verification codes are returned to the client in development instead.',
            });
        }
        logger.info('email_skipped', { to, subject });
        return false;
    }

    try {
        const info = await transporter.sendMail({
            from: `"${process.env.EMAIL_SENDER_NAME || 'Service Connect'}" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html,
        });
        logger.info('email_sent', { to, subject, messageId: info.messageId });
        return true;
    } catch (error) {
        logger.error('email_send_failed', { to, subject, error: error.message });
        return false;
    }
};

module.exports = { sendEmail, isEmailConfigured };
