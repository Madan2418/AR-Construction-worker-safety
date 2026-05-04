// worker.js — Worker AR view: show safety zones fixed in the real world

import { startCamera } from './camera.js';
import { startGPS } from './gps.js';
import { startCompass, requestCompassPermission } from './compass.js';
import { listenToZones } from './db.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const HORIZONTAL_FOV = 60;    // degrees — mobile rear camera typical FOV
const NEAR_ZONE_M    = 6;     // metres — within this, GPS bearing is too noisy; show proximity alert
const MAX_DIST_M     = 100;   // metres — beyond this, pin zone at top of screen

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
let myLat     = null;
let myLng     = null;
let myHeading = null;
let zones     = [];

// ── DOM ───────────────────────────────────────────────────────────────────────
const video         = document.getElementById('camera-feed');
const canvas        = document.getElementById('ar-canvas');
const ctx           = canvas.getContext('2d');
const gpsStatus     = document.getElementById('gps-status');
const compassStatus = document.getElementById('compass-status');
const zoneCount     = document.getElementById('zone-count');

// ── Canvas resize ─────────────────────────────────────────────────────────────
function fitCanvas() {
  canvas.width  = video.offsetWidth  || window.innerWidth;
  canvas.height = video.offsetHeight || window.innerHeight;
}
window.addEventListener('resize', fitCanvas);

// ── GPS ───────────────────────────────────────────────────────────────────────
startGPS(
  (lat, lng, accuracy) => {
    myLat = lat; myLng = lng;
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
  compassStatus.textContent = `Facing: ${Math.round(heading)}°`;
  compassStatus.classList.add('locked');
});

// ── Camera ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await startCamera(video);
    video.addEventListener('loadedmetadata', fitCanvas);
    fitCanvas();
    requestAnimationFrame(renderLoop);
  } catch (err) {
    document.getElementById('status-msg').textContent = 'Camera: ' + err.message;
    document.getElementById('status-msg').style.opacity = '1';
  }
})();

// ── Firebase zones ────────────────────────────────────────────────────────────
listenToZones((updated) => {
  zones = updated;
  zoneCount.textContent = `${zones.length} zone${zones.length !== 1 ? 's' : ''} active`;
});

// ── Math helpers ──────────────────────────────────────────────────────────────

