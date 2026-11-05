// DB-backed integration tests for the administrator API.
//
// SKIPPED unless TEST_DATABASE_URL points at a disposable database:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5433/service_connect_test \
//     npm test
//
// Only rows with the "it-admin-" email prefix created by this suite are removed.

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const enabled = Boolean(process.env.TEST_DATABASE_URL);
if (enabled) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret';
}

const skip = enabled ? false : 'Set TEST_DATABASE_URL to run database integration tests.';
const PREFIX = `it-admin-${Date.now()}`;
const PASSWORD = 'IntegrationPass123!';

let pool;
let app;
let server;
let baseUrl;
let adminToken;
let customerToken;
let providerToken;
let adminId;
let customerId;
let providerUserId;
let providerId;
let serviceId;
let bookingId;
let reviewId;

const request = async (pathname, { token, method = 'GET', body } = {}) => {
    const response = await fetch(`${baseUrl}/api/v1${pathname}`, {
        method,
        headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { 'x-auth-token': token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
};

const createUser = async (suffix, role, status = 'active') => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const result = await pool.query(
        `INSERT INTO users (email, password_hash, role, status, email_verified_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id`,
        [`${PREFIX}-${suffix}@example.test`, hash, role, status]
    );
    return result.rows[0].id;
};

test.before(async () => {
    if (!enabled) return;
    pool = require('../../src/config/db');
    await pool.query(fs.readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8'));
    const migrationsDir = path.join(__dirname, '../../db/migrations');
    for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
        await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    await pool.query(fs.readFileSync(path.join(__dirname, '../../db/seed.sql'), 'utf8'));

    adminId = await createUser('admin', 'admin');
    customerId = await createUser('customer', 'customer');
    providerUserId = await createUser('provider', 'provider');

    await pool.query(
        `INSERT INTO customer_profiles (user_id, full_name, location_lat, location_lon)
         VALUES ($1, '[IT] Customer', 16.17, 81.129997)`,
        [customerId]
    );

    const provider = await pool.query(
        `INSERT INTO providers (user_id, display_name, location_lat, location_lon, service_radius_km,
                                is_verified, verification_status)
         VALUES ($1, '[IT] Provider', 16.175, 81.135, 10, TRUE, 'approved') RETURNING id`,
        [providerUserId]
    );
    providerId = provider.rows[0].id;

    const service = await pool.query("SELECT id FROM services WHERE name = 'AC/Refrigerator Repair'");
    serviceId = service.rows[0].id;
    await pool.query('INSERT INTO provider_services (provider_id, service_id) VALUES ($1, $2)', [providerId, serviceId]);

    const booking = await pool.query(
        `INSERT INTO bookings (customer_id, provider_id, service_id, booking_status, scheduled_at,
                               address, service_description, amount)
         VALUES ($1, $2, $3, 'closed', CURRENT_TIMESTAMP, 'IT address', 'IT booking', 100)
         RETURNING id`,
        [customerId, providerId, serviceId]
    );
    bookingId = booking.rows[0].id;
    await pool.query(
        `INSERT INTO payments (booking_id, amount, status, gateway_transaction_id, paid_at)
         VALUES ($1, 100, 'succeeded', $2, CURRENT_TIMESTAMP)`,
        [bookingId, `${PREFIX}-txn`]
    );
    const review = await pool.query(
        `INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment)
         VALUES ($1, $2, $3, 2, 'IT review') RETURNING id`,
        [bookingId, customerId, providerId]
    );
    reviewId = review.rows[0].id;
    await pool.query(
        `UPDATE providers SET average_rating = 2.00, review_count = 1 WHERE id = $1`,
        [providerId]
    );

    app = require('../../index');
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const adminLogin = await request('/admin/login', {
        method: 'POST',
        body: { email: `${PREFIX}-admin@example.test`, password: PASSWORD },
    });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));
    adminToken = adminLogin.body.token;

    const customerLogin = await request('/auth/login', {
        method: 'POST',
        body: { email: `${PREFIX}-customer@example.test`, password: PASSWORD },
    });
    customerToken = customerLogin.body.token;

    const providerLogin = await request('/auth/login', {
        method: 'POST',
        body: { email: `${PREFIX}-provider@example.test`, password: PASSWORD },
    });
    providerToken = providerLogin.body.token;
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
            await pool.query('DELETE FROM reviews WHERE booking_id = ANY($1::int[])', [bookingIds]);
            await pool.query('DELETE FROM payments WHERE booking_id = ANY($1::int[])', [bookingIds]);
            await pool.query('DELETE FROM messages WHERE booking_id = ANY($1::int[])', [bookingIds]);
            await pool.query('DELETE FROM bookings WHERE id = ANY($1::int[])', [bookingIds]);
        }
        await pool.query('DELETE FROM admin_audit_logs WHERE admin_id = ANY($1::int[])', [userIds]);
        await pool.query('DELETE FROM provider_services WHERE provider_id = ANY($1::int[])', [providerIds]);
        await pool.query('DELETE FROM providers WHERE id = ANY($1::int[])', [providerIds]);
        await pool.query('DELETE FROM customer_profiles WHERE user_id = ANY($1::int[])', [userIds]);
        await pool.query('DELETE FROM wallets WHERE user_id = ANY($1::int[])', [userIds]);
        await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [userIds]);
    }
    // Remove service categories created by this suite.
    await pool.query("DELETE FROM services WHERE name LIKE '[IT]%'");
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end().catch(() => {});
});

