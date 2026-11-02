// backend/src/routes/publicRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { calculateDistance } = require('../utils/helpers');

/**
 * @route GET /
 * @desc Server status check
 * @access Public
 */
router.get('/', (req, res) => {
    res.send('Welcome to the Service Connect Backend API!');
});

/**
 * @route GET /api/v1/services
 * @desc List all available service categories
 * @access Public
 */
router.get('/services', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, description, icon_url FROM services ORDER BY name');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Service listing error:', err);
        res.status(500).json({ error: 'Failed to fetch services.' });
    }
});

/**
 * @route GET /api/v1/providers
 * @desc List and filter providers by service ID and customer location/radius. Also supports top_rated sorting.
 * @access Public
 */
router.get('/providers', async (req, res) => {
    const { service_id, lat, lon, sort_by } = req.query;

    // Allow fetching without specific location for top_rated on homepage, but recommend location for actual search
    if (!service_id && sort_by !== 'top_rated') {
         return res.status(400).json({ error: 'Service ID or sort_by=top_rated is required.' });
    }

    const customerLat = parseFloat(lat || 0);
    const customerLon = parseFloat(lon || 0);

    // Check if lat/lon were explicitly provided or are non-zero (indicating a specific search intent)
    const isLocationProvided = !!lat && !!lon && (customerLat !== 0 || customerLon !== 0);

    try {
        let query = `
            SELECT
                p.id, p.display_name, p.is_verified, p.average_rating, p.review_count,
                p.location_lat, p.location_lon, p.service_radius_km,
                u.profile_picture_url,
                s.name AS service_name,
                s.id AS service_id
            FROM providers p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN provider_services ps ON p.id = ps.provider_id
            LEFT JOIN services s ON s.id = ps.service_id
            WHERE p.is_verified = TRUE
        `;
        const queryParams = [];

        if (service_id) {
            query += ` AND ps.service_id = $1`;
            queryParams.push(service_id);
        }

        query += ` GROUP BY p.id, u.profile_picture_url, s.name, s.id`;


        // FIX: Ensure top-rated query is correct for database sorting
        if (sort_by === 'top_rated') {
            query += ` ORDER BY p.average_rating DESC, p.review_count DESC LIMIT 10`;
        } else {
             query += ` ORDER BY p.average_rating DESC`; // Default sort for standard search
        }

        const result = await pool.query(query, queryParams);

        const filteredProviders = result.rows.map(provider => {
            const providerLat = parseFloat(provider.location_lat || 0);
            const providerLon = parseFloat(provider.location_lon || 0);

            // Only calculate distance if a location is provided
            const distance = isLocationProvided ? calculateDistance(
                customerLat,
                customerLon,
                providerLat,
                providerLon
            ) : null;

            return {
                ...provider,
                distance_km: distance !== null ? Math.round(distance * 10) / 10 : null
            };
        }).filter(provider => {
            // FILTER LOGIC:
            // 1. If fetching top rated, include all.
            if (sort_by === 'top_rated') return true;

            // 2. If a location was NOT provided, include all (no distance filter).
            if (!isLocationProvided) return true;

            // 3. If a location WAS provided, apply the radius filter.
            return provider.distance_km !== null && provider.distance_km <= provider.service_radius_km;

        }).sort((a, b) => {
            // FINAL SORT: Prioritize distance if location is provided for standard search
            if (isLocationProvided && sort_by !== 'top_rated') {
                 return a.distance_km - b.distance_km;
            }
            // For top rated, DB sort is usually enough, but here we enforce rating sort again
            if (sort_by === 'top_rated') {
                 return b.average_rating - a.average_rating;
            }
            return 0;
        });

        // Limit top-rated results to 5 for homepage display if requested
        const finalProviders = sort_by === 'top_rated' ? filteredProviders.slice(0, 5) : filteredProviders;

        res.status(200).json({
            message: `${finalProviders.length} providers found.`,
            providers: finalProviders
        });

    } catch (err) {
        console.error('Provider search error:', err);
        res.status(500).json({ error: 'An error occurred during provider search.' });
    }
});


/**
 * @route POST /api/v1/contact-us
 * @desc Submit a contact form message to be viewed by Admin
 * @access Public
 */
router.post('/contact-us', async (req, res) => {
    const { name, email, problem_description } = req.body;
    const { sendEmail } = require('../config/nodemailer'); // Require here to avoid circular dependency in some setups

    if (!name || !email || !problem_description) {
        return res.status(400).json({ error: 'Name, email, and a description are required.' });
    }

    try {
        // Assumes a 'contact_messages' table exists for admin view
        const result = await pool.query(
            'INSERT INTO contact_messages (sender_name, sender_email, message) VALUES ($1, $2, $3) RETURNING id',
            [name, email, problem_description]
        );

        // Notify admin via email (optional)
        const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
        await sendEmail(
            adminEmail,
            `New Contact Form Submission (ID: ${result.rows[0].id})`,
            `<h2>New Contact Message Received</h2><p>From: ${name} (${email})</p><p>Message: ${problem_description}</p>`
        );

        res.status(201).json({ message: 'Message submitted successfully. Admin will review shortly.' });

    } catch (err) {
        console.error('Contact form submission error:', err);
        res.status(500).json({ error: 'An error occurred during submission.' });
    }
});

module.exports = router;