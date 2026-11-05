// backend/scripts/seed-dev.js
//
// DEVELOPMENT-ONLY synthetic data. Never run this against production.
//
// All accounts use @example.test addresses and display names prefixed with
// "[DEMO]" so they cannot be mistaken for real users. Password for every demo
// account: DemoPass123! (printed by the script, not a secret).
//
// Usage (from server/, database must be migrated first):
//   npm run seed:dev
//   npm run seed:dev -- --reset     # remove previous demo rows, then re-seed
//
// Test location: Ongole, Andhra Pradesh (16.17000000, 81.12999700) - the same
// coordinates reported in the provider-discovery bug report.

const bcrypt = require('bcrypt');
require('dotenv').config();
const pool = require('../src/config/db');
const { ensureInitialAdmin } = require('../src/services/adminBootstrap');

const DEMO_PASSWORD = 'DemoPass123!';
const EMAIL_DOMAIN = '@example.test';
const TEST_LOCATION = { lat: 16.17, lon: 81.129997 };

const KM_PER_DEG_LAT = 111.045;
const KM_PER_DEG_LON = 111.045 * Math.cos((TEST_LOCATION.lat * Math.PI) / 180);

const at = (kmNorth = 0, kmEast = 0) => ({
    lat: Number((TEST_LOCATION.lat + kmNorth / KM_PER_DEG_LAT).toFixed(8)),
    lon: Number((TEST_LOCATION.lon + kmEast / KM_PER_DEG_LON).toFixed(8)),
});

const PROVIDERS = [
    {
        key: 'ac_near',
        email: `demo.provider.ac-near${EMAIL_DOMAIN}`,
        display_name: '[DEMO] Suresh AC Services',
        bio: 'Synthetic demo provider: AC and refrigerator repair, 0.5 km away.',
        location: at(0.3, 0.4),
        radius: 10,
        status: 'approved',
        services: ['AC/Refrigerator Repair', 'Washing Machine Repair'],
    },
    {
        key: 'ac_mid',
        email: `demo.provider.ac-mid${EMAIL_DOMAIN}`,
        display_name: '[DEMO] Lakshmi Cooling Care',
        bio: 'Synthetic demo provider: AC specialist, about 2 km away.',
        location: at(1.4, 1.4),
        radius: 10,
        status: 'approved',
        services: ['AC/Refrigerator Repair'],
    },
    {
        key: 'electric_far',
        email: `demo.provider.electric${EMAIL_DOMAIN}`,
        display_name: '[DEMO] Ravi Electricals',
        bio: 'Synthetic demo provider: electrician only (different category), about 8 km away.',
        location: at(5.6, 5.6),
        radius: 10,
        status: 'approved',
        services: ['Electrician'],
    },
    {
        key: 'ac_outside',
        email: `demo.provider.ac-outside${EMAIL_DOMAIN}`,
        display_name: '[DEMO] Faraway AC Works',
        bio: 'Synthetic demo provider: AC repair but about 24 km away (outside the default 10 km radius).',
        location: at(17, 17),
        radius: 30,
        status: 'approved',
        services: ['AC/Refrigerator Repair'],
    },
    {
        key: 'pending',
        email: `demo.provider.pending${EMAIL_DOMAIN}`,
        display_name: '[DEMO] Pending Cool Tech',
        bio: 'Synthetic demo provider awaiting admin approval.',
        location: at(0.8, 0.8),
        radius: 10,
        status: 'pending',
        services: ['AC/Refrigerator Repair'],
    },
    {
        key: 'rejected',
        email: `demo.provider.rejected${EMAIL_DOMAIN}`,
        display_name: '[DEMO] Rejected AirFix',
        bio: 'Synthetic demo provider with a rejected application.',
        location: at(0.5, 0.6),
        radius: 10,
        status: 'rejected',
        rejection_reason: 'Demo data: documents could not be verified.',
        services: ['AC/Refrigerator Repair'],
    },
    {
        key: 'suspended',
        email: `demo.provider.suspended${EMAIL_DOMAIN}`,
        display_name: '[DEMO] Suspended ChillPoint',
        bio: 'Synthetic demo provider with a suspended account.',
        location: at(0.7, 0.5),
        radius: 10,
        status: 'suspended',
        suspended_reason: 'Demo data: repeated customer complaints.',
        services: ['AC/Refrigerator Repair'],
    },
];

