// backend/src/utils/helpers.js

// Haversine formula to calculate distance between two lat/lon points (in kilometers)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of Earth in kilometers
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
};

// Function to generate a random 6-digit OTP
const generateOtp = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Basic email shape validation (the DB column is 255 chars).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value) =>
    typeof value === 'string' && value.length <= 255 && EMAIL_PATTERN.test(value.trim());

/**
 * Build the publicly reachable URL for an uploaded file.
 *
 * Inside Docker the request host is the internal service name (e.g.
 * "backend:3001") which a browser cannot resolve. PUBLIC_BASE_URL overrides it
 * with the host-visible origin; without it we fall back to the request origin,
 * which is correct for plain local development.
 */
const buildFileUrl = (req, filename) => {
    const configuredBase = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    const base = configuredBase || `${req.protocol}://${req.get('host')}`;
    return `${base}/uploads/${filename}`;
};

module.exports = { calculateDistance, generateOtp, isValidEmail, buildFileUrl };
