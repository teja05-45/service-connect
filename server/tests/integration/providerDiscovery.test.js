// DB-backed integration tests for provider discovery.
//
// These tests are SKIPPED unless a disposable test database is provided:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5433/service_connect_test \
//     npm test
//
// The database is wiped ONLY for synthetic rows created by this suite (all
// emails start with "it-discovery-"); the schema/seed are applied idempotently.

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const enabled = Boolean(process.env.TEST_DATABASE_URL);
if (enabled) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
}

const skip = enabled ? false : 'Set TEST_DATABASE_URL to run database integration tests.';

let pool;
let app;
let server;
let baseUrl;
let serviceId;
let otherServiceId;
const PREFIX = `it-discovery-${Date.now()}`;
const ORIGIN = { lat: 16.17, lon: 81.129997 };

const KM_LAT = 111.045;
const KM_LON = 111.045 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const offset = (northKm, eastKm) => ({
    lat: Number((ORIGIN.lat + northKm / KM_LAT).toFixed(8)),
    lon: Number((ORIGIN.lon + eastKm / KM_LON).toFixed(8)),
});

const makeProvider = async ({ key, km, status = 'approved', services = [], coords = true, userStatus = 'active', coverage = 10 }) => {
    const email = `${PREFIX}-${key}@example.test`;
    const passwordHash = await bcrypt.hash('IntegrationPass123!', 4);
    const user = await pool.query(
        `INSERT INTO users (email, password_hash, role, status, email_verified_at)
         VALUES ($1, $2, 'provider', $3, CURRENT_TIMESTAMP) RETURNING id`,
        [email, passwordHash, userStatus]
    );
    // Place the provider due north by `km`; the previous fixture offset both
    // axes, which made a "10 km" provider ~14.1 km away (diagonal).
    const location = coords ? offset(km, 0) : { lat: null, lon: null };
    const provider = await pool.query(
        `INSERT INTO providers
            (user_id, display_name, location_lat, location_lon, service_radius_km,
             is_verified, verification_status)
         VALUES ($1, $2, $3, $4, $7, $5, $6) RETURNING id`,
        [user.rows[0].id, `[IT] ${key}`, location.lat, location.lon, status === 'approved', status, coverage]
    );

    for (const sid of services) {
        await pool.query('INSERT INTO provider_services (provider_id, service_id) VALUES ($1, $2)', [provider.rows[0].id, sid]);
    }
    return { providerId: provider.rows[0].id, userId: user.rows[0].id };
};

const search = async (query) => {
    const response = await fetch(`${baseUrl}/api/v1/providers?${query}`);
    return { status: response.status, body: await response.json() };
};

test.before(async () => {
    if (!enabled) return;
    pool = require('../../src/config/db');

    // Base schema + migrations + service seed (all idempotent).
    await pool.query(fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8'));
    const migrationsDir = path.join(__dirname, '../../db/migrations');
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
        await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    await pool.query(fs.readFileSync(path.join(__dirname, '../../db/seed.sql'), 'utf8'));

    const services = await pool.query("SELECT id, name FROM services WHERE name IN ('AC/Refrigerator Repair', 'Electrician')");
    serviceId = services.rows.find((row) => row.name === 'AC/Refrigerator Repair').id;
    otherServiceId = services.rows.find((row) => row.name === 'Electrician').id;

    // Synthetic users are deleted by prefix at the end.
    app = require('../../index');
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (!enabled) return;

    const users = await pool.query('SELECT id FROM users WHERE email LIKE $1', [`${PREFIX}%`]);
    const userIds = users.rows.map((row) => row.id);
    if (userIds.length > 0) {
        const providers = await pool.query('SELECT id FROM providers WHERE user_id = ANY($1::int[])', [userIds]);
        const providerIds = providers.rows.map((row) => row.id);
        const bookings = await pool.query(
            'SELECT id FROM bookings WHERE customer_id = ANY($1::int[]) OR provider_id = ANY($2::int[])',
            [userIds, providerIds]
        );
        const bookingIds = bookings.rows.map((row) => row.id);
        if (bookingIds.length > 0) {
            await pool.query('DELETE FROM booking_status_history WHERE booking_id = ANY($1::int[])', [bookingIds]);
            await pool.query('DELETE FROM bookings WHERE id = ANY($1::int[])', [bookingIds]);
        }
        await pool.query('DELETE FROM provider_services WHERE provider_id = ANY($1::int[])', [providerIds]);
        await pool.query('DELETE FROM providers WHERE id = ANY($1::int[])', [providerIds]);
        await pool.query('DELETE FROM wallets WHERE user_id = ANY($1::int[])', [userIds]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
    }

    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
});

test('approved nearby provider offering the selected service is returned', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'near', km: 0.5, services: [serviceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);

    assert.equal(result.status, 200);
    const found = result.body.providers.find((provider) => provider.id === providerId);
    assert.ok(found, 'approved nearby provider should be discoverable');
    assert.equal(found.is_verified, true);
    assert.ok(found.distance_km <= 1.5);
});

test('approved provider outside the radius is excluded', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'far', km: 25, services: [serviceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    assert.equal(result.body.providers.some((provider) => provider.id === providerId), false);
});

test('pending provider is not publicly discoverable', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'pending', km: 0.4, status: 'pending', services: [serviceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    assert.equal(result.body.providers.some((provider) => provider.id === providerId), false);
});

test('suspended provider is not publicly discoverable', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'suspended', km: 0.4, status: 'suspended', services: [serviceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    assert.equal(result.body.providers.some((provider) => provider.id === providerId), false);
});

test('approved provider offering another service is excluded', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'other-service', km: 0.4, services: [otherServiceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    assert.equal(result.body.providers.some((provider) => provider.id === providerId), false);
});

test('provider with missing coordinates is excluded', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'no-coords', km: 0.4, services: [serviceId], coords: false });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    assert.equal(result.body.providers.some((provider) => provider.id === providerId), false);
});