const resetDemoData = async (client) => {
    const usersResult = await client.query("SELECT id FROM users WHERE email LIKE $1", [`%${EMAIL_DOMAIN}`]);
    const userIds = usersResult.rows.map((row) => row.id);
    if (userIds.length === 0) return;

    const providersResult = await client.query('SELECT id FROM providers WHERE user_id = ANY($1::int[])', [userIds]);
    const providerIds = providersResult.rows.map((row) => row.id);

    const bookingsResult = await client.query(
        'SELECT id FROM bookings WHERE customer_id = ANY($1::int[]) OR provider_id = ANY($2::int[])',
        [userIds, providerIds]
    );
    const bookingIds = bookingsResult.rows.map((row) => row.id);

    if (bookingIds.length > 0) {
        await client.query('DELETE FROM messages WHERE booking_id = ANY($1::int[])', [bookingIds]);
        await client.query('DELETE FROM reviews WHERE booking_id = ANY($1::int[])', [bookingIds]);
        await client.query('DELETE FROM payments WHERE booking_id = ANY($1::int[])', [bookingIds]);
        await client.query('DELETE FROM booking_status_history WHERE booking_id = ANY($1::int[])', [bookingIds]);
        await client.query('DELETE FROM bookings WHERE id = ANY($1::int[])', [bookingIds]);
    }

    await client.query('DELETE FROM transactions WHERE user_id = ANY($1::int[])', [userIds]);
    await client.query('DELETE FROM wallet_requests WHERE user_id = ANY($1::int[])', [userIds]);
    await client.query('DELETE FROM wallets WHERE user_id = ANY($1::int[])', [userIds]);
    await client.query('DELETE FROM provider_services WHERE provider_id = ANY($1::int[])', [providerIds]);
    await client.query('DELETE FROM providers WHERE id = ANY($1::int[])', [providerIds]);
    await client.query('DELETE FROM customer_profiles WHERE user_id = ANY($1::int[])', [userIds]);
    await client.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
};

