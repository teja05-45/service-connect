// frontend/src/pages/utils/helpers.test.js
import { API_BASE_URL, getProfileField, getPhotoUrl, CURRENCY_SYMBOL } from './helpers';

describe('frontend helpers', () => {
    it('exposes an API base URL without a trailing slash', () => {
        expect(typeof API_BASE_URL).toBe('string');
        expect(API_BASE_URL.length).toBeGreaterThan(0);
        expect(API_BASE_URL.endsWith('/')).toBe(false);
        expect(API_BASE_URL).toMatch(/\/api\/v1$/);
    });

    it('reads nested profile fields with a fallback', () => {
        const user = { profile: { city: 'Bengaluru' } };
        expect(getProfileField(user, 'city')).toBe('Bengaluru');
        expect(getProfileField(user, 'phone_number')).toBe('');
        expect(getProfileField(user, 'phone_number', 'n/a')).toBe('n/a');
        expect(getProfileField(null, 'city')).toBe('');
    });

    it('falls back to a placeholder photo', () => {
        expect(getPhotoUrl({})).toContain('placehold.co');
        expect(getPhotoUrl({ profile_picture_url: 'http://localhost:3001/uploads/a.jpg' })).toBe(
            'http://localhost:3001/uploads/a.jpg'
        );
    });

    it('uses the rupee symbol', () => {
        expect(CURRENCY_SYMBOL).toBe('₹');
    });
});
