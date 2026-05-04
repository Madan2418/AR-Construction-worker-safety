// worker.js — Worker mode: AR zone overlay using GPS + compass

import { startCamera, resizeCanvasToVideo } from './camera.js';
import { startGPS } from './gps.js';
import { startCompass, requestCompassPermission } from './compass.js';
import { listenToZones } from './db.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const HORIZONTAL_FOV = 60; // degrees — typical mobile camera

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
let myLat = null;
let myLng = null;
let myHeading = null;
let zones = [];
let cameraStream = null;
let animFrameId = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const video         = document.getElementById('camera-feed');
const canvas        = document.getElementById('ar-canvas');
const ctx           = canvas.getContext('2d');
const gpsStatus     = document.getElementById('gps-status');
const compassStatus = document.getElementById('compass-status');
const zoneCount     = document.getElementById('zone-count');

// ── Canvas Resize ─────────────────────────────────────────────────────────────
function fitCanvas() {
  canvas.width  = video.offsetWidth  || window.innerWidth;
  canvas.height = video.offsetHeight || window.innerHeight;
}

window.addEventListener('resize', () => { fitCanvas(); });

// ── GPS ───────────────────────────────────────────────────────────────────────
startGPS(
  (lat, lng, accuracy) => {
    myLat = lat;
    myLng = lng;
    gpsStatus.textContent = `GPS: ${lat.toFixed(5)}, ${lng.toFixed(5)} (±${Math.round(accuracy)}m)`;
    gpsStatus.classList.add('locked');
  },
  () => {
    gpsStatus.textContent = 'GPS: Error';
    gpsStatus.classList.remove('locked');
  }
);

// ── Compass ───────────────────────────────────────────────────────────────────
startCompass((heading) => {
  myHeading = heading;
  compassStatus.textContent = `Heading: ${Math.round(heading)}°`;
  compassStatus.classList.add('locked');
});

// ── Camera ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    cameraStream = await startCamera(video);
    video.addEventListener('loadedmetadata', fitCanvas);
    fitCanvas();
    startRenderLoop();
  } catch (err) {
    document.getElementById('status-msg').textContent = 'Camera error: ' + err.message;
  }
})();

// ── Firebase Real-time Zones ──────────────────────────────────────────────────
listenToZones((updatedZones) => {
  zones = updatedZones;
  zoneCount.textContent = `${zones.length} zone${zones.length !== 1 ? 's' : ''} active`;
});

// ── Bearing Calculation ───────────────────────────────────────────────────────
function calculateBearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Compute shortest angular difference between two headings (-180 to +180).
 */
function angleDiff(a, b) {
  let diff = ((a - b) + 540) % 360 - 180;
  return diff;
}

