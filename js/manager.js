// manager.js — Manager mode: zone placement with drag-and-drop onto camera feed

import { startCamera, resizeCanvasToVideo } from './camera.js';
import { startGPS } from './gps.js';
import { startCompass, requestCompassPermission } from './compass.js';
import { addZone, listenToZones, deleteZone } from './db.js';

// ── State ─────────────────────────────────────────────────────────────────────
let currentGPS = { lat: null, lng: null, accuracy: null };
let currentHeading = null;
let zones = [];
let cameraStream = null;

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

// ── DOM References ─────────────────────────────────────────────────────────────
const video        = document.getElementById('camera-feed');
const canvas       = document.getElementById('ar-canvas');
const ctx          = canvas.getContext('2d');
const gpsStatus    = document.getElementById('gps-status');
const compassStatus = document.getElementById('compass-status');
const statusMsg    = document.getElementById('status-msg');

// ── Canvas Resize ──────────────────────────────────────────────────────────────
function fitCanvas() {
  canvas.width  = video.offsetWidth;
  canvas.height = video.offsetHeight;
}

window.addEventListener('resize', fitCanvas);

// ── GPS Setup ─────────────────────────────────────────────────────────────────
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

// ── Compass Setup ─────────────────────────────────────────────────────────────
startCompass((heading) => {
  currentHeading = heading;
  compassStatus.textContent = `Compass: ${Math.round(heading)}°`;
  compassStatus.classList.add('locked');
});

// ── Camera Setup ─────────────────────────────────────────────────────────────
(async () => {
  try {
    cameraStream = await startCamera(video);
    video.addEventListener('loadedmetadata', fitCanvas);
    fitCanvas();
    showStatus('Camera ready — drag a zone onto the feed', 'success');
  } catch (err) {
    showStatus('Camera error: ' + err.message, 'error');
  }
})();

// ── Drag-and-Drop Logic ───────────────────────────────────────────────────────
let dragZoneType = null;
let dragGhost   = null;

// Desktop drag (mouse)
document.querySelectorAll('.zone-icon').forEach(icon => {
  icon.addEventListener('dragstart', (e) => {
    dragZoneType = icon.dataset.zone;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', dragZoneType);
  });
});

// Canvas drop target
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
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  await placeZone(type, x, y, rect.width, rect.height);
});

// ── Touch Drag (Mobile) ───────────────────────────────────────────────────────
document.querySelectorAll('.zone-icon').forEach(icon => {
  icon.addEventListener('touchstart', (e) => {
    dragZoneType = icon.dataset.zone;
    dragGhost = createDragGhost(icon);
    document.body.appendChild(dragGhost);
  }, { passive: true });
});

document.addEventListener('touchmove', (e) => {
  if (!dragGhost) return;
  const touch = e.touches[0];
  dragGhost.style.left = (touch.clientX - 24) + 'px';
  dragGhost.style.top  = (touch.clientY - 24) + 'px';
}, { passive: true });

document.addEventListener('touchend', async (e) => {
  if (!dragGhost || !dragZoneType) return;

  const touch = e.changedTouches[0];
  const wrapper = document.getElementById('camera-wrapper');
  const rect = wrapper.getBoundingClientRect();

  // Check if touch ended inside the camera wrapper
  if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
      touch.clientY >= rect.top  && touch.clientY <= rect.bottom) {
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    await placeZone(dragZoneType, x, y, rect.width, rect.height);
  }

  dragGhost.remove();
  dragGhost = null;
  dragZoneType = null;
}, { passive: true });

function createDragGhost(icon) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = icon.querySelector('.zone-emoji').textContent;
  ghost.style.position = 'fixed';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '9999';
  ghost.style.fontSize = '36px';
  return ghost;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const HORIZONTAL_FOV = 60; // degrees — typical mobile rear camera
const ZONE_DEPTH_M   = 8;  // assumed hazard distance ahead (meters)

// ── Zone Placement ────────────────────────────────────────────────────────────

/**
 * Project a GPS point forward by `distanceM` meters along `bearingDeg`.
 * Returns { lat, lng } of the hazard's estimated real-world position.
 */
function projectGPS(lat, lng, bearingDeg, distanceM) {
  const R  = 6371000; // Earth radius in metres
  const d  = distanceM / R;
  const b  = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat  * Math.PI) / 180;
  const λ1 = (lng  * Math.PI) / 180;

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(d) +
    Math.cos(φ1) * Math.sin(d) * Math.cos(b)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(b) * Math.sin(d) * Math.cos(φ1),
    Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
  );

  return {
    lat: (φ2 * 180) / Math.PI,
    lng: ((λ2 * 180) / Math.PI + 540) % 360 - 180 // normalise to -180..+180
  };
}