const upsertUser = async (client, email, role, passwordHash, status = 'active') => {
    const result = await client.query(
        `INSERT INTO users (email, password_hash, role, status, email_verified_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            status = EXCLUDED.status,
            email_verified_at = COALESCE(users.email_verified_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [email, passwordHash, role, status]
    );
    const userId = result.rows[0].id;

    await client.query(
        'INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId]
    );

    return userId;
};

(async () => {
    if (process.env.NODE_ENV === 'production') {
        console.error('[seed:dev] refusing to run with NODE_ENV=production.');
        process.exit(1);
    }

    const reset = process.argv.includes('--reset');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        if (reset) {
            await resetDemoData(client);
            console.log('[seed:dev] previous demo rows removed');
        }

        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

        // --- Customers -------------------------------------------------------
        const customers = [
            { key: 'customer1', email: `demo.customer1${EMAIL_DOMAIN}`, name: '[DEMO] Anitha Rao' },
            { key: 'customer2', email: `demo.customer2${EMAIL_DOMAIN}`, name: '[DEMO] Kiran Kumar' },
        ];
        const customerIds = {};

        for (const customer of customers) {
            const userId = await upsertUser(client, customer.email, 'customer', passwordHash);
            customerIds[customer.key] = userId;
            await client.query(
                `INSERT INTO customer_profiles
                    (user_id, full_name, phone_number, address_line_1, city, location_lat, location_lon)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (user_id) DO UPDATE SET
                    full_name = EXCLUDED.full_name,
                    phone_number = EXCLUDED.phone_number,
                    address_line_1 = EXCLUDED.address_line_1,
                    city = EXCLUDED.city,
                    location_lat = EXCLUDED.location_lat,
                    location_lon = EXCLUDED.location_lon,
                    updated_at = CURRENT_TIMESTAMP`,
                [userId, customer.name, '+910000000000', 'Demo Street 1', 'Ongole', TEST_LOCATION.lat, TEST_LOCATION.lon]
            );
        }

        // --- Providers -------------------------------------------------------
        const serviceRows = await client.query('SELECT id, name FROM services WHERE is_active = TRUE');
        const serviceIds = new Map(serviceRows.rows.map((row) => [row.name, row.id]));
        const providerIds = {};

        for (const provider of PROVIDERS) {
            const userId = await upsertUser(client, provider.email, 'provider', passwordHash);
            const approved = provider.status === 'approved';

            const providerResult = await client.query(
                `INSERT INTO providers
                    (user_id, display_name, bio, location_lat, location_lon, service_radius_km,
                     is_verified, verification_status, rejection_reason, suspended_reason,
                     verified_at, verified_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                         CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE NULL END, NULL)
                 ON CONFLICT (user_id) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    bio = EXCLUDED.bio,
                    location_lat = EXCLUDED.location_lat,
                    location_lon = EXCLUDED.location_lon,
                    service_radius_km = EXCLUDED.service_radius_km,
                    is_verified = EXCLUDED.is_verified,
                    verification_status = EXCLUDED.verification_status,
                    rejection_reason = EXCLUDED.rejection_reason,
                    suspended_reason = EXCLUDED.suspended_reason,
                    updated_at = CURRENT_TIMESTAMP
                 RETURNING id`,
                [
                    userId,
                    provider.display_name,
                    provider.bio,
                    provider.location.lat,
                    provider.location.lon,
                    provider.radius,
                    approved,
                    provider.status,
                    provider.rejection_reason || null,
                    provider.suspended_reason || null,
                ]
            );
            const providerId = providerResult.rows[0].id;
            providerIds[provider.key] = providerId;

            await client.query('DELETE FROM provider_services WHERE provider_id = $1', [providerId]);
            for (const serviceName of provider.services) {
                const serviceId = serviceIds.get(serviceName);
                if (!serviceId) {
                    throw new Error(`Seed service "${serviceName}" is missing. Run npm run migrate first.`);
                }
                await client.query(
                    'INSERT INTO provider_services (provider_id, service_id, rate_per_hour) VALUES ($1, $2, $3)',
                    [providerId, serviceId, 400]
                );
            }
        }

        // --- A little booking/review history (created once) ------------------
        const existingBookings = await client.query(
            'SELECT COUNT(*)::int AS total FROM bookings WHERE customer_id = ANY($1::int[])',
            [Object.values(customerIds)]
        );

        if (existingBookings.rows[0].total === 0) {
            const acServiceId = serviceIds.get('AC/Refrigerator Repair');
            const electricServiceId = serviceIds.get('Electrician');

            const completed = await client.query(
                `INSERT INTO bookings
                    (customer_id, provider_id, service_id, booking_status, scheduled_at, address,
                     service_description, amount, created_at, updated_at)
                 VALUES ($1, $2, $3, 'closed', CURRENT_TIMESTAMP - INTERVAL '2 days',
                         'Demo Street 1, Ongole', 'Demo booking: AC service.', 450,
                         CURRENT_TIMESTAMP - INTERVAL '4 days', CURRENT_TIMESTAMP - INTERVAL '2 days')
                 RETURNING id`,
                [customerIds.customer1, providerIds.ac_near, acServiceId]
            );
            const completedId = completed.rows[0].id;

            await client.query(
                `INSERT INTO payments (booking_id, amount, status, gateway_transaction_id, paid_at)
                 VALUES ($1, 450, 'succeeded', $2, CURRENT_TIMESTAMP - INTERVAL '2 days')`,
                [completedId, `demo_txn_${Date.now()}`]
            );
            await client.query(
                `INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment, created_at)
                 VALUES ($1, $2, $3, 5, 'Demo review: prompt and professional service.', CURRENT_TIMESTAMP - INTERVAL '1 day')`,
                [completedId, customerIds.customer1, providerIds.ac_near]
            );
            await client.query(
                `INSERT INTO booking_status_history (booking_id, status, changed_by_role, note)
                 VALUES ($1, 'closed', 'system', 'Demo seed: completed booking.')`,
                [completedId]
            );
            await client.query(
                `UPDATE providers p
                 SET average_rating = COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 2)
                                                FROM reviews r WHERE r.provider_id = p.id AND r.is_hidden = FALSE), 0),
                     review_count = (SELECT COUNT(*) FROM reviews r
                                     WHERE r.provider_id = p.id AND r.is_hidden = FALSE)
                 WHERE p.id = $1`,
                [providerIds.ac_near]
            );

            const pending = await client.query(
                `INSERT INTO bookings
                    (customer_id, provider_id, service_id, booking_status, scheduled_at, address,
                     service_description, created_at, updated_at)
                 VALUES ($1, $2, $3, 'pending_provider', CURRENT_TIMESTAMP + INTERVAL '2 days',
                         'Demo Street 1, Ongole', 'Demo booking: refrigerator not cooling.',
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 RETURNING id`,
                [customerIds.customer1, providerIds.ac_mid, acServiceId]
            );
            await client.query(
                `INSERT INTO booking_status_history (booking_id, status, changed_by_role, note)
                 VALUES ($1, 'pending_provider', 'customer', 'Demo seed: new request.')`,
                [pending.rows[0].id]
            );

            const rejected = await client.query(
                `INSERT INTO bookings
                    (customer_id, provider_id, service_id, booking_status, scheduled_at, address,
                     service_description, amount, created_at, updated_at)
                 VALUES ($1, $2, $3, 'rejected', CURRENT_TIMESTAMP + INTERVAL '3 days',
                         'Demo Street 2, Ongole', 'Demo booking: electrical wiring check.', 700,
                         CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '1 day')
                 RETURNING id`,
                [customerIds.customer2, providerIds.electric_far, electricServiceId]
            );
            await client.query(
                `INSERT INTO booking_status_history (booking_id, status, changed_by_role, note)
                 VALUES ($1, 'rejected', 'provider', 'Demo seed: provider unavailable.')`,
                [rejected.rows[0].id]
            );
        }

        await client.query('COMMIT');

        // Optional first admin (only when ADMIN_EMAIL + ADMIN_PASSWORD are set).
        const adminResult = await ensureInitialAdmin();
        if (adminResult.created) {
            console.log(`[seed:dev] initial administrator created: ${adminResult.email}`);
        } else if (adminResult.reason && adminResult.reason !== 'not_configured' && adminResult.reason !== 'admin_exists') {
            console.warn(`[seed:dev] administrator bootstrap skipped: ${adminResult.reason}`);
        }

        const verify = await pool.query(
            `SELECT p.display_name, p.verification_status, p.location_lat, p.location_lon,
                    COALESCE(array_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '{}') AS services
             FROM providers p
             JOIN users u ON u.id = p.user_id
             LEFT JOIN provider_services ps ON ps.provider_id = p.id
             LEFT JOIN services s ON s.id = ps.service_id
             WHERE u.email LIKE $1
             GROUP BY p.id
             ORDER BY p.display_name`,
            [`%${EMAIL_DOMAIN}`]
        );

        console.log('\n[seed:dev] synthetic data ready (all accounts use @example.test):');
        console.log(`  customer: demo.customer1${EMAIL_DOMAIN} / ${DEMO_PASSWORD}`);
        console.log(`  customer: demo.customer2${EMAIL_DOMAIN} / ${DEMO_PASSWORD}`);
        console.log(`  providers: ${PROVIDERS.length} demo providers, password ${DEMO_PASSWORD}`);
        console.table(verify.rows);
        console.log(`  test location: ${TEST_LOCATION.lat}, ${TEST_LOCATION.lon} (Ongole)`);
        console.log('  expected at 10 km: 2 approved AC providers (near + mid), electrician excluded, far/pending/rejected/suspended excluded.');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[seed:dev] FAILED:', err.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end().catch(() => {});
    }
})();
