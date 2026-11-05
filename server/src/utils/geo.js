// backend/src/utils/geo.js
//
// Single source of truth for geolocation input validation.
//
// Rules enforced here (and mirrored in the React helpers):
//   * latitude  is a finite number in [-90, 90]
//   * longitude is a finite number in [-180, 180]
//   * latitude and longitude must be supplied together
//   * (0, 0) is "Null Island" - it is treated as "location not set" rather
//     than as a real user position, so a default 0 never silently overrides a
//     saved location or excludes every provider.
//
// Distance stays in kilometres everywhere (Earth radius 6371.0088 km).

const EARTH_RADIUS_KM = 6371.0088;

const DEFAULT_SEARCH_RADIUS_KM = 10;
const DEFAULT_MAX_SEARCH_RADIUS_KM = 50;
const MIN_SEARCH_RADIUS_KM = 1;
const MAX_PROVIDER_RADIUS_KM = 100;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const isValidLatitude = (value) => isFiniteNumber(value) && value >= -90 && value <= 90;

const isValidLongitude = (value) => isFiniteNumber(value) && value >= -180 && value <= 180;

/**
 * Convert an optional request value to a number.
 * Returns null when absent/blank, NaN when present but not numeric.
 */
const parseOptionalNumber = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'boolean') return NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
};

/**
 * Validate a lat/lon pair coming from a request (query string or JSON body).
 * @returns {{ latitude: number|null, longitude: number|null, hasLocation: boolean, error?: string, ignoredNullIsland?: boolean }}
 */
const parseCoordinates = ({ lat, lon }) => {
    const latitude = parseOptionalNumber(lat);
    const longitude = parseOptionalNumber(lon);

    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
        return { latitude: null, longitude: null, hasLocation: false, error: 'Latitude and longitude must be numbers.' };
    }

    if ((latitude === null) !== (longitude === null)) {
        return {
            latitude: null,
            longitude: null,
            hasLocation: false,
            error: 'Provide both latitude and longitude, or neither.',
        };
    }

    if (latitude === null) {
        return { latitude: null, longitude: null, hasLocation: false };
    }

    if (!isValidLatitude(latitude)) {
        return { latitude: null, longitude: null, hasLocation: false, error: 'Latitude must be between -90 and 90.' };
    }
    if (!isValidLongitude(longitude)) {
        return { latitude: null, longitude: null, hasLocation: false, error: 'Longitude must be between -180 and 180.' };
    }

    if (latitude === 0 && longitude === 0) {
        return { latitude: null, longitude: null, hasLocation: false, ignoredNullIsland: true };
    }

    return { latitude, longitude, hasLocation: true };
};

/**
 * Validate a stored provider location (already numeric from PostgreSQL).
 * A provider at (0, 0) or with NULL coordinates is not discoverable.
 */
const isUsableStoredLocation = (lat, lon) => {
    const latitude = parseOptionalNumber(lat);
    const longitude = parseOptionalNumber(lon);
    return (
        !Number.isNaN(latitude) &&
        !Number.isNaN(longitude) &&
        latitude !== null &&
        longitude !== null &&
        isValidLatitude(latitude) &&
        isValidLongitude(longitude) &&
        !(latitude === 0 && longitude === 0)
    );
};

const clampRadius = (value, { fallback = DEFAULT_SEARCH_RADIUS_KM, max = DEFAULT_MAX_SEARCH_RADIUS_KM } = {}) => {
    const parsed = parseOptionalNumber(value);
    const safeFallback = Math.min(Math.max(Math.round(fallback), MIN_SEARCH_RADIUS_KM), max);
    if (parsed === null || Number.isNaN(parsed)) return safeFallback;
    return Math.min(Math.max(Math.round(parsed), MIN_SEARCH_RADIUS_KM), max);
};

/** Provider coverage radius: missing/invalid values fall back to the search radius. */
const parseProviderRadius = (value, fallback = DEFAULT_SEARCH_RADIUS_KM) => {
    const parsed = parseOptionalNumber(value);
    if (parsed === null || Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(Math.round(parsed), MIN_SEARCH_RADIUS_KM), MAX_PROVIDER_RADIUS_KM);
};

/** Great-circle distance in kilometres (Haversine). */
const haversineKm = (lat1, lon1, lat2, lon2) => {
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
};

/** Round to 1 decimal for display; never used for comparisons. */
const roundDistance = (km) => (km === null || km === undefined ? null : Math.round(km * 10) / 10);

module.exports = {
    EARTH_RADIUS_KM,
    DEFAULT_SEARCH_RADIUS_KM,
    DEFAULT_MAX_SEARCH_RADIUS_KM,
    MIN_SEARCH_RADIUS_KM,
    MAX_PROVIDER_RADIUS_KM,
    isValidLatitude,
    isValidLongitude,
    isUsableStoredLocation,
    parseCoordinates,
    parseOptionalNumber,
    clampRadius,
    parseProviderRadius,
    haversineKm,
    roundDistance,
};
