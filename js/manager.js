// manager.js — Manager: place zone circles at hazard GPS location

import { startCamera } from './camera.js';
import { startGPS } from './gps.js';
import { startCompass, requestCompassPermission } from './compass.js';
import { addZone, listenToZones, deleteZone } from './db.js';

const COLORS = { danger:'#FF3B30', safe:'#34C759', restricted:'#FF9500', assembly:'#007AFF' };
const LABELS = { danger:'DANGER',  safe:'SAFE PATH', restricted:'RESTRICTED', assembly:'ASSEMBLY' };
const ICONS  = { danger:'⚠️',     safe:'✅',        restricted:'🚧',         assembly:'🏥' };
const DEF_R  = { danger:5,         safe:15,          restricted:10,           assembly:20 };

let gps = { lat:null, lng:null, acc:null }, heading=null, zones=[], radius=5;

const video    = document.getElementById('camera-feed');
const canvas   = document.getElementById('ar-canvas');
const ctx      = canvas.getContext('2d');
const gpsStat  = document.getElementById('gps-status');
const cmpsStat = document.getElementById('compass-status');
const statusEl = document.getElementById('status-msg');
const radiusEl = document.getElementById('radius-display');

function fitCanvas() { canvas.width=video.offsetWidth||window.innerWidth; canvas.height=video.offsetHeight||window.innerHeight; }
window.addEventListener('resize', fitCanvas);

startGPS((la,ln,ac)=>{
  gps={lat:la,lng:ln,acc:ac};
  gpsStat.textContent=`GPS ±${Math.round(ac)}m`; gpsStat.classList.add('locked');
},()=>{ gpsStat.textContent='GPS Error'; gpsStat.classList.remove('locked'); });

startCompass(h=>{ heading=h; cmpsStat.textContent=`${Math.round(h)}°`; cmpsStat.classList.add('locked'); });

(async()=>{
  try {
    await startCamera(video);
    video.addEventListener('loadedmetadata', fitCanvas); fitCanvas();
    toast('Stand AT the hazard — drag a zone icon onto the feed','success');
  } catch(e){ toast('Camera: '+e.message,'error'); }
})();

// ── Radius selector ───────────────────────────────────────────────────────────
const RADII = [2,3,5,8,10,15,20,30];
let radiusIdx = 2; // default 5m
if (radiusEl) radiusEl.textContent = RADII[radiusIdx]+'m';

document.getElementById('radius-minus')?.addEventListener('click',()=>{
  radiusIdx = Math.max(0,radiusIdx-1); radius=RADII[radiusIdx]; if(radiusEl) radiusEl.textContent=radius+'m';
});
document.getElementById('radius-plus')?.addEventListener('click',()=>{
  radiusIdx = Math.min(RADII.length-1,radiusIdx+1); radius=RADII[radiusIdx]; if(radiusEl) radiusEl.textContent=radius+'m';
});

// Auto-update radius when zone type dragged
document.querySelectorAll('.zone-icon').forEach(icon=>{
  icon.addEventListener('click',()=>{
    const type=icon.dataset.zone;
    radius=DEF_R[type]||5;
    radiusIdx=RADII.findIndex(r=>r>=radius); if(radiusIdx<0)radiusIdx=RADII.length-1;
    if(radiusEl) radiusEl.textContent=radius+'m';
  });
});

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
let dragType=null, ghost=null;

document.querySelectorAll('.zone-icon').forEach(icon=>{
  icon.addEventListener('dragstart',e=>{ dragType=icon.dataset.zone; e.dataTransfer.setData('text/plain',dragType); });
});

const wrapper = document.getElementById('camera-wrapper');
wrapper.addEventListener('dragover',e=>e.preventDefault());
wrapper.addEventListener('drop',async e=>{
  e.preventDefault();
  const type=e.dataTransfer.getData('text/plain')||dragType; if(!type) return;
  const r=wrapper.getBoundingClientRect();
  await place(type,e.clientX-r.left,e.clientY-r.top,r.width,r.height);
});

