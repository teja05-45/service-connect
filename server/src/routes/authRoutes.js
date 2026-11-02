// backend/src/routes/authRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { generateOtp, isValidEmail } = require('../utils/helpers');
const { logger } = require('../utils/logger');
const { createRateLimiter } = require('../middleware/rateLimit');
const { sendEmail } = require('../config/nodemailer');
require('dotenv').config();

// Brute-force protection for credential and OTP endpoints.
const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
});
const otpLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
});


/**
 * @route POST /api/v1/auth/register
 * @desc Create a new user (customer or provider) and send OTP
 * @access Public
 */
router.post('/register', async (req, res) => {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
        return res.status(400).json({ error: 'Email, password, and role are required.' });
    }
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    if (!['customer', 'provider'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role specified. Must be customer or provider.' });
    }

    try {
        const userExists = await pool.query('SELECT id, status FROM users WHERE email = $1', [email]);
        if (userExists.rows.length > 0 && userExists.rows[0].status !== 'pending_verification') {
            // Only an unfinished signup may be resumed. Never overwrite the
            // credentials of an active (or otherwise non-pending) account.
            return res.status(409).json({ error: 'An account with this email already exists.' });
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        const otp = generateOtp();
        const otpExpiry = new Date(Date.now() + 10 * 60000); // 10 minutes from now
        const status = 'pending_verification';

        // Use UPSERT logic to create or update a user stuck in pending verification
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, role, status, otp_code, otp_expiry)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (email) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                status = $4,
                otp_code = $5,
                otp_expiry = $6
             RETURNING id, role`,
            [email, passwordHash, role, status, otp, otpExpiry]
        );

        // --- REAL EMAIL SENDING: Registration OTP ---
        const emailBody = `
            <h2>Service Connect Email Verification</h2>
            <p>Thank you for registering. Please use the following code to verify your account:</p>
            <p>Your one-time password (OTP) is: <strong>${otp}</strong></p>
            <p>This code is valid for 10 minutes.</p>
        `;
        const emailSent = await sendEmail(
            email,
            'Service Connect: Verify Your Account',
            emailBody
        );

        const registrationResponse = {
            message: 'Registration initiation successful. OTP sent to your email for verification.',
            user_id: result.rows[0].id,
            role: role
        };

        // Local-development fallback: when SMTP is not configured (or rejects the
        // message) the code would be unreachable, so return it to the caller.
        // Never enabled in production.
        if (!emailSent && process.env.NODE_ENV !== 'production') {
            registrationResponse.dev_otp = otp;
            registrationResponse.message =
                'Registration initiation successful, but the verification email could not be sent. The OTP is included in this response for local development.';
        }

        res.status(201).json(registrationResponse);
    } catch (err) {
        console.error('Registration initiation error:', err);
        res.status(500).json({ error: 'An error occurred during registration initiation.' });
    }
});

/**
 * @route POST /api/v1/auth/verify-otp
 * @desc Verify OTP and activate the user account
 * @access Public
 */
router.post('/verify-otp', otpLimiter, async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required.' });
    }

    try {
        const userResult = await pool.query(
            'SELECT id, role, otp_code, otp_expiry, status FROM users WHERE email = $1',
            [email]
        );
        const user = userResult.rows[0];

        if (!user || user.status !== 'pending_verification') {
            return res.status(400).json({ error: 'Account not found or already verified.' });
        }

        if (user.otp_code !== otp || new Date(user.otp_expiry) < new Date()) {
            // Check if OTP is matched first, if so, invalid/expired
            if (user.otp_code === otp) {
                return res.status(401).json({ error: 'OTP has expired. Please try registering again.' });
            }
            return res.status(401).json({ error: 'Invalid OTP code.' });
        }

        // OTP is valid and not expired, activate the account
        await pool.query(
            'UPDATE users SET status = $1, otp_code = NULL, otp_expiry = NULL WHERE id = $2',
            ['active', user.id]
        );

        const user_id = user.id;

        // Perform initial profile setup for customer/provider
        if (user.role === 'provider') {
            await pool.query(
                'INSERT INTO providers (user_id, display_name, bio, location_lat, location_lon, service_radius_km) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id) DO NOTHING',
                [user_id, `New Provider ${user_id}`, 'A dedicated service provider.', 0, 0, 10]
            );
        } else if (user.role === 'customer') {
            await pool.query(
                'INSERT INTO customer_profiles (user_id, full_name, phone_number, location_lat, location_lon) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO NOTHING',
                [user_id, '', null, 0, 0]
            );
        }

        // Ensure every new user has a wallet record
        await pool.query(
            'INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
            [user_id]
        );

        res.status(200).json({ message: 'Account verified successfully.', role: user.role });

    } catch (err) {
        console.error('OTP verification error:', err);
        res.status(500).json({ error: 'An error occurred during verification.' });
    }
});


/**
 * @route POST /api/v1/auth/login
 * @desc Authenticate and log in a user (Includes Admin Backdoor)
 * @access Public
 */
router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const userResult = await pool.query('SELECT id, email, password_hash, role, status FROM users WHERE email = $1', [email]);
        const user = userResult.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        if (user.status !== 'active') {
             return res.status(401).json({ error: 'Account is not active. Please check your email for verification code.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // 3. ADMIN ROLE ESCALATION
        // The configured ADMIN_EMAIL is always treated as an administrator.
        // NOTE: `email` must be part of the SELECT above for this to work.
        let effectiveRole = user.role;
        if (
            process.env.ADMIN_EMAIL &&
            user.email.toLowerCase() === process.env.ADMIN_EMAIL.trim().toLowerCase()
        ) {
            effectiveRole = 'admin';
            logger.info('admin_login', { userId: user.id, email: user.email });
        }

        // 4. Generate a JWT token
        const payload = {
            user: {
                id: user.id,
                role: effectiveRole
            }
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.status(200).json({
            message: 'Login successful.',
            token,
            user_id: user.id,
            role: effectiveRole
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'An error occurred during login.' });
    }
});

/**
 * @route POST /api/v1/auth/forgot-password
 * @desc Request a password reset OTP
 * @access Public
 */
router.post('/forgot-password', otpLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    try {
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1 AND status = $2', [email, 'active']);
        if (userResult.rows.length === 0) {
            // Send 200 OK even if user not found to prevent email enumeration
            return res.status(200).json({ message: 'A password reset code has been sent to your email.' });
        }

        const otp = generateOtp();
        const otpExpiry = new Date(Date.now() + 10 * 60000); // 10 minutes from now

        await pool.query(
            'UPDATE users SET otp_code = $1, otp_expiry = $2 WHERE email = $3',
            [otp, otpExpiry, email]
        );

        // --- REAL EMAIL SENDING: Forgot Password ---
        const emailBody = `
            <h2>Service Connect Password Reset</h2>
            <p>You requested a password reset for your Service Connect account.</p>
            <p>Your one-time password (OTP) is: <strong>${otp}</strong></p>
            <p>This code is valid for 10 minutes. Please use it immediately to set a new password.</p>
            <p>If you did not request this, please ignore this email.</p>
        `;
        const resetEmailSent = await sendEmail(
            email,
            'Service Connect: Password Reset Code',
            emailBody
        );

        const resetResponse = { message: 'A password reset code has been sent to your email.' };
        if (!resetEmailSent && process.env.NODE_ENV !== 'production') {
            resetResponse.dev_otp = otp;
            resetResponse.message =
                'Password reset code generated, but the email could not be sent. The OTP is included in this response for local development.';
        }

        res.status(200).json(resetResponse);

    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'An error occurred during OTP request.' });
    }
});

/**
 * @route POST /api/v1/auth/reset-password
 * @desc Reset password using OTP
 * @access Public
 */
router.post('/reset-password', otpLimiter, async (req, res) => {
    const { email, otp, new_password } = req.body;
    if (!email || !otp || !new_password) {
        return res.status(400).json({ error: 'Email, OTP, and new password are required.' });
    }
    if (typeof new_password !== 'string' || new_password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    try {
        const userResult = await pool.query(
            'SELECT id, otp_code, otp_expiry FROM users WHERE email = $1 AND status = $2',
            [email, 'active']
        );
        const user = userResult.rows[0];

        if (!user || user.otp_code !== otp || new Date(user.otp_expiry) < new Date()) {
            return res.status(401).json({ error: 'Invalid or expired OTP.' });
        }

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(new_password, saltRounds);

        await pool.query(
            'UPDATE users SET password_hash = $1, otp_code = NULL, otp_expiry = NULL WHERE id = $2',
            [passwordHash, user.id]
        );

        // --- REAL EMAIL SENDING: Password Success Notification ---
        const emailBody = `
            <h2>Service Connect Password Reset Successful</h2>
            <p>Your password for your Service Connect account was successfully reset.</p>
            <p>If you did not authorize this change, please contact support immediately.</p>
        `;
        await sendEmail(
            email,
            'Service Connect: Password Reset Confirmation',
            emailBody
        );

        res.status(200).json({ message: 'Password reset successfully. You can now log in.' });

    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'An error occurred during password reset.' });
    }
});


module.exports = router;