async function placeZone(type, x, y, w, h) {
  if (currentGPS.lat === null) {
    showStatus('⚠️ Waiting for GPS fix... Try again in a moment', 'warning');
    return;
  }
  if (currentHeading === null) {
    showStatus('⚠️ Waiting for compass... Hold phone flat and rotate slowly', 'warning');
    return;
  }

  const screenX = x / w; // 0 (left) → 1 (right)
  const screenY = y / h;

  // Angular offset from screen centre caused by where on screen the zone was dropped.
  // Left half of screen → negative offset (hazard is to the left of heading)
  // Right half          → positive offset
  const angleOffset  = (screenX - 0.5) * HORIZONTAL_FOV;

  // True compass bearing toward the hazard
  const hazardBearing = ((currentHeading + angleOffset) + 360) % 360;

  // Project that bearing forward by ZONE_DEPTH_M to get a real-world GPS for the hazard
  const hazardGPS = projectGPS(
    currentGPS.lat,
    currentGPS.lng,
    hazardBearing,
    ZONE_DEPTH_M
  );

  const zoneData = {
    type,
    lat:       hazardGPS.lat,     // ← real-world hazard location (not manager's feet!)
    lng:       hazardGPS.lng,
    bearing:   hazardBearing,     // compass direction to hazard
    managerLat: currentGPS.lat,   // keep manager origin for debugging
    managerLng: currentGPS.lng,
    screenX,
    screenY,
    placedBy:  'manager-' + getManagerId()
  };

  try {
    await addZone(zoneData);
    showStatus(`✅ ${ZONE_LABELS[type]} zone placed (${Math.round(hazardBearing)}°, ~${ZONE_DEPTH_M}m)`, 'success');
    drawZoneMarker(x, y, type, true);
  } catch (err) {
    showStatus('❌ Failed to save zone: ' + err.message, 'error');
  }
}


function getManagerId() {
  let id = localStorage.getItem('managerId');
  if (!id) {
    id = Math.random().toString(36).slice(2, 8);
    localStorage.setItem('managerId', id);
  }
  return id;
}

// ── Real-time Zone Rendering ──────────────────────────────────────────────────
listenToZones((updatedZones) => {
  zones = updatedZones;
  renderZones();
});

function renderZones() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  zones.forEach(zone => {
    const x = zone.screenX * canvas.width;
    const y = zone.screenY * canvas.height;
    drawZoneMarker(x, y, zone.type, false);
  });
}

function drawZoneMarker(x, y, type, flash = false) {
  const color = ZONE_COLORS[type];
  const label = ZONE_LABELS[type];

  ctx.save();

  // Outer glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;

  // Main circle
  ctx.beginPath();
  ctx.arc(x, y, 28, 0, Math.PI * 2);
  ctx.fillStyle = color + 'CC';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Icon text
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ZONE_ICONS[type], x, y);

  // Label background
  const labelWidth = ctx.measureText(label).width + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(x - labelWidth / 2, y + 34, labelWidth, 22, 4);
  ctx.fill();

  // Label text
  ctx.font = 'bold 11px Inter, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, x, y + 45);

  ctx.restore();
}

// ── Status Message ────────────────────────────────────────────────────────────
let statusTimer = null;
function showStatus(msg, type = 'info') {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg ' + type;
  statusMsg.style.opacity = '1';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMsg.style.opacity = '0';
  }, 3500);
}

// ── Delete Zone on Click ──────────────────────────────────────────────────────
canvas.addEventListener('click', async (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  // Check if click is on any zone marker
  for (const zone of zones) {
    const x = zone.screenX * canvas.width;
    const y = zone.screenY * canvas.height;
    const dist = Math.sqrt((cx - x) ** 2 + (cy - y) ** 2);
    if (dist <= 32) {
      if (confirm(`Delete ${ZONE_LABELS[zone.type]} zone?`)) {
        await deleteZone(zone.id);
        showStatus('Zone deleted', 'success');
      }
      return;
    }
  }
});

// ── iOS Compass Permission Button ─────────────────────────────────────────────
const iosBtn = document.getElementById('ios-compass-btn');
if (iosBtn) {
  iosBtn.addEventListener('click', async () => {
    const granted = await requestCompassPermission();
    if (granted) {
      iosBtn.style.display = 'none';
      showStatus('Compass access granted!', 'success');
    } else {
      showStatus('Compass permission denied', 'error');
    }
  });
}
