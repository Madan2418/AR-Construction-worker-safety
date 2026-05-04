// manager.js — Manager mode: mark hazard zones at your current GPS location

import { startCamera } from './camera.js';
import { startGPS } from './gps.js';
import { startCompass, requestCompassPermission } from './compass.js';
import { addZone, listenToZones, deleteZone } from './db.js';

// ── Zone metadata ─────────────────────────────────────────────────────────────
const ZONE_COLORS = {
  danger:     '#FF3B30',
  safe:       '#34C759',
  restricted: '#FF9500',
  assembly:   '#007AFF'
};
const ZONE_LABELS = {
  danger:     'DANGER',
  safe:       'SAFE PATH',
  restricted: 'RESTRICTED',
  assembly:   'ASSEMBLY'
};
const ZONE_ICONS = {
  danger:     '⚠️',
  safe:       '✅',
  restricted: '🚧',
  assembly:   '🏥'
};

// ── State ─────────────────────────────────────────────────────────────────────
let currentGPS     = { lat: null, lng: null, accuracy: null };
let currentHeading = null;
let zones          = [];
let cameraStream   = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const video         = document.getElementById('camera-feed');
const canvas        = document.getElementById('ar-canvas');
const ctx           = canvas.getContext('2d');
const gpsStatus     = document.getElementById('gps-status');
const compassStatus = document.getElementById('compass-status');
const statusMsg     = document.getElementById('status-msg');

// ── Canvas sizing ─────────────────────────────────────────────────────────────
function fitCanvas() {
  canvas.width  = video.offsetWidth  || window.innerWidth;
  canvas.height = video.offsetHeight || window.innerHeight;
}
window.addEventListener('resize', fitCanvas);

// ── GPS ───────────────────────────────────────────────────────────────────────
startGPS(
  (lat, lng, accuracy) => {
    currentGPS = { lat, lng, accuracy };
    gpsStatus.textContent = `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)} (±${Math.round(accuracy)}m)`;
    gpsStatus.classList.add('locked');
  },
  () => {
    gpsStatus.textContent = 'GPS: Error — check permissions';
    gpsStatus.classList.remove('locked');
  }
);

// ── Compass ───────────────────────────────────────────────────────────────────
startCompass((heading) => {
  currentHeading = heading;
  compassStatus.textContent = `Facing: ${Math.round(heading)}°`;
  compassStatus.classList.add('locked');
});

// ── Camera ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    cameraStream = await startCamera(video);
    video.addEventListener('loadedmetadata', fitCanvas);
    fitCanvas();
    showStatus('Stand AT the hazard location, then drag a zone onto the feed', 'success');
  } catch (err) {
    showStatus('Camera error: ' + err.message, 'error');
  }
})();

// ── Drag-and-drop (mouse) ─────────────────────────────────────────────────────
let dragZoneType = null;
let dragGhost    = null;

document.querySelectorAll('.zone-icon').forEach(icon => {
  icon.addEventListener('dragstart', (e) => {
    dragZoneType = icon.dataset.zone;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', dragZoneType);
  });
});

const dropZone = document.getElementById('camera-wrapper');

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('text/plain') || dragZoneType;
  if (!type) return;
  const rect = dropZone.getBoundingClientRect();
  await placeZone(type, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
});

// ── Touch drag (mobile) ───────────────────────────────────────────────────────
document.querySelectorAll('.zone-icon').forEach(icon => {
  icon.addEventListener('touchstart', (e) => {
    dragZoneType = icon.dataset.zone;
    dragGhost = createDragGhost(icon);
    document.body.appendChild(dragGhost);
  }, { passive: true });
});

document.addEventListener('touchmove', (e) => {
  if (!dragGhost) return;
  const t = e.touches[0];
  dragGhost.style.left = (t.clientX - 24) + 'px';
  dragGhost.style.top  = (t.clientY - 24) + 'px';
}, { passive: true });

document.addEventListener('touchend', async (e) => {
  if (!dragGhost || !dragZoneType) return;
  const touch = e.changedTouches[0];
  const wrapper = document.getElementById('camera-wrapper');
  const rect = wrapper.getBoundingClientRect();
  if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
      touch.clientY >= rect.top  && touch.clientY <= rect.bottom) {
    await placeZone(dragZoneType,
      touch.clientX - rect.left, touch.clientY - rect.top,
      rect.width, rect.height);
  }
  dragGhost.remove();
  dragGhost = null;
  dragZoneType = null;
}, { passive: true });

