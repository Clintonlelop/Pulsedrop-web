// PulseDrop Dashboard Configuration
// Copy this file to config.js and fill in your values, or set environment variables.

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,
  HTTPS_PORT: process.env.HTTPS_PORT || 3443,
  USE_HTTPS: process.env.USE_HTTPS === 'true',

  // SSL cert paths (required for HTTPS)
  SSL_KEY: process.env.SSL_KEY || './certs/privkey.pem',
  SSL_CERT: process.env.SSL_CERT || './certs/fullchain.pem',

  // Session secret - CHANGE THIS
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-to-a-random-string',

  // Dashboard admin credentials
  // Set these via env vars or run: node scripts/set-password.js
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS_HASH: process.env.ADMIN_PASS_HASH || '', // bcrypt hash, set via script

  // Device auth token - the Android app uses this to authenticate
  DEVICE_TOKEN: process.env.DEVICE_TOKEN || 'change-me-device-token',

  // File storage
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  MAX_FILE_SIZE_MB: 200,

  // Transcription / Translation (optional)
  // Set these to enable call recording transcription and translation
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  TRANSCRIBE_MODEL: 'whisper-1',
  TRANSLATE_MODEL: 'gpt-4o-mini',
  DEFAULT_TARGET_LANG: 'en',

  // Data retention (days, 0 = keep forever)
  RETENTION_DAYS: 0
};
