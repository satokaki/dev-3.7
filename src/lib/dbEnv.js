// Frontend mirror of the backend environment guard (base44/shared/dbManagement.js).
// Source of truth for the shared module; keep in sync.
export const APP_ENVIRONMENT = 'development'; // 'development' | 'staging' | 'production'
export const IS_PRODUCTION = APP_ENVIRONMENT === 'production';
export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = '2026.08';
export const RESET_CONFIRM_PHRASE = 'RESET DATABASE LAB PRO';
export const RESTORE_CONFIRM_PHRASE = 'RESTORE DATABASE LAB PRO';
export const APPLICATION_NAME = 'LAB PRO';
export const MAX_RESTORE_FILE_SIZE = 100 * 1024 * 1024; // 100 MB