const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProviderSearchQuery, mapProviderRow } = require('../src/services/providerSearch');

const sqlFor = (params) => buildProviderSearchQuery(params).text;

test('provider search filters to approved, active, located providers', () => {
    const sql = sqlFor({ serviceId: 5, latitude: 16.17, longitude: 81.13, radiusKm: 10 });
    assert.match(sql, /p\.verification_status = 'approved'/);
    assert.match(sql, /p\.is_verified = TRUE/);
    assert.match(sql, /u\.status = 'active'/);
    assert.match(sql, /p\.location_lat IS NOT NULL/);
    assert.match(sql, /p\.location_lon IS NOT NULL/);
    assert.match(sql, /NOT \(p\.location_lat = 0 AND p\.location_lon = 0\)/);
});

test('provider search requires the requested service via provider_services', () => {
    const sql = sqlFor({ serviceId: 5, latitude: null, longitude: null });
    assert.match(sql, /FROM provider_services ps/);
    assert.match(sql, /sv\.id = \$1::int/);
    assert.match(sql, /\(\$1::int IS NULL OR s\.id IS NOT NULL\)/);
});

test('provider search only joins active service categories', () => {
    const sql = sqlFor({ serviceId: 5, latitude: null, longitude: null });
    assert.match(sql, /sv\.is_active = TRUE/g);
});

test('provider search computes Haversine distance in kilometres', () => {
    const sql = sqlFor({ serviceId: 5, latitude: 16.17, longitude: 81.13, radiusKm: 10 });
    assert.match(sql, /6371\.0088 \* 2 \* asin/);
    assert.match(sql, /radians\(p\.location_lat::float8 - \$2::float8\)/);
    assert.match(sql, /radians\(p\.location_lon::float8 - \$3::float8\)/);
});

test('provider search filters by both the search radius and provider coverage', () => {
    const sql = sqlFor({ serviceId: 5, latitude: 16.17, longitude: 81.13, radiusKm: 10 });
    assert.match(sql, /distance_km <= \$4::float8/);
    assert.match(sql, /LEAST\(\$4::float8, COALESCE\(service_radius_km, \$4::float8\)\)/);
});

test('provider search uses a lat/lon bounding-box prefilter', () => {
    const sql = sqlFor({ serviceId: 5, latitude: 16.17, longitude: 81.13, radiusKm: 10 });
    assert.match(sql, /p\.location_lat BETWEEN \$2::float8/);
    assert.match(sql, /p\.location_lon BETWEEN/);
    assert.match(sql, /GREATEST\(cos\(radians\(\$2::float8\)\), 0\.000001\)/);
});

test('provider search sorts by distance when a location is supplied', () => {
    const sql = sqlFor({ serviceId: 5, latitude: 16.17, longitude: 81.13, radiusKm: 10 });
    assert.match(sql, /CASE WHEN \$2::float8 IS NOT NULL THEN distance_km END ASC NULLS LAST/);
    assert.match(sql, /average_rating DESC/);
});

test('provider search without a location keeps approved providers but no distance filter', () => {
    const { text, values } = buildProviderSearchQuery({ serviceId: 5, latitude: null, longitude: null });
    assert.equal(values[1], null);
    assert.equal(values[2], null);
    assert.match(text, /WHERE \$2::float8 IS NULL/);
});

test('provider search without a service (top rated) does not require a service match', () => {
    const { text, values } = buildProviderSearchQuery({ serviceId: null, latitude: null, longitude: null });
    assert.equal(values[0], null);
    assert.match(text, /\(\$1::int IS NULL OR s\.id IS NOT NULL\)/);
});

test('query parameter order matches the placeholders', () => {
    const { values } = buildProviderSearchQuery({
        serviceId: 7,
        latitude: 16.17,
        longitude: 81.13,
        radiusKm: 25,
        limit: 40,
    });
    assert.deepEqual(values, [7, 16.17, 81.13, 25, 40]);
});

test('mapProviderRow converts numeric strings and always returns a services array', () => {
    const mapped = mapProviderRow({
        id: 1,
        average_rating: '4.50',
        review_count: '3',
        service_radius_km: '10',
        location_lat: '16.17000000',
        location_lon: '81.12999700',
        services: null,
        distance_km: '1.234',
    });

    assert.equal(mapped.average_rating, 4.5);
    assert.equal(mapped.review_count, 3);
    assert.equal(mapped.service_radius_km, 10);
    assert.equal(mapped.location_lat, 16.17);
    assert.equal(mapped.distance_km, 1.2);
    assert.deepEqual(mapped.services, []);
});