/** Haversine distance in metres between two GPS points */
function distanceTo(lat1, lng1, lat2, lng2) {
  const R   = 6371000;
  const dLt = (lat2 - lat1) * Math.PI / 180;
  const dLn = (lng2 - lng1) * Math.PI / 180;
  const a   = Math.sin(dLt/2)**2 +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLn/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compass bearing (0–360) from point 1 → point 2 */
function bearingTo(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const φ1   = lat1 * Math.PI / 180;
  const φ2   = lat2 * Math.PI / 180;
  const y    = Math.sin(dLng) * Math.cos(φ2);
  const x    = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Shortest signed angle difference (-180 to +180) */
function angleDiff(target, ref) {
  return ((target - ref) + 540) % 360 - 180;
}

// ── Render loop ───────────────────────────────────────────────────────────────
function renderLoop() {
  render();
  requestAnimationFrame(renderLoop);
}

function render() {
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Show status messages until sensors are ready
  if (myLat === null || myLng === null) {
    drawMessage(W, H, '📡 Waiting for GPS fix…', '#FF9500');
    return;
  }
  if (myHeading === null) {
    drawMessage(W, H, '🧭 Waiting for compass…\nHold phone flat and rotate slowly', '#007AFF');
    return;
  }

  // Separate zones into: nearby (proximity alert) and directional (far enough for GPS bearing)
  const nearbyZones     = [];
  const directionalZones = [];

  for (const zone of zones) {
    const d = distanceTo(myLat, myLng, zone.lat, zone.lng);
    zone._dist = d; // cache
    if (d <= NEAR_ZONE_M) {
      nearbyZones.push(zone);
    } else {
      directionalZones.push(zone);
    }
  }

  // Draw far zones as directional AR markers
  directionalZones.forEach(zone => drawDirectionalZone(zone, W, H));

  // Draw nearby zones as proximity alerts (full-screen warning)
  if (nearbyZones.length > 0) {
    drawProximityAlert(nearbyZones, W, H);
  }

  drawCompassHUD(W, H);
}

// ── Directional AR zone (worker is far enough for GPS bearing to be accurate) ─
function drawDirectionalZone(zone, W, H) {
  const distance = zone._dist;
  const bearing  = bearingTo(myLat, myLng, zone.lat, zone.lng);
  const diff     = angleDiff(bearing, myHeading);

  // Only draw if zone is in the camera's field of view (+15° margin)
  const halfFOV = HORIZONTAL_FOV / 2;
  if (Math.abs(diff) > halfFOV + 15) return;

  // Screen X: centre = straight ahead, edges = ±FOV/2
  const sx = (W / 2) + (diff / halfFOV) * (W / 2);

  // Screen Y: closer = lower (more imminent), further = higher up
  const t  = Math.min(distance / MAX_DIST_M, 1);
  const sy = H * 0.75 - t * (H * 0.60);

  // Icon scale: bigger when closer
  const scale  = Math.max(0.5, 1.2 - t * 0.7);
  const radius = 32 * scale;

  const color = ZONE_COLORS[zone.type];
  const label = ZONE_LABELS[zone.type];
  const icon  = ZONE_ICONS[zone.type];

  ctx.save();

  // Danger pulse
  if (zone.type === 'danger') {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 280);
    ctx.shadowColor = color;
    ctx.shadowBlur  = 12 + pulse * 24;
  }

  // Outer halo
  ctx.beginPath();
  ctx.arc(sx, sy, radius + 8, 0, Math.PI * 2);
  ctx.fillStyle = color + '28';
  ctx.fill();

  // Main circle
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fillStyle   = color + 'CC';
  ctx.fill();
  ctx.lineWidth   = 2.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Icon
  ctx.font         = `${Math.round(radius * 0.9)}px sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, sx, sy);

  // Stem drop-line
  ctx.beginPath();
  ctx.moveTo(sx, sy + radius);
  ctx.lineTo(sx, sy + radius + 14);
  ctx.strokeStyle = '#ffffff88';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // Label pill
  ctx.font = `bold ${Math.round(11 * scale)}px Inter, sans-serif`;
  const lw    = ctx.measureText(label).width + 14;
  const chipY = sy + radius + 18;
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.beginPath();
  ctx.roundRect(sx - lw/2, chipY, lw, 20, 5);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(label, sx, chipY + 10);

  // Distance pill
  const distTxt = distance < 1000
    ? `${Math.round(distance)}m away`
    : `${(distance / 1000).toFixed(1)}km`;
  ctx.font = `${Math.round(10 * scale)}px Inter, sans-serif`;
  const dw     = ctx.measureText(distTxt).width + 10;
  const distY  = chipY + 24;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(sx - dw/2, distY, dw, 18, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(distTxt, sx, distY + 9);

  ctx.restore();
}

// ── Proximity alert: zone is RIGHT HERE (≤ NEAR_ZONE_M metres) ───────────────
// GPS bearing is unreliable at this range. Instead, flash a clear warning.
function drawProximityAlert(nearbyZones, W, H) {
  const now   = Date.now();
  const pulse = 0.5 + 0.5 * Math.sin(now / 220);

  // Find the most severe zone (danger > restricted > assembly > safe)
  const severity = { danger: 4, restricted: 3, assembly: 2, safe: 1 };
  const worst    = nearbyZones.sort((a, b) => (severity[b.type] || 0) - (severity[a.type] || 0))[0];
  const color    = ZONE_COLORS[worst.type];
  const icon     = ZONE_ICONS[worst.type];
  const label    = ZONE_LABELS[worst.type];
  const dist     = Math.round(worst._dist);

  // Pulsing screen-edge border
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 10 + pulse * 8;
  ctx.globalAlpha = 0.55 + pulse * 0.35;
  ctx.strokeRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // Dark background for the alert card
  const cardW = Math.min(W * 0.85, 340);
  const cardH = 110;
  const cardX = (W - cardW) / 2;
  const cardY = H * 0.35;

  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 14);
  ctx.fill();

  // Coloured left accent bar
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, 6, cardH, [14, 0, 0, 14]);
  ctx.fill();

  // Icon
  ctx.font         = '38px sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(icon, cardX + 20, cardY + cardH / 2 - 10);

  // Title
  ctx.font      = 'bold 20px Inter, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(label + ' ZONE', cardX + 68, cardY + 32);

  // Subtitle
  ctx.font      = '14px Inter, sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(
    dist < 1 ? 'You are at this zone!' : `${dist}m — You are inside this zone`,
    cardX + 68, cardY + 56
  );

  // Extra zones count
  if (nearbyZones.length > 1) {
    ctx.font      = '12px Inter, sans-serif';
    ctx.fillStyle = '#AAAAAA';
    ctx.fillText(`+${nearbyZones.length - 1} more zone${nearbyZones.length > 2 ? 's' : ''} nearby`, cardX + 68, cardY + 78);
  }

  // Pulsing "STOP" or safety instruction for danger
  if (worst.type === 'danger') {
    ctx.font      = `bold ${Math.round(14 + pulse * 3)}px Inter, sans-serif`;
    ctx.fillStyle = `rgba(255,59,48,${0.8 + pulse * 0.2})`;
    ctx.textAlign = 'center';
    ctx.fillText('⛔ STOP — DO NOT PROCEED', W / 2, cardY + cardH + 28);
  }

  ctx.restore();
}

// ── Compass HUD arc at the top ────────────────────────────────────────────────
function drawCompassHUD(W, H) {
  if (myHeading === null) return;
  ctx.save();

  const cx = W / 2, cy = 0, r = W * 0.55;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.stroke();

  // North dot
  const na = (-myHeading) * Math.PI / 180 + Math.PI / 2;
  const nx = cx + r * Math.cos(na);
  const ny = cy + r * Math.sin(na);
  if (ny > 0 && ny < H / 3) {
    ctx.beginPath();
    ctx.arc(nx, ny, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#FF3B30';
    ctx.fill();
    ctx.font         = 'bold 8px sans-serif';
    ctx.fillStyle    = '#fff';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
  }
  ctx.restore();
}

// ── Generic message overlay ───────────────────────────────────────────────────
function drawMessage(W, H, msg, color = '#fff') {
  const lines = msg.split('\n');
  const padX  = 24, padY = 14;
  const lineH = 22;
  const boxW  = 280;
  const boxH  = padY * 2 + lineH * lines.length;
  const bx    = (W - boxW) / 2;
  const by    = H / 2 - boxH / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 10);
  ctx.fill();

  ctx.fillStyle    = color;
  ctx.font         = 'bold 14px Inter, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, W / 2, by + padY + i * lineH));
  ctx.restore();
}

// ── iOS compass permission ────────────────────────────────────────────────────
const iosBtn = document.getElementById('ios-compass-btn');
if (iosBtn) {
  iosBtn.addEventListener('click', async () => {
    const ok = await requestCompassPermission();
    if (ok) iosBtn.style.display = 'none';
  });
}
