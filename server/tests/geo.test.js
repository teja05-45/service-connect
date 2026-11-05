const test = require('node:test');
const assert = require('node:assert/strict');

const {
    EARTH_RADIUS_KM,
    isValidLatitude,
    isValidLongitude,
    isUsableStoredLocation,
    parseCoordinates,
    clampRadius,
    parseProviderRadius,
    haversineKm,
    roundDistance,
} = require('../src/utils/geo');

test('latitude validation accepts the valid range and rejects out-of-range values', () => {
    assert.equal(isValidLatitude(0), true);
    assert.equal(isValidLatitude(-90), true);
    assert.equal(isValidLatitude(90), true);
    assert.equal(isValidLatitude(90.0001), false);
    assert.equal(isValidLatitude(-90.0001), false);
    assert.equal(isValidLatitude(NaN), false);
    assert.equal(isValidLatitude('16.17'), false);
});

test('longitude validation accepts the valid range and rejects out-of-range values', () => {
    assert.equal(isValidLongitude(0), true);
    assert.equal(isValidLongitude(-180), true);
    assert.equal(isValidLongitude(180), true);
    assert.equal(isValidLongitude(180.5), false);
    assert.equal(isValidLongitude(Infinity), false);
});

test('parseCoordinates requires a complete, numeric pair', () => {
    assert.deepEqual(parseCoordinates({ lat: '16.17', lon: '81.13' }), {
        latitude: 16.17,
        longitude: 81.13,
        hasLocation: true,
    });

    assert.equal(parseCoordinates({ lat: '16.17' }).error, 'Provide both latitude and longitude, or neither.');
    assert.equal(parseCoordinates({ lat: 'abc', lon: '81.13' }).error, 'Latitude and longitude must be numbers.');
    assert.equal(parseCoordinates({ lat: '91', lon: '81.13' }).error, 'Latitude must be between -90 and 90.');
    assert.equal(parseCoordinates({ lat: '16.17', lon: '181' }).error, 'Longitude must be between -180 and 180.');
});

test('parseCoordinates treats an absent pair and (0,0) as "location not set"', () => {
    assert.deepEqual(parseCoordinates({}), { latitude: null, longitude: null, hasLocation: false });

    const nullIsland = parseCoordinates({ lat: 0, lon: 0 });
    assert.equal(nullIsland.hasLocation, false);
    assert.equal(nullIsland.ignoredNullIsland, true);
    assert.equal(nullIsland.error, undefined);
});

test('stored provider locations must be usable, not NULL and not (0,0)', () => {
    assert.equal(isUsableStoredLocation(16.17, 81.13), true);
    assert.equal(isUsableStoredLocation(null, 81.13), false);
    assert.equal(isUsableStoredLocation(0, 0), false);
    assert.equal(isUsableStoredLocation('16.17', '81.13'), true);
    assert.equal(isUsableStoredLocation(200, 81.13), false);
});

test('clampRadius applies defaults, clamps and rounds', () => {
    assert.equal(clampRadius(undefined, { fallback: 10, max: 30 }), 10);
    assert.equal(clampRadius('5', { fallback: 10, max: 30 }), 5);
    assert.equal(clampRadius('999', { fallback: 10, max: 30 }), 30);
    assert.equal(clampRadius('0', { fallback: 10, max: 30 }), 1);
    assert.equal(clampRadius('abc', { fallback: 20, max: 30 }), 20);
    assert.equal(clampRadius('12.6', { fallback: 10, max: 30 }), 13);
});

test('provider coverage radius falls back to the default and is bounded', () => {
    assert.equal(parseProviderRadius(null), 10);
    assert.equal(parseProviderRadius(undefined, 15), 15);
    assert.equal(parseProviderRadius(25), 25);
    assert.equal(parseProviderRadius(0), 1);
    assert.equal(parseProviderRadius(1000), 100);
});

test('haversine is zero for the same point and symmetric', () => {
    assert.equal(haversineKm(16.17, 81.13, 16.17, 81.13), 0);
    const forward = haversineKm(16.17, 81.13, 16.2, 81.15);
    const backward = haversineKm(16.2, 81.15, 16.17, 81.13);
    assert.ok(Math.abs(forward - backward) < 1e-9);
    assert.ok(forward > 0 && forward < 5);
});

test('one degree of latitude is about 111 km with the shared Earth radius', () => {
    assert.equal(EARTH_RADIUS_KM, 6371.0088);
    const distance = haversineKm(0, 0, 1, 0);
    assert.ok(distance > 111 && distance < 112, `unexpected distance: ${distance}`);
});

test('roundDistance keeps one decimal and preserves null', () => {
    assert.equal(roundDistance(1.234), 1.2);
    assert.equal(roundDistance(9.96), 10);
    assert.equal(roundDistance(null), null);
});
