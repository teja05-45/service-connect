// backend/src/services/providerSearch.js
//
// Provider discovery query builder.
//
// Everything that decides whether a provider is discoverable lives in one SQL
// statement so the rules can be reviewed (and integration tested) in one place:
//
//   1. provider verification == 'approved' (and legacy is_verified mirror)
//   2. provider's user account is active
//   3. provider has usable coordinates (not NULL, not 0,0)
//   4. provider offers the requested, still-active service category
//   5. optional distance filter: distance <= search radius
//      AND distance <= the provider's own coverage radius (missing coverage
//      falls back to the search radius instead of hiding the provider)
//
// Distance is computed with the Haversine formula in kilometres, plus a cheap
// bounding-box prefilter so the lat/lon index can be used. No PostGIS needed.

const { DEFAULT_SEARCH_RADIUS_KM, roundDistance } = require('../utils/geo');

const buildProviderSearchQuery = ({
    serviceId = null,
    latitude = null,
    longitude = null,
    radiusKm = DEFAULT_SEARCH_RADIUS_KM,
    limit = 50,
    sortBy = null,
} = {}) => {
    const values = [serviceId, latitude, longitude, radiusKm, limit];

    const text = `
        WITH candidates AS (
            SELECT
                p.id,
                p.display_name,
                p.bio,
                p.is_verified,
                p.verification_status,
                p.average_rating,
                p.review_count,
                p.service_radius_km,
                p.location_lat::float8 AS location_lat,
                p.location_lon::float8 AS location_lon,
                u.profile_picture_url,
                s.id AS service_id,
                s.name AS service_name,
                s.slug AS service_slug,
                (
                    SELECT array_agg(DISTINCT sv.name ORDER BY sv.name)
                    FROM provider_services ps2
                    JOIN services sv ON sv.id = ps2.service_id
                    WHERE ps2.provider_id = p.id AND sv.is_active = TRUE
                ) AS services,
                CASE
                    WHEN $2::float8 IS NULL THEN NULL
                    ELSE 6371.0088 * 2 * asin(sqrt(
                        power(sin(radians(p.location_lat::float8 - $2::float8) / 2), 2)
                        + cos(radians($2::float8)) * cos(radians(p.location_lat::float8))
                        * power(sin(radians(p.location_lon::float8 - $3::float8) / 2), 2)
                    ))
                END AS distance_km
            FROM providers p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN LATERAL (
                SELECT sv.id, sv.name, sv.slug
                FROM provider_services ps
                JOIN services sv ON sv.id = ps.service_id
                WHERE ps.provider_id = p.id
                  AND sv.is_active = TRUE
                  AND ($1::int IS NULL OR sv.id = $1::int)
                ORDER BY sv.name
                LIMIT 1
            ) s ON TRUE
            WHERE p.verification_status = 'approved'
              AND p.is_verified = TRUE
              AND u.status = 'active'
              AND p.location_lat IS NOT NULL
              AND p.location_lon IS NOT NULL
              AND NOT (p.location_lat = 0 AND p.location_lon = 0)
              AND ($1::int IS NULL OR s.id IS NOT NULL)
              AND (
                  $2::float8 IS NULL
                  OR (
                      p.location_lat BETWEEN $2::float8 - ($4::float8 / 111.045)
                                          AND $2::float8 + ($4::float8 / 111.045)
                      AND p.location_lon BETWEEN
                          $3::float8 - ($4::float8 / (111.045 * GREATEST(cos(radians($2::float8)), 0.000001)))
                          AND $3::float8 + ($4::float8 / (111.045 * GREATEST(cos(radians($2::float8)), 0.000001)))
                  )
              )
        )
        SELECT *
        FROM candidates
        WHERE $2::float8 IS NULL
           OR (
               distance_km <= $4::float8
               AND distance_km <= LEAST($4::float8, COALESCE(service_radius_km, $4::float8))
           )
        ORDER BY
            $2::float8 IS NULL,
            CASE WHEN $2::float8 IS NOT NULL THEN distance_km END ASC NULLS LAST,
            average_rating DESC,
            review_count DESC,
            id ASC
        LIMIT $5::int
    `;

    return { text, values, sortBy };
};

/** Normalise a row for the API (numbers instead of pg numeric strings). */
const mapProviderRow = (row) => ({
    ...row,
    location_lat: row.location_lat === null ? null : Number(row.location_lat),
    location_lon: row.location_lon === null ? null : Number(row.location_lon),
    average_rating: Number(row.average_rating || 0),
    review_count: Number(row.review_count || 0),
    service_radius_km: row.service_radius_km === null ? null : Number(row.service_radius_km),
    services: Array.isArray(row.services) ? row.services : [],
    distance_km: roundDistance(row.distance_km === null ? null : Number(row.distance_km)),
});

module.exports = { buildProviderSearchQuery, mapProviderRow };
