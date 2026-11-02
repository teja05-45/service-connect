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

// --- UTILITY FUNCTIONS ---
// Helper to safely read nested user profile data
export const getProfileField = (user, field, defaultValue = '') => user?.profile?.[field] || defaultValue;

export const getPhotoUrl = (user) => {
    // Uses the corrected database column name 'profile_picture_url'
    return user?.profile_picture_url || 'https://placehold.co/100x100/F0F4FF/4338CA?text=User';
};