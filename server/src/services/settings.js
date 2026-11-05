// backend/src/services/settings.js
//
// Operational platform settings stored in `platform_settings`.
// Only non-secret knobs are allowed here - credentials stay in environment
// variables and are never exposed through the admin API.

const pool = require('../config/db');

const SETTING_DEFINITIONS = {
    default_search_radius_km: { type: 'int', default: 10, min: 1, max: 100 },
    max_search_radius_km: { type: 'int', default: 50, min: 1, max: 200 },
    provider_approval_policy: { type: 'enum', default: 'manual', values: ['manual', 'auto'] },
    booking_allow_new_bookings: { type: 'bool', default: true },
    notifications_email_enabled: { type: 'bool', default: true },
    service_availability_enabled: { type: 'bool', default: true },
};

const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS);

const coerceStoredValue = (definition, raw) => {
    if (raw === undefined || raw === null) return definition.default;
    if (definition.type === 'int') {
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : definition.default;
    }
    if (definition.type === 'bool') {
        return String(raw).toLowerCase() === 'true';
    }
    if (definition.type === 'enum') {
        return definition.values.includes(raw) ? raw : definition.default;
    }
    return raw;
};

/** Validate an incoming setting value, returning a normalised string value. */
const validateSettingValue = (key, value) => {
    const definition = SETTING_DEFINITIONS[key];
    if (!definition) return { error: `Unknown setting: ${key}` };
    if (value === undefined || value === null || value === '') {
        return { error: `A value is required for ${key}.` };
    }

    if (definition.type === 'int') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed)) return { error: `${key} must be a whole number.` };
        if (parsed < definition.min || parsed > definition.max) {
            return { error: `${key} must be between ${definition.min} and ${definition.max}.` };
        }
        return { value: String(parsed) };
    }

    if (definition.type === 'bool') {
        if (typeof value === 'boolean') return { value: String(value) };
        if (value === 'true' || value === 'false') return { value };
        return { error: `${key} must be true or false.` };
    }

    if (definition.type === 'enum') {
        if (!definition.values.includes(value)) {
            return { error: `${key} must be one of: ${definition.values.join(', ')}.` };
        }
        return { value };
    }

    return { value: String(value) };
};

/**
 * Read every known setting, falling back to documented defaults when a row is
 * missing or invalid.
 */
const getSettings = async (db = pool) => {
    const result = await db.query('SELECT key, value FROM platform_settings');
    const stored = new Map(result.rows.map((row) => [row.key, row.value]));

    return SETTING_KEYS.reduce((settings, key) => {
        settings[key] = coerceStoredValue(SETTING_DEFINITIONS[key], stored.get(key));
        return settings;
    }, {});
};

const getPublicSearchSettings = async (db = pool) => {
    const settings = await getSettings(db);
    return {
        default_radius_km: Math.min(settings.default_search_radius_km, settings.max_search_radius_km),
        max_radius_km: settings.max_search_radius_km,
    };
};

/** Persist validated settings inside the caller's transaction/client. */
const updateSettings = async (db, updates, adminId) => {
    const keys = Object.keys(updates);
    for (const key of keys) {
        const validated = validateSettingValue(key, updates[key]);
        if (validated.error) {
            const error = new Error(validated.error);
            error.statusCode = 400;
            throw error;
        }
        await db.query(
            `INSERT INTO platform_settings (key, value, updated_by, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (key) DO UPDATE
               SET value = EXCLUDED.value,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = CURRENT_TIMESTAMP`,
            [key, validated.value, adminId || null]
        );
    }
    return getSettings(db);
};

module.exports = {
    SETTING_DEFINITIONS,
    SETTING_KEYS,
    validateSettingValue,
    getSettings,
    getPublicSearchSettings,
    updateSettings,
};
