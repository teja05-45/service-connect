// frontend/src/pages/utils/helpers.js

// --- API Configuration ---
// Configurable at build time - Create React App inlines REACT_APP_* variables.
// Falls back to the local backend so `npm start` works without a .env file.
const configuredApiBaseUrl =
    process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001/api/v1';
export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, '');

export const CURRENCY_SYMBOL = '₹'; // Indian Rupees
// Mock UPI QR Code URL for deposit - Admin's Account
// NOTE: Ensure this local image file exists in your project directory
export const MOCK_UPI_QR_CODE_URL = '/IMG_20251017_234756.jpg'; 
// --- Global Styling Classes (Dark Cyan Theme) ---
export const DARK_CYAN_CLASS = 'bg-[#008080]'; // Main background/button color
export const DARK_CYAN_TEXT_CLASS = 'text-[#008080]'; // Main text/accent color
export const DARK_CYAN_HOVER_CLASS = 'hover:bg-[#006666]'; // Darker hover state

// The public radius choices offered in the search UI (km).
export const SEARCH_RADIUS_OPTIONS = [5, 10, 20, 30];

// --- UTILITY FUNCTIONS ---
// Helper to safely read nested user profile data
export const getProfileField = (user, field, defaultValue = '') =>
    user?.profile?.[field] ?? defaultValue;

export const isValidLatitude = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;

export const isValidLongitude = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

/**
 * Read the saved location from a profile. Returns null when it is missing or
 * the database default (0, 0), so a placeholder location is never used as if
 * it were the customer's real position.
 */
export const getSavedLocation = (user) => {
    const lat = Number(getProfileField(user, 'location_lat', null));
    const lon = Number(getProfileField(user, 'location_lon', null));

    if (!isValidLatitude(lat) || !isValidLongitude(lon)) return null;
    if (lat === 0 && lon === 0) return null;
    return { lat, lon };
};

export const formatCoordinates = (location) =>
    location ? `${Number(location.lat).toFixed(5)}, ${Number(location.lon).toFixed(5)}` : '';

export const formatDistance = (distanceKm) => {
    if (distanceKm === null || distanceKm === undefined) return null;
    const value = Number(distanceKm);
    if (!Number.isFinite(value)) return null;
    return value < 1 ? `${Math.round(value * 1000)} m` : `${value.toFixed(1)} km`;
};

/** Browser geolocation wrapped in a promise (the permission prompt is native). */
export const requestBrowserLocation = () =>
    new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('This browser does not support location sharing. Enter your coordinates manually.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) =>
                resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude,
                    accuracy_m: position.coords.accuracy,
                }),
            (error) => {
                const message =
                    error.code === 1
                        ? 'Location permission was denied. Enter your location manually instead.'
                        : 'Could not read your browser location. Enter it manually instead.';
                reject(new Error(message));
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
        );
    });

export const getPhotoUrl = (user) => {
    // Uses the corrected database column name 'profile_picture_url'
    return user?.profile_picture_url || 'https://placehold.co/100x100/F0F4FF/4338CA?text=User';
};