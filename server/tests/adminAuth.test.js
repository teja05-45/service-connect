const test = require('node:test');
const assert = require('node:assert/strict');

const { createAdminGuard } = require('../src/middleware/adminAuth');
const { parsePagination, buildPaginationMeta } = require('../src/utils/pagination');
const { validateSettingValue } = require('../src/services/settings');

const makeResponse = () => {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
    return res;
};

const makeDb = (rows) => {
    const queries = [];
    return {
        queries,
        async query(text, values) {
            queries.push({ text, values });
            return { rows };
        },
    };
};

test('admin guard rejects a non-admin token role without querying the database', async () => {
    const db = makeDb([]);
    const guard = createAdminGuard(db);
    const req = { user: { id: 1, role: 'customer' } };
    const res = makeResponse();
    let nextCalled = false;

    await guard(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(db.queries.length, 0);
});

test('admin guard rejects an admin token when the database role is no longer admin', async () => {
    const db = makeDb([]);
    const guard = createAdminGuard(db);
    const req = { user: { id: 9, role: 'admin' } };
    const res = makeResponse();
    let nextCalled = false;

    await guard(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test('admin guard rejects a suspended administrator', async () => {
    const db = makeDb([{ id: 9, role: 'admin', status: 'suspended' }]);
    const guard = createAdminGuard(db);
    const req = { user: { id: 9, role: 'admin' } };
    const res = makeResponse();
    let nextCalled = false;

    await guard(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test('admin guard allows an active administrator and attaches req.admin', async () => {
    const db = makeDb([{ id: 9, role: 'admin', status: 'active' }]);
    const guard = createAdminGuard(db);
    const req = { user: { id: 9, role: 'admin' } };
    const res = makeResponse();
    let nextCalled = false;

    await guard(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.deepEqual(req.admin, { id: 9 });
    assert.equal(res.statusCode, 200);
    assert.match(db.queries[0].text, /role = 'admin'/);
});

test('admin guard returns 500 when the database check throws', async () => {
    const db = {
        async query() {
            throw new Error('db down');
        },
    };
    const guard = createAdminGuard(db);
    const res = makeResponse();
    let nextCalled = false;

    await guard({ user: { id: 9, role: 'admin' } }, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 500);
});

test('pagination parses defaults and clamps limits', () => {
    assert.deepEqual(parsePagination({}), { page: 1, limit: 20, offset: 0 });
    assert.deepEqual(parsePagination({ page: '3', limit: '10' }), { page: 3, limit: 10, offset: 20 });
    assert.deepEqual(parsePagination({ page: '-2', limit: '9999' }), { page: 1, limit: 100, offset: 0 });
    assert.deepEqual(parsePagination({ page: 'abc', limit: 'abc' }), { page: 1, limit: 20, offset: 0 });
});

test('pagination metadata reports totals and navigation flags', () => {
    assert.deepEqual(buildPaginationMeta(0, 1, 20), {
        page: 1,
        limit: 20,
        total: 0,
        total_pages: 0,
        has_next: false,
        has_previous: false,
    });

    const second = buildPaginationMeta(45, 2, 20);
    assert.equal(second.total_pages, 3);
    assert.equal(second.has_next, true);
    assert.equal(second.has_previous, true);
});

test('setting validation enforces types and bounds', () => {
    assert.deepEqual(validateSettingValue('default_search_radius_km', '15'), { value: '15' });
    assert.equal(validateSettingValue('default_search_radius_km', '0').error.includes('between'), true);
    assert.equal(validateSettingValue('default_search_radius_km', '12.5').error.includes('whole number'), true);
    assert.deepEqual(validateSettingValue('booking_allow_new_bookings', false), { value: 'false' });
    assert.equal(validateSettingValue('provider_approval_policy', 'sneaky').error.includes('manual'), true);
    assert.equal(validateSettingValue('unknown_key', '1').error.includes('Unknown setting'), true);
});