document.querySelectorAll('.zone-icon').forEach(icon=>{
  icon.addEventListener('touchstart',e=>{ dragType=icon.dataset.zone; ghost=mkGhost(icon); document.body.appendChild(ghost); },{passive:true});
});
document.addEventListener('touchmove',e=>{ if(!ghost)return; const t=e.touches[0]; ghost.style.left=(t.clientX-24)+'px'; ghost.style.top=(t.clientY-24)+'px'; },{passive:true});
document.addEventListener('touchend',async e=>{
  if(!ghost||!dragType)return;
  const t=e.changedTouches[0], r=wrapper.getBoundingClientRect();
  if(t.clientX>=r.left&&t.clientX<=r.right&&t.clientY>=r.top&&t.clientY<=r.bottom)
    await place(dragType,t.clientX-r.left,t.clientY-r.top,r.width,r.height);
  ghost.remove(); ghost=null; dragType=null;
},{passive:true});

function mkGhost(icon){ const g=document.createElement('div'); g.style.cssText='position:fixed;z-index:9999;pointer-events:none;font-size:40px'; g.textContent=icon.querySelector('.zone-emoji').textContent; return g; }

// ── Zone placement ────────────────────────────────────────────────────────────
// Manager stands AT the hazard. zone.lat/lng = manager's GPS = the hazard location.
// zone.radius defines the danger perimeter workers will be warned about.
async function place(type,x,y,w,h){
  if(!gps.lat){ toast('No GPS fix yet','warning'); return; }
  const data={
    type, radius,
    lat:gps.lat, lng:gps.lng,
    bearing: heading??0,
    accuracy: gps.acc,
    screenX: x/w, screenY: y/h,
    placedBy:'manager-'+mid()
  };
  try {
    await addZone(data);
    toast(`✅ ${LABELS[type]} zone (r=${radius}m) placed`,'success');
    drawMarker(x,y,type,radius,w,h);
  } catch(e){ toast('Save failed: '+e.message,'error'); }
}

function mid(){ let id=localStorage.getItem('mid'); if(!id){id=Math.random().toString(36).slice(2,8);localStorage.setItem('mid',id);} return id; }

// ── Canvas render ─────────────────────────────────────────────────────────────
listenToZones(up=>{ zones=up; redraw(); });

function redraw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  zones.forEach(z=>drawMarker(z.screenX*canvas.width,z.screenY*canvas.height,z.type,z.radius||DEF_R[z.type]||5,canvas.width,canvas.height));
}

function drawMarker(x,y,type,r,W,H){
  const col=COLORS[type], lbl=LABELS[type];
  ctx.save();
  ctx.shadowColor=col; ctx.shadowBlur=16;
  ctx.beginPath(); ctx.arc(x,y,28,0,Math.PI*2);
  ctx.fillStyle=col+'BB'; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.stroke();
  ctx.shadowBlur=0;
  ctx.font='20px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(ICONS[type],x,y);

  // Radius label badge
  ctx.font='bold 10px Inter'; ctx.fillStyle='#fff';
  const badge=`r=${r}m`, bw=ctx.measureText(badge).width+12;
  ctx.fillStyle='rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.roundRect(x-bw/2,y+32,bw,18,4); ctx.fill();
  ctx.fillStyle=col; ctx.fillText(badge,x,y+41);

  // Zone label
  ctx.font='bold 10px Inter'; const lw=ctx.measureText(lbl).width+12;
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.beginPath(); ctx.roundRect(x-lw/2,y+54,lw,18,4); ctx.fill();
  ctx.fillStyle='#fff'; ctx.fillText(lbl,x,y+63);
  ctx.restore();
}

// ── Click to delete ───────────────────────────────────────────────────────────
canvas.addEventListener('click',async e=>{
  const r=canvas.getBoundingClientRect(), cx=e.clientX-r.left, cy=e.clientY-r.top;
  for(const z of zones){
    if(Math.hypot(cx-z.screenX*canvas.width,cy-z.screenY*canvas.height)<=32){
      if(confirm(`Delete ${LABELS[z.type]} zone?`)){ await deleteZone(z.id); toast('Deleted','success'); }
      return;
    }
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let _t=null;
function toast(msg,type='info'){
  statusEl.textContent=msg; statusEl.className='status-msg '+type; statusEl.style.opacity='1';
  clearTimeout(_t); _t=setTimeout(()=>statusEl.style.opacity='0',4000);
}

const iosBtn=document.getElementById('ios-compass-btn');
if(iosBtn) iosBtn.addEventListener('click',async()=>{ if(await requestCompassPermission()){iosBtn.style.display='none';toast('Compass enabled!','success');} });