test('administrator can log in with the separate admin login', { skip }, async () => {
    const result = await request('/admin/login', {
        method: 'POST',
        body: { email: `${PREFIX}-admin@example.test`, password: PASSWORD },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.role, 'admin');
    assert.ok(result.body.token);
});

test('invalid administrator credentials are rejected', { skip }, async () => {
    const result = await request('/admin/login', {
        method: 'POST',
        body: { email: `${PREFIX}-admin@example.test`, password: 'wrong-password' },
    });
    assert.equal(result.status, 401);
});

test('a customer cannot sign in through the admin login', { skip }, async () => {
    const result = await request('/admin/login', {
        method: 'POST',
        body: { email: `${PREFIX}-customer@example.test`, password: PASSWORD },
    });
    assert.equal(result.status, 401);
});

test('a provider token cannot access admin endpoints', { skip }, async () => {
    const result = await request('/admin/users', { token: providerToken });
    assert.equal(result.status, 403);
});

test('unauthenticated admin API requests are rejected', { skip }, async () => {
    const result = await request('/admin/users');
    assert.equal(result.status, 401);
});

test('an invalid JWT is rejected', { skip }, async () => {
    const result = await request('/admin/users', { token: 'not-a-real-jwt' });
    assert.equal(result.status, 401);
});

test('dashboard statistics come from the database', { skip }, async () => {
    const result = await request('/admin/dashboard/stats', { token: adminToken });
    assert.equal(result.status, 200);
    assert.ok(result.body.users.total_users >= 3);
    assert.ok(result.body.providers.total_providers >= 1);
    assert.ok(result.body.bookings.total_bookings >= 1);
    assert.ok(Array.isArray(result.body.recent_registrations));
});

test('admin can list users with pagination metadata', { skip }, async () => {
    const result = await request('/admin/users?page=1&limit=2', { token: adminToken });
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.data));
    assert.equal(result.body.data.length <= 2, true);
    assert.equal(result.body.pagination.page, 1);
    assert.equal(result.body.pagination.limit, 2);
    assert.equal(result.body.data[0].password_hash, undefined);
});

test('admin can list providers with their services', { skip }, async () => {
    const result = await request('/admin/providers?status=approved', { token: adminToken });
    assert.equal(result.status, 200);
    const found = result.body.data.find((provider) => provider.id === providerId);
    assert.ok(found);
    assert.ok(found.services.includes('AC/Refrigerator Repair'));
});

test('admin can approve a provider', { skip }, async () => {
    await pool.query("UPDATE providers SET verification_status = 'pending' WHERE id = $1", [providerId]);
    const result = await request(`/admin/providers/${providerId}/approve`, { token: adminToken, method: 'PATCH', body: {} });
    assert.equal(result.status, 200);
    const row = await pool.query('SELECT verification_status, is_verified FROM providers WHERE id = $1', [providerId]);
    assert.equal(row.rows[0].verification_status, 'approved');
    assert.equal(row.rows[0].is_verified, true);
});

