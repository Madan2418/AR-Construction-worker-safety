// worker.js — Next-level AR Construction Safety Worker

import { startCamera } from './camera.js';
import { startGPS } from './gps.js';
import { startCompass, requestCompassPermission } from './compass.js';
import { listenToZones } from './db.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const H_FOV    = 60;   // camera horizontal field of view (degrees)
const BAR_FOV  = 160;  // compass bar field of view (degrees)
const NEAR_GPS = 6;    // metres — GPS too noisy below this, use bearing fallback

const COLORS = { danger:'#FF3B30', safe:'#34C759', restricted:'#FF9500', assembly:'#007AFF' };
const LABELS = { danger:'DANGER',  safe:'SAFE PATH', restricted:'RESTRICTED', assembly:'ASSEMBLY' };
const ICONS  = { danger:'⚠️',     safe:'✅',        restricted:'🚧',         assembly:'🏥' };
const DEF_R  = { danger:5,         safe:15,          restricted:10,           assembly:20 };

// ── Audio ─────────────────────────────────────────────────────────────────────
let _audioCtx = null;
function beep(freqs, durs) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let t = _audioCtx.currentTime;
    freqs.forEach((f, i) => {
      const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
      o.connect(g); g.connect(_audioCtx.destination);
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + durs[i]);
      o.start(t); o.stop(t + durs[i]); t += durs[i] + 0.04;
    });
  } catch(e) {}
}
const ALERT = {
  danger:     () => beep([880,660,880], [0.1,0.08,0.15]),
  restricted: () => beep([660,440],    [0.12,0.12]),
  warning:    () => beep([440],        [0.15]),
};

// ── State ─────────────────────────────────────────────────────────────────────
let myLat = null, myLng = null, myHeading = null;
let zones = [], viewMode = 'ar';
let lastAlerted = {}; // zoneId → timestamp

// ── DOM ───────────────────────────────────────────────────────────────────────
const video     = document.getElementById('camera-feed');
const canvas    = document.getElementById('ar-canvas');
const ctx       = canvas.getContext('2d');
const gpsStat   = document.getElementById('gps-status');
const cmpsStat  = document.getElementById('compass-status');
const countEl   = document.getElementById('zone-count');
const nearEl    = document.getElementById('nearest-zone');
const modeBtn   = document.getElementById('mode-toggle-btn');

function fitCanvas() {
  canvas.width  = video.offsetWidth  || window.innerWidth;
  canvas.height = video.offsetHeight || window.innerHeight;
}
window.addEventListener('resize', fitCanvas);

// ── Sensors ───────────────────────────────────────────────────────────────────
startGPS((lat, lng, acc) => {
  myLat = lat; myLng = lng;
  gpsStat.textContent = `GPS ±${Math.round(acc)}m`;
  gpsStat.classList.add('locked');
}, () => { gpsStat.textContent = 'GPS Error'; gpsStat.classList.remove('locked'); });

startCompass(h => {
  myHeading = h;
  cmpsStat.textContent = `${Math.round(h)}°`;
  cmpsStat.classList.add('locked');
});

// ── Camera ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await startCamera(video);
    video.addEventListener('loadedmetadata', fitCanvas);
    fitCanvas();
    requestAnimationFrame(loop);
  } catch(e) { showMsg(canvas.width||320, canvas.height||600, 'Camera: ' + e.message); }
})();

// ── Firebase ──────────────────────────────────────────────────────────────────
listenToZones(updated => {
  zones = updated.map(z => ({ ...z, radius: z.radius ?? DEF_R[z.type] ?? 5 }));
  refreshBottomBar();
});

// ── Mode toggle ───────────────────────────────────────────────────────────────
if (modeBtn) {
  modeBtn.addEventListener('click', () => {
    viewMode = viewMode === 'ar' ? 'map' : 'ar';
    modeBtn.textContent = viewMode === 'ar' ? '🗺️ Map' : '📷 AR';
    video.style.display = viewMode === 'ar' ? '' : 'none';
  });
}