/**
 * Haversine distance in meters between two GPS points.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── AR Render Loop ────────────────────────────────────────────────────────────
function startRenderLoop() {
  function frame() {
    renderAR();
    animFrameId = requestAnimationFrame(frame);
  }
  animFrameId = requestAnimationFrame(frame);
}

function renderAR() {
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (myLat === null || myLng === null) {
    drawWaitingMessage(W, H, 'Waiting for GPS fix...');
    return;
  }

  if (myHeading === null) {
    drawWaitingMessage(W, H, 'Waiting for compass...');
    return;
  }

  zones.forEach(zone => drawZoneOverlay(zone, W, H));
  drawHUD(W, H);
}

function drawZoneOverlay(zone, W, H) {
  const distance = haversineDistance(myLat, myLng, zone.lat, zone.lng);

  // ── Determine bearing to zone ──────────────────────────────────────────────
  // If worker is very close to the projected zone GPS (< 2m, GPS noise floor),
  // fall back to the stored bearing the manager recorded — still world-fixed.
  let bearing;
  if (distance < 2) {
    bearing = zone.bearing; // use manager's recorded compass direction
  } else {
    bearing = calculateBearing(myLat, myLng, zone.lat, zone.lng);
  }

  // ── Angular difference: where on screen should this zone appear? ───────────
  // negative → left of centre, positive → right
  const diff = angleDiff(bearing, myHeading);

  // Clip to ±(FOV/2 + 15°) margin — hide zones clearly behind the user
  const halfFOV = HORIZONTAL_FOV / 2;
  if (Math.abs(diff) > halfFOV + 15) return;

  // Map angle to pixel X
  const screenX = (W / 2) + (diff / halfFOV) * (W / 2);

  // ── Vertical position: closer = lower on screen ────────────────────────────
  const maxDist = 50; // metres
  const minY    = H * 0.15;
  const maxY    = H * 0.75;
  const t       = Math.min(distance / maxDist, 1);
  const screenY = maxY - t * (maxY - minY);

  // ── Size: closer = bigger ─────────────────────────────────────────────────
  const scale  = Math.max(0.5, 1 - t * 0.5);
  const radius = 36 * scale;

  const color = ZONE_COLORS[zone.type];
  const label = ZONE_LABELS[zone.type];
  const icon  = ZONE_ICONS[zone.type];

  ctx.save();

  // Pulse for danger zones
  if (zone.type === 'danger') {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10 + pulse * 20;
  }

  // Outer ring
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius + 6, 0, Math.PI * 2);
  ctx.fillStyle = color + '33';
  ctx.fill();

  // Main circle
  ctx.beginPath();
  ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
  ctx.fillStyle = color + 'CC';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Zone icon
  ctx.font = `${Math.round(radius * 0.85)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, screenX, screenY);

  // Stem
  ctx.beginPath();
  ctx.moveTo(screenX, screenY + radius);
  ctx.lineTo(screenX, screenY + radius + 12);
  ctx.strokeStyle = '#FFFFFF99';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Label chip
  ctx.font = `bold ${Math.round(10 * scale)}px Inter, sans-serif`;
  const labelW = ctx.measureText(label).width + 12;
  const chipY  = screenY + radius + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.beginPath();
  ctx.roundRect(screenX - labelW / 2, chipY, labelW, 18, 4);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, screenX, chipY + 9);

  // Distance chip
  const distText = distance < 1000
    ? `${Math.round(distance)}m`
    : `${(distance / 1000).toFixed(1)}km`;
  ctx.font = `${Math.round(9 * scale)}px Inter, sans-serif`;
  const distW = ctx.measureText(distText).width + 10;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(screenX - distW / 2, chipY + 22, distW, 16, 3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(distText, screenX, chipY + 30);

  ctx.restore();
}


function drawHUD(W, H) {
  // Compass arc at the top
  const arcCx = W / 2;
  const arcCy = 0;
  const arcR  = W * 0.55;

  if (myHeading !== null) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(arcCx, arcCy, arcR, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();

    // North indicator
    const northAngle = (-myHeading) * Math.PI / 180 + Math.PI / 2;
    const nx = arcCx + arcR * Math.cos(northAngle);
    const ny = arcCy + arcR * Math.sin(northAngle);
    if (ny > 0 && ny < H / 3) {
      ctx.beginPath();
      ctx.arc(nx, ny, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#FF3B30';
      ctx.fill();
      ctx.font = 'bold 8px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', nx, ny);
    }
    ctx.restore();
  }
}

function drawWaitingMessage(W, H, msg) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(W / 2 - 120, H / 2 - 20, 240, 40);
  ctx.beginPath();
  ctx.roundRect(W / 2 - 120, H / 2 - 20, 240, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#FFF';
  ctx.font = 'bold 14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, H / 2);
  ctx.restore();
}

// ── iOS Compass Permission ────────────────────────────────────────────────────
const iosBtn = document.getElementById('ios-compass-btn');
if (iosBtn) {
  iosBtn.addEventListener('click', async () => {
    const granted = await requestCompassPermission();
    if (granted) {
      iosBtn.style.display = 'none';
    }
  });
}
