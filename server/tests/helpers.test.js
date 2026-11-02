// backend/tests/helpers.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateDistance,
    generateOtp,
    isValidEmail,
    buildFileUrl,
} = require('../src/utils/helpers');

test('calculateDistance returns 0 for the same point', () => {
    assert.equal(calculateDistance(12.9716, 77.5946, 12.9716, 77.5946), 0);
});

test('calculateDistance approximates one degree of latitude (~111 km)', () => {
    const distance = calculateDistance(0, 0, 1, 0);
    assert.ok(distance > 110 && distance < 112, `unexpected distance: ${distance}`);
});

test('calculateDistance is symmetric', () => {
    const forward = calculateDistance(12.9716, 77.5946, 13.0827, 80.2707);
    const backward = calculateDistance(13.0827, 80.2707, 12.9716, 77.5946);
    assert.ok(Math.abs(forward - backward) < 1e-9);
});

test('generateOtp returns a 6 digit numeric string', () => {
    for (let i = 0; i < 50; i += 1) {
        assert.match(generateOtp(), /^\d{6}$/);
    }
});

test('isValidEmail accepts normal addresses', () => {
    assert.equal(isValidEmail('user@example.com'), true);
    assert.equal(isValidEmail('first.last+tag@sub.example.co.in'), true);
});

test('isValidEmail rejects malformed addresses', () => {
    assert.equal(isValidEmail('user@'), false);
    assert.equal(isValidEmail('user example.com'), false);
    assert.equal(isValidEmail(''), false);
    assert.equal(isValidEmail(null), false);
    assert.equal(isValidEmail('a'.repeat(250) + '@example.com'), false);
});

test('buildFileUrl prefers PUBLIC_BASE_URL when configured', () => {
    const previous = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'http://localhost:3001/';

    const req = { protocol: 'http', get: () => 'backend:3001' };
    assert.equal(buildFileUrl(req, 'photo.jpg'), 'http://localhost:3001/uploads/photo.jpg');

    if (previous === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previous;
});

test('buildFileUrl falls back to the request origin', () => {
    const previous = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;

    const req = { protocol: 'http', get: () => 'localhost:3001' };
    assert.equal(buildFileUrl(req, 'photo.jpg'), 'http://localhost:3001/uploads/photo.jpg');

    if (previous !== undefined) process.env.PUBLIC_BASE_URL = previous;
});