// ── Math helpers ──────────────────────────────────────────────────────────────
function dist(la1,ln1,la2,ln2) {
  const R=6371000, dLt=(la2-la1)*Math.PI/180, dLn=(ln2-ln1)*Math.PI/180;
  const a=Math.sin(dLt/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLn/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function bearing(la1,ln1,la2,ln2) {
  const dL=(ln2-ln1)*Math.PI/180, p1=la1*Math.PI/180, p2=la2*Math.PI/180;
  return(Math.atan2(Math.sin(dL)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dL))*180/Math.PI+360)%360;
}
function adiff(a,b) { return ((a-b)+540)%360-180; }
function distLabel(m) { return m<1000 ? `${Math.round(m)}m` : `${(m/1000).toFixed(1)}km`; }

// ── Proximity alerts (run every second) ───────────────────────────────────────
setInterval(() => {
  if (!myLat || !myLng) return;
  zones.forEach(z => {
    const d = dist(myLat,myLng,z.lat,z.lng);
    const now = Date.now(), last = lastAlerted[z.id]||0;
    if (d <= z.radius && now-last > 4000) {
      (ALERT[z.type] || ALERT.warning)();
      if (navigator.vibrate) navigator.vibrate(z.type==='danger'?[250,100,250,100,250]:[200]);
      lastAlerted[z.id] = now;
    } else if (d <= z.radius*2.5 && d > z.radius && now-last > 8000) {
      ALERT.warning();
      if (navigator.vibrate) navigator.vibrate([100]);
      lastAlerted[z.id] = now;
    }
  });
}, 1000);

// ── Bottom bar ────────────────────────────────────────────────────────────────
function refreshBottomBar() {
  countEl.textContent = `${zones.length} zone${zones.length!==1?'s':''} active`;
  if (!myLat || !zones.length) { nearEl.textContent=''; return; }
  const nearest = zones.map(z=>({...z,d:dist(myLat,myLng,z.lat,z.lng)})).sort((a,b)=>a.d-b.d)[0];
  nearEl.textContent = `${ICONS[nearest.type]} Nearest ${LABELS[nearest.type]}: ${distLabel(nearest.d)}`;
  nearEl.style.color = COLORS[nearest.type];
}
setInterval(refreshBottomBar, 1500);

// ── Render loop ───────────────────────────────────────────────────────────────
function loop() { render(); requestAnimationFrame(loop); }

function render() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  if (!myLat || !myLng) { showMsg(W,H,'📡 Acquiring GPS…','#FF9500'); return; }
  if (myHeading === null){ showMsg(W,H,'🧭 Rotate phone slowly\nto calibrate compass','#007AFF'); return; }

  // enrich zones with runtime data
  const zd = zones.map(z => ({
    ...z,
    d:   dist(myLat,myLng,z.lat,z.lng),
    brg: z.d < NEAR_GPS ? (z.bearing??0) : bearing(myLat,myLng,z.lat,z.lng)
  })).sort((a,b)=>b.d-a.d);

  if (viewMode==='map') drawMapMode(zd,W,H);
  else                  drawARMode(zd,W,H);

  drawCompassBar(zd,W,H);
  drawProximityOverlay(zd,W,H);
}

// ── AR Mode ───────────────────────────────────────────────────────────────────
function drawARMode(zd, W, H) {
  const half = H_FOV/2;
  // In-FOV zones
  zd.forEach(z => {
    const diff = adiff(z.brg, myHeading);
    if (Math.abs(diff) <= half+15) drawARMarker(z, W/2+(diff/half)*(W/2), W, H);
  });
  // Off-screen edge arrows
  zd.forEach(z => {
    const diff = adiff(z.brg, myHeading);
    if (Math.abs(diff) > half+15) drawEdgeArrow(z, diff, W, H);
  });
}

