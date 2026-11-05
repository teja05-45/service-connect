// backend/src/routes/publicRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { logger } = require('../utils/logger');
const { parseCoordinates, clampRadius } = require('../utils/geo');
const { getPublicSearchSettings } = require('../services/settings');
const { buildProviderSearchQuery, mapProviderRow } = require('../services/providerSearch');

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
 * @desc List active service categories
 * @access Public
 */
router.get('/services', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, slug, description, icon_url
             FROM services
             WHERE is_active = TRUE
             ORDER BY name`
        );
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error('service_listing_failed', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch services.', code: 'SERVICE_LIST_FAILED' });
    }
});

/**
 * @route GET /api/v1/providers
 * @desc Approved providers for a service category, distance-filtered when a
 *       customer location is supplied. Supports ?sort_by=top_rated for the
 *       homepage (no distance filter).
 * @access Public
 *
 * Query: service_id | service_slug, lat, lon, radius (km), sort_by
 * Response: { message, providers, search: { ... } }
 */
router.get('/providers', async (req, res) => {
    const { service_id, service_slug, sort_by } = req.query;
    const isTopRated = sort_by === 'top_rated';

    if (!service_id && !service_slug && !isTopRated) {
        return res.status(400).json({
            error: 'A service category (service_id or service_slug) is required.',
            code: 'SERVICE_REQUIRED',
        });
    }

    const coordinates = parseCoordinates({ lat: req.query.lat, lon: req.query.lon });
    if (coordinates.error) {
        return res.status(400).json({ error: coordinates.error, code: 'INVALID_COORDINATES' });
    }

    try {
        const searchSettings = await getPublicSearchSettings(pool);
        const radiusKm = clampRadius(req.query.radius, {
            fallback: searchSettings.default_radius_km,
            max: searchSettings.max_radius_km,
        });

        // Resolve the service first so an unknown/inactive category is a clear
        // 404 instead of an empty result that looks like "no providers nearby".
        let service = null;
        if (service_id || service_slug) {
            const serviceResult = await pool.query(
                `SELECT id, name, slug, description
                 FROM services
                 WHERE is_active = TRUE
                   AND (($1::int IS NOT NULL AND id = $1::int)
                        OR ($2::text IS NOT NULL AND slug = $2::text))
                 LIMIT 1`,
                [
                    service_id === undefined ? null : Number(service_id) || null,
                    service_slug || null,
                ]
            );
            service = serviceResult.rows[0] || null;

            if (!service) {
                return res.status(404).json({
                    error: 'This service category does not exist or is no longer available.',
                    code: 'SERVICE_NOT_FOUND',
                });
            }
        }

        const { text, values } = buildProviderSearchQuery({
            serviceId: service ? service.id : null,
            latitude: coordinates.hasLocation ? coordinates.latitude : null,
            longitude: coordinates.hasLocation ? coordinates.longitude : null,
            // Top-rated homepage lists are not distance searches.
            radiusKm: isTopRated && !coordinates.hasLocation ? searchSettings.max_radius_km : radiusKm,
            limit: isTopRated ? 10 : 50,
        });

        const result = await pool.query(text, values);
        const providers = result.rows.map(mapProviderRow);

        const finalProviders = isTopRated ? providers.slice(0, 5) : providers;

        res.status(200).json({
            message:
                finalProviders.length > 0
                    ? `${finalProviders.length} provider(s) found.`
                    : 'No approved providers matched this search.',
            providers: finalProviders,
            search: {
                service_id: service ? service.id : null,
                service_name: service ? service.name : null,
                radius_km: radiusKm,
                has_location: coordinates.hasLocation,
                location_ignored: Boolean(coordinates.ignoredNullIsland),
                sort_by: isTopRated ? 'top_rated' : 'distance',
                max_radius_km: searchSettings.max_radius_km,
            },
        });
    } catch (err) {
        logger.error('provider_search_failed', { error: err.message });
        res.status(500).json({
            error: 'Provider search failed. Please try again in a moment.',
            code: 'PROVIDER_SEARCH_FAILED',
        });
    }
});

/**
 * @route POST /api/v1/contact-us
 * @desc Submit a contact form message (admin sees it under Complaints)
 * @access Public
 */
router.post('/contact-us', async (req, res) => {
    const { name, email, problem_description } = req.body;
    const { sendEmail } = require('../config/nodemailer');

    if (!name || !email || !problem_description) {
        return res.status(400).json({ error: 'Name, email, and a description are required.' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO contact_messages (sender_name, sender_email, message) VALUES ($1, $2, $3) RETURNING id',
            [name, email, problem_description]
        );

        const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
        if (adminEmail) {
            await sendEmail(
                adminEmail,
                `New Contact Form Submission (ID: ${result.rows[0].id})`,
                `<h2>New Contact Message Received</h2><p>From: ${name} (${email})</p><p>Message: ${problem_description}</p>`
            );
        }

        res.status(201).json({ message: 'Message submitted successfully. Admin will review shortly.' });
    } catch (err) {
        logger.error('contact_submission_failed', { error: err.message });
        res.status(500).json({ error: 'An error occurred during submission.' });
    }
});

module.exports = router;