test('invalid customer coordinates are rejected with 400', { skip }, async () => {
    const result = await search(`service_id=${serviceId}&lat=999&lon=${ORIGIN.lon}`);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_COORDINATES');
});

test('missing customer location returns approved providers without a distance filter', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'no-location', km: 2, services: [serviceId] });
    const result = await search(`service_id=${serviceId}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.search.has_location, false);
    assert.ok(result.body.providers.some((provider) => provider.id === providerId));
});

test('multiple nearby providers are sorted by distance', { skip }, async () => {
    const near = await makeProvider({ key: 'sort-near', km: 0.3, services: [serviceId] });
    const mid = await makeProvider({ key: 'sort-mid', km: 3, services: [serviceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10&`);
    const ids = result.body.providers.map((provider) => provider.id);
    assert.ok(ids.indexOf(near.providerId) < ids.indexOf(mid.providerId), 'nearer provider should come first');
});

test('provider exactly on the radius boundary is included', { skip }, async () => {
    // ~9.9 km north, so it is inside but very close to the 10 km boundary.
    const { providerId } = await makeProvider({ key: 'boundary', km: 9.9, services: [serviceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    assert.ok(result.body.providers.some((provider) => provider.id === providerId));
});

test('a larger radius includes providers that a smaller radius excludes', { skip }, async () => {
    // The provider must serve a wider area for the search radius (not the
    // coverage radius) to be the only binding constraint.
    const { providerId } = await makeProvider({ key: 'radius-15', km: 15, services: [serviceId], coverage: 30 });
    const small = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    const large = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=30`);
    assert.equal(small.body.providers.some((provider) => provider.id === providerId), false);
    assert.equal(large.body.providers.some((provider) => provider.id === providerId), true);
});

test('no matching provider returns an empty list, not an error', { skip }, async () => {
    const result = await search(`service_id=${serviceId}&lat=-45&lon=170&radius=5`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.providers, []);
});

test('unknown service category returns a clear 404', { skip }, async () => {
    const result = await search('service_id=999999&lat=16.17&lon=81.13');
    assert.equal(result.status, 404);
    assert.equal(result.body.code, 'SERVICE_NOT_FOUND');
});

test('provider with multiple services is returned once for the selected service', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'multi', km: 1, services: [serviceId, otherServiceId] });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    const matches = result.body.providers.filter((provider) => provider.id === providerId);
    assert.equal(matches.length, 1);
    assert.ok(matches[0].services.includes('AC/Refrigerator Repair'));
    assert.ok(matches[0].services.includes('Electrician'));
});

test('a suspended user account hides its approved provider', { skip }, async () => {
    const { providerId } = await makeProvider({ key: 'user-suspended', km: 0.5, services: [serviceId], userStatus: 'suspended' });
    const result = await search(`service_id=${serviceId}&lat=${ORIGIN.lat}&lon=${ORIGIN.lon}&radius=10`);
    assert.equal(result.body.providers.some((provider) => provider.id === providerId), false);
});