function drawARMarker(z, sx, W, H) {
  const { d, radius, type } = z;
  const col = COLORS[type], lbl = LABELS[type], ico = ICONS[type];
  const inside     = d <= radius;
  const approach   = d <= radius*2.5;
  const t          = Math.min(d/80, 1);
  const sy         = H*0.72 - t*(H*0.52);
  const r          = Math.max(20, Math.min(44, 44*(1-t*0.6)));

  ctx.save();
  if (type==='danger') {
    ctx.shadowColor = col;
    ctx.shadowBlur  = 12 + 18*Math.sin(Date.now()/280)**2;
  }
  ctx.beginPath(); ctx.arc(sx,sy,r+10,0,Math.PI*2);
  ctx.fillStyle = col+'22'; ctx.fill();
  ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2);
  ctx.fillStyle = col+'CC'; ctx.fill();
  ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke();
  ctx.shadowBlur=0;
  ctx.font=`${Math.round(r*.9)}px sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(ico,sx,sy);
  // stem
  ctx.beginPath(); ctx.moveTo(sx,sy+r); ctx.lineTo(sx,sy+r+14);
  ctx.strokeStyle='#fff8'; ctx.lineWidth=2; ctx.stroke();
  // label
  const cy=sy+r+18;
  chip(sx, cy, lbl, '#000B', '#fff', `bold 11px Inter`);
  // status
  const stxt = inside?'⚠️ YOU\'RE INSIDE' : approach?`⚡ ${distLabel(d)} — approaching` : distLabel(d);
  const scol = inside?'#FF3B30': approach?'#FF9500': col;
  chip(sx, cy+24, stxt, '#000A', scol, `10px Inter`);
  ctx.restore();
}

function drawEdgeArrow(z, diff, W, H) {
  const col = COLORS[z.type];
  const onLeft = diff < 0;
  const ex = onLeft ? 36 : W-36, ey = H/2;
  const alpha = z.d<=z.radius*3 ? 0.6+0.4*Math.abs(Math.sin(Date.now()/300)) : 0.85;

  ctx.save(); ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.arc(ex,ey,26,0,Math.PI*2);
  ctx.fillStyle=col+'CC'; ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();

  ctx.font='14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(onLeft?'◀':'▶', ex, ey-7);
  ctx.font='9px Inter'; ctx.fillStyle='#fff';
  ctx.fillText(distLabel(z.d), ex, ey+8);
  ctx.restore();
}

// ── Map Mode ──────────────────────────────────────────────────────────────────
function drawMapMode(zd, W, H) {
  const cx = W/2, cy = H/2, maxR = Math.min(W,H)*0.42;
  const scale = 50; // metres shown at edge of radar

  // Background
  ctx.fillStyle='#0A0C10'; ctx.fillRect(0,0,W,H);

  // Range rings
  [10,25,50].forEach(m => {
    const rr = (m/scale)*maxR;
    ctx.beginPath(); ctx.arc(cx,cy,rr,0,Math.PI*2);
    ctx.strokeStyle='#2A3040'; ctx.lineWidth=1; ctx.stroke();
    ctx.font='10px Inter'; ctx.fillStyle='#445'; ctx.textAlign='left';
    ctx.fillText(m+'m', cx+rr+4, cy);
  });

  // Cardinal directions (north-up, compensated for heading)
  const dirs = [{l:'N',b:0},{l:'E',b:90},{l:'S',b:180},{l:'W',b:270}];
  dirs.forEach(({l,b}) => {
    const a = (b - myHeading + 360)*Math.PI/180 - Math.PI/2;
    const dx = Math.cos(a)*(maxR+18), dy = Math.sin(a)*(maxR+18);
    ctx.font='bold 12px Inter'; ctx.fillStyle = l==='N'?'#FF3B30':'#8892A4';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(l, cx+dx, cy+dy);
  });

  // Zones
  zd.forEach(z => {
    const a  = (z.brg - myHeading + 360)*Math.PI/180 - Math.PI/2;
    const rr = Math.min(z.d/scale, 1)*maxR;
    const zx = cx + Math.cos(a)*rr;
    const zy = cy + Math.sin(a)*rr;
    const col = COLORS[z.type];

    // Zone radius circle
    const zrr = (z.radius/scale)*maxR;
    ctx.beginPath(); ctx.arc(zx,zy,zrr,0,Math.PI*2);
    ctx.fillStyle=col+'22'; ctx.fill();
    ctx.strokeStyle=col; ctx.lineWidth=1.5; ctx.stroke();

    // Zone dot
    ctx.beginPath(); ctx.arc(zx,zy,8,0,Math.PI*2);
    ctx.fillStyle=col+'EE'; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(ICONS[z.type],zx,zy);

    // Distance label
    ctx.font='9px Inter'; ctx.fillStyle='#fff'; ctx.textBaseline='top';
    ctx.fillText(distLabel(z.d), zx, zy+10);
  });

  // Worker (you) — always at center with heading arrow
  ctx.beginPath(); ctx.arc(cx,cy,12,0,Math.PI*2);
  ctx.fillStyle='#5B8AF5'; ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx,cy-12); ctx.lineTo(cx-7,cy+8); ctx.lineTo(cx+7,cy+8); ctx.closePath();
  ctx.fillStyle='#fff8'; ctx.fill();

  // Map label
  ctx.font='bold 13px Inter'; ctx.fillStyle='#5B8AF5';
  ctx.textAlign='center'; ctx.textBaseline='top';
  ctx.fillText('📍 You — North Up', cx, 12);
}

// ── Compass bearing bar ───────────────────────────────────────────────────────
function drawCompassBar(zd, W) {
  const barH = 44, barY = 56; // below status chips
  const half = BAR_FOV/2;

  // Background
  ctx.fillStyle='rgba(10,12,16,0.85)';
  ctx.fillRect(0, barY, W, barH);

  // Centre line
  ctx.fillStyle='rgba(255,255,255,0.6)';
  ctx.fillRect(W/2-1, barY, 2, barH);

  // Cardinal ticks
  const cards = [{l:'N',b:0},{l:'NE',b:45},{l:'E',b:90},{l:'SE',b:135},
                  {l:'S',b:180},{l:'SW',b:225},{l:'W',b:270},{l:'NW',b:315}];
  cards.forEach(({l,b}) => {
    const d = adiff(b, myHeading);
    if (Math.abs(d) > half) return;
    const x = W/2 + (d/half)*(W/2);
    ctx.fillStyle = l==='N' ? '#FF3B30' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(x-0.5, barY, 1, l.length===1?16:10);
    ctx.font = l==='N'?'bold 11px Inter':'9px Inter';
    ctx.textAlign='center'; ctx.fillStyle=l==='N'?'#FF3B30':'#aaa';
    ctx.fillText(l, x, barY+28);
  });

  // Zone dots on bar
  zd.forEach(z => {
    const d = adiff(z.brg, myHeading);
    const col = COLORS[z.type];
    const inside = z.d <= z.radius;
    const x = W/2 + (d/half)*(W/2);

    if (Math.abs(d) <= half) {
      // In range — show dot
      const r = inside ? 10+3*Math.sin(Date.now()/250) : 8;
      ctx.save();
      if (inside) { ctx.shadowColor=col; ctx.shadowBlur=10; }
      ctx.beginPath(); ctx.arc(x, barY+barH-14, r, 0, Math.PI*2);
      ctx.fillStyle=col; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.shadowBlur=0;
      ctx.font='8px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(ICONS[z.type], x, barY+barH-14);
      ctx.restore();
    } else {
      // Off screen — chevron at edge
      const ex = d<0 ? 8 : W-8;
      ctx.font='10px sans-serif'; ctx.fillStyle=col; ctx.textAlign='center';
      ctx.fillText(d<0?'◀':'▶', ex, barY+barH-14);
    }
  });
}

// ── Proximity overlay (inside zone = full screen alert) ───────────────────────
function drawProximityOverlay(zd, W, H) {
  const inside = zd.filter(z => z.d <= z.radius);
  if (!inside.length) return;

  const sev    = {danger:4,restricted:3,assembly:2,safe:1};
  const worst  = inside.sort((a,b)=>(sev[b.type]||0)-(sev[a.type]||0))[0];
  const col    = COLORS[worst.type];
  const pulse  = 0.4+0.4*Math.abs(Math.sin(Date.now()/220));

  // Pulsing border
  ctx.save();
  ctx.strokeStyle=col; ctx.lineWidth=12+pulse*10; ctx.globalAlpha=0.5+pulse*0.3;
  ctx.strokeRect(0,0,W,H);
  ctx.globalAlpha=1;

  // Alert card
  const cw=Math.min(W-32,360), ch=120, cx=(W-cw)/2, cy=H*0.38;
  ctx.fillStyle='rgba(0,0,0,0.88)';
  ctx.beginPath(); ctx.roundRect(cx,cy,cw,ch,14); ctx.fill();
  ctx.fillStyle=col; ctx.beginPath(); ctx.roundRect(cx,cy,6,ch,[14,0,0,14]); ctx.fill();

  ctx.font='36px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillText(ICONS[worst.type], cx+18, cy+ch/2-10);

  ctx.font='bold 19px Inter'; ctx.fillStyle=col;
  ctx.fillText(LABELS[worst.type]+' ZONE', cx+66, cy+30);
  ctx.font='13px Inter'; ctx.fillStyle='#fff';
  ctx.fillText(`${Math.round(worst.d)}m — You are inside this zone`, cx+66, cy+56);
  if (inside.length>1) {
    ctx.font='11px Inter'; ctx.fillStyle='#999';
    ctx.fillText(`+${inside.length-1} more zone${inside.length>2?'s':''} here`, cx+66, cy+76);
  }
  if (worst.type==='danger') {
    ctx.font=`bold ${15+Math.round(pulse*3)}px Inter`;
    ctx.fillStyle=`rgba(255,59,48,${0.8+pulse*0.2})`;
    ctx.textAlign='center';
    ctx.fillText('⛔  STOP — DO NOT PROCEED', W/2, cy+ch+32);
  }
  ctx.restore();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function chip(cx, y, txt, bg, fg, font) {
  ctx.font=font; ctx.textAlign='center'; ctx.textBaseline='top';
  const w=ctx.measureText(txt).width+14;
  ctx.fillStyle=bg; ctx.beginPath(); ctx.roundRect(cx-w/2,y,w,20,5); ctx.fill();
  ctx.fillStyle=fg; ctx.fillText(txt,cx,y+10);
}
function showMsg(W, H, msg, col='#fff') {
  const lines=msg.split('\n'), lh=22, pad=16;
  const bh=pad*2+lh*lines.length, bw=300, bx=(W-bw)/2, by=H/2-bh/2;
  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,10); ctx.fill();
  ctx.fillStyle=col; ctx.font='bold 14px Inter'; ctx.textAlign='center'; ctx.textBaseline='top';
  lines.forEach((l,i)=>ctx.fillText(l,W/2,by+pad+i*lh));
  ctx.restore();
}

// ── iOS permission ────────────────────────────────────────────────────────────
const iosBtn = document.getElementById('ios-compass-btn');
if (iosBtn) {
  iosBtn.addEventListener('click', async () => {
    if (await requestCompassPermission()) iosBtn.style.display='none';
  });
}
