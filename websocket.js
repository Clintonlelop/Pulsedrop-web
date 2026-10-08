const WebSocket = require('ws');
const crypto = require('crypto');
const config = require('./config');

// Map of device_id -> WebSocket connection
const deviceSockets = new Map();
// Map of command_id -> resolve callback (for dashboard waiting for response)
const pendingCommands = new Map();
// Dashboard socket
let dashboardSocket = null;

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const deviceId = url.searchParams.get('device_id');
    const token = url.searchParams.get('token');
    const role = url.searchParams.get('role') || 'device';

    if (role === 'dashboard') {
      // Dashboard connection - no device token needed, session validated elsewhere
      dashboardSocket = ws;
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'send_command') {
            sendCommandToDevice(msg.device_id, msg.command, msg.payload);
          }
        } catch (e) { /* ignore */ }
      });
      ws.on('close', () => { if (dashboardSocket === ws) dashboardSocket = null; });
      return;
    }

    // Device connection
    if (!deviceId || token !== config.DEVICE_TOKEN) {
      ws.close(403, 'Unauthorized');
      return;
    }

    deviceSockets.set(deviceId, ws);
    console.log(`[WS] Device connected: ${deviceId}`);

    // Update device status in DB
    const { db } = require('./database');
    db.prepare(`INSERT OR REPLACE INTO devices (device_id, last_heartbeat, status) VALUES (?, ?, 'online')`)
      .run(deviceId, Date.now());

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'heartbeat') {
          db.prepare(`UPDATE devices SET last_heartbeat = ?, status = 'online' WHERE device_id = ?`)
            .run(Date.now(), deviceId);
        } else if (msg.commandId) {
          // Command response from device
          const pending = pendingCommands.get(msg.commandId);
          if (pending) {
            pending(msg);
            pendingCommands.delete(msg.commandId);
          }
          // Forward to dashboard if connected
          if (dashboardSocket && dashboardSocket.readyState === WebSocket.OPEN) {
            dashboardSocket.send(JSON.stringify({ type: 'command_response', data: msg }));
          }
          // Log to DB
          db.prepare(`INSERT INTO command_log (device_id, command_id, type, status, response, timestamp) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(deviceId, msg.commandId, msg.type || '', msg.status || '', JSON.stringify(msg.data || ''), Date.now());
        }
      } catch (e) { /* ignore parse errors */ }
    });

    ws.on('close', () => {
      deviceSockets.delete(deviceId);
      db.prepare(`UPDATE devices SET status = 'offline' WHERE device_id = ?`).run(deviceId);
      console.log(`[WS] Device disconnected: ${deviceId}`);
      if (dashboardSocket && dashboardSocket.readyState === WebSocket.OPEN) {
        dashboardSocket.send(JSON.stringify({ type: 'device_status', device_id: deviceId, status: 'offline' }));
      }
    });
  });

  // Periodic offline check
  setInterval(() => {
    const { db } = require('./database');
    const cutoff = Date.now() - 30000; // 30s timeout
    const offline = db.prepare(`SELECT device_id FROM devices WHERE last_heartbeat < ? AND status = 'online'`).all(cutoff);
    offline.forEach(d => {
      db.prepare(`UPDATE devices SET status = 'offline' WHERE device_id = ?`).run(d.device_id);
      if (dashboardSocket && dashboardSocket.readyState === WebSocket.OPEN) {
        dashboardSocket.send(JSON.stringify({ type: 'device_status', device_id: d.device_id, status: 'offline' }));
      }
    });
  }, 10000);
}

function sendCommandToDevice(deviceId, commandType, payload = {}) {
  return new Promise((resolve, reject) => {
    const ws = deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('Device not connected'));
    }

    const commandId = crypto.randomUUID();
    const cmd = {
      command_id: commandId,
      type: commandType,
      payload
    };

    pendingCommands.set(commandId, resolve);
    ws.send(JSON.stringify(cmd));

    // Timeout after 30s
    setTimeout(() => {
      if (pendingCommands.has(commandId)) {
        pendingCommands.delete(commandId);
        reject(new Error('Command timeout'));
      }
    }, 30000);
  });
}

function isDeviceOnline(deviceId) {
  const ws = deviceSockets.get(deviceId);
  return ws && ws.readyState === WebSocket.OPEN;
}

function getConnectedDevices() {
  return Array.from(deviceSockets.keys());
}

module.exports = { setupWebSocket, sendCommandToDevice, isDeviceOnline, getConnectedDevices };