function createDragGhost(icon) {
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.textContent = icon.querySelector('.zone-emoji').textContent;
  g.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;font-size:40px';
  return g;
}

// ── Zone placement ────────────────────────────────────────────────────────────
// Manager STANDS AT the hazard to mark it.
// zone.lat/lng = manager's GPS = the hazard's real-world location.
// Workers approaching from any direction will see this point on their camera.

async function placeZone(type, x, y, w, h) {
  if (currentGPS.lat === null) {
    showStatus('⚠️ No GPS fix yet — wait for the GPS chip to lock', 'warning');
    return;
  }

  const zoneData = {
    type,
    lat:      currentGPS.lat,      // hazard is HERE — where manager is standing
    lng:      currentGPS.lng,
    bearing:  currentHeading ?? 0, // direction manager was facing (for reference)
    accuracy: currentGPS.accuracy, // GPS accuracy at time of placement
    screenX:  x / w,               // screen position reference (used in manager view only)
    screenY:  y / h,
    placedBy: 'manager-' + getManagerId()
  };

  try {
    await addZone(zoneData);
    showStatus(`✅ ${ZONE_LABELS[type]} zone marked at your location`, 'success');
    drawZoneMarker(x, y, type);
  } catch (err) {
    showStatus('❌ Save failed: ' + err.message + ' — check Firebase rules', 'error');
  }
}

function getManagerId() {
  let id = localStorage.getItem('managerId');
  if (!id) { id = Math.random().toString(36).slice(2, 8); localStorage.setItem('managerId', id); }
  return id;
}

// ── Real-time zone display in manager view ────────────────────────────────────
// Manager sees placed zones at the screen position they dropped them.
listenToZones((updated) => {
  zones = updated;
  renderManagerZones();
});

function renderManagerZones() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  zones.forEach(zone => {
    const x = zone.screenX * canvas.width;
    const y = zone.screenY * canvas.height;
    drawZoneMarker(x, y, zone.type);
  });
}

function drawZoneMarker(x, y, type) {
  const color = ZONE_COLORS[type];
  const label = ZONE_LABELS[type];
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur  = 18;
  ctx.beginPath();
  ctx.arc(x, y, 28, 0, Math.PI * 2);
  ctx.fillStyle   = color + 'BB';
  ctx.fill();
  ctx.lineWidth   = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.shadowBlur  = 0;
  ctx.font        = '20px sans-serif';
  ctx.textAlign   = 'center';
  ctx.textBaseline= 'middle';
  ctx.fillText(ZONE_ICONS[type], x, y);
  const lw = ctx.measureText(label).width + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(x - lw/2, y + 34, lw, 22, 4);
  ctx.fill();
  ctx.font      = 'bold 11px Inter, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x, y + 45);
  ctx.restore();
}

// ── Delete zone on click ──────────────────────────────────────────────────────
canvas.addEventListener('click', async (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  for (const zone of zones) {
    const x = zone.screenX * canvas.width;
    const y = zone.screenY * canvas.height;
    if (Math.hypot(cx - x, cy - y) <= 32) {
      if (confirm(`Delete ${ZONE_LABELS[zone.type]} zone?`)) {
        await deleteZone(zone.id);
        showStatus('Zone deleted', 'success');
      }
      return;
    }
  }
});

// ── Status toast ──────────────────────────────────────────────────────────────
let statusTimer = null;
function showStatus(msg, type = 'info') {
  statusMsg.textContent = msg;
  statusMsg.className   = 'status-msg ' + type;
  statusMsg.style.opacity = '1';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusMsg.style.opacity = '0'; }, 4000);
}

// ── iOS compass permission ────────────────────────────────────────────────────
const iosBtn = document.getElementById('ios-compass-btn');
if (iosBtn) {
  iosBtn.addEventListener('click', async () => {
    const ok = await requestCompassPermission();
    if (ok) { iosBtn.style.display = 'none'; showStatus('Compass enabled!', 'success'); }
    else     { showStatus('Compass permission denied', 'error'); }
  });
}