test('provider rejection requires a reason and records it', { skip }, async () => {
    const withoutReason = await request(`/admin/providers/${providerId}/reject`, { token: adminToken, method: 'PATCH', body: {} });
    assert.equal(withoutReason.status, 400);

    const result = await request(`/admin/providers/${providerId}/reject`, {
        token: adminToken,
        method: 'PATCH',
        body: { reason: 'IT documents unreadable' },
    });
    assert.equal(result.status, 200);
    const row = await pool.query('SELECT verification_status, rejection_reason FROM providers WHERE id = $1', [providerId]);
    assert.equal(row.rows[0].verification_status, 'rejected');
    assert.equal(row.rows[0].rejection_reason, 'IT documents unreadable');
});

test('admin can suspend a provider', { skip }, async () => {
    const result = await request(`/admin/providers/${providerId}/suspend`, {
        token: adminToken,
        method: 'PATCH',
        body: { reason: 'IT suspension reason' },
    });
    assert.equal(result.status, 200);
    const row = await pool.query('SELECT verification_status, is_verified FROM providers WHERE id = $1', [providerId]);
    assert.equal(row.rows[0].verification_status, 'suspended');
    assert.equal(row.rows[0].is_verified, false);
});

test('admin can create a service category', { skip }, async () => {
    const result = await request('/admin/services', {
        token: adminToken,
        method: 'POST',
        body: { name: `[IT] Service ${Date.now()}`, description: 'IT service' },
    });
    assert.equal(result.status, 201);
    assert.ok(result.body.service.id);
    serviceId = serviceId || result.body.service.id;
});

test('admin can modify a service category', { skip }, async () => {
    const created = await request('/admin/services', {
        token: adminToken,
        method: 'POST',
        body: { name: `[IT] Editable ${Date.now()}` },
    });
    const result = await request(`/admin/services/${created.body.service.id}`, {
        token: adminToken,
        method: 'PATCH',
        body: { description: 'Updated by IT', is_active: false },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.service.description, 'Updated by IT');
    assert.equal(result.body.service.is_active, false);
});

test('admin can list bookings and view status history', { skip }, async () => {
    const list = await request(`/admin/bookings?q=${bookingId}`, { token: adminToken });
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((booking) => booking.id === bookingId));

    const detail = await request(`/admin/bookings/${bookingId}`, { token: adminToken });
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.body.status_history));
});

test('admin can moderate a review and the rating is recalculated', { skip }, async () => {
    const hidden = await request(`/admin/reviews/${reviewId}/moderate`, {
        token: adminToken,
        method: 'PATCH',
        body: { action: 'hide', reason: 'IT inappropriate content' },
    });
    assert.equal(hidden.status, 200);

    const provider = await pool.query('SELECT average_rating, review_count FROM providers WHERE id = $1', [providerId]);
    assert.equal(Number(provider.rows[0].average_rating), 0);
    assert.equal(Number(provider.rows[0].review_count), 0);

    const restored = await request(`/admin/reviews/${reviewId}/moderate`, {
        token: adminToken,
        method: 'PATCH',
        body: { action: 'unhide' },
    });
    assert.equal(restored.status, 200);
});

test('admin actions are written to the audit log', { skip }, async () => {
    const result = await request("/admin/audit-logs?action=provider", { token: adminToken });
    assert.equal(result.status, 200);
    assert.ok(result.body.data.some((entry) => entry.action === 'provider.approve'));
});

test('admin listings honour page and limit', { skip }, async () => {
    const page1 = await request('/admin/audit-logs?page=1&limit=1', { token: adminToken });
    const page2 = await request('/admin/audit-logs?page=2&limit=1', { token: adminToken });
    assert.equal(page1.body.pagination.limit, 1);
    assert.equal(page1.body.data.length, 1);
    if (page1.body.pagination.total > 1) {
        assert.notEqual(page1.body.data[0].id, page2.body.data[0].id);
    }
});

test('JWT role escalation is rejected by the database check', { skip }, async () => {
    const forged = jwt.sign({ user: { id: customerId, role: 'admin' } }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const result = await request('/admin/users', { token: forged });
    assert.equal(result.status, 403);
});
