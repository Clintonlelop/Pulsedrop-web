const bcrypt = require('bcryptjs');
const config = require('./config');

// Middleware: require dashboard login
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

// Middleware: require device token (for APK API calls)
function requireDeviceAuth(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  const deviceId = req.headers['x-device-id'] || req.query.device_id;

  if (!deviceId) {
    return res.status(400).json({ error: 'Device ID required' });
  }

  if (token !== config.DEVICE_TOKEN) {
    return res.status(403).json({ error: 'Invalid device token' });
  }

  req.deviceId = deviceId;
  next();
}

// Login handler
function login(req, res) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  if (username !== config.ADMIN_USER) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // If no password hash is configured, allow first-time setup
  if (!config.ADMIN_PASS_HASH) {
    // First login: set password from what was entered
    const hash = bcrypt.hashSync(password, 10);
    config.ADMIN_PASS_HASH = hash;
    // In production, persist this to a file
    const fs = require('fs');
    fs.writeFileSync('./.admin_hash', hash);
    req.session.authenticated = true;
    req.session.user = username;
    return res.json({ success: true, message: 'Password set. Change config.js to persist.' });
  }

  if (bcrypt.compareSync(password, config.ADMIN_PASS_HASH)) {
    req.session.authenticated = true;
    req.session.user = username;
    return res.json({ success: true });
  }

  return res.status(401).json({ error: 'Invalid credentials' });
}

function logout(req, res) {
  req.session.destroy();
  res.json({ success: true });
}

// Load saved password hash if exists
function loadSavedHash() {
  try {
    const fs = require('fs');
    if (fs.existsSync('./.admin_hash')) {
      config.ADMIN_PASS_HASH = fs.readFileSync('./.admin_hash', 'utf8').trim();
    }
  } catch (e) { /* ignore */ }
}

module.exports = { requireAuth, requireDeviceAuth, login, logout, loadSavedHash };